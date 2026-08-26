import Foundation
import Observation

enum C14_7TwinStage: String, CaseIterable, Identifiable, Sendable {
  case overview
  case plan
  case reconstruction
  case reconciliation
  case confirmation

  var id: String { rawValue }
  var title: String {
    switch self {
    case .overview: "Home model"
    case .plan: "Plan proposal"
    case .reconstruction: "Photo/video"
    case .reconciliation: "Reconcile"
    case .confirmation: "Confirm twin"
    }
  }
  var symbol: String {
    switch self {
    case .overview: "house.and.flag"
    case .plan: "doc.text.magnifyingglass"
    case .reconstruction: "camera.metering.multispot"
    case .reconciliation: "point.3.connected.trianglepath.dotted"
    case .confirmation: "checkmark.seal"
    }
  }
}

enum C14_7TwinState: Equatable, Sendable {
  case idle
  case loading
  case ready
  case stale(String)
  case expired
  case forbidden
  case failure(String)
}

@MainActor
@Observable
final class C14_7TwinIntegrationModel {
  private(set) var state: C14_7TwinState = .idle
  private(set) var workspace: C14_7Workspace?
  private(set) var planProposal: C14_7PlanProposal?
  private(set) var planCalibration: C14_7PlanCalibration?
  private(set) var reconstructionResult: C14_7ReconstructionResult?
  private(set) var fusionProposal: C14_7FusionProposal?
  private(set) var fusionDecisionIds: [UUID] = []
  private(set) var activeOperations: [C14_7JSONValue] = []
  private(set) var activeDraftLabel: String?
  private(set) var preview: C14_7OperationsPreview?
  private(set) var isMutating = false
  private(set) var announcement = ""

  var selectedStage: C14_7TwinStage = .overview
  var selectedPlanAssetId: String?
  var selectedPlanJobId: UUID?
  var planReviews: [UUID: C14_7CandidateReview] = [:]
  var calibrationKnownLengthMillimetres = 1_000
  var calibrationStart = C14_7SourcePoint(x: 0, y: 0)
  var calibrationEnd = C14_7SourcePoint(x: 100, y: 0)
  var selectedReconstructionAssetIds: Set<String> = []
  var includeAppearance = false
  var selectedReconstructionJobId: UUID?
  var selectedFusionSourceIds: Set<UUID> = []
  var fusionAnchors: [UUID: [C14_7FusionAnchor]] = [:]
  var selectedFusionJobId: UUID?
  var fusionChoices: [UUID: C14_7FusionDecisionChoice] = [:]

  @ObservationIgnored private let service: any C14_7TwinIntegrationServing
  private var projectId: UUID?
  private var planReviewStartedAt: Date?
  private var planDraftReviewDurationMilliseconds: Int?
  private var loadTask: Task<Void, Never>?
  private var mutationTask: Task<Void, Never>?
  private var serviceResetTask: Task<Void, Never>?

  init(service: any C14_7TwinIntegrationServing) { self.service = service }

  var canMutate: Bool {
    state == .ready && workspace?.session.actor.role.canMutate == true && !isMutating
  }
  var confirmedTwin: Bool { state == .ready && workspace?.exactSucceededScene != nil }
  var planAssets: [EvidenceAsset] {
    workspace?.assets.filter {
      $0.kind == .plan && $0.status == .ready && $0.rights.serviceProcessingConsent
        && $0.rights.trainingUseConsent == .denied
    } ?? []
  }
  var reconstructionAssets: [EvidenceAsset] {
    workspace?.assets.filter {
      ($0.kind == .photograph || $0.kind == .video) && $0.status == .ready
        && $0.rights.serviceProcessingConsent && $0.rights.trainingUseConsent == .denied
        && $0.detectedMimeType.map({
          ["image/heic", "image/jpeg", "image/png", "video/mp4", "video/quicktime"].contains($0)
        }) == true
    } ?? []
  }
  var selectedFusionSources: [C14_7FusionSource] {
    workspace?.fusionSources.filter { selectedFusionSourceIds.contains($0.id) } ?? []
  }
  var fusionSelectionValid: Bool {
    selectedFusionSources.count >= 2 && Set(selectedFusionSources.map(\.kind)).count >= 2
      && selectedFusionSources.allSatisfy { source in
        source.coordinateFrame == "project-local"
          || validAnchors(fusionAnchors[source.id] ?? [])
      }
  }
  var allPlanCandidatesReviewed: Bool {
    guard let candidates = planProposal?.candidates, !candidates.isEmpty else { return false }
    return candidates.allSatisfy { planReviews[$0.id]?.decision != .unresolved }
      && candidates.contains { candidate in
        let decision = planReviews[candidate.id]?.decision
        return decision == .accepted || decision == .corrected
      }
  }
  var allFusionDiscrepanciesReviewed: Bool {
    guard let discrepancies = fusionProposal?.discrepancies, !discrepancies.isEmpty else {
      return false
    }
    return discrepancies.allSatisfy { fusionChoices[$0.id] != nil }
  }

  func activate(projectId rawProjectId: String, force: Bool = false) async {
    guard let nextProject = UUID(uuidString: rawProjectId) else {
      reset()
      state = .failure("The selected project identifier is invalid.")
      return
    }
    let changed = projectId != nextProject
    guard changed || force || state == .idle else { return }
    if changed {
      if projectId != nil { await service.resetPendingMutationKeys() }
      clearProjectState()
    }
    projectId = nextProject
    await serviceResetTask?.value
    await reload()
  }

  func reload(cancelInFlightMutation: Bool = true) async {
    guard let projectId else { return }
    if cancelInFlightMutation {
      mutationTask?.cancel()
      mutationTask = nil
      isMutating = false
    }
    loadTask?.cancel()
    let previous = workspace
    let previousBranch = previous?.branch
    state = .loading
    loadTask = Task { [weak self] in
      guard let self else { return }
      do {
        let next = try await service.loadWorkspace(projectId: projectId)
        try Task.checkCancellation()
        guard self.projectId == projectId else { return }
        workspace = next
        if next.session.actor.role.canMutate == false {
          await service.resetPendingMutationKeys()
          try Task.checkCancellation()
          guard self.projectId == projectId else { return }
        }
        if next.session.actor.role.canMutate == false
          || previousBranch?.id != next.branch?.id
          || previousBranch?.revision != next.branch?.revision
          || previousBranch?.headSnapshotSha256 != next.branch?.headSnapshotSha256 {
          discardLocalIntent()
        }
        alignSelections(next)
        state = .ready
        announcement = next.exactSucceededScene == nil
          ? "Fresh proposal and confirmation state loaded."
          : "Exact confirmed twin loaded. Continue to the design studio."
      } catch is CancellationError {
        return
      } catch let error as C14_5DesignStudioError {
        guard self.projectId == projectId else { return }
        if error == .offline, previous != nil {
          workspace = previous
          state = .stale("Offline. Last in-memory state is read-only and cannot advance the twin.")
        } else {
          present(error)
        }
      } catch {
        guard self.projectId == projectId else { return }
        state = .failure("The confirmed-twin workspace is unavailable.")
      }
    }
    await loadTask?.value
  }

  func reset() {
    loadTask?.cancel()
    mutationTask?.cancel()
    serviceResetTask = Task { [service] in await service.resetPendingMutationKeys() }
    projectId = nil
    clearProjectState()
    state = .idle
  }

  func initializeWorkspace() {
    mutate(success: "Unmeasured existing workspace initialized by the server.") { service, projectId, _ in
      try await service.initializeWorkspace(projectId: projectId)
    }
  }

  func startPlanJob() {
    guard let asset = planAssets.first(where: { $0.id == selectedPlanAssetId }) else { return }
    mutate(success: "Exact plan asset submitted. It remains evidence until a proposal is reviewed.") {
      service, projectId, _ in
      try await service.createPlanJob(projectId: projectId, asset: asset)
    }
  }

  func loadSelectedPlanProposal() {
    guard let jobId = selectedPlanJobId else { return }
    mutate(success: "Plan proposal loaded without accepting any candidate.", reloads: false) {
      [weak self] service, projectId, _ in
      let proposal = try await service.planProposal(projectId: projectId, jobId: jobId)
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      guard let job = workspace?.planJobs.first(where: { $0.id == jobId }),
            let asset = workspace?.assets.first(where: {
              UUID(uuidString: $0.id) == proposal.source.assetId
            }),
            job.assetId == proposal.source.assetId,
            job.sourceSha256 == proposal.source.sha256,
            asset.source.sha256 == proposal.source.sha256,
            asset.source.byteSize == proposal.source.byteSize,
            asset.detectedMimeType == proposal.source.detectedMimeType,
            asset.rights.basis == proposal.source.rights.basis,
            asset.rights.serviceProcessingConsent
              == proposal.source.rights.serviceProcessingConsent,
            asset.rights.trainingUseConsent == proposal.source.rights.trainingUseConsent else {
        throw C14_5DesignStudioError.invalidResponse
      }
      planProposal = proposal
      planCalibration = nil
      preview = nil
      activeOperations = []
      activeDraftLabel = nil
      planReviews = Dictionary(uniqueKeysWithValues: (proposal.candidates ?? []).map {
        ($0.id, C14_7CandidateReview.initial($0))
      })
      planReviewStartedAt = Date()
      planDraftReviewDurationMilliseconds = nil
    }
  }

  func calibratePlan() {
    guard let jobId = selectedPlanJobId else { return }
    let length = calibrationKnownLengthMillimetres
    let start = calibrationStart
    let end = calibrationEnd
    mutate(success: "Exact rational calibration saved.", reloads: false) {
      [weak self] service, projectId, _ in
      let value = try await service.calibratePlan(
        projectId: projectId,
        jobId: jobId,
        knownLengthMillimetres: length,
        sourceStart: start,
        sourceEnd: end
      )
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      planCalibration = value
    }
  }

  func createPlanDraft() {
    guard let jobId = selectedPlanJobId, let proposal = planProposal,
          let calibration = planCalibration, let branch = workspace?.branch,
          let actorId = workspace?.session.actor.userId,
          let reviewStartedAt = planReviewStartedAt else { return }
    let reviews = planReviews
    let reviewDuration = planDraftReviewDurationMilliseconds ?? min(
      86_400_000, max(1, Int(Date().timeIntervalSince(reviewStartedAt) * 1_000))
    )
    planDraftReviewDurationMilliseconds = reviewDuration
    mutate(success: "Reviewed C6 operations drafted against the exact branch.", reloads: false) {
      [weak self] service, projectId, _ in
      let draft = try await service.createPlanDraft(
        projectId: projectId,
        jobId: jobId,
        proposal: proposal,
        calibration: calibration,
        actorUserId: actorId,
        branch: branch,
        reviewDurationMilliseconds: reviewDuration,
        reviews: reviews
      )
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      activeOperations = draft.operations
      activeDraftLabel = "Reviewed plan proposal"
      planDraftReviewDurationMilliseconds = nil
      preview = nil
      selectedStage = .confirmation
    }
  }

  func startReconstruction() {
    let assets = reconstructionAssets.filter { selectedReconstructionAssetIds.contains($0.id) }
    let appearance = includeAppearance
    mutate(success: "C8 reconstruction submitted. Geometry remains proposal-only.") {
      service, projectId, _ in
      try await service.createReconstruction(
        projectId: projectId,
        assets: assets,
        includeAppearance: appearance
      )
    }
  }

  func loadSelectedReconstructionResult() {
    guard let jobId = selectedReconstructionJobId else { return }
    mutate(success: "Reconstruction result loaded; appearance remains non-dimensional.", reloads: false) {
      [weak self] service, projectId, _ in
      let result = try await service.reconstructionResult(projectId: projectId, jobId: jobId)
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      reconstructionResult = result
    }
  }

  func toggleFusionSource(_ source: C14_7FusionSource) {
    guard canMutate else { return }
    if selectedFusionSourceIds.remove(source.id) == nil {
      selectedFusionSourceIds.insert(source.id)
      if source.coordinateFrame != "project-local", fusionAnchors[source.id] == nil {
        fusionAnchors[source.id] = [
          .init(
            projectPoint: .init(xMm: 0, yMm: 0, zMm: 0),
            sourcePoint: .init(xMm: 0, yMm: 0, zMm: 0)
          ),
          .init(
            projectPoint: .init(xMm: 0, yMm: 0, zMm: 0),
            sourcePoint: .init(xMm: 0, yMm: 0, zMm: 0)
          ),
          .init(
            projectPoint: .init(xMm: 0, yMm: 0, zMm: 0),
            sourcePoint: .init(xMm: 0, yMm: 0, zMm: 0)
          ),
        ]
      }
    }
  }

  func startFusion() {
    guard let snapshot = workspace?.snapshot else { return }
    let sources = selectedFusionSources
    let anchors = fusionAnchors
    mutate(success: "Selected persisted sources submitted for C9 reconciliation.") {
      service, projectId, _ in
      try await service.createFusion(
        projectId: projectId,
        snapshot: snapshot,
        sources: sources,
        anchors: anchors
      )
    }
  }

  func loadSelectedFusionProposal() {
    guard let jobId = selectedFusionJobId else { return }
    mutate(success: "C9 proposal loaded. Every discrepancy still requires a choice.", reloads: false) {
      [weak self] service, projectId, _ in
      let proposal = try await service.fusionProposal(projectId: projectId, jobId: jobId)
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      guard let snapshot = workspace?.snapshot,
            proposal.baseSnapshot.modelId == snapshot.modelId,
            proposal.baseSnapshot.snapshotId == snapshot.id,
            proposal.baseSnapshot.snapshotSha256 == snapshot.snapshotSha256 else {
        throw C14_5DesignStudioError.stale
      }
      fusionProposal = proposal
      fusionChoices = [:]
      fusionDecisionIds = []
      activeOperations = []
      activeDraftLabel = nil
      preview = nil
    }
  }

  func reviewFusion() {
    guard let jobId = selectedFusionJobId, let proposal = fusionProposal else { return }
    let choices = fusionChoices
    mutate(success: "Every C9 discrepancy decision was persisted explicitly.", reloads: false) {
      [weak self] service, projectId, _ in
      let result = try await service.reviewFusion(
        projectId: projectId,
        jobId: jobId,
        proposal: proposal,
        choices: choices
      )
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      fusionProposal = result.proposal
      fusionDecisionIds = result.decisions.map(\.id)
    }
  }

  func createFusionDraft() {
    guard let jobId = selectedFusionJobId, let proposal = fusionProposal,
          let branch = workspace?.branch, !fusionDecisionIds.isEmpty else { return }
    let decisions = fusionDecisionIds
    mutate(success: "Reviewed C9 operations drafted against the exact branch.", reloads: false) {
      [weak self] service, projectId, _ in
      let draft = try await service.createFusionDraft(
        projectId: projectId,
        jobId: jobId,
        proposal: proposal,
        branch: branch,
        decisionIds: decisions
      )
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      activeOperations = draft.operations
      activeDraftLabel = "Reviewed multi-source reconciliation"
      preview = nil
      selectedStage = .confirmation
    }
  }

  func createPreview() {
    guard let branch = workspace?.branch, !activeOperations.isEmpty else { return }
    let operations = activeOperations
    mutate(success: "Exact geometry preview created. It is not committed.", reloads: false) {
      [weak self] service, projectId, _ in
      let value = try await service.preview(
        projectId: projectId,
        branch: branch,
        operations: operations
      )
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      preview = value
    }
  }

  func confirmPreview() {
    guard let branch = workspace?.branch, let preview else { return }
    mutate(success: "Explicit C5 confirmation committed. Reloading exact persisted state.") {
      [weak self] service, projectId, _ in
      _ = try await service.commit(projectId: projectId, branch: branch, preview: preview)
      guard let self, self.projectId == projectId, !Task.isCancelled else {
        throw CancellationError()
      }
      activeOperations = []
      activeDraftLabel = nil
      self.preview = nil
    }
  }

  func compileConfirmedTwin() {
    guard let snapshot = workspace?.snapshot, let branch = workspace?.branch,
          branch.revision > 0, branch.headSnapshotId != branch.sourceSnapshotId,
          branch.headSnapshotId == snapshot.id,
          branch.headSnapshotSha256 == snapshot.snapshotSha256 else { return }
    mutate(success: "Exact C10 compilation submitted; polling fresh persisted state.") {
      [weak self] service, projectId, _ in
      try await service.createScene(projectId: projectId, snapshot: snapshot)
      guard let self else { return }
      for _ in 0..<20 {
        try Task.checkCancellation()
        try await Task.sleep(for: .seconds(1))
        let next = try await service.loadWorkspace(projectId: projectId)
        try Task.checkCancellation()
        guard self.projectId == projectId else { throw CancellationError() }
        workspace = next
        if next.exactSucceededScene != nil { break }
      }
    }
  }

  private func mutate(
    success: String,
    reloads: Bool = true,
    operation: @escaping @MainActor @Sendable (
      any C14_7TwinIntegrationServing, UUID, C14_7Workspace
    ) async throws -> Void
  ) {
    guard canMutate, let projectId, let exactWorkspace = workspace else { return }
    mutationTask?.cancel()
    isMutating = true
    mutationTask = Task { [weak self, service] in
      guard let self else { return }
      do {
        try await operation(service, projectId, exactWorkspace)
        try Task.checkCancellation()
        guard self.projectId == projectId else { return }
        announcement = success
        if reloads { await reload(cancelInFlightMutation: false) }
      } catch is CancellationError {
        return
      } catch let error as C14_5DesignStudioError {
        guard self.projectId == projectId else { return }
        if error == .stale || error == .gone {
          activeOperations = []
          activeDraftLabel = nil
          preview = nil
          announcement = "Exact server state changed. Local intent was discarded; reload and review again."
          await reload(cancelInFlightMutation: false)
        } else {
          present(error)
        }
      } catch {
        guard self.projectId == projectId else { return }
        state = .failure("The requested exact operation could not be completed.")
      }
      if self.projectId == projectId { isMutating = false }
    }
  }

  private func present(_ error: C14_5DesignStudioError) {
    isMutating = false
    switch error {
    case .expired: state = .expired
    case .forbidden, .notFound: state = .forbidden
    case .offline: state = .stale("Offline. No proposal or confirmation action is available.")
    case .stale, .gone: state = .failure("Exact server state changed. Reload before continuing.")
    case .rejected: state = .failure("The server rejected this proposal, geometry or exact pin.")
    case .throttled: state = .failure("The service is busy. Retry after the server limit clears.")
    case .unavailable: state = .failure("The required producer or service is unavailable.")
    case .invalidResponse: state = .failure("The server response failed strict contract validation.")
    }
  }

  private func alignSelections(_ next: C14_7Workspace) {
    if !planAssets.contains(where: { $0.id == selectedPlanAssetId }) {
      selectedPlanAssetId = nil
    }
    if !next.planJobs.contains(where: { $0.id == selectedPlanJobId }) {
      selectedPlanJobId = nil
    }
    if !next.reconstructionJobs.contains(where: { $0.id == selectedReconstructionJobId }) {
      selectedReconstructionJobId = nil
    }
    if !next.fusionJobs.contains(where: { $0.id == selectedFusionJobId }) {
      selectedFusionJobId = nil
    }
    let eligibleAssetIds = Set(reconstructionAssets.map(\.id))
    selectedReconstructionAssetIds.formIntersection(eligibleAssetIds)
    let eligibleSourceIds = Set(next.fusionSources.map(\.id))
    selectedFusionSourceIds.formIntersection(eligibleSourceIds)
    fusionAnchors = fusionAnchors.filter { eligibleSourceIds.contains($0.key) }
  }

  private func clearProjectState() {
    loadTask?.cancel()
    mutationTask?.cancel()
    workspace = nil
    planProposal = nil
    planCalibration = nil
    reconstructionResult = nil
    fusionProposal = nil
    fusionDecisionIds = []
    activeOperations = []
    activeDraftLabel = nil
    preview = nil
    isMutating = false
    announcement = ""
    selectedStage = .overview
    selectedPlanAssetId = nil
    selectedPlanJobId = nil
    planReviews = [:]
    planReviewStartedAt = nil
    planDraftReviewDurationMilliseconds = nil
    selectedReconstructionAssetIds = []
    selectedReconstructionJobId = nil
    selectedFusionSourceIds = []
    fusionAnchors = [:]
    selectedFusionJobId = nil
    fusionChoices = [:]
  }

  private func discardLocalIntent() {
    planProposal = nil
    planCalibration = nil
    planReviewStartedAt = nil
    planDraftReviewDurationMilliseconds = nil
    planReviews = [:]
    reconstructionResult = nil
    fusionProposal = nil
    fusionDecisionIds = []
    fusionChoices = [:]
    activeOperations = []
    activeDraftLabel = nil
    preview = nil
  }

  private func validAnchors(_ anchors: [C14_7FusionAnchor]) -> Bool {
    guard anchors.count >= 3,
          anchors.allSatisfy({ $0.sourcePoint.isValid && $0.projectPoint.isValid }) else {
      return false
    }
    return nonCollinear(anchors.map(\.sourcePoint)) && nonCollinear(anchors.map(\.projectPoint))
  }

  private func nonCollinear(_ points: [C14_7FusionPoint]) -> Bool {
    guard points.count >= 3, points.allSatisfy(\.isValid) else { return false }
    for first in 0..<(points.count - 2) {
      for second in (first + 1)..<(points.count - 1) {
        for third in (second + 1)..<points.count {
          let a = points[first], b = points[second], c = points[third]
          let ab = (b.xMm - a.xMm, b.yMm - a.yMm, b.zMm - a.zMm)
          let ac = (c.xMm - a.xMm, c.yMm - a.yMm, c.zMm - a.zMm)
          if (
            ab.1 * ac.2 - ab.2 * ac.1,
            ab.2 * ac.0 - ab.0 * ac.2,
            ab.0 * ac.1 - ab.1 * ac.0
          ) != (0, 0, 0) { return true }
        }
      }
    }
    return false
  }
}

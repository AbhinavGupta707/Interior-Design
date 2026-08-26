import CrossDeviceContinuityClient
import Foundation
import Observation

enum C14_5DesignStage: String, CaseIterable, Identifiable, Sendable {
  case explore
  case brief
  case options
  case specification
  case render

  var id: String { rawValue }

  var title: String {
    switch self {
    case .explore: "Explore twin"
    case .brief: "Design brief"
    case .options: "Compare options"
    case .specification: "Materials"
    case .render: "Render still"
    }
  }

  var symbol: String {
    switch self {
    case .explore: "cube.transparent"
    case .brief: "text.badge.checkmark"
    case .options: "rectangle.3.group"
    case .specification: "swatchpalette"
    case .render: "photo"
    }
  }
}

enum C14_5WorkspaceState: Equatable, Sendable {
  case idle
  case loading
  case ready
  case stale(C14_5RecoverySummary, message: String)
  case expired
  case forbidden
  case failure(String)
}

@MainActor
@Observable
final class C14_5DesignStudioModel {
  private(set) var state: C14_5WorkspaceState = .idle
  private(set) var workspace: C14_5Workspace?
  private(set) var verifiedArtifact: C14_5VerifiedArtifact?
  private(set) var substitutionPreview: C14_5SubstitutionPreview?
  private(set) var isMutating = false
  private(set) var announcement = ""

  var selectedStage: C14_5DesignStage = .explore
  var briefStatement = ""
  var briefCategory = "spatial-need"
  var briefClassification = "preference"
  var selectedOptionId: UUID?
  var selectedReplacementId: UUID?
  var selectedSourceJobId: UUID?
  var selectedCameraId: UUID?
  var selectedProfileId = "cycles-cpu-geometry-safe-v1"

  @ObservationIgnored private let service: any C14_5DesignStudioServing
  @ObservationIgnored private let recovery: any C14_5RecoveryStoring
  private var projectId: UUID?
  private var loadTask: Task<Void, Never>?
  private var mutationTask: Task<Void, Never>?
  private var artifactTask: Task<Void, Never>?

  init(
    service: any C14_5DesignStudioServing,
    recovery: any C14_5RecoveryStoring = C14_5ProtectedRecoveryStore()
  ) {
    self.service = service
    self.recovery = recovery
  }

  var role: C14_5MemberRole? { workspace?.session.actor.role }
  var canMutate: Bool {
    state == .ready && role?.canMutate == true && workspace?.designEligible == true
  }
  var designEligible: Bool { state == .ready && workspace?.designEligible == true }

  func activate(projectId rawProjectId: String, force: Bool = false) async {
    guard let id = UUID(uuidString: rawProjectId) else {
      clearProjectState()
      state = .failure("The selected project identifier is invalid.")
      return
    }
    let projectChanged = projectId != id
    guard force || projectChanged || state == .idle else { return }
    if projectChanged { clearProjectState() }
    projectId = id
    await reload()
  }

  func reload() async {
    guard let projectId else { return }
    loadTask?.cancel()
    state = .loading
    loadTask = Task { [weak self] in
      guard let self else { return }
      do {
        let next = try await service.loadWorkspace(projectId: projectId)
        try Task.checkCancellation()
        guard self.projectId == projectId else { return }
        workspace = next
        verifiedArtifact = nil
        substitutionPreview = nil
        alignSelections(next)
        state = .ready
        announcement = next.designEligible
          ? "Server-confirmed twin and native design stages loaded."
          : "Design remains locked until every exact server prerequisite is satisfied."
        try? await recovery.save(C14_5RecoverySummary.make(projectId: projectId, workspace: next))
      } catch is CancellationError {
        return
      } catch let error as C14_5DesignStudioError {
        guard self.projectId == projectId, !Task.isCancelled else { return }
        await present(error, projectId: projectId)
      } catch {
        guard self.projectId == projectId, !Task.isCancelled else { return }
        await present(.unavailable, projectId: projectId)
      }
    }
    await loadTask?.value
  }

  func addBriefEntry() {
    runMutation(success: "Brief entry saved with user-stated provenance.") { [self] projectId, workspace in
      try await service.updateBrief(
        projectId: projectId,
        actorId: workspace.session.actor.userId,
        expectedRevision: workspace.brief?.brief.revision ?? 0,
        statement: briefStatement,
        category: briefCategory,
        classification: briefClassification
      )
      guard self.projectId == projectId, !Task.isCancelled else { throw CancellationError() }
      self.briefStatement = ""
    }
  }

  func acceptBrief() {
    runMutation(success: "Exact design brief accepted.") { [service] projectId, workspace in
      guard let brief = workspace.brief else { throw C14_5DesignStudioError.rejected }
      try await service.acceptBrief(projectId: projectId, expectedRevision: brief.brief.revision)
    }
  }

  func generateOptions() {
    runMutation(success: "Two exact-source option directions submitted.") { [service] projectId, workspace in
      guard let brief = workspace.brief, let snapshot = workspace.snapshot else {
        throw C14_5DesignStudioError.rejected
      }
      try await service.createOptions(projectId: projectId, brief: brief, snapshot: snapshot)
    }
  }

  func confirmSelectedOption() {
    runMutation(success: "Selected option confirmed into proposed state only.") { [self] projectId, workspace in
      guard let response = workspace.options,
            let set = response.optionSet,
            let option = response.options.first(where: { $0.id == selectedOptionId }),
            let job = workspace.optionJobs.first(where: { $0.id == response.jobId }),
            let brief = workspace.brief,
            let snapshot = workspace.snapshot
      else { throw C14_5DesignStudioError.rejected }
      _ = try await service.confirmOption(
        projectId: projectId,
        job: job,
        option: option,
        set: set,
        brief: brief,
        snapshot: snapshot
      )
    }
  }

  func createSpecification() {
    runMutation(success: "Specification created from the server-recovered confirmation.") {
      [service] projectId, workspace in
      guard let confirmation = workspace.recoveredConfirmation,
            let release = workspace.catalogReleases.last(where: { $0.status == "published" })
      else { throw C14_5DesignStudioError.rejected }
      try await service.createSpecification(
        projectId: projectId,
        confirmation: confirmation,
        release: release
      )
    }
  }

  func previewSubstitution() {
    runMutation(success: "Bounded material substitution preview created.", reloads: false) {
      [self] projectId, workspace in
      guard let specification = workspace.currentSpecification,
            let line = specification.currentRevision.lines.first,
            let replacement = workspace.catalogAssets.first(where: {
              $0.id == selectedReplacementId && $0.kind == line.kind
                && $0.versionId != line.assetVersionId
            })
      else { throw C14_5DesignStudioError.rejected }
      let preview = try await service.createSubstitutionPreview(
        projectId: projectId,
        specification: specification,
        line: line,
        replacement: replacement
      )
      guard self.projectId == projectId, !Task.isCancelled else { throw CancellationError() }
      self.substitutionPreview = preview
    }
  }

  func confirmSubstitution() {
    runMutation(success: "Exact substitution confirmed; proposed scene compilation requested.") {
      [self] projectId, workspace in
      guard let specification = workspace.currentSpecification,
            let preview = substitutionPreview
      else { throw C14_5DesignStudioError.rejected }
      try await service.confirmSubstitution(
        projectId: projectId,
        specification: specification,
        preview: preview
      )
      guard self.projectId == projectId, !Task.isCancelled else { throw CancellationError() }
      self.substitutionPreview = nil
    }
  }

  func submitRender() {
    runMutation(success: "Geometry-safe render job submitted for server revalidation.") {
      [self] projectId, workspace in
      guard let sources = workspace.eligibleSources?.sources,
            let source = sources.first(where: { $0.source.sceneJobId == selectedSourceJobId }),
            let camera = source.cameras.first(where: { $0.cameraId == selectedCameraId }),
            workspace.renderCapabilities?.acceptingNewJobs == true,
            workspace.renderCapabilities?.profiles.contains(where: {
              $0.profileId == selectedProfileId && $0.available
            }) == true
      else { throw C14_5DesignStudioError.rejected }
      try await service.createRender(
        projectId: projectId,
        source: source,
        camera: camera,
        profileId: selectedProfileId
      )
    }
  }

  func loadGeometrySafeArtifact() {
    guard !isMutating, let projectId, let workspace,
          let result = workspace.renderResult,
          let job = workspace.renderJobs.first(where: { $0.id == result.jobId }),
          let artifact = result.manifest.artifacts.first(where: { $0.role == "geometry-safe-png" })
    else { return }
    isMutating = true
    artifactTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if self.projectId == projectId { self.isMutating = false }
      }
      do {
        let verified = try await service.verifiedArtifact(
          projectId: projectId,
          jobId: job.id,
          artifact: artifact,
          manifestSha256: result.manifestSha256
        )
        try Task.checkCancellation()
        guard self.projectId == projectId else { return }
        self.verifiedArtifact = verified
        self.announcement = "Geometry-safe PNG verified by byte length and SHA-256."
      } catch is CancellationError {
        return
      } catch let error as C14_5DesignStudioError {
        guard self.projectId == projectId else { return }
        self.announcement = self.message(for: error)
      } catch {
        guard self.projectId == projectId else { return }
        self.announcement = "Artifact verification failed safely."
      }
    }
  }

  func selectSource(_ source: RenderEligibleSource) {
    selectedSourceJobId = source.source.sceneJobId
    selectedCameraId = source.cameras.first?.cameraId
  }

  private func runMutation(
    success: String,
    reloads: Bool = true,
    operation: @escaping @MainActor (UUID, C14_5Workspace) async throws -> Void
  ) {
    guard !isMutating, canMutate, let projectId, let workspace else { return }
    isMutating = true
    announcement = ""
    mutationTask = Task { [weak self] in
      guard let self else { return }
      defer {
        if self.projectId == projectId { self.isMutating = false }
      }
      do {
        try await operation(projectId, workspace)
        try Task.checkCancellation()
        guard self.projectId == projectId else { return }
        self.announcement = success
        if reloads { await self.reload() }
      } catch is CancellationError {
        return
      } catch let error as C14_5DesignStudioError {
        guard self.projectId == projectId else { return }
        self.announcement = self.message(for: error)
      } catch {
        guard self.projectId == projectId else { return }
        self.announcement = "The server action failed safely."
      }
    }
  }

  private func present(_ error: C14_5DesignStudioError, projectId: UUID) async {
    switch error {
    case .expired:
      state = .expired
    case .forbidden, .notFound:
      state = .forbidden
    case .offline, .unavailable:
      if let cached = try? await recovery.load(projectId: projectId) {
        state = .stale(cached, message: message(for: error))
      } else if let workspace {
        state = .stale(
          C14_5RecoverySummary.make(projectId: projectId, workspace: workspace),
          message: message(for: error)
        )
      } else {
        state = .failure(message(for: error))
      }
    case .stale, .gone, .rejected, .throttled, .invalidResponse:
      state = .failure(message(for: error))
    }
  }

  private func alignSelections(_ workspace: C14_5Workspace) {
    if workspace.options?.options.contains(where: { $0.id == selectedOptionId }) != true {
      selectedOptionId = workspace.options?.options.first(where: { $0.status == "pending" })?.id
    }
    if workspace.catalogAssets.contains(where: { $0.id == selectedReplacementId }) != true {
      if let line = workspace.currentSpecification?.currentRevision.lines.first {
        selectedReplacementId = workspace.catalogAssets.first(where: {
          $0.kind == line.kind && $0.versionId != line.assetVersionId
        })?.id
      } else {
        selectedReplacementId = workspace.catalogAssets.first?.id
      }
    }
    let sources = workspace.eligibleSources?.sources ?? []
    if sources.contains(where: { $0.source.sceneJobId == selectedSourceJobId }) != true {
      selectedSourceJobId = sources.first?.source.sceneJobId
    }
    if let source = sources.first(where: { $0.source.sceneJobId == selectedSourceJobId }),
       source.cameras.contains(where: { $0.cameraId == selectedCameraId }) != true {
      selectedCameraId = source.cameras.first?.cameraId
    }
    let profiles = workspace.renderCapabilities?.profiles.filter(\.available) ?? []
    if profiles.contains(where: { $0.profileId == selectedProfileId }) != true,
       let fallback = profiles.first {
      selectedProfileId = fallback.profileId
    }
  }

  private func message(for error: C14_5DesignStudioError) -> String {
    switch error {
    case .offline: "You’re offline. Last-verified state is display-only; no action was queued."
    case .expired: "The session expired. Sign in again; no state was changed."
    case .forbidden, .notFound: "This project or action is unavailable to the current role."
    case .stale: "Server state changed. Reload the exact revision and pins before trying again."
    case .gone: "The exact preview or access grant expired. Request a fresh server record."
    case .rejected: "The server rejected this exact request. No partial result was promoted."
    case .throttled: "The service is busy. Reload before making another explicit request."
    case .unavailable: "The service is unavailable. No completion state was inferred."
    case .invalidResponse: "The server response failed strict native validation."
    }
  }

  private func clearProjectState() {
    loadTask?.cancel()
    mutationTask?.cancel()
    artifactTask?.cancel()
    loadTask = nil
    mutationTask = nil
    artifactTask = nil
    workspace = nil
    verifiedArtifact = nil
    substitutionPreview = nil
    projectId = nil
    selectedStage = .explore
    briefStatement = ""
    briefCategory = "spatial-need"
    briefClassification = "preference"
    selectedOptionId = nil
    selectedReplacementId = nil
    selectedSourceJobId = nil
    selectedCameraId = nil
    selectedProfileId = "cycles-cpu-geometry-safe-v1"
    announcement = ""
    isMutating = false
  }
}

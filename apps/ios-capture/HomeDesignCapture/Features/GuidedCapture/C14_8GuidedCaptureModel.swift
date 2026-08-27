@preconcurrency import ARKit
import Foundation
import Observation

enum C14_8SubmissionStage: String, Equatable, Sendable {
  case accepting = "Accepting immutable envelope"
  case creatingSession = "Creating scoped capture session"
  case uploadingDepth = "Uploading optional depth"
  case uploadingRGB = "Uploading immutable RGB"
}

enum C14_8GuidedCaptureState: Equatable, Sendable {
  case accepted(sourcesReady: Bool)
  case cameraDenied
  case cameraRestricted
  case capturing
  case checking
  case failed(message: String, retryable: Bool)
  case fixtureReview
  case interrupted
  case permissionRequired
  case readOnly
  case ready
  case reconstructed(jobId: UUID)
  case review
  case startingReconstruction
  case submitting(stage: C14_8SubmissionStage, progress: Double)
  case unavailable
}

struct C14_8RoomPlanCandidate: Identifiable, Sendable {
  let captureLabel: String
  let rightsBasis: C7RightsBasis
  let source: C14_8RoomPlanSource

  var id: String { "\(source.captureSessionId.uuidString):\(source.packageId.uuidString)" }
}

@MainActor
@Observable
final class C14_8GuidedCaptureModel {
  private(set) var capabilities: C14_8CapabilityDeclaration
  private(set) var draft: C14_8GuidedCaptureDraft?
  private(set) var liveTelemetry: C14_8LiveTelemetry?
  private(set) var roomPlanCandidates: [C14_8RoomPlanCandidate] = []
  private(set) var roomPlanDiscoveryInProgress = false
  private(set) var roomPlanDiscoveryMessage: String?
  private(set) var state: C14_8GuidedCaptureState = .checking

  var includeAppearance = false
  var rightsBasis: EvidenceRightsBasis = .ownedByUser
  var serviceProcessingConsent = false

  @ObservationIgnored private var activationId = UUID()
  @ObservationIgnored private var activeTask: Task<Void, Never>?
  @ObservationIgnored private var authenticatedActorUserId: UUID?
  @ObservationIgnored private var authenticatedTenantId: UUID?
  @ObservationIgnored private var currentRole = "viewer"
  @ObservationIgnored private let capabilityProvider: any C14_8CapabilityProviding
  @ObservationIgnored private let captureService: any C7CaptureServing
  @ObservationIgnored private let depthUploader: any C14_8DepthUploading
  @ObservationIgnored private let engine: any C14_8GuidedCaptureServing
  @ObservationIgnored private let envelopeService: any C14_8CaptureEnvelopeServing
  @ObservationIgnored private let evidenceService: any EvidenceServing
  @ObservationIgnored private let journal: any C14_8ProtectedCaptureStoring
  @ObservationIgnored private let mediaStore: any C8ProtectedMediaStoring
  @ObservationIgnored private let mediaUploader: any C8ImmutableEvidenceUploading
  @ObservationIgnored private let permissionProvider: any C8CameraPermissionProviding
  @ObservationIgnored private var pendingSegmentReason: C14_8SegmentReason?
  @ObservationIgnored private var projectId: UUID?
  @ObservationIgnored private var scopeMismatch = false

  init(
    capabilityProvider: any C14_8CapabilityProviding,
    permissionProvider: any C8CameraPermissionProviding,
    engine: any C14_8GuidedCaptureServing,
    captureService: any C7CaptureServing,
    envelopeService: any C14_8CaptureEnvelopeServing,
    evidenceService: any EvidenceServing,
    mediaUploader: any C8ImmutableEvidenceUploading,
    depthUploader: any C14_8DepthUploading,
    journal: any C14_8ProtectedCaptureStoring = C14_8ProtectedCaptureStore(),
    mediaStore: any C8ProtectedMediaStoring = C8ProtectedMediaStore()
  ) {
    self.capabilityProvider = capabilityProvider
    self.permissionProvider = permissionProvider
    self.engine = engine
    self.captureService = captureService
    self.envelopeService = envelopeService
    self.evidenceService = evidenceService
    self.mediaUploader = mediaUploader
    self.depthUploader = depthUploader
    self.journal = journal
    self.mediaStore = mediaStore
    capabilities = capabilityProvider.current()
  }

  var previewSession: ARSession? { engine.previewSession }
  var isSyntheticFixture: Bool {
    capabilities.runtime == .simulatorFixture || engine.syntheticFixture
  }
  var canMutate: Bool {
    guard !scopeMismatch,
      currentRole == "owner" || currentRole == "editor",
      let authenticatedActorUserId,
      let authenticatedTenantId
    else { return false }
    return draft.map {
      $0.actorUserId == authenticatedActorUserId && $0.tenantId == authenticatedTenantId
    } ?? true
  }
  var rightsAreBound: Bool {
    draft?.captureSession != nil || draft?.mediaReceipts.isEmpty == false
      || draft?.roomPlanSources.isEmpty == false
  }
  var currentRoom: C14_8RoomEnvelope? { draft?.rooms.last }
  var currentRoomIndex: Int? { draft.map { max(0, $0.rooms.count - 1) } }
  var capturedKeyframeCount: Int { draft?.keyframes.count ?? 0 }
  var observedCellCount: Int {
    currentRoom?.coverage.filter { $0.status == .observed }.count ?? 0
  }
  var totalRoomCount: Int { draft?.rooms.count ?? 0 }

  var guidance: [String] {
    guard let telemetry = liveTelemetry else {
      return ["Aim at a wall, corner or opening; the live cell will appear here."]
    }
    var result: [String] = []
    if telemetry.trackingState != .normal {
      result.append("Tracking is limited. Move slowly toward a textured surface before retaining a keyframe.")
    }
    if telemetry.motionScoreMillionths > 400_000 {
      result.append("Slow down and hold steady.")
    }
    if telemetry.exposureScoreMillionths < C8CaptureQualityEvaluator.minimumAcceptedExposure
      || (telemetry.ambientIntensity ?? 1_000) < 300
    {
      result.append("Improve even lighting; avoid dark corners and bright windows.")
    }
    if telemetry.blurScoreMillionths < C8CaptureQualityEvaluator.minimumAcceptedBlur {
      result.append("This view is blurry. Pause before capture.")
    }
    if currentRoom?.coverage.first(where: { $0.id == telemetry.coverageCellId })?.status
      == .observed
    {
      result.append("This area is covered. Turn toward a missing lower, middle or upper area.")
    } else {
      result.append("This area is missing. Retain a keyframe when steady.")
    }
    return result
  }

  func activate(projectId rawProjectId: String, actor: C14_6Actor) async {
    resetMemory()
    capabilities = capabilityProvider.current()
    guard let projectId = UUID(uuidString: rawProjectId),
      let actorUserId = UUID(uuidString: actor.userId),
      let tenantId = UUID(uuidString: actor.tenantId)
    else {
      state = .failed(message: "The authenticated capture scope is invalid.", retryable: false)
      return
    }
    self.projectId = projectId
    authenticatedActorUserId = actorUserId
    authenticatedTenantId = tenantId
    currentRole = actor.role
    let scope = activationId
    do {
      if let restored = try await journal.load(projectId: projectId) {
        guard scope == activationId, self.projectId == projectId else { return }
        guard restored.actorUserId == actorUserId, restored.tenantId == tenantId else {
          draft = nil
          scopeMismatch = true
          state = .readOnly
          return
        }
        draft = restored
        guard scope == activationId else { return }
        rightsBasis = restored.captureSession?.brief.rights.basis.evidenceBasis ?? .ownedByUser
        serviceProcessingConsent = restored.captureSession != nil
        if restored.acceptance != nil {
          state = .accepted(sourcesReady: false)
          await checkSourceReadiness()
        } else if !canMutate {
          state = .readOnly
        } else if restored.keyframes.isEmpty {
          var resumed = restored
          appendSegment(reason: .relaunch, to: &resumed)
          resumed.updatedAt = Date()
          try await journal.save(resumed)
          guard scope == activationId, self.projectId == projectId else { return }
          draft = resumed
          await preflight(
            requestPermission: false,
            actorUserId: actorUserId,
            tenantId: tenantId,
            scope: scope,
            expectedProjectId: projectId
          )
        } else {
          pendingSegmentReason = .relaunch
          state = .review
        }
        return
      }
      guard canMutate else {
        state = .readOnly
        return
      }
      await preflight(
        requestPermission: false,
        actorUserId: actorUserId,
        tenantId: tenantId,
        scope: scope,
        expectedProjectId: projectId
      )
    } catch {
      guard scope == activationId, self.projectId == projectId else { return }
      state = .failed(
        message: "Protected capture recovery could not be validated for this project.",
        retryable: true
      )
    }
  }

  func requestPermission() {
    guard let projectId, let actor = draftScope ?? pendingActorScope else { return }
    activeTask?.cancel()
    let scope = activationId
    activeTask = Task { [weak self] in
      guard let self, scope == self.activationId, self.projectId == projectId else { return }
      await self.preflight(
        requestPermission: true,
        actorUserId: actor.actorUserId,
        tenantId: actor.tenantId,
        scope: scope,
        expectedProjectId: projectId
      )
    }
  }

  func captureKeyframe() {
    guard canMutate, state == .ready, let projectId, let draft, let room = draft.rooms.last,
      let segment = draft.segments.last
    else { return }
    state = .capturing
    let scope = activationId
    activeTask = Task { [weak self] in
      guard let self else { return }
      do {
        let destination = try await self.mediaStore.allocateDestination()
        do {
          let captured = try await self.engine.captureKeyframe(
            to: destination.url,
            localIdentifier: destination.id,
            roomId: room.roomId,
            segmentId: segment.segmentId,
            captureStartedAt: draft.createdAt
          )
          let handle = try await self.mediaStore.finalize(
            id: destination.id,
            mimeType: .jpeg,
            containsDepthData: captured.depthData?.isEmpty == false,
            origin: self.engine.syntheticFixture
              ? .syntheticSimulatorFixture : .physicalCamera
          )
          try self.assertCurrent(scope: scope, projectId: projectId)
          var next = self.draft ?? draft
          next.keyframes.append(handle)
          next.samples.append(captured.sample)
          if let data = captured.depthData, !data.isEmpty,
            let width = captured.depthWidth, let height = captured.depthHeight
          {
            let depth = try await self.journal.storeDepth(
              projectId: projectId,
              sampleId: captured.sample.sampleId,
              data: data,
              width: width,
              height: height
            )
            next.depthHandles.append(depth)
            try self.assertCurrent(scope: scope, projectId: projectId)
          }
          self.markObserved(telemetry: self.liveTelemetry, in: &next)
          self.closeCurrentSegment(in: &next)
          next.updatedAt = Date()
          try self.assertCurrent(scope: scope, projectId: projectId)
          try await self.journal.save(next)
          try self.assertCurrent(scope: scope, projectId: projectId)
          self.draft = next
          self.state = .ready
        } catch {
          try? FileManager.default.removeItem(at: destination.url)
          throw error
        }
      } catch {
        guard scope == self.activationId else { return }
        self.state = .failed(
          message: "No keyframe was retained. Restore tracking, lighting and protected storage, then retry.",
          retryable: true
        )
      }
    }
  }

  func finishRoomReview() {
    guard canMutate, var next = draft, !next.keyframes.isEmpty, next.acceptance == nil else { return }
    closeCurrentSegment(in: &next)
    next.endedAt = Date()
    next.updatedAt = Date()
    engine.stop()
    draft = next
    state = engine.syntheticFixture ? .fixtureReview : .review
    Task { try? await journal.save(next) }
  }

  func captureMore() {
    guard var next = draft, canMutate, next.acceptance == nil else { return }
    appendSegment(reason: pendingSegmentReason ?? .manualRestart, to: &next)
    pendingSegmentReason = nil
    next.endedAt = nil
    next.updatedAt = Date()
    draft = next
    Task { try? await journal.save(next) }
    startEngine()
  }

  func addRoom() {
    guard var next = draft, canMutate, next.acceptance == nil,
      next.rooms.count < C14_8CaptureContract.maximumRooms
    else { return }
    closeCurrentSegment(in: &next)
    engine.stop()
    appendSegment(reason: .roomTransition, to: &next, attachToCurrentRoom: false)
    guard let segmentId = next.segments.last?.segmentId else { return }
    next.rooms.append(
      .empty(label: "Room \(next.rooms.count + 1)", sequence: next.rooms.count + 1, segmentId: segmentId)
    )
    next.endedAt = nil
    next.updatedAt = Date()
    draft = next
    Task { try? await journal.save(next) }
    startEngine()
  }

  func renameCurrentRoom(_ label: String) {
    guard canMutate, var next = draft, next.acceptance == nil, let index = currentRoomIndex else {
      return
    }
    let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 120 else { return }
    next.rooms[index].label = trimmed
    next.updatedAt = Date()
    draft = next
    Task { try? await journal.save(next) }
  }

  func cycleCoverage(_ cellId: String) {
    guard canMutate, var next = draft, next.acceptance == nil, let roomIndex = currentRoomIndex,
      let cellIndex = next.rooms[roomIndex].coverage.firstIndex(where: { $0.id == cellId }),
      next.rooms[roomIndex].coverage[cellIndex].status != .observed
    else { return }
    switch next.rooms[roomIndex].coverage[cellIndex].status {
    case .missing: next.rooms[roomIndex].coverage[cellIndex].status = .occluded
    case .occluded: next.rooms[roomIndex].coverage[cellIndex].status = .unknown
    case .unknown: next.rooms[roomIndex].coverage[cellIndex].status = .missing
    case .observed: break
    }
    next.updatedAt = Date()
    draft = next
    Task { try? await journal.save(next) }
  }

  func updateSemantic(layer: C14_8SemanticLayer, status: C14_8SemanticStatus) {
    guard canMutate, var next = draft, next.acceptance == nil, let roomIndex = currentRoomIndex,
      let index = next.rooms[roomIndex].semanticDeclarations.firstIndex(where: { $0.layer == layer })
    else { return }
    next.rooms[roomIndex].semanticDeclarations[index].status = status
    next.updatedAt = Date()
    draft = next
    Task { try? await journal.save(next) }
  }

  func refreshRoomPlanSources() {
    guard capabilities.roomPlan, canMutate, let projectId else { return }
    let scope = activationId
    roomPlanDiscoveryInProgress = true
    roomPlanDiscoveryMessage = nil
    activeTask?.cancel()
    activeTask = Task { [weak self] in
      guard let self else { return }
      do {
        let sessions = try await self.captureService.listSessions(projectId: projectId)
        try self.assertCurrent(scope: scope, projectId: projectId)
        let eligible = sessions.filter { session in
          session.projectId == projectId
            && session.id != self.draft?.captureSession?.id
            && (session.brief.deviceCapability == nil
              || session.brief.deviceCapability
                == C7CaptureDeviceCapability.roomPlanLiDAR.rawValue)
            && session.brief.rights.serviceProcessingConsent
            && session.brief.rights.trainingUseConsent == "denied"
            && session.brief.rights.basis == self.rightsBasis.c7Basis
            && (session.state == .proposed || session.state == .abstained)
        }.prefix(C14_8CaptureContract.maximumRooms)
        var candidates: [C14_8RoomPlanCandidate] = []
        for session in eligible {
          let result = try await self.captureService.proposal(
            projectId: projectId,
            captureSessionId: session.id
          )
          try self.assertCurrent(scope: scope, projectId: projectId)
          let source: C14_8RoomPlanSource
          switch result {
          case .proposal(let proposal):
            source = C14_8RoomPlanSource(
              captureSessionId: proposal.captureSessionId,
              packageId: proposal.packageId,
              packageManifestSha256: proposal.packageManifestSha256
            )
          case .abstained(let abstention):
            source = C14_8RoomPlanSource(
              captureSessionId: abstention.captureSessionId,
              packageId: abstention.packageId,
              packageManifestSha256: abstention.packageManifestSha256
            )
          }
          guard source.captureSessionId == session.id, source.packageId == session.packageId else {
            throw C14_8ContractError.invalidEvidence
          }
          candidates.append(
            C14_8RoomPlanCandidate(
              captureLabel: session.brief.captureLabel,
              rightsBasis: session.brief.rights.basis,
              source: source
            )
          )
        }
        try self.assertCurrent(scope: scope, projectId: projectId)
        self.roomPlanCandidates = candidates.sorted { $0.id < $1.id }
        self.roomPlanDiscoveryMessage = candidates.isEmpty
          ? "No rights-compatible processed RoomPlan package is available yet."
          : nil
        self.roomPlanDiscoveryInProgress = false
      } catch is CancellationError {
        guard scope == self.activationId else { return }
        self.roomPlanDiscoveryInProgress = false
      } catch {
        guard scope == self.activationId, self.projectId == projectId else { return }
        self.roomPlanCandidates = []
        self.roomPlanDiscoveryInProgress = false
        self.roomPlanDiscoveryMessage =
          "RoomPlan evidence could not be revalidated. No optional package was attached."
      }
    }
  }

  func setRoomPlanSource(_ candidate: C14_8RoomPlanCandidate, selected: Bool) {
    guard capabilities.roomPlan, canMutate, var next = draft, next.acceptance == nil,
      candidate.rightsBasis == rightsBasis.c7Basis,
      roomPlanCandidates.contains(where: { $0.id == candidate.id })
    else { return }
    next.roomPlanSources.removeAll {
      $0.captureSessionId == candidate.source.captureSessionId
        && $0.packageId == candidate.source.packageId
    }
    if selected, next.roomPlanSources.count < C14_8CaptureContract.maximumRooms {
      next.roomPlanSources.append(candidate.source)
    }
    next.updatedAt = Date()
    draft = next
    Task { try? await journal.save(next) }
  }

  func submit() {
    guard canMutate, serviceProcessingConsent, let projectId, let draft,
      !draft.keyframes.isEmpty, draft.acceptance == nil
    else { return }
    guard capabilities.runtime == .physicalDevice else {
      state = .fixtureReview
      return
    }
    engine.stop()
    let scope = activationId
    activeTask?.cancel()
    activeTask = Task { [weak self] in
      await self?.performSubmission(projectId: projectId, initialDraft: draft, scope: scope)
    }
  }

  func cancelSubmission() {
    activeTask?.cancel()
    state = .review
  }

  func checkSourceReadiness() async {
    guard let projectId, let draft, draft.acceptance != nil else { return }
    let scope = activationId
    do {
      let assets = try await evidenceService.list(projectId: projectId.uuidString.lowercased())
      guard scope == activationId else { return }
      let expected = Set(draft.mediaReceipts.map { $0.receipt.assetId.uuidString.lowercased() })
      let selected = assets.filter { expected.contains($0.id.lowercased()) }
      guard selected.count == expected.count else { throw C14_8ContractError.invalidEvidence }
      if selected.contains(where: { [.quarantined, .rejected, .aborted].contains($0.status) }) {
        state = .failed(
          message: "An immutable RGB source failed evidence validation. Reconstruction remains blocked.",
          retryable: false
        )
      } else {
        state = .accepted(sourcesReady: selected.allSatisfy { $0.status == .ready })
      }
    } catch let error as C7CaptureServiceError where error == .offline {
      guard scope == activationId else { return }
      state = .accepted(sourcesReady: false)
    } catch {
      guard scope == activationId else { return }
      state = .failed(message: "Source readiness could not be verified safely.", retryable: true)
    }
  }

  func startReconstruction() {
    guard canMutate, case .accepted(sourcesReady: true) = state,
      let projectId, let draft, let acceptance = draft.acceptance,
      let captureSession = draft.captureSession
    else { return }
    state = .startingReconstruction
    let scope = activationId
    activeTask = Task { [weak self] in
      guard let self else { return }
      do {
        let result = try await self.envelopeService.startReconstruction(
          projectId: projectId,
          captureSessionId: captureSession.id,
          expectedEnvelopeSha256: acceptance.envelopeSha256,
          includeAppearance: self.includeAppearance,
          idempotencyKey: "c14-8-reconstruct-\(acceptance.envelopeId.uuidString.lowercased())"
        )
        guard scope == self.activationId else { return }
        self.state = .reconstructed(jobId: result.reconstructionJob.id)
      } catch let error as C7CaptureServiceError where error == .offline {
        guard scope == self.activationId else { return }
        self.state = .accepted(sourcesReady: true)
      } catch {
        guard scope == self.activationId else { return }
        self.state = .failed(
          message: "The proposal-only C8 job was not started. The accepted evidence is unchanged.",
          retryable: true
        )
      }
    }
  }

  func handleBackgrounding() {
    guard state == .ready || state == .capturing else { return }
    activeTask?.cancel()
    engine.stop()
    guard var next = draft else { return }
    closeCurrentSegment(in: &next)
    next.interruptionCount += 1
    next.updatedAt = Date()
    draft = next
    state = .interrupted
    Task { try? await journal.save(next) }
  }

  func recoverAfterInterruption() {
    guard var next = draft, canMutate, next.acceptance == nil else { return }
    appendSegment(reason: .interruption, to: &next)
    next.updatedAt = Date()
    draft = next
    Task { try? await journal.save(next) }
    startEngine()
  }

  func reset() {
    resetMemory()
    state = .checking
  }

  @ObservationIgnored private var pendingActorScope: (actorUserId: UUID, tenantId: UUID)?
  private var draftScope: (actorUserId: UUID, tenantId: UUID)? {
    draft.map { ($0.actorUserId, $0.tenantId) }
  }

  private func preflight(
    requestPermission: Bool,
    actorUserId: UUID,
    tenantId: UUID,
    scope: UUID,
    expectedProjectId: UUID
  ) async {
    guard scope == activationId, projectId == expectedProjectId, canMutate else { return }
    pendingActorScope = (actorUserId, tenantId)
    guard capabilities.runtime == .simulatorFixture || capabilities.arWorldTracking else {
      state = .unavailable
      return
    }
    if capabilities.runtime == .simulatorFixture {
      do {
        if draft == nil {
          try await createDraft(
            projectId: expectedProjectId,
            actorUserId: actorUserId,
            tenantId: tenantId,
            scope: scope
          )
        }
        try assertCurrent(scope: scope, projectId: expectedProjectId)
        startEngine()
      } catch {
        guard scope == activationId, projectId == expectedProjectId else { return }
        state = .failed(message: "Protected guided capture fixture could not start.", retryable: true)
      }
      return
    }
    let permission = requestPermission
      ? await permissionProvider.requestPermission()
      : permissionProvider.currentPermission()
    guard scope == activationId, projectId == expectedProjectId, canMutate else { return }
    switch permission {
    case .notDetermined:
      state = .permissionRequired
    case .denied:
      state = .cameraDenied
    case .restricted:
      state = .cameraRestricted
    case .authorised:
      do {
        if draft == nil {
          try await createDraft(
            projectId: expectedProjectId,
            actorUserId: actorUserId,
            tenantId: tenantId,
            scope: scope
          )
        }
        try assertCurrent(scope: scope, projectId: expectedProjectId)
        startEngine()
      } catch {
        state = .failed(message: "Protected guided capture could not start.", retryable: true)
      }
    }
  }

  private func createDraft(
    projectId: UUID,
    actorUserId: UUID,
    tenantId: UUID,
    scope: UUID
  ) async throws {
    let segmentId = UUID()
    let now = Date()
    let created = C14_8GuidedCaptureDraft(
      acceptance: nil,
      actorUserId: actorUserId,
      capabilities: capabilities,
      captureSession: nil,
      createdAt: now,
      depthHandles: [],
      depthReceipts: [],
      endedAt: nil,
      interruptionCount: 0,
      keyframes: [],
      mediaReceipts: [],
      projectId: projectId,
      roomPlanSources: [],
      rooms: [.empty(label: "Room 1", sequence: 1, segmentId: segmentId)],
      samples: [],
      schemaVersion: C14_8CaptureContract.localJournalSchemaVersion,
      segments: [
        C14_8CoordinateSegment(
          coordinateSystem: "arkit-right-handed-y-up",
          endedAtMicroseconds: 1,
          reason: .initial,
          segmentId: segmentId,
          startedAtMicroseconds: 0,
          translationUnit: "micrometres",
          worldOriginRelationship: "independent-unless-later-registered"
        )
      ],
      tenantId: tenantId,
      updatedAt: now
    )
    try await journal.save(created)
    try assertCurrent(scope: scope, projectId: projectId)
    draft = created
  }

  private func startEngine() {
    let scope = activationId
    do {
      try engine.start(
        telemetry: { [weak self] telemetry in
          guard let self, self.activationId == scope else { return }
          self.liveTelemetry = telemetry
        },
        events: { [weak self] event in
          guard let self, self.activationId == scope else { return }
          self.handle(event)
        }
      )
      state = .ready
    } catch {
      state = .failed(message: "ARKit could not establish a fresh tracking segment.", retryable: true)
    }
  }

  private func handle(_ event: C14_8GuidedCaptureEvent) {
    switch event {
    case .interrupted:
      handleBackgrounding()
    case .interruptionEnded:
      state = .interrupted
    case .runtimeFailure:
      handleBackgrounding()
      state = .failed(message: "ARKit stopped this segment after a runtime failure.", retryable: true)
    }
  }

  private func performSubmission(
    projectId: UUID,
    initialDraft: C14_8GuidedCaptureDraft,
    scope: UUID
  ) async {
    do {
      var next = initialDraft
      closeCurrentSegment(in: &next)
      next.endedAt = next.endedAt ?? Date()
      if next.captureSession == nil {
        state = .submitting(stage: .creatingSession, progress: 0)
        let session = try await captureService.createSession(
          projectId: projectId,
          request: C7CreateCaptureSessionRequest(
            captureLabel: "Guided mobile capture",
            deviceCapability: capabilities.sceneDepth ? .arkitRGBDepth : .arkitRGB,
            expectedRoomCount: next.rooms.count,
            mode: next.rooms.count > 1 ? .structure : .singleRoom,
            rights: C7CaptureRights(
              basis: rightsBasis.c7Basis,
              serviceProcessingConsent: true
            )
          ),
          idempotencyKey: "c14-8-session-\(projectId.uuidString.lowercased())-\(Int(next.createdAt.timeIntervalSince1970))"
        )
        try assertCurrent(scope: scope, projectId: projectId)
        next.captureSession = session
        next.updatedAt = Date()
        try await journal.save(next)
        draft = next
      }
      guard let captureSession = next.captureSession else {
        throw C14_8ContractError.invalidScope
      }
      let boundRightsBasis = captureSession.brief.rights.basis.evidenceBasis
      let uploadedIds = Set(next.mediaReceipts.map(\.localIdentifier))
      let pendingMedia = next.keyframes.filter { !uploadedIds.contains($0.localIdentifier) }
      for (index, handle) in pendingMedia.enumerated() {
        state = .submitting(
          stage: .uploadingRGB,
          progress: Double(index) / Double(max(1, pendingMedia.count))
        )
        let fileURL = try await mediaStore.resolve(handle)
        let receipt = try await mediaUploader.upload(
          C8ImmutableEvidenceUpload(
            fileURL: fileURL,
            handle: handle,
            projectId: projectId,
            rights: C8MediaRights(basis: boundRightsBasis, serviceProcessingConsent: true)
          )
        ) { progress in
          await MainActor.run {
            guard self.activationId == scope else { return }
            self.state = .submitting(
              stage: .uploadingRGB,
              progress: (Double(index) + progress) / Double(max(1, pendingMedia.count))
            )
          }
        }
        try assertCurrent(scope: scope, projectId: projectId)
        guard [.uploaded, .processing, .ready].contains(receipt.status) else {
          throw C14_8ContractError.invalidEvidence
        }
        next.mediaReceipts.append(
          C14_8MediaReceipt(
            localIdentifier: handle.localIdentifier,
            receipt: receipt,
            transferPartCount: max(
              1,
              Int(ceil(Double(handle.byteSize) / Double(C7CaptureContract.uploadPartSizeBytes)))
            )
          )
        )
        next.updatedAt = Date()
        try await journal.save(next)
        draft = next
      }
      let uploadedDepthIds = Set(next.depthReceipts.map(\.sampleId))
      let pendingDepth = next.depthHandles.filter { !uploadedDepthIds.contains($0.sampleId) }
      for (index, handle) in pendingDepth.enumerated() {
        state = .submitting(
          stage: .uploadingDepth,
          progress: Double(index) / Double(max(1, pendingDepth.count))
        )
        let fileURL = try await journal.resolveDepth(projectId: projectId, handle: handle)
        let receipt = try await depthUploader.upload(
          projectId: projectId,
          captureSessionId: captureSession.id,
          handle: handle,
          fileURL: fileURL
        )
        try assertCurrent(scope: scope, projectId: projectId)
        next.depthReceipts.append(receipt)
        next.updatedAt = Date()
        try await journal.save(next)
        draft = next
      }
      state = .submitting(stage: .accepting, progress: 1)
      let envelope = try buildEnvelope(next, rightsBasis: boundRightsBasis)
      let record = try await envelopeService.accept(
        projectId: projectId,
        captureSessionId: captureSession.id,
        envelope: envelope,
        idempotencyKey: "c14-8-envelope-\(captureSession.id.uuidString.lowercased())"
      )
      try assertCurrent(scope: scope, projectId: projectId)
      guard record.envelope == envelope else { throw C14_8ContractError.invalidEvidence }
      next.acceptance = record.acceptance
      next.updatedAt = Date()
      try await journal.save(next)
      draft = next
      state = .accepted(sourcesReady: false)
      await checkSourceReadiness()
    } catch is CancellationError {
      guard scope == activationId else { return }
      state = .review
    } catch let error as C7CaptureServiceError where error == .offline {
      guard scope == activationId else { return }
      state = .failed(
        message: "Upload paused offline. Protected receipts will reconcile on retry.",
        retryable: true
      )
    } catch {
      guard scope == activationId else { return }
      state = .failed(
        message: "Submission stopped without accepting an envelope. Immutable completed uploads remain resumable.",
        retryable: true
      )
    }
  }

  private func buildEnvelope(
    _ draft: C14_8GuidedCaptureDraft,
    rightsBasis: EvidenceRightsBasis
  ) throws -> C14_8CaptureEnvelopeRequest {
    guard let captureSession = draft.captureSession,
      let endedAt = draft.endedAt,
      draft.mediaReceipts.count == draft.keyframes.count
    else { throw C14_8ContractError.invalidEvidence }
    let receiptByLocal = Dictionary(
      uniqueKeysWithValues: draft.mediaReceipts.map { ($0.localIdentifier, $0) }
    )
    let now = C7ISO8601.string(from: Date())
    let mediaSources = try draft.keyframes.map { handle -> C14_8MediaSource in
      guard let receipt = receiptByLocal[handle.localIdentifier] else {
        throw C14_8ContractError.invalidEvidence
      }
      return C14_8MediaSource(
        assetId: receipt.receipt.assetId,
        byteSize: handle.byteSize,
        kind: handle.mimeType.reconstructionKind == .rgbVideo ? "rgb-video" : "rgb-keyframe",
        mimeType: handle.mimeType.rawValue,
        sha256: handle.sha256,
        transfer: C14_8TransferReceipt(
          partCount: receipt.transferPartCount,
          reconciledAt: now,
          resumable: true,
          state: "complete"
        )
      )
    }
    let cameraSamples = try draft.samples.map { sample -> C14_8CameraSample in
      guard let receipt = receiptByLocal[sample.sourceLocalIdentifier] else {
        throw C14_8ContractError.invalidEvidence
      }
      return C14_8CameraSample(
        ambientIntensity: sample.ambientIntensity,
        blurScoreMillionths: sample.blurScoreMillionths,
        cameraIntrinsicsMicropixels: sample.cameraIntrinsicsMicropixels,
        exposureScoreMillionths: sample.exposureScoreMillionths,
        intrinsicsModel: sample.intrinsicsModel,
        motionScoreMillionths: sample.motionScoreMillionths,
        orientation: sample.orientation,
        poseTransform: sample.poseTransform,
        quaternionOrder: sample.quaternionOrder,
        quaternionNanounits: sample.quaternionNanounits,
        roomId: sample.roomId,
        sampleId: sample.sampleId,
        segmentId: sample.segmentId,
        sourceAssetId: receipt.receipt.assetId,
        sourceTimestampMicroseconds: sample.sourceTimestampMicroseconds,
        timestampMicroseconds: sample.timestampMicroseconds,
        trackingState: sample.trackingState,
        translationMicrometres: sample.translationMicrometres
      )
    }
    return C14_8CaptureEnvelopeRequest(
      cameraSamples: cameraSamples,
      capabilities: draft.capabilities,
      captureSessionId: captureSession.id,
      coordinateSegments: draft.segments,
      depthSources: draft.depthReceipts.map {
        C14_8DepthSource(
          alignment: "arkit-scene-depth-image-plane",
          artifactId: $0.artifactId,
          byteSize: $0.byteSize,
          format: "float32-metres-little-endian",
          heightPixels: $0.heightPixels,
          sampleIds: [$0.sampleId],
          sha256: $0.sha256,
          transfer: C14_8TransferReceipt(
            partCount: $0.partCount,
            reconciledAt: $0.reconciledAt,
            resumable: true,
            state: "complete"
          ),
          widthPixels: $0.widthPixels
        )
      },
      endedAt: C7ISO8601.string(from: endedAt),
      generator: C14_8EnvelopeGenerator(name: "ios-guided-capture", version: capabilities.appVersion),
      intent: draft.rooms.count > 1 ? "small-apartment" : "room-by-room",
      mediaSources: mediaSources,
      projectId: draft.projectId,
      quality: qualitySummary(draft),
      rights: C14_8CaptureRights(
        basis: rightsBasis,
        serviceProcessingConsent: true,
        trainingUseConsent: .denied
      ),
      roomPlanSources: draft.roomPlanSources,
      rooms: draft.rooms,
      schemaVersion: C14_8CaptureContract.envelopeSchemaVersion,
      startedAt: C7ISO8601.string(from: draft.createdAt),
      transferState: "complete"
    )
  }

  private func qualitySummary(_ draft: C14_8GuidedCaptureDraft) -> C14_8QualitySummary {
    C14_8QualitySummary(
      interruptionCount: draft.interruptionCount,
      lowLightSampleCount: draft.samples.filter {
        ($0.ambientIntensity ?? 1_000) < 300
          || $0.exposureScoreMillionths < C8CaptureQualityEvaluator.minimumAcceptedExposure
      }.count,
      missingCoverageCellCount: draft.rooms.flatMap(\.coverage).filter { $0.status == .missing }.count,
      motionWarningSampleCount: draft.samples.filter { $0.motionScoreMillionths > 400_000 }.count,
      occludedCoverageCellCount: draft.rooms.flatMap(\.coverage).filter { $0.status == .occluded }.count,
      trackingLimitedSampleCount: draft.samples.filter { $0.trackingState != .normal }.count,
      unusableBlurSampleCount: draft.samples.filter {
        $0.blurScoreMillionths < C8CaptureQualityEvaluator.minimumAcceptedBlur
      }.count
    )
  }

  private func markObserved(telemetry: C14_8LiveTelemetry?, in draft: inout C14_8GuidedCaptureDraft) {
    guard let telemetry, let roomIndex = draft.rooms.indices.last,
      let cellIndex = draft.rooms[roomIndex].coverage.firstIndex(where: {
        $0.id == telemetry.coverageCellId
      })
    else { return }
    draft.rooms[roomIndex].coverage[cellIndex].status = .observed
  }

  private func appendSegment(
    reason: C14_8SegmentReason,
    to draft: inout C14_8GuidedCaptureDraft,
    attachToCurrentRoom: Bool = true
  ) {
    let started = elapsedMicroseconds(since: draft.createdAt)
    let segment = C14_8CoordinateSegment(
      coordinateSystem: "arkit-right-handed-y-up",
      endedAtMicroseconds: min(C14_8CaptureContract.maximumDurationMicroseconds, started + 1),
      reason: reason,
      segmentId: UUID(),
      startedAtMicroseconds: started,
      translationUnit: "micrometres",
      worldOriginRelationship: "independent-unless-later-registered"
    )
    draft.segments.append(segment)
    if attachToCurrentRoom, let roomIndex = draft.rooms.indices.last {
      draft.rooms[roomIndex].coordinateSegmentIds.append(segment.segmentId)
    }
  }

  private func closeCurrentSegment(in draft: inout C14_8GuidedCaptureDraft) {
    guard let index = draft.segments.indices.last else { return }
    let elapsed = elapsedMicroseconds(since: draft.createdAt)
    draft.segments[index].endedAtMicroseconds = min(
      C14_8CaptureContract.maximumDurationMicroseconds,
      max(draft.segments[index].startedAtMicroseconds + 1, elapsed)
    )
  }

  private func elapsedMicroseconds(since date: Date) -> Int64 {
    min(
      C14_8CaptureContract.maximumDurationMicroseconds - 1,
      max(0, Int64(Date().timeIntervalSince(date) * 1_000_000))
    )
  }

  private func assertCurrent(scope: UUID, projectId: UUID) throws {
    try Task.checkCancellation()
    guard activationId == scope, self.projectId == projectId, canMutate else {
      throw C14_8ContractError.staleOperation
    }
  }

  private func resetMemory() {
    activationId = UUID()
    activeTask?.cancel()
    activeTask = nil
    engine.stop()
    draft = nil
    liveTelemetry = nil
    pendingActorScope = nil
    pendingSegmentReason = nil
    projectId = nil
    authenticatedActorUserId = nil
    authenticatedTenantId = nil
    currentRole = "viewer"
    includeAppearance = false
    rightsBasis = .ownedByUser
    serviceProcessingConsent = false
    roomPlanCandidates = []
    roomPlanDiscoveryInProgress = false
    roomPlanDiscoveryMessage = nil
    scopeMismatch = false
  }
}

private extension EvidenceRightsBasis {
  var c7Basis: C7RightsBasis {
    switch self {
    case .licensed: .licensed
    case .ownedByUser: .ownedByUser
    case .permissionGranted: .permissionGranted
    case .publicDomain: .publicDomain
    }
  }
}

private extension C7RightsBasis {
  var evidenceBasis: EvidenceRightsBasis {
    switch self {
    case .licensed: .licensed
    case .ownedByUser: .ownedByUser
    case .permissionGranted: .permissionGranted
    case .publicDomain: .publicDomain
    }
  }
}

import Foundation
import Observation

enum C7CaptureWorkspaceState: Equatable, Sendable {
  case abstained(C7CaptureAbstentionSummary)
  case cancelled
  case cancelPending
  case creatingSession
  case expired
  case forbidden
  case interrupted
  case loading
  case offlinePaused
  case packaging
  case paused
  case permissionRequired
  case processing
  case proposed(C7CaptureModelProposalSummary)
  case ready
  case relocalising
  case roomReview
  case safeFailure(message: String, retryable: Bool)
  case scanning
  case sensorRestartRequired
  case sessionSetup
  case structureReview
  case uploading(progress: Double)
}

@MainActor
@Observable
final class C7CaptureWorkspaceModel {
  private(set) var state: C7CaptureWorkspaceState = .loading
  private(set) var qualityAssessment: C7CaptureQualityAssessment?
  private(set) var qualityManifest: C7CaptureQualityManifest?
  private(set) var rooms: [C7CaptureRoomManifest] = []
  private(set) var sourceOptions: [(id: UUID, label: String)] = []
  private(set) var activeBrief: C7CaptureBrief?
  private(set) var readOnlyNotice: String?

  var captureLabel = ""
  var expectedRoomCountText = ""
  var mode: C7CaptureMode = .singleRoom
  var rightsBasis: C7RightsBasis = .ownedByUser
  var serviceProcessingConsent = false
  let referenceMeasurements: C7ReferenceMeasurementModel
  let role: C7WorkspaceRole

  @ObservationIgnored private let service: any C7CaptureServing
  @ObservationIgnored private let journal: any C7CaptureJournalStoring
  @ObservationIgnored private let syncEngine: C7CaptureSyncEngine
  @ObservationIgnored private let captureLauncher: any C7CaptureLaunching
  @ObservationIgnored private let clock: any C7CaptureClock
  @ObservationIgnored private let idGenerator: @MainActor @Sendable () -> UUID
  @ObservationIgnored private var activeTask: Task<Void, Never>?
  @ObservationIgnored private var operationGeneration = 0
  private var projectId: UUID?
  private var record: C7CaptureJournalRecord?
  private var normalizedDraft: C7NormalizedRoomPlan?

  init(
    role: C7WorkspaceRole,
    service: any C7CaptureServing,
    journal: any C7CaptureJournalStoring,
    syncEngine: C7CaptureSyncEngine,
    captureLauncher: any C7CaptureLaunching = C7UnavailableCaptureLauncher(),
    clock: any C7CaptureClock = C7SystemCaptureClock(),
    idGenerator: @escaping @MainActor @Sendable () -> UUID = UUID.init
  ) {
    self.role = role
    self.service = service
    self.journal = journal
    self.syncEngine = syncEngine
    self.captureLauncher = captureLauncher
    self.clock = clock
    self.idGenerator = idGenerator
    referenceMeasurements = C7ReferenceMeasurementModel(idGenerator: idGenerator)
  }

  var isReadOnly: Bool { !role.canMutate }

  func activate(projectId rawProjectId: String) async {
    activeTask?.cancel()
    operationGeneration += 1
    state = .loading
    resetReview()
    guard let projectId = UUID(uuidString: rawProjectId) else {
      state = .safeFailure(message: "The selected project identifier is invalid.", retryable: false)
      return
    }
    self.projectId = projectId
    do {
      if let restored = try await journal.loadLatest(projectId: projectId) {
        var active = restored
        activeBrief = active.brief
        if [.scanning, .interrupted, .relocalising].contains(active.phase) {
          active.phase = .sensorRestartRequired
          active = try await journal.save(active)
          record = active
          state = .sensorRestartRequired
          return
        }
        record = active
        if active.phase == .review {
          try await restoreReview(from: active)
        }
        let snapshot = try await syncEngine.refresh(active)
        record = snapshot.record
        try present(snapshot)
        return
      }

      if let intent = try await journal.loadIntent(projectId: projectId) {
        restoreForm(from: intent.request)
        readOnlyNotice =
          "A protected session request is waiting to replay with the same idempotency key."
      }
      let sessions = try await service.listSessions(projectId: projectId)
      if let latest = sessions.sorted(by: { $0.updatedAt > $1.updatedAt }).first {
        let local = try await journal.create(brief: latest.brief, serverVersion: latest.version)
        activeBrief = latest.brief
        record = local
        let snapshot = try await syncEngine.refresh(local)
        record = snapshot.record
        try present(snapshot)
      } else {
        state = .sessionSetup
        if isReadOnly {
          readOnlyNotice =
            "Viewers can inspect capture sessions and proposals, but cannot create or change them."
        }
      }
    } catch {
      present(error)
    }
  }

  func beginSession() {
    guard role.canMutate, let projectId else { return }
    let expectedRoomCount: Int? =
      if mode == .singleRoom {
        1
      } else if expectedRoomCountText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        nil
      } else {
        Int(expectedRoomCountText)
      }
    let request = C7CreateCaptureSessionRequest(
      captureLabel: captureLabel.trimmingCharacters(in: .whitespacesAndNewlines),
      expectedRoomCount: expectedRoomCount,
      mode: mode,
      rights: C7CaptureRights(
        basis: rightsBasis,
        serviceProcessingConsent: serviceProcessingConsent
      )
    )
    do {
      try C7StrictCaptureValidator.validateSessionRequest(request)
    } catch {
      state = .safeFailure(
        message: "Enter a capture label, confirm service processing, and use a valid room count.",
        retryable: true
      )
      return
    }
    run { [weak self] generation in
      guard let self else { return }
      await MainActor.run { self.state = .creatingSession }
      do {
        let existingIntent = try await self.journal.loadIntent(projectId: projectId)
        let intent: C7CaptureSessionIntent
        if let existingIntent {
          guard existingIntent.request == request else { throw C7CaptureServiceError.conflict }
          intent = existingIntent
        } else {
          intent = await MainActor.run {
            C7CaptureSessionIntent(
              createdAt: self.clock.now(),
              idempotencyKey: self.idGenerator().uuidString.lowercased(),
              projectId: projectId,
              request: request,
              schemaVersion: C7CaptureSessionIntent.schemaVersion
            )
          }
          try await self.journal.saveIntent(intent)
        }
        let session = try await self.service.createSession(
          projectId: projectId,
          request: request,
          idempotencyKey: intent.idempotencyKey
        )
        guard session.projectId == projectId, session.brief.projectId == projectId else {
          throw C7CaptureServiceError.conflict
        }
        let record = try await self.journal.create(
          brief: session.brief,
          serverVersion: session.version
        )
        try await self.journal.clearIntent(projectId: projectId)
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = record
          self.activeBrief = record.brief
          self.readOnlyNotice = nil
          self.state = .ready
        }
      } catch {
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.present(error)
        }
      }
    }
  }

  func startCapture() {
    guard role.canMutate, let initialRecord = record else { return }
    run { [weak self] generation in
      guard let self else { return }
      do {
        var record = initialRecord
        record.phase = .scanning
        record = try await self.journal.save(record)
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = record
          self.state = .scanning
        }
        let draft = try await self.captureLauncher.capture(brief: record.brief) { event in
          await self.accept(event: event, generation: generation)
        }
        try C7StrictCaptureValidator.validateReview(draft, brief: record.brief)
        guard let latest = try await self.journal.loadLatest(projectId: record.projectId),
          latest.id == record.id
        else {
          throw C7CaptureServiceError.conflict
        }
        record = latest
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.state = .packaging
        }
        record = try await self.journal.stageReview(draft, record: record)
        let normalized = try await self.journal.loadNormalizedDraft(record: record)
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = record
          self.normalizedDraft = normalized
          self.configureReview(record: record, normalized: normalized)
        }
      } catch is CancellationError {
        await self.sensorTaskEnded(record: initialRecord, generation: generation)
      } catch {
        if let launchError = error as? C7CaptureLaunchError,
          launchError == .permissionDenied || launchError == .terminated
            || launchError == .relocalisationFailed
        {
          var stopped =
            (try? await self.journal.loadLatest(projectId: initialRecord.projectId))
            ?? initialRecord
          stopped.phase =
            launchError == .permissionDenied
            ? .permissionRequired
            : .sensorRestartRequired
          if let saved = try? await self.journal.save(stopped) {
            await MainActor.run { self.record = saved }
          }
        }
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          if error as? C7CaptureLaunchError == .terminated {
            self.state = .sensorRestartRequired
          } else {
            self.present(error)
          }
        }
      }
    }
  }

  func updateRoomLabel(roomId: UUID, label: String) {
    guard role.canMutate else { return }
    let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count <= 120 else { return }
    rooms = rooms.map { room in
      guard room.roomId == roomId else { return room }
      return C7CaptureRoomManifest(
        capturedRoomVersion: room.capturedRoomVersion,
        roomId: room.roomId,
        sequence: room.sequence,
        sourceRoomIdentifier: room.sourceRoomIdentifier,
        story: room.story,
        userLabel: trimmed.isEmpty ? nil : trimmed
      )
    }
  }

  func prepareAndUpload() {
    guard role.canMutate, let initialRecord = record, initialRecord.review != nil else { return }
    let reviewRooms = rooms
    let measurements = referenceMeasurements.measurements
    run { [weak self] generation in
      guard let self else { return }
      await MainActor.run { self.state = .packaging }
      do {
        let record = try await self.journal.finalizeReview(
          record: initialRecord,
          rooms: reviewRooms,
          referenceMeasurements: measurements
        )
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = record
          self.state = .paused
        }
        try await self.synchronize(record, generation: generation)
      } catch {
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.present(error)
        }
      }
    }
  }

  func resumeUpload() {
    guard role.canMutate, let record, record.package != nil else { return }
    run { [weak self] generation in
      guard let self else { return }
      do {
        try await self.synchronize(record, generation: generation)
      } catch {
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.present(error)
        }
      }
    }
  }

  func pauseUpload() {
    guard role.canMutate else { return }
    operationGeneration += 1
    activeTask?.cancel()
    guard let record else { return }
    Task { [weak self] in
      guard let self else { return }
      guard var current = try? await self.journal.loadLatest(projectId: record.projectId),
        current.id == record.id
      else { return }
      current.phase = .paused
      if let saved = try? await self.journal.save(current) {
        await MainActor.run {
          self.record = saved
          self.state = .paused
        }
      }
    }
  }

  func cancelSession() {
    guard role.canMutate, let record else { return }
    operationGeneration += 1
    activeTask?.cancel()
    let generation = operationGeneration
    activeTask = Task { [weak self] in
      guard let self else { return }
      do {
        let cancelled = try await self.syncEngine.cancel(record)
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = cancelled
          self.state = cancelled.phase == .cancelled ? .cancelled : .cancelPending
        }
      } catch {
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.present(error)
        }
      }
    }
  }

  func withdrawRights() {
    guard role.canMutate, let record else { return }
    operationGeneration += 1
    activeTask?.cancel()
    let generation = operationGeneration
    activeTask = Task { [weak self] in
      guard let self else { return }
      do {
        let withdrawn = try await self.syncEngine.withdrawRights(record)
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = withdrawn
          self.state = .safeFailure(
            message: C7CaptureServiceError.rightsWithdrawn.localizedDescription,
            retryable: false
          )
        }
      } catch {
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.present(error)
        }
      }
    }
  }

  func refresh() {
    guard let record else { return }
    run { [weak self] generation in
      guard let self else { return }
      do {
        let snapshot = try await self.syncEngine.refresh(record)
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = snapshot.record
          try? self.present(snapshot)
        }
      } catch {
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.present(error)
        }
      }
    }
  }

  func retryProcessing() {
    guard role.canMutate, let record else { return }
    run { [weak self] generation in
      guard let self else { return }
      do {
        let updated = try await self.syncEngine.retry(record)
        let snapshot = try await self.syncEngine.refresh(updated)
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.record = snapshot.record
          try? self.present(snapshot)
        }
      } catch {
        await MainActor.run {
          guard self.operationGeneration == generation else { return }
          self.present(error)
        }
      }
    }
  }

  func retryCurrentAction() {
    guard let record else {
      beginSession()
      return
    }
    if record.package != nil {
      if record.phase == .failed || record.phase == .abstained {
        retryProcessing()
      } else {
        resumeUpload()
      }
    } else if record.phase == .ready || record.phase == .sensorRestartRequired {
      startCapture()
    } else {
      refresh()
    }
  }

  private func run(
    operation: @escaping @MainActor @Sendable (Int) async -> Void
  ) {
    operationGeneration += 1
    activeTask?.cancel()
    let generation = operationGeneration
    activeTask = Task { @MainActor in await operation(generation) }
  }

  private func synchronize(_ record: C7CaptureJournalRecord, generation: Int) async throws {
    let snapshot = try await syncEngine.synchronize(record) { progress in
      await MainActor.run {
        guard self.operationGeneration == generation else { return }
        self.state = .uploading(progress: min(max(progress, 0), 1))
      }
    }
    await MainActor.run {
      guard self.operationGeneration == generation else { return }
      self.record = snapshot.record
      try? self.present(snapshot)
    }
  }

  private func accept(event: C7CaptureLifecycleEvent, generation: Int) async {
    guard operationGeneration == generation, var record else { return }
    switch event {
    case .scanning:
      record.phase = .scanning
      state = .scanning
    case .interrupted:
      record.phase = .interrupted
      state = .interrupted
    case .permissionRequired:
      record.phase = .permissionRequired
      state = .permissionRequired
    case .relocalising:
      record.phase = .relocalising
      state = .relocalising
    }
    if let saved = try? await journal.save(record), operationGeneration == generation {
      self.record = saved
    }
  }

  private func sensorTaskEnded(record: C7CaptureJournalRecord, generation: Int) async {
    guard operationGeneration == generation else { return }
    var ended = self.record ?? record
    ended.phase = .sensorRestartRequired
    if let saved = try? await journal.save(ended), operationGeneration == generation {
      self.record = saved
      state = .sensorRestartRequired
    }
  }

  private func restoreReview(from record: C7CaptureJournalRecord) async throws {
    let normalized = try await journal.loadNormalizedDraft(record: record)
    normalizedDraft = normalized
    configureReview(record: record, normalized: normalized)
  }

  private func configureReview(
    record: C7CaptureJournalRecord,
    normalized: C7NormalizedRoomPlan
  ) {
    guard let review = record.review else { return }
    rooms = review.rooms.sorted { $0.sequence < $1.sequence }
    qualityManifest = review.quality
    qualityAssessment = try? C7CaptureQualityEvaluator.assess(review.quality)
    let surfaceOptions = normalized.surfaces.map {
      (
        id: $0.sourceIdentifier,
        label: "\($0.category.rawValue) \($0.sourceIdentifier.uuidString.prefix(8))"
      )
    }
    let objectOptions = normalized.objects.map {
      (
        id: $0.sourceIdentifier,
        label: "\($0.category.rawValue) \($0.sourceIdentifier.uuidString.prefix(8))"
      )
    }
    sourceOptions = (surfaceOptions + objectOptions).sorted { $0.id.uuidString < $1.id.uuidString }
    referenceMeasurements.replaceSources(
      Set(review.sourceEntityIds),
      measurements: review.referenceMeasurements
    )
    state = record.brief.mode == .structure ? .structureReview : .roomReview
  }

  private func present(_ snapshot: C7CaptureSyncSnapshot) throws {
    activeBrief = snapshot.record.brief
    switch snapshot.proposal {
    case .proposal(let proposal):
      state = .proposed(proposal)
    case .abstained(let abstention):
      state = .abstained(abstention)
    case nil:
      switch snapshot.record.phase {
      case .abstained:
        state = .processing
      case .cancelled:
        state = .cancelled
      case .cancelPending:
        state = .cancelPending
      case .expired:
        state = .expired
      case .failed:
        state = .safeFailure(message: "Capture processing failed safely.", retryable: true)
      case .interrupted:
        state = .interrupted
      case .packaging:
        state = .packaging
      case .paused, .uploading:
        state = .paused
      case .permissionRequired:
        state = .permissionRequired
      case .processing, .proposed:
        state = .processing
      case .ready:
        state = .ready
      case .relocalising:
        state = .relocalising
      case .review:
        if snapshot.record.review != nil, normalizedDraft == nil {
          throw C7CaptureServiceError.conflict
        }
        state = snapshot.record.brief.mode == .structure ? .structureReview : .roomReview
      case .rightsWithdrawn:
        state = .safeFailure(
          message: C7CaptureServiceError.rightsWithdrawn.localizedDescription,
          retryable: false
        )
      case .scanning, .sensorRestartRequired:
        state = .sensorRestartRequired
      }
    }
  }

  private func present(_ error: Error) {
    if let serviceError = error as? C7CaptureServiceError {
      switch serviceError {
      case .offline:
        state = .offlinePaused
      case .forbidden:
        state = .forbidden
      case .captureExpired:
        state = .expired
      case .cancelled:
        state = .cancelled
      case .rightsWithdrawn:
        state = .safeFailure(message: serviceError.localizedDescription, retryable: false)
      default:
        state = .safeFailure(message: serviceError.localizedDescription, retryable: true)
      }
    } else if let launchError = error as? C7CaptureLaunchError {
      if launchError == .permissionDenied {
        state = .permissionRequired
      } else if launchError == .terminated || launchError == .relocalisationFailed {
        state = .sensorRestartRequired
      } else {
        state = .safeFailure(message: launchError.localizedDescription, retryable: true)
      }
    } else {
      state = .safeFailure(
        message: "Capture state could not continue safely. Protected local data was not uploaded.",
        retryable: true
      )
    }
  }

  private func restoreForm(from request: C7CreateCaptureSessionRequest) {
    captureLabel = request.captureLabel
    expectedRoomCountText = request.expectedRoomCount.map(String.init) ?? ""
    mode = request.mode
    rightsBasis = request.rights.basis
    serviceProcessingConsent = request.rights.serviceProcessingConsent
  }

  private func resetReview() {
    qualityAssessment = nil
    qualityManifest = nil
    rooms = []
    sourceOptions = []
    activeBrief = nil
    readOnlyNotice = nil
    normalizedDraft = nil
    referenceMeasurements.replaceSources([], measurements: [])
  }
}

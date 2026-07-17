import Foundation
import Testing

@testable import HomeDesignCapture

@MainActor
@Suite("C7 capture workspace state", .serialized)
struct CaptureWorkspaceModelTests {
  @Test("owner with no capture sees bounded session setup")
  func emptyOwnerWorkspace() async throws {
    let context = try makeContext()
    defer { try? FileManager.default.removeItem(at: context.root) }

    await context.model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    #expect(context.model.state == .sessionSetup)
    #expect(!context.model.isReadOnly)
  }

  @Test("viewer is read-only and cannot create a session")
  func viewerReadOnly() async throws {
    let context = try makeContext(role: .viewer)
    defer { try? FileManager.default.removeItem(at: context.root) }
    await context.model.activate(projectId: C7SyntheticFixture.projectId.uuidString)
    context.model.captureLabel = "VISIBLY SYNTHETIC"
    context.model.serviceProcessingConsent = true

    context.model.beginSession()
    try? await Task.sleep(for: .milliseconds(50))

    #expect(context.model.isReadOnly)
    #expect(context.model.state == .sessionSetup)
    #expect(await context.service.createCount() == 0)
    #expect(context.model.readOnlyNotice?.contains("cannot create") == true)
  }

  @Test("offline create replays the exact protected idempotency key")
  func sessionIntentReplay() async throws {
    let context = try makeContext()
    defer { try? FileManager.default.removeItem(at: context.root) }
    await context.model.activate(projectId: C7SyntheticFixture.projectId.uuidString)
    context.model.captureLabel = "VISIBLY SYNTHETIC capture"
    context.model.serviceProcessingConsent = true
    await context.service.setCreateError(.offline)

    context.model.beginSession()
    await eventually { context.model.state == .offlinePaused }
    let intent = try #require(
      try await context.journal.loadIntent(projectId: C7SyntheticFixture.projectId)
    )
    await context.service.setCreateError(nil)
    context.model.beginSession()
    await eventually { context.model.state == .ready }

    let keys = await context.service.createKeys()
    #expect(keys == [intent.idempotencyKey, intent.idempotencyKey])
    #expect(try await context.journal.loadIntent(projectId: C7SyntheticFixture.projectId) == nil)
  }

  @Test("relaunch converts scanning state into explicit sensor restart")
  func terminatedSensorRelaunch() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let service = C7WorkspaceServiceStub(sessions: [C7SyntheticFixture.session()])
    let journal = C7ProtectedCaptureJournal(root: root)
    var record = try await journal.create(brief: C7SyntheticFixture.brief(), serverVersion: 1)
    record.phase = .scanning
    _ = try await journal.save(record)
    let launcher = C7WorkspaceLauncherStub(
      result: .failure(.unavailable("Should never launch during restore"))
    )
    let model = makeModel(
      service: service,
      journal: journal,
      launcher: launcher
    )

    await model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    #expect(model.state == .sensorRestartRequired)
    #expect(await launcher.launchCount() == 0)
    #expect(
      try await journal.loadLatest(projectId: C7SyntheticFixture.projectId)?.phase
        == .sensorRestartRequired)
  }

  @Test("launcher events finish in room review with quality and source controls")
  func captureToReview() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let source = try C7SyntheticFixture.sourceFile(in: root)
    let service = C7WorkspaceServiceStub(sessions: [C7SyntheticFixture.session()])
    let journal = C7ProtectedCaptureJournal(root: root)
    _ = try await journal.create(brief: C7SyntheticFixture.brief(), serverVersion: 1)
    let launcher = C7WorkspaceLauncherStub(
      result: .success(C7SyntheticFixture.review(sourceURL: source)),
      events: [.scanning, .interrupted, .relocalising, .scanning]
    )
    let model = makeModel(service: service, journal: journal, launcher: launcher)
    await model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    model.startCapture()
    await eventually { model.state == .roomReview }

    #expect(model.rooms == [C7SyntheticFixture.room])
    #expect(model.qualityAssessment?.attention == .noHeuristicWarning)
    #expect(
      Set(model.sourceOptions.map(\.id)) == [
        C7SyntheticFixture.surfaceId,
        C7SyntheticFixture.objectId,
      ])
    #expect(await launcher.launchCount() == 1)
  }

  @Test("unregistered RoomPlan launcher fails honestly without fixture capture claim")
  func unavailableLauncher() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let service = C7WorkspaceServiceStub(sessions: [C7SyntheticFixture.session()])
    let journal = C7ProtectedCaptureJournal(root: root)
    _ = try await journal.create(brief: C7SyntheticFixture.brief(), serverVersion: 1)
    let model = makeModel(
      service: service,
      journal: journal,
      launcher: C7UnavailableCaptureLauncher()
    )
    await model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    model.startCapture()
    await eventually {
      if case .safeFailure = model.state { return true }
      return false
    }

    if case .safeFailure(let message, _) = model.state {
      #expect(message.contains("not registered"))
      #expect(!message.localizedCaseInsensitiveContains("captured successfully"))
    } else {
      Issue.record("Expected safe failure")
    }
  }

  @Test("camera denial is a distinct permission state with no authoritative capture")
  func permissionDenied() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let service = C7WorkspaceServiceStub(sessions: [C7SyntheticFixture.session()])
    let journal = C7ProtectedCaptureJournal(root: root)
    _ = try await journal.create(brief: C7SyntheticFixture.brief(), serverVersion: 1)
    let launcher = C7WorkspaceLauncherStub(result: .failure(.permissionDenied))
    let model = makeModel(service: service, journal: journal, launcher: launcher)
    await model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    model.startCapture()
    await eventually { model.state == .permissionRequired }

    #expect(model.state == .permissionRequired)
    #expect(await launcher.launchCount() == 1)
  }

  @Test("offline restore presents resumable recovery")
  func offlineRestore() async throws {
    let context = try makeContext(listError: .offline)
    defer { try? FileManager.default.removeItem(at: context.root) }

    await context.model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    #expect(context.model.state == .offlinePaused)
  }

  @Test("viewer sees proposal without mutation controls")
  func viewerProposal() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let service = C7WorkspaceServiceStub(
      sessions: [C7SyntheticFixture.session(state: .proposed)],
      proposal: C7SyntheticFixture.proposal()
    )
    let journal = C7ProtectedCaptureJournal(root: root)
    let model = makeModel(role: .viewer, service: service, journal: journal)

    await model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    if case .proposed(let proposal) = model.state {
      #expect(proposal.overallConfidence == 72)
      #expect(proposal.unresolvedSourceEntityIds == [C7SyntheticFixture.objectId])
    } else {
      Issue.record("Expected proposal")
    }
    #expect(model.isReadOnly)
  }

  @Test("abstention remains distinct and exposes bounded next actions")
  func abstention() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let service = C7WorkspaceServiceStub(
      sessions: [C7SyntheticFixture.session(state: .abstained)],
      proposal: C7SyntheticFixture.abstention()
    )
    let journal = C7ProtectedCaptureJournal(root: root)
    let model = makeModel(service: service, journal: journal)

    await model.activate(projectId: C7SyntheticFixture.projectId.uuidString)

    if case .abstained(let abstention) = model.state {
      #expect(abstention.code == .lowQuality)
      #expect(abstention.nextActions == [.rescanRoom, .usePlan])
    } else {
      Issue.record("Expected abstention")
    }
  }

  private func makeContext(
    role: C7WorkspaceRole = .owner,
    listError: C7CaptureServiceError? = nil
  ) throws -> (
    root: URL,
    service: C7WorkspaceServiceStub,
    journal: C7ProtectedCaptureJournal,
    model: C7CaptureWorkspaceModel
  ) {
    let root = try C7SyntheticFixture.temporaryDirectory()
    let service = C7WorkspaceServiceStub(sessions: [], listError: listError)
    let journal = C7ProtectedCaptureJournal(root: root)
    let model = makeModel(role: role, service: service, journal: journal)
    return (root, service, journal, model)
  }

  private func makeModel(
    role: C7WorkspaceRole = .owner,
    service: C7WorkspaceServiceStub,
    journal: C7ProtectedCaptureJournal,
    launcher: any C7CaptureLaunching = C7UnavailableCaptureLauncher()
  ) -> C7CaptureWorkspaceModel {
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )
    return C7CaptureWorkspaceModel(
      role: role,
      service: service,
      journal: journal,
      syncEngine: engine,
      captureLauncher: launcher,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )
  }

  private func eventually(
    condition: @escaping @MainActor () -> Bool
  ) async {
    for _ in 0..<200 {
      if condition() { return }
      try? await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("Condition was not reached")
  }
}

private actor C7WorkspaceLauncherStub: C7CaptureLaunching {
  private let result: Result<C7CaptureReviewDraft, C7CaptureLaunchError>
  private let events: [C7CaptureLifecycleEvent]
  private var launches = 0

  init(
    result: Result<C7CaptureReviewDraft, C7CaptureLaunchError>,
    events: [C7CaptureLifecycleEvent] = []
  ) {
    self.result = result
    self.events = events
  }

  func capture(
    brief: C7CaptureBrief,
    onEvent: @escaping @Sendable (C7CaptureLifecycleEvent) async -> Void
  ) async throws -> C7CaptureReviewDraft {
    launches += 1
    for event in events { await onEvent(event) }
    return try result.get()
  }

  func launchCount() -> Int { launches }
}

private actor C7WorkspaceServiceStub: C7CaptureServing {
  private var sessions: [C7CaptureSession]
  private var result: C7CaptureProposalResult
  private var createError: C7CaptureServiceError?
  private let listError: C7CaptureServiceError?
  private var keys: [String] = []

  init(
    sessions: [C7CaptureSession],
    proposal: C7CaptureProposalResult = C7SyntheticFixture.proposal(),
    listError: C7CaptureServiceError? = nil
  ) {
    self.sessions = sessions
    result = proposal
    self.listError = listError
  }

  func listSessions(projectId: UUID) throws -> [C7CaptureSession] {
    if let listError { throw listError }
    return sessions
  }

  func createSession(
    projectId: UUID,
    request: C7CreateCaptureSessionRequest,
    idempotencyKey: String
  ) throws -> C7CaptureSession {
    keys.append(idempotencyKey)
    if let createError { throw createError }
    let session = C7SyntheticFixture.session()
    sessions = [session]
    return session
  }

  func session(projectId: UUID, captureSessionId: UUID) throws -> C7CaptureSession {
    guard let session = sessions.first else { throw C7CaptureServiceError.forbidden }
    return session
  }

  func cancelSession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) -> C7CaptureSession {
    let session = C7SyntheticFixture.session(state: .cancelled, version: 2)
    sessions = [session]
    return session
  }

  func retrySession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) -> C7CaptureSession {
    let session = C7SyntheticFixture.session(state: .processing, version: 2)
    sessions = [session]
    return session
  }

  func proposal(projectId: UUID, captureSessionId: UUID) -> C7CaptureProposalResult { result }

  func createArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    request: C7CreateCaptureArtifactUploadRequest,
    idempotencyKey: String
  ) throws -> C7ArtifactUploadSession { throw C7CaptureServiceError.unavailable }

  func uploadSession(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID
  ) throws -> C7ArtifactUploadSession { throw C7CaptureServiceError.unavailable }

  func signArtifactPart(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    request: C7SignArtifactPartRequest,
    idempotencyKey: String
  ) throws -> C7SignedArtifactPart { throw C7CaptureServiceError.unavailable }

  func uploadArtifactPart(
    fileURL: URL,
    signedPart: C7SignedArtifactPart,
    expectedChecksum: String
  ) throws -> String { throw C7CaptureServiceError.unavailable }

  func completeArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    parts: [C7CompletedArtifactPart],
    idempotencyKey: String
  ) throws -> C7ArtifactUploadSession { throw C7CaptureServiceError.unavailable }

  func finalizePackage(
    projectId: UUID,
    captureSessionId: UUID,
    package: C7CreateCapturePackageRequest,
    idempotencyKey: String
  ) throws -> C7CaptureSession { throw C7CaptureServiceError.unavailable }

  func setCreateError(_ error: C7CaptureServiceError?) { createError = error }
  func createCount() -> Int { keys.count }
  func createKeys() -> [String] { keys }
}

import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C7 checksum-bound sync engine", .serialized)
struct CaptureSyncEngineTests {
  @Test("complete package uploads bounded parts and finalizes exactly once")
  func completeUpload() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let service = C7SyncServiceStub()
    let diagnostics = C7MemoryDiagnostics()
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      diagnostics: diagnostics,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )

    let snapshot = try await engine.synchronize(record) { _ in }

    #expect(snapshot.record.phase == .processing)
    #expect(snapshot.record.package?.artifacts.allSatisfy(\.completed) == true)
    #expect(await service.finalizeCount() == 1)
    #expect(await service.uploadCount() == record.package?.artifacts.count)
    #expect(await service.allUploadsHadValidChecksums())
    #expect(await diagnostics.events().contains(.partRecorded))
  }

  @Test("partial recorded part reconciliation reuploads only the missing suffix")
  func partialPartResume() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, initial) = try await C7SyntheticFixture.preparedJournal(
      root: root,
      sourceBytes: C7CaptureContract.uploadPartSizeBytes + 7
    )
    var record = initial
    var package = try #require(record.package)
    let index = try #require(
      package.artifacts.firstIndex(where: { $0.manifest.kind == .capturedRoomJSON })
    )
    var artifact = package.artifacts[index]
    let uploadSessionId = UUID()
    artifact.uploadSessionId = uploadSessionId
    artifact.uploadExpiresAt = "2026-07-18T12:00:00.000Z"
    for partNumber in 1...2 {
      let length = partNumber == 1 ? C7CaptureContract.uploadPartSizeBytes : 7
      let part = try await journal.makePartFile(
        record: record,
        artifact: artifact,
        offset: UInt64((partNumber - 1) * C7CaptureContract.uploadPartSizeBytes),
        length: length,
        partNumber: partNumber
      )
      artifact.completedParts.append(
        C7CompletedArtifactPart(
          checksumSha256: try C7CaptureFileHasher.checksumBase64(fileURL: part),
          etag: "synthetic-etag-\(partNumber)",
          partNumber: partNumber
        )
      )
    }
    package.artifacts[index] = artifact
    record.package = package
    record = try await journal.save(record)
    let service = C7SyncServiceStub()
    await service.seedUpload(
      artifact: artifact,
      uploadSessionId: uploadSessionId,
      recordedPartNumbers: [1]
    )
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )

    _ = try await engine.synchronize(record) { _ in }

    let signed = await service.signedParts(for: artifact.id)
    #expect(signed == [2])
  }

  @Test("a locally modified artifact stops before any signed upload")
  func substitutedArtifactStops() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let artifact = try #require(record.package?.artifacts.first)
    let url =
      root
      .appendingPathComponent(record.projectId.uuidString.lowercased())
      .appendingPathComponent(record.id.uuidString.lowercased())
      .appendingPathComponent("artifacts")
      .appendingPathComponent(artifact.storageName)
    try Data("VISIBLY SYNTHETIC TAMPER".utf8).write(to: url)
    let service = C7SyncServiceStub()
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )

    await #expect(throws: C7CaptureServiceError.checksumMismatch) {
      try await engine.synchronize(record) { _ in }
    }
    #expect(await service.uploadCount() == 0)
  }

  @Test("expired signed URL is refreshed once with a persisted generation")
  func signedURLRefresh() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let service = C7SyncServiceStub(expireFirstSignedUpload: true)
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )

    let snapshot = try await engine.synchronize(record) { _ in }
    let firstArtifact = try #require(snapshot.record.package?.artifacts.first)

    #expect(await service.totalSignCount() == 4)
    #expect(firstArtifact.signingGenerations.values.contains(1))
    #expect(snapshot.record.phase == .processing)
  }

  @Test("forbidden session check discloses nothing and performs no upload")
  func forbidden() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let service = C7SyncServiceStub(sessionError: .forbidden)
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )

    await #expect(throws: C7CaptureServiceError.forbidden) {
      try await engine.synchronize(record) { _ in }
    }
    #expect(await service.uploadCount() == 0)
  }

  @Test("expired capture brief is journaled before the network is touched")
  func expiredBrief() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let lateClock = C7FixedClock(value: Date(timeIntervalSince1970: 1_800_000_000))
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(
      root: root,
      clock: lateClock
    )
    let service = C7SyncServiceStub()
    let engine = C7CaptureSyncEngine(service: service, journal: journal, clock: lateClock)

    await #expect(throws: C7CaptureServiceError.captureExpired) {
      try await engine.synchronize(record) { _ in }
    }
    #expect(try await journal.loadLatest(projectId: record.projectId)?.phase == .expired)
    #expect(await service.sessionReadCount() == 0)
  }

  @Test("rights withdrawal remains fail-closed when cancellation is offline")
  func offlineRightsWithdrawal() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let service = C7SyncServiceStub(cancelError: .offline)
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )

    await #expect(throws: C7CaptureServiceError.offline) {
      try await engine.withdrawRights(record)
    }
    let protected = try #require(try await journal.loadLatest(projectId: record.projectId))
    #expect(protected.rightsState == .withdrawalPending)
    #expect(protected.phase == .rightsWithdrawn)
    await #expect(throws: C7CaptureServiceError.rightsWithdrawn) {
      try await engine.synchronize(protected) { _ in }
    }
  }

  @Test("cancel wins an in-flight upload race and package finalization never runs")
  func cancellationRace() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let service = C7SyncServiceStub(uploadDelay: .seconds(5))
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )
    let upload = Task { try await engine.synchronize(record) { _ in } }
    await eventually { await service.uploadStarted() }
    upload.cancel()

    let cancelled = try await engine.cancel(record)

    #expect(cancelled.phase == .cancelled)
    #expect(await service.finalizeCount() == 0)
    await #expect(throws: (any Error).self) { try await upload.value }
  }

  @Test("proposed and abstained terminal results remain distinct")
  func terminalResults() async throws {
    let rootA = try C7SyntheticFixture.temporaryDirectory()
    let rootB = try C7SyntheticFixture.temporaryDirectory()
    defer {
      try? FileManager.default.removeItem(at: rootA)
      try? FileManager.default.removeItem(at: rootB)
    }
    let journalA = C7ProtectedCaptureJournal(root: rootA)
    let proposedRecord = try await journalA.create(
      brief: C7SyntheticFixture.brief(), serverVersion: 1)
    let proposedService = C7SyncServiceStub(
      session: C7SyntheticFixture.session(state: .proposed),
      proposal: C7SyntheticFixture.proposal()
    )
    let proposedEngine = C7CaptureSyncEngine(service: proposedService, journal: journalA)
    let proposed = try await proposedEngine.refresh(proposedRecord)

    let journalB = C7ProtectedCaptureJournal(root: rootB)
    let abstainedRecord = try await journalB.create(
      brief: C7SyntheticFixture.brief(), serverVersion: 1)
    let abstainedService = C7SyncServiceStub(
      session: C7SyntheticFixture.session(state: .abstained),
      proposal: C7SyntheticFixture.abstention()
    )
    let abstainedEngine = C7CaptureSyncEngine(service: abstainedService, journal: journalB)
    let abstained = try await abstainedEngine.refresh(abstainedRecord)

    #expect(proposed.record.phase == .proposed)
    #expect(abstained.record.phase == .abstained)
    if case .proposal = proposed.proposal {} else { Issue.record("Expected proposal") }
    if case .abstained = abstained.proposal {} else { Issue.record("Expected abstention") }
  }

  @Test("mismatched artifact upload session is rejected as a replay conflict")
  func uploadIdentityConflict() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let service = C7SyncServiceStub(mismatchCreatedArtifact: true)
    let engine = C7CaptureSyncEngine(
      service: service,
      journal: journal,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )

    await #expect(throws: C7CaptureServiceError.invalidResponse) {
      try await engine.synchronize(record) { _ in }
    }
    #expect(await service.finalizeCount() == 0)
  }

  private func eventually(
    condition: @escaping @Sendable () async -> Bool
  ) async {
    for _ in 0..<100 {
      if await condition() { return }
      try? await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("Condition was not reached")
  }
}

private actor C7MemoryDiagnostics: C7CaptureDiagnosticsRecording {
  private var recorded: [C7CaptureDiagnosticEvent] = []
  func record(_ event: C7CaptureDiagnosticEvent) { recorded.append(event) }
  func events() -> [C7CaptureDiagnosticEvent] { recorded }
}

private actor C7SyncServiceStub: C7CaptureServing {
  private var currentSession: C7CaptureSession
  private var result: C7CaptureProposalResult
  private var uploadSessions: [UUID: C7ArtifactUploadSession] = [:]
  private var signed: [(UUID, Int)] = []
  private var uploads = 0
  private var validChecksums = true
  private var finalizations = 0
  private var reads = 0
  private var started = false
  private var didExpireSignedUpload = false
  private let expireFirstSignedUpload: Bool
  private let sessionError: C7CaptureServiceError?
  private let cancelError: C7CaptureServiceError?
  private let uploadDelay: Duration?
  private let mismatchCreatedArtifact: Bool

  init(
    session: C7CaptureSession = C7SyntheticFixture.session(),
    proposal: C7CaptureProposalResult = C7SyntheticFixture.proposal(),
    expireFirstSignedUpload: Bool = false,
    sessionError: C7CaptureServiceError? = nil,
    cancelError: C7CaptureServiceError? = nil,
    uploadDelay: Duration? = nil,
    mismatchCreatedArtifact: Bool = false
  ) {
    currentSession = session
    result = proposal
    self.expireFirstSignedUpload = expireFirstSignedUpload
    self.sessionError = sessionError
    self.cancelError = cancelError
    self.uploadDelay = uploadDelay
    self.mismatchCreatedArtifact = mismatchCreatedArtifact
  }

  func listSessions(projectId: UUID) -> [C7CaptureSession] { [currentSession] }

  func createSession(
    projectId: UUID,
    request: C7CreateCaptureSessionRequest,
    idempotencyKey: String
  ) -> C7CaptureSession { currentSession }

  func session(projectId: UUID, captureSessionId: UUID) throws -> C7CaptureSession {
    reads += 1
    if let sessionError { throw sessionError }
    return currentSession
  }

  func cancelSession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) throws -> C7CaptureSession {
    if let cancelError { throw cancelError }
    currentSession = C7SyntheticFixture.session(
      state: .cancelled, version: currentSession.version + 1)
    return currentSession
  }

  func retrySession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) -> C7CaptureSession {
    currentSession = C7SyntheticFixture.session(
      state: .processing, version: currentSession.version + 1)
    return currentSession
  }

  func createArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    request: C7CreateCaptureArtifactUploadRequest,
    idempotencyKey: String
  ) -> C7ArtifactUploadSession {
    let id = UUID()
    let session = C7ArtifactUploadSession(
      artifactId: mismatchCreatedArtifact ? UUID() : requestArtifactId(from: idempotencyKey),
      captureSessionId: captureSessionId,
      expiresAt: "2026-07-18T12:00:00.000Z",
      maximumPartCount: C7CaptureContract.maximumUploadPartCount,
      minimumNonFinalPartSize: 5_242_880,
      partSize: C7CaptureContract.uploadPartSizeBytes,
      recordedPartNumbers: [],
      state: .initiated,
      uploadSessionId: id
    )
    uploadSessions[id] = session
    return session
  }

  func uploadSession(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID
  ) throws -> C7ArtifactUploadSession {
    guard let session = uploadSessions[uploadSessionId] else {
      throw C7CaptureServiceError.conflict
    }
    return session
  }

  func signArtifactPart(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    request: C7SignArtifactPartRequest,
    idempotencyKey: String
  ) throws -> C7SignedArtifactPart {
    guard let upload = uploadSessions[uploadSessionId] else {
      throw C7CaptureServiceError.conflict
    }
    signed.append((upload.artifactId, request.partNumber))
    return C7SignedArtifactPart(
      expiresAt: "2026-07-18T12:00:00.000Z",
      partNumber: request.partNumber,
      requiredHeaders: ["x-amz-checksum-sha256": request.checksumSha256],
      url: URL(string: "http://127.0.0.1:8333/VISIBLY-SYNTHETIC")!
    )
  }

  func uploadArtifactPart(
    fileURL: URL,
    signedPart: C7SignedArtifactPart,
    expectedChecksum: String
  ) async throws -> String {
    started = true
    if let uploadDelay { try await Task.sleep(for: uploadDelay) }
    if expireFirstSignedUpload, !didExpireSignedUpload {
      didExpireSignedUpload = true
      throw C7CaptureServiceError.signedURLExpired
    }
    uploads += 1
    if try C7CaptureFileHasher.checksumBase64(fileURL: fileURL) != expectedChecksum {
      validChecksums = false
      throw C7CaptureServiceError.checksumMismatch
    }
    return "synthetic-etag-\(signedPart.partNumber)"
  }

  func completeArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    parts: [C7CompletedArtifactPart],
    idempotencyKey: String
  ) throws -> C7ArtifactUploadSession {
    guard let existing = uploadSessions[uploadSessionId] else {
      throw C7CaptureServiceError.conflict
    }
    let completed = C7ArtifactUploadSession(
      artifactId: existing.artifactId,
      captureSessionId: captureSessionId,
      expiresAt: existing.expiresAt,
      maximumPartCount: existing.maximumPartCount,
      minimumNonFinalPartSize: existing.minimumNonFinalPartSize,
      partSize: existing.partSize,
      recordedPartNumbers: parts.map(\.partNumber),
      state: .completed,
      uploadSessionId: uploadSessionId
    )
    uploadSessions[uploadSessionId] = completed
    return completed
  }

  func finalizePackage(
    projectId: UUID,
    captureSessionId: UUID,
    package: C7CreateCapturePackageRequest,
    idempotencyKey: String
  ) -> C7CaptureSession {
    finalizations += 1
    currentSession = C7SyntheticFixture.session(
      state: .processing, version: currentSession.version + 1)
    return currentSession
  }

  func proposal(projectId: UUID, captureSessionId: UUID) -> C7CaptureProposalResult { result }

  func seedUpload(
    artifact: C7JournalArtifact,
    uploadSessionId: UUID,
    recordedPartNumbers: [Int]
  ) {
    uploadSessions[uploadSessionId] = C7ArtifactUploadSession(
      artifactId: artifact.id,
      captureSessionId: C7SyntheticFixture.sessionId,
      expiresAt: "2026-07-18T12:00:00.000Z",
      maximumPartCount: C7CaptureContract.maximumUploadPartCount,
      minimumNonFinalPartSize: 5_242_880,
      partSize: C7CaptureContract.uploadPartSizeBytes,
      recordedPartNumbers: recordedPartNumbers,
      state: .uploading,
      uploadSessionId: uploadSessionId
    )
  }

  func requestArtifactId(from key: String) -> UUID {
    let suffix = key.replacingOccurrences(of: "artifact-", with: "").split(separator: "-").prefix(5)
      .joined(separator: "-")
    return UUID(uuidString: suffix) ?? C7SyntheticFixture.roomArtifactId
  }

  func signedParts(for artifactId: UUID) -> [Int] {
    signed.filter { $0.0 == artifactId }.map(\.1)
  }

  func totalSignCount() -> Int { signed.count }
  func uploadCount() -> Int { uploads }
  func finalizeCount() -> Int { finalizations }
  func sessionReadCount() -> Int { reads }
  func uploadStarted() -> Bool { started }
  func allUploadsHadValidChecksums() -> Bool { validChecksums }
}

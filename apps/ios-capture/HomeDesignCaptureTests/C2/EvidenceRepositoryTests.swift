import Foundation
import XCTest
@testable import HomeDesignCapture

@MainActor
final class EvidenceRepositoryTests: XCTestCase {
  func testTrainingPermissionDefaultsDeniedAndServiceConsentIsSeparate() {
    let repository = EvidenceRepository(
      service: EvidenceServiceStub(),
      recoveryStore: MemoryRecoveryStore()
    )

    XCTAssertEqual(repository.trainingUseConsent, .denied)
    XCTAssertFalse(repository.serviceProcessingConsent)
  }

  func testInventoryMapsOfflineForbiddenAndReadyStates() async {
    let offline = EvidenceRepository(
      service: EvidenceServiceStub(listResult: .failure(.offline)),
      recoveryStore: MemoryRecoveryStore()
    )
    await offline.activate(projectId: Fixture.projectId)
    XCTAssertEqual(offline.inventoryState, .offline)

    let forbidden = EvidenceRepository(
      service: EvidenceServiceStub(listResult: .failure(.forbidden)),
      recoveryStore: MemoryRecoveryStore()
    )
    await forbidden.activate(projectId: Fixture.projectId)
    XCTAssertEqual(forbidden.inventoryState, .forbidden)

    let ready = EvidenceRepository(
      service: EvidenceServiceStub(listResult: .success([Fixture.asset(status: .ready)])),
      recoveryStore: MemoryRecoveryStore()
    )
    await ready.activate(projectId: Fixture.projectId)
    XCTAssertEqual(ready.inventoryState, .loaded([Fixture.asset(status: .ready)]))
  }

  func testActivationSurfacesSavedRecoveryWithoutPersistingCredentialsOrSignedURL() async throws {
    let store = MemoryRecoveryStore(recovery: Fixture.recovery)
    let repository = EvidenceRepository(service: EvidenceServiceStub(), recoveryStore: store)

    await repository.activate(projectId: Fixture.projectId)

    XCTAssertEqual(repository.transferState, .paused(Fixture.recovery))
    let encoded = String(data: try JSONEncoder().encode(Fixture.recovery), encoding: .utf8)!
    XCTAssertFalse(encoded.localizedCaseInsensitiveContains("bearer"))
    XCTAssertFalse(encoded.localizedCaseInsensitiveContains("signed"))
    XCTAssertFalse(encoded.contains("http://"))
    XCTAssertFalse(encoded.contains("https://"))
  }

  func testResumeReconcilesExpiredServerSessionBeforeUploading() async {
    let service = EvidenceServiceStub(sessionState: .expired)
    let store = MemoryRecoveryStore(recovery: Fixture.recovery)
    let repository = EvidenceRepository(service: service, recoveryStore: store)
    await repository.activate(projectId: Fixture.projectId)

    repository.resume(Fixture.recovery)
    await eventually { repository.transferState == .failed("The saved session is expired. Select the file again.", recovery: nil) }

    let savedRecovery = await store.currentRecovery()
    let uploadCount = await service.uploadCount()
    XCTAssertNil(savedRecovery)
    XCTAssertEqual(uploadCount, 0)
  }

  func testFileValidationRejectsOversizedUnsupportedAndUnsafeNamesBeforeServiceSubmission() throws {
    XCTAssertThrowsError(
      try EvidenceFileSupport.validate(
        fileName: "notes.txt",
        size: 12,
        mimeType: "text/plain",
        kind: .document
      )
    )
    XCTAssertThrowsError(
      try EvidenceFileSupport.validate(
        fileName: "../plan.pdf",
        size: 12,
        mimeType: "application/pdf",
        kind: .plan
      )
    )
    XCTAssertThrowsError(
      try EvidenceFileSupport.validate(
        fileName: "plan.pdf",
        size: 2_147_483_649,
        mimeType: "application/pdf",
        kind: .plan
      )
    )
  }

  func testResumeReconciliationConsumesSortedServerPartNumbers() {
    var recovery = Fixture.recovery
    recovery.completedParts = [
      CompletedEvidencePart(checksumSha256: "three", etag: "etag-three", partNumber: 3),
      CompletedEvidencePart(checksumSha256: "one", etag: "etag-one", partNumber: 1),
    ]

    let reconciled = EvidenceResumeReconciler.reconcile(
      recovery,
      recordedPartNumbers: [2, 1, 2]
    )

    XCTAssertEqual(reconciled.completedParts.map(\.partNumber), [1])
    XCTAssertEqual(reconciled.completedParts.first?.etag, "etag-one")
  }

  func testStagingPathNeverUsesTheDisplayedFileNameAsIdentity() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let source = root.appendingPathComponent("\u{202E}invoice.pdf")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("%PDF-1.4 synthetic".utf8).write(to: source)
    defer { try? FileManager.default.removeItem(at: root) }

    let staged = try await EvidenceRecoveryStore(root: root.appendingPathComponent("store")).stage(
      sourceURL: source
    )

    XCTAssertNotEqual(staged.lastPathComponent, source.lastPathComponent)
    XCTAssertFalse(staged.path.contains("invoice.pdf"))
    XCTAssertEqual(UUID(uuidString: staged.lastPathComponent)?.uuidString, staged.lastPathComponent)
  }

  private func eventually(
    timeout: Duration = .seconds(2),
    condition: @escaping @MainActor () -> Bool
  ) async {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if condition() { return }
      try? await Task.sleep(for: .milliseconds(20))
    }
    XCTFail("Condition was not reached before timeout")
  }
}

private enum Fixture {
  static let projectId = "33333333-3333-4333-8333-333333333333"
  static let sessionId = "44444444-4444-4444-8444-444444444444"

  static func asset(status: EvidenceStatus) -> EvidenceAsset {
    EvidenceAsset(
      createdAt: "2026-07-17T12:00:00.000Z",
      declaredMimeType: "application/pdf",
      detectedMimeType: status == .ready ? "application/pdf" : nil,
      fileName: "synthetic-plan.pdf",
      id: "55555555-5555-4555-8555-555555555555",
      kind: .plan,
      projectId: projectId,
      rejectionCode: nil,
      rights: EvidenceRightsAssertion(
        attribution: nil,
        basis: .ownedByUser,
        licenceUrl: nil,
        serviceProcessingConsent: true,
        trainingUseConsent: .denied
      ),
      source: EvidenceSourceFingerprint(byteSize: 16, sha256: String(repeating: "a", count: 64)),
      status: status,
      updatedAt: "2026-07-17T12:00:00.000Z"
    )
  }

  static let recovery = EvidenceRecoveryRecord(
    assetId: "55555555-5555-4555-8555-555555555555",
    completedParts: [],
    completionKey: "complete-fixture",
    fileName: "synthetic-plan.pdf",
    fileURL: URL(fileURLWithPath: "/tmp/synthetic-plan.pdf"),
    kind: .plan,
    partSize: 5_242_880,
    projectId: projectId,
    sessionId: sessionId,
    sha256: String(repeating: "a", count: 64),
    updatedAt: Date(timeIntervalSince1970: 0)
  )
}

private actor MemoryRecoveryStore: EvidenceRecoveryStoring {
  private var recovery: EvidenceRecoveryRecord?

  init(recovery: EvidenceRecoveryRecord? = nil) {
    self.recovery = recovery
  }

  func clear(projectId: String) { recovery = nil }
  func load(projectId: String) -> EvidenceRecoveryRecord? { recovery }
  func save(_ record: EvidenceRecoveryRecord) { recovery = record }
  func stage(sourceURL: URL) -> URL { sourceURL }
  func partFile(sourceURL: URL, offset: UInt64, length: Int, partNumber: Int) -> URL { sourceURL }
  func currentRecovery() -> EvidenceRecoveryRecord? { recovery }
}

private actor EvidenceServiceStub: EvidenceServing {
  private let listResult: Result<[EvidenceAsset], EvidenceServiceError>
  private let sessionState: EvidenceUploadSessionState
  private var uploads = 0

  init(
    listResult: Result<[EvidenceAsset], EvidenceServiceError> = .success([]),
    sessionState: EvidenceUploadSessionState = .initiated
  ) {
    self.listResult = listResult
    self.sessionState = sessionState
  }

  func list(projectId: String) throws -> [EvidenceAsset] { try listResult.get() }

  func session(projectId: String, sessionId: String) -> EvidenceUploadSession {
    EvidenceUploadSession(
      asset: Fixture.asset(status: .uploading),
      expiresAt: "2026-07-17T13:00:00.000Z",
      maximumPartCount: 10_000,
      minimumNonFinalPartSize: 5_242_880,
      partSize: 5_242_880,
      recordedPartNumbers: [],
      sessionId: Fixture.sessionId,
      state: sessionState
    )
  }

  func createSession(
    projectId: String,
    selection: EvidenceSelection,
    sha256: String,
    rights: EvidenceRightsAssertion,
    idempotencyKey: String
  ) -> EvidenceUploadSession {
    session(projectId: projectId, sessionId: Fixture.sessionId)
  }

  func signPart(
    projectId: String,
    sessionId: String,
    partNumber: Int,
    byteSize: Int,
    checksumSha256: String,
    idempotencyKey: String
  ) -> SignedEvidencePart {
    SignedEvidencePart(
      expiresAt: "2026-07-17T12:15:00.000Z",
      partNumber: partNumber,
      requiredHeaders: ["x-amz-checksum-sha256": checksumSha256],
      url: URL(string: "http://127.0.0.1:8333/part")!
    )
  }

  func uploadPart(fileURL: URL, signedPart: SignedEvidencePart) -> String {
    uploads += 1
    return "fixture-etag"
  }

  func complete(
    projectId: String,
    sessionId: String,
    sha256: String,
    parts: [CompletedEvidencePart],
    idempotencyKey: String
  ) -> EvidenceAsset { Fixture.asset(status: .uploaded) }

  func abort(projectId: String, sessionId: String, idempotencyKey: String) {}

  func access(projectId: String, assetId: String, representation: String) -> EvidenceAccess {
    EvidenceAccess(
      contentDisposition: "inline",
      expiresAt: "2026-07-17T12:05:00.000Z",
      url: URL(string: "http://127.0.0.1:8333/preview")!
    )
  }

  func uploadCount() -> Int { uploads }
}

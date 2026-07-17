import Foundation
import Testing

@testable import HomeDesignCapture

private actor C8EvidenceServiceFixture: EvidenceServing {
  private(set) var createdRights: EvidenceRightsAssertion?
  private(set) var uploadedParts = 0
  private var sessionValue: EvidenceUploadSession?

  func createSession(
    projectId: String,
    selection: EvidenceSelection,
    sha256: String,
    rights: EvidenceRightsAssertion,
    idempotencyKey: String
  ) -> EvidenceUploadSession {
    createdRights = rights
    let asset = asset(
      projectId: projectId, selection: selection, sha256: sha256, status: .pendingUpload)
    let session = EvidenceUploadSession(
      asset: asset,
      expiresAt: "2026-07-18T12:00:00.000Z",
      maximumPartCount: 10_000,
      minimumNonFinalPartSize: 1,
      partSize: 8,
      recordedPartNumbers: [],
      sessionId: "1bf98ae6-601d-529f-83db-6c8666205444",
      state: .initiated
    )
    sessionValue = session
    return session
  }

  func session(projectId: String, sessionId: String) throws -> EvidenceUploadSession {
    guard let sessionValue else { throw EvidenceServiceError.invalidResponse }
    return sessionValue
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
      expiresAt: "2026-07-18T12:00:00.000Z",
      partNumber: partNumber,
      requiredHeaders: ["x-amz-checksum-sha256": checksumSha256],
      url: URL(string: "https://synthetic.invalid/opaque")!
    )
  }

  func uploadPart(fileURL: URL, signedPart: SignedEvidencePart) -> String {
    uploadedParts += 1
    return "synthetic-etag-\(signedPart.partNumber)"
  }

  func complete(
    projectId: String,
    sessionId: String,
    sha256: String,
    parts: [CompletedEvidencePart],
    idempotencyKey: String
  ) throws -> EvidenceAsset {
    guard let sessionValue else { throw EvidenceServiceError.invalidResponse }
    return asset(
      projectId: projectId,
      selection: EvidenceSelection(
        fileName: sessionValue.asset.fileName,
        fileURL: URL(fileURLWithPath: "/not-returned"),
        kind: sessionValue.asset.kind,
        mimeType: sessionValue.asset.declaredMimeType,
        size: sessionValue.asset.source.byteSize
      ),
      sha256: sha256,
      status: .processing
    )
  }

  func abort(projectId: String, sessionId: String, idempotencyKey: String) {}
  func access(projectId: String, assetId: String, representation: String) throws -> EvidenceAccess {
    throw EvidenceServiceError.forbidden
  }
  func list(projectId: String) -> [EvidenceAsset] { [] }

  func snapshot() -> (rights: EvidenceRightsAssertion?, parts: Int) {
    (createdRights, uploadedParts)
  }

  private func asset(
    projectId: String,
    selection: EvidenceSelection,
    sha256: String,
    status: EvidenceStatus
  ) -> EvidenceAsset {
    EvidenceAsset(
      createdAt: "2026-07-17T12:00:00.000Z",
      declaredMimeType: selection.mimeType,
      detectedMimeType: nil,
      fileName: selection.fileName,
      id: "70f8da39-ce0e-58f7-8c04-c74c2eb372c4",
      kind: selection.kind,
      projectId: projectId,
      rejectionCode: nil,
      rights: createdRights
        ?? EvidenceRightsAssertion(
          attribution: nil,
          basis: .ownedByUser,
          licenceUrl: nil,
          serviceProcessingConsent: true,
          trainingUseConsent: .denied
        ),
      source: EvidenceSourceFingerprint(byteSize: selection.size, sha256: sha256),
      status: status,
      updatedAt: "2026-07-17T12:00:00.000Z"
    )
  }
}

@Suite("C8 immutable evidence handoff")
struct C8EvidenceUploaderTests {
  @Test("local bytes must still match the protected handle before C2 handoff")
  func changedLocalBytesAreRejected() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-tamper-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    let original = Data(repeating: 65, count: 32)
    try original.write(to: source)
    let originalHash = try await EvidenceFileSupport.hash(fileURL: source) { _ in }
    try Data(repeating: 66, count: original.count).write(to: source)
    let service = C8EvidenceServiceFixture()
    let uploader = C8ImmutableEvidenceUploader(
      service: service,
      recoveryStore: EvidenceRecoveryStore(root: root.appendingPathComponent("recovery"))
    )

    await #expect(throws: EvidenceServiceError.invalidResponse) {
      try await uploader.upload(
        C8ImmutableEvidenceUpload(
          fileURL: source,
          handle: C8LocalMediaHandle(
            byteSize: Int64(original.count),
            containsDepthData: false,
            createdAt: Date(timeIntervalSince1970: 0),
            localIdentifier: UUID(),
            mimeType: .png,
            origin: .syntheticSimulatorFixture,
            sha256: originalHash
          ),
          projectId: UUID(),
          rights: C8MediaRights(basis: .ownedByUser, serviceProcessingConsent: true)
        )
      ) { _ in }
    }
    let snapshot = await service.snapshot()
    #expect(snapshot.rights == nil)
    #expect(snapshot.parts == 0)
  }

  @Test("captured media uses C2 checksummed parts and never grants training")
  func immutableUpload() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-upload-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    let bytes = Data("SYNTHETIC RIGHTS-CLEARED UPLOAD".utf8)
    try bytes.write(to: source)
    let hash = try await EvidenceFileSupport.hash(fileURL: source) { _ in }
    let projectId = UUID()
    let service = C8EvidenceServiceFixture()
    let uploader = C8ImmutableEvidenceUploader(
      service: service,
      recoveryStore: EvidenceRecoveryStore(root: root.appendingPathComponent("recovery"))
    )
    let receipt = try await uploader.upload(
      C8ImmutableEvidenceUpload(
        fileURL: source,
        handle: C8LocalMediaHandle(
          byteSize: Int64(bytes.count),
          containsDepthData: false,
          createdAt: Date(timeIntervalSince1970: 0),
          localIdentifier: UUID(),
          mimeType: .png,
          origin: .syntheticSimulatorFixture,
          sha256: hash
        ),
        projectId: projectId,
        rights: C8MediaRights(basis: .ownedByUser, serviceProcessingConsent: true)
      )
    ) { _ in }
    #expect(receipt.projectId == projectId)
    #expect(receipt.sha256 == hash)
    #expect(receipt.trainingUseConsent == .denied)
    #expect(receipt.status == .processing)
    let snapshot = await service.snapshot()
    #expect(snapshot.rights?.serviceProcessingConsent == true)
    #expect(snapshot.rights?.trainingUseConsent == .denied)
    #expect(snapshot.parts == 4)
  }
}

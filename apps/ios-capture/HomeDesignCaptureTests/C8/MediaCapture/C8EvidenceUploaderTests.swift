import Foundation
import Testing

@testable import HomeDesignCapture

private actor C8EvidenceServiceFixture: EvidenceServing {
  private var expiringUploadAttempts: Int
  private let partSize: Int
  private(set) var abortRequests = 0
  private(set) var createdSessions = 0
  private(set) var createdRights: EvidenceRightsAssertion?
  private(set) var signRequests = 0
  private(set) var uploadedParts = 0
  private var listedAssets: [EvidenceAsset] = []
  private var sessionValue: EvidenceUploadSession?

  init(partSize: Int = 8, expiringUploadAttempts: Int = 0) {
    self.partSize = partSize
    self.expiringUploadAttempts = expiringUploadAttempts
  }

  func createSession(
    projectId: String,
    selection: EvidenceSelection,
    sha256: String,
    rights: EvidenceRightsAssertion,
    idempotencyKey: String
  ) -> EvidenceUploadSession {
    createdSessions += 1
    createdRights = rights
    let asset = asset(
      projectId: projectId, selection: selection, sha256: sha256, status: .pendingUpload)
    let session = EvidenceUploadSession(
      asset: asset,
      expiresAt: "2026-07-18T12:00:00.000Z",
      maximumPartCount: 10_000,
      minimumNonFinalPartSize: 1,
      partSize: partSize,
      recordedPartNumbers: [],
      sessionId: String(format: "1bf98ae6-601d-529f-83db-%012d", createdSessions),
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
    signRequests += 1
    return SignedEvidencePart(
      expiresAt: "2026-07-18T12:00:00.000Z",
      partNumber: partNumber,
      requiredHeaders: ["x-amz-checksum-sha256": checksumSha256],
      url: URL(string: "https://synthetic.invalid/opaque")!
    )
  }

  func uploadPart(fileURL: URL, signedPart: SignedEvidencePart) throws -> String {
    if expiringUploadAttempts > 0 {
      expiringUploadAttempts -= 1
      throw EvidenceServiceError.signedURLExpired
    }
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

  func abort(projectId: String, sessionId: String, idempotencyKey: String) {
    abortRequests += 1
    setSessionState(.aborted)
  }
  func access(projectId: String, assetId: String, representation: String) throws -> EvidenceAccess {
    throw EvidenceServiceError.forbidden
  }
  func list(projectId: String) -> [EvidenceAsset] {
    listedAssets.filter { $0.projectId.lowercased() == projectId.lowercased() }
  }

  func seedCompletedAsset(
    projectId: String,
    selection: EvidenceSelection,
    sha256: String,
    status: EvidenceStatus = .ready,
    fileName: String? = nil
  ) {
    createdRights = EvidenceRightsAssertion(
      attribution: nil,
      basis: .ownedByUser,
      licenceUrl: nil,
      serviceProcessingConsent: true,
      trainingUseConsent: .denied
    )
    listedAssets.append(
      asset(
        projectId: projectId,
        selection: EvidenceSelection(
          fileName: fileName ?? selection.fileName,
          fileURL: selection.fileURL,
          kind: selection.kind,
          mimeType: selection.mimeType,
          size: selection.size
        ),
        sha256: sha256,
        status: status
      )
    )
  }

  func setSessionState(_ state: EvidenceUploadSessionState) {
    guard let sessionValue else { return }
    self.sessionValue = EvidenceUploadSession(
      asset: sessionValue.asset,
      expiresAt: sessionValue.expiresAt,
      maximumPartCount: sessionValue.maximumPartCount,
      minimumNonFinalPartSize: sessionValue.minimumNonFinalPartSize,
      partSize: sessionValue.partSize,
      recordedPartNumbers: sessionValue.recordedPartNumbers,
      sessionId: sessionValue.sessionId,
      state: state
    )
  }

  func snapshot() -> (
    rights: EvidenceRightsAssertion?, parts: Int, signRequests: Int,
    abortRequests: Int, createdSessions: Int
  ) {
    (createdRights, uploadedParts, signRequests, abortRequests, createdSessions)
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
  @Test("background file upload failures remain catchable Swift errors")
  func delegateBackedBackgroundUpload() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-background-upload-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    try Data("SYNTHETIC BACKGROUND UPLOAD".utf8).write(to: source)
    let transport = URLSessionEvidenceTransport(
      backgroundIdentifier: "com.homedesignstudio.capture.tests.\(UUID().uuidString)"
    )
    let task = Task {
      try await transport.upload(
        for: URLRequest(url: URL(string: "https://127.0.0.1:1/upload")!),
        fromFile: source
      )
    }

    try await Task.sleep(nanoseconds: 50_000_000)
    task.cancel()
    do {
      _ = try await task.value
      Issue.record("An unreachable background upload must not succeed.")
    } catch {
      // A delegate-delivered transport or cancellation error is the expected safe boundary.
    }
  }

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

  @Test("expired C2 signatures advance through a bounded fresh generation")
  func expiredSignatureRefresh() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-expired-signature-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    let bytes = Data("SYNTHETIC EXPIRED SIGNATURE".utf8)
    try bytes.write(to: source)
    let hash = try await EvidenceFileSupport.hash(fileURL: source) { _ in }
    let service = C8EvidenceServiceFixture(
      partSize: EvidenceTransferPolicy.maximumPartBytes,
      expiringUploadAttempts: 1
    )
    let uploader = C8ImmutableEvidenceUploader(
      service: service,
      recoveryStore: EvidenceRecoveryStore(root: root.appendingPathComponent("recovery"))
    )

    _ = try await uploader.upload(
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
        projectId: UUID(),
        rights: C8MediaRights(basis: .ownedByUser, serviceProcessingConsent: true)
      )
    ) { _ in }
    let snapshot = await service.snapshot()
    #expect(snapshot.signRequests == 2)
    #expect(snapshot.parts == 1)
  }

  @Test("a lost local receipt reuses the exact completed C2 asset")
  func completedAssetReconciliation() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-completed-reconciliation-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    let bytes = Data("SYNTHETIC COMPLETED RECONCILIATION".utf8)
    try bytes.write(to: source)
    let hash = try await EvidenceFileSupport.hash(fileURL: source) { _ in }
    let projectId = UUID()
    let localIdentifier = UUID()
    let service = C8EvidenceServiceFixture()
    await service.seedCompletedAsset(
      projectId: projectId.uuidString.lowercased(),
      selection: EvidenceSelection(
        fileName: "capture-\(localIdentifier.uuidString.lowercased()).png",
        fileURL: source,
        kind: .photograph,
        mimeType: C8MediaMIMEType.png.rawValue,
        size: Int64(bytes.count)
      ),
      sha256: hash
    )
    let uploader = C8ImmutableEvidenceUploader(
      service: service,
      recoveryStore: EvidenceRecoveryStore(root: root.appendingPathComponent("recovery"))
    )

    let receipt = try await uploader.upload(
      uploadRequest(
        fileURL: source,
        byteCount: bytes.count,
        hash: hash,
        localIdentifier: localIdentifier,
        projectId: projectId
      )
    ) { _ in }
    let snapshot = await service.snapshot()
    #expect(receipt.status == .ready)
    #expect(snapshot.createdSessions == 0)
    #expect(snapshot.parts == 0)
  }

  @Test("completed C2 reconciliation requires the exact protected local identity")
  func completedAssetReconciliationRejectsAnotherLocalIdentity() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-completed-identity-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    let bytes = Data("SYNTHETIC COMPLETED IDENTITY".utf8)
    try bytes.write(to: source)
    let hash = try await EvidenceFileSupport.hash(fileURL: source) { _ in }
    let projectId = UUID()
    let localIdentifier = UUID()
    let service = C8EvidenceServiceFixture(partSize: EvidenceTransferPolicy.maximumPartBytes)
    await service.seedCompletedAsset(
      projectId: projectId.uuidString.lowercased(),
      selection: EvidenceSelection(
        fileName: "capture-\(localIdentifier.uuidString.lowercased()).png",
        fileURL: source,
        kind: .photograph,
        mimeType: C8MediaMIMEType.png.rawValue,
        size: Int64(bytes.count)
      ),
      sha256: hash,
      fileName: "capture-\(UUID().uuidString.lowercased()).png"
    )
    let uploader = C8ImmutableEvidenceUploader(
      service: service,
      recoveryStore: EvidenceRecoveryStore(root: root.appendingPathComponent("recovery"))
    )

    _ = try await uploader.upload(
      uploadRequest(
        fileURL: source,
        byteCount: bytes.count,
        hash: hash,
        localIdentifier: localIdentifier,
        projectId: projectId
      )
    ) { _ in }
    let snapshot = await service.snapshot()
    #expect(snapshot.createdSessions == 1)
    #expect(snapshot.parts == 1)
  }

  @Test("recovery rebinds a verified source after the app container URL changes")
  func recoveryRebindsContainerURL() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-container-rebind-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let firstURL = root.appendingPathComponent("old-container-source")
    let reboundURL = root.appendingPathComponent("new-container-source")
    let bytes = Data("SYNTHETIC CONTAINER REBIND".utf8)
    try bytes.write(to: firstURL)
    try bytes.write(to: reboundURL)
    let hash = try await EvidenceFileSupport.hash(fileURL: firstURL) { _ in }
    let projectId = UUID()
    let localIdentifier = UUID()
    let service = C8EvidenceServiceFixture(
      partSize: EvidenceTransferPolicy.maximumPartBytes,
      expiringUploadAttempts: 3
    )
    let uploader = C8ImmutableEvidenceUploader(
      service: service,
      recoveryStore: EvidenceRecoveryStore(root: root.appendingPathComponent("recovery"))
    )

    await #expect(throws: EvidenceServiceError.signedURLExpired) {
      try await uploader.upload(
        uploadRequest(
          fileURL: firstURL,
          byteCount: bytes.count,
          hash: hash,
          localIdentifier: localIdentifier,
          projectId: projectId
        )
      ) { _ in }
    }
    _ = try await uploader.upload(
      uploadRequest(
        fileURL: reboundURL,
        byteCount: bytes.count,
        hash: hash,
        localIdentifier: localIdentifier,
        projectId: projectId
      )
    ) { _ in }
    let snapshot = await service.snapshot()
    #expect(snapshot.createdSessions == 1)
    #expect(snapshot.abortRequests == 0)
    #expect(snapshot.parts == 1)
  }

  @Test("terminal resumable sessions advance to a fresh create generation")
  func terminalSessionReplacement() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-terminal-replacement-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    let bytes = Data("SYNTHETIC TERMINAL REPLACEMENT".utf8)
    try bytes.write(to: source)
    let hash = try await EvidenceFileSupport.hash(fileURL: source) { _ in }
    let request = uploadRequest(
      fileURL: source,
      byteCount: bytes.count,
      hash: hash,
      localIdentifier: UUID(),
      projectId: UUID()
    )
    let service = C8EvidenceServiceFixture(
      partSize: EvidenceTransferPolicy.maximumPartBytes,
      expiringUploadAttempts: 3
    )
    let uploader = C8ImmutableEvidenceUploader(
      service: service,
      recoveryStore: EvidenceRecoveryStore(root: root.appendingPathComponent("recovery"))
    )

    await #expect(throws: EvidenceServiceError.signedURLExpired) {
      try await uploader.upload(request) { _ in }
    }
    await service.setSessionState(.aborted)
    _ = try await uploader.upload(request) { _ in }
    let snapshot = await service.snapshot()
    #expect(snapshot.createdSessions == 2)
    #expect(snapshot.abortRequests == 0)
    #expect(snapshot.parts == 1)
  }

  @Test(
    "captured media uses valid C2 checksummed part plans and never grants training",
    arguments: [8, EvidenceTransferPolicy.maximumPartBytes]
  )
  func immutableUpload(partSize: Int) async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-evidence-upload-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("opaque-source")
    let bytes = Data("SYNTHETIC RIGHTS-CLEARED UPLOAD".utf8)
    try bytes.write(to: source)
    let hash = try await EvidenceFileSupport.hash(fileURL: source) { _ in }
    let projectId = UUID()
    let service = C8EvidenceServiceFixture(partSize: partSize)
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
    #expect(snapshot.parts == Int(ceil(Double(bytes.count) / Double(partSize))))
  }

  private func uploadRequest(
    fileURL: URL,
    byteCount: Int,
    hash: String,
    localIdentifier: UUID,
    projectId: UUID
  ) -> C8ImmutableEvidenceUpload {
    C8ImmutableEvidenceUpload(
      fileURL: fileURL,
      handle: C8LocalMediaHandle(
        byteSize: Int64(byteCount),
        containsDepthData: false,
        createdAt: Date(timeIntervalSince1970: 0),
        localIdentifier: localIdentifier,
        mimeType: .png,
        origin: .syntheticSimulatorFixture,
        sha256: hash
      ),
      projectId: projectId,
      rights: C8MediaRights(basis: .ownedByUser, serviceProcessingConsent: true)
    )
  }
}

import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C7 protected capture journal", .serialized)
struct ProtectedCaptureJournalTests {
  @Test("pending session intent replays the exact idempotency request")
  func intentReplay() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = C7ProtectedCaptureJournal(root: root)
    let request = C7CreateCaptureSessionRequest(
      captureLabel: "VISIBLY SYNTHETIC capture",
      expectedRoomCount: 1,
      mode: .singleRoom,
      rights: C7SyntheticFixture.rights
    )
    let intent = C7CaptureSessionIntent(
      createdAt: C7SyntheticFixture.now,
      idempotencyKey: "synthetic-idempotency-key",
      projectId: C7SyntheticFixture.projectId,
      request: request,
      schemaVersion: C7CaptureSessionIntent.schemaVersion
    )

    try await journal.saveIntent(intent)
    #expect(try await journal.loadIntent(projectId: C7SyntheticFixture.projectId) == intent)
    try await journal.clearIntent(projectId: C7SyntheticFixture.projectId)
    #expect(try await journal.loadIntent(projectId: C7SyntheticFixture.projectId) == nil)
  }

  @Test("staged source uses an opaque name and iOS data protection")
  func protectedOpaqueStaging() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let source = try C7SyntheticFixture.sourceFile(in: root)
    let journal = C7ProtectedCaptureJournal(root: root)
    var record = try await journal.create(brief: C7SyntheticFixture.brief(), serverVersion: 1)
    record = try await journal.stageReview(
      C7SyntheticFixture.review(sourceURL: source), record: record)
    let artifact = try #require(record.review?.rawArtifacts.first)
    let staged = artifactURL(root: root, record: record, storageName: artifact.storageName)
    let protection = try FileManager.default.attributesOfItem(atPath: staged.path)[.protectionKey]

    #expect(artifact.storageName == C7SyntheticFixture.roomArtifactId.uuidString.lowercased())
    #expect(!artifact.storageName.localizedCaseInsensitiveContains("room"))
    #if targetEnvironment(simulator)
      // APFS-backed Simulator containers may accept but not report NSFileProtection metadata.
      #expect(
        protection == nil
          || protection as? FileProtectionType == .completeUntilFirstUserAuthentication
      )
    #else
      #expect(protection as? FileProtectionType == .completeUntilFirstUserAuthentication)
    #endif
    #expect(try C7CaptureFileHasher.sha256Hex(fileURL: staged) == artifact.manifest.sha256)
  }

  @Test("journal contains no URL, bearer token, signed locator, object key, or source path")
  func noSecretJournal() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (_, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let journalURL =
      root
      .appendingPathComponent(record.projectId.uuidString.lowercased())
      .appendingPathComponent(record.id.uuidString.lowercased())
      .appendingPathComponent("journal.json")
    let journalText = try String(contentsOf: journalURL, encoding: .utf8).lowercased()

    #expect(!journalText.contains("http://"))
    #expect(!journalText.contains("https://"))
    #expect(!journalText.contains("bearer"))
    #expect(!journalText.contains("signedurl"))
    #expect(!journalText.contains("objectkey"))
    #expect(!journalText.contains("visibly-synthetic-room.json"))
    #expect(!journalText.contains(root.path.lowercased()))
  }

  @Test("optimistic journal save rejects a stale writer")
  func staleWriterConflict() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = C7ProtectedCaptureJournal(root: root)
    let record = try await journal.create(brief: C7SyntheticFixture.brief(), serverVersion: 1)
    var first = record
    first.phase = .scanning
    _ = try await journal.save(first)
    var stale = record
    stale.phase = .cancelled

    await #expect(throws: C7CaptureJournalError.conflict) {
      try await journal.save(stale)
    }
  }

  @Test("final package writes contract-shaped normalized and quality artifacts")
  func finalWireArtifacts() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (_, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let package = try #require(record.package)
    let normalized = try #require(
      package.artifacts.first(where: { $0.manifest.kind == .roomPlanNormalizedJSON })
    )
    let quality = try #require(
      package.artifacts.first(where: { $0.manifest.kind == .qualityManifestJSON })
    )
    let normalizedJSON = try #require(
      JSONSerialization.jsonObject(
        with: Data(
          contentsOf: artifactURL(root: root, record: record, storageName: normalized.storageName))
      ) as? [String: Any]
    )
    let qualityJSON = try #require(
      JSONSerialization.jsonObject(
        with: Data(
          contentsOf: artifactURL(root: root, record: record, storageName: quality.storageName))
      ) as? [String: Any]
    )

    #expect(
      normalizedJSON["schemaVersion"] as? String
        == C7CaptureContract.normalizedRoomPlanSchemaVersion)
    #expect((normalizedJSON["quality"] as? [String: Any])?["instructionCounts"] is [String: Any])
    #expect(qualityJSON["instructionCounts"] is [String: Any])
    #expect(package.manifest.artifacts.count == 3)
  }

  @Test("artifact substitution is detected before resume")
  func checksumMismatch() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let artifact = try #require(record.package?.artifacts.first)
    let url = artifactURL(root: root, record: record, storageName: artifact.storageName)
    try Data("VISIBLY SYNTHETIC SUBSTITUTION".utf8).write(to: url)

    await #expect(throws: C7CaptureServiceError.checksumMismatch) {
      try await journal.verifyArtifact(record: record, artifact: artifact)
    }
  }

  @Test("part files are exact bounded slices")
  func boundedPartFiles() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let sourceBytes = C7CaptureContract.uploadPartSizeBytes + 7
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(
      root: root,
      sourceBytes: sourceBytes
    )
    let artifact = try #require(
      record.package?.artifacts.first(where: { $0.manifest.kind == .capturedRoomJSON })
    )
    let first = try await journal.makePartFile(
      record: record,
      artifact: artifact,
      offset: 0,
      length: C7CaptureContract.uploadPartSizeBytes,
      partNumber: 1
    )
    let second = try await journal.makePartFile(
      record: record,
      artifact: artifact,
      offset: UInt64(C7CaptureContract.uploadPartSizeBytes),
      length: 7,
      partNumber: 2
    )

    #expect(
      try first.resourceValues(forKeys: [.fileSizeKey]).fileSize
        == C7CaptureContract.uploadPartSizeBytes)
    #expect(try second.resourceValues(forKeys: [.fileSizeKey]).fileSize == 7)
  }

  @Test("partial server reconciliation retains only checksum-bearing recorded parts")
  func partialReconciliation() throws {
    let parts = [
      C7CompletedArtifactPart(checksumSha256: "one", etag: "etag-one", partNumber: 1),
      C7CompletedArtifactPart(checksumSha256: "two", etag: "etag-two", partNumber: 2),
      C7CompletedArtifactPart(checksumSha256: "three", etag: "etag-three", partNumber: 3),
    ]
    let reconciled = try C7CapturePartReconciler.reconcile(
      localParts: parts,
      serverPartNumbers: [1, 2]
    )
    #expect(reconciled.map(\.partNumber) == [1, 2])
  }

  @Test("server-only part is safely reuploaded while malformed ordering fails closed")
  func invalidReconciliation() throws {
    let local = [
      C7CompletedArtifactPart(checksumSha256: "one", etag: "etag-one", partNumber: 1)
    ]
    #expect(
      try C7CapturePartReconciler.reconcile(localParts: local, serverPartNumbers: [1, 2])
        .map(\.partNumber) == [1]
    )
    #expect(throws: C7CaptureServiceError.invalidResponse) {
      try C7CapturePartReconciler.reconcile(localParts: local, serverPartNumbers: [1, 1])
    }
    #expect(throws: C7CaptureServiceError.invalidResponse) {
      try C7CapturePartReconciler.reconcile(localParts: local, serverPartNumbers: [2, 1])
    }
  }

  @Test("a prepared journal reloads byte-for-byte without raw source payload")
  func relaunchRoundTrip() async throws {
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let (journal, record) = try await C7SyntheticFixture.preparedJournal(root: root)
    let restored = try await journal.loadLatest(projectId: C7SyntheticFixture.projectId)
    #expect(restored == record)
    #expect(restored?.phase == .paused)
    #expect(restored?.package?.artifacts.allSatisfy({ !$0.storageName.contains("/") }) == true)
  }

  private func artifactURL(
    root: URL,
    record: C7CaptureJournalRecord,
    storageName: String
  ) -> URL {
    root
      .appendingPathComponent(record.projectId.uuidString.lowercased())
      .appendingPathComponent(record.id.uuidString.lowercased())
      .appendingPathComponent("artifacts")
      .appendingPathComponent(storageName)
  }
}

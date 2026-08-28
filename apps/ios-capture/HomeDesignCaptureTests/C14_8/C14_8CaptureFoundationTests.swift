import CryptoKit
import Foundation
import XCTest

@testable import HomeDesignCapture

@MainActor
final class C14_8CaptureFoundationTests: XCTestCase {
  func testWireTimelineContainsMicrosecondSegmentAfterMillisecondEncoding() throws {
    let startedAt = Date(timeIntervalSinceReferenceDate: 810_000_000.123_789)
    let requiredEndMicroseconds: Int64 = 2_724_244_146
    let endedAt = startedAt.addingTimeInterval(2_724.244_161)

    let timeline = try C14_8GuidedCaptureModel.canonicalWireTimeline(
      startedAt: startedAt,
      endedAt: endedAt,
      requiredEndMicroseconds: requiredEndMicroseconds
    )
    let encodedStart = try XCTUnwrap(C7ISO8601.date(from: timeline.startedAt))
    let encodedEnd = try XCTUnwrap(C7ISO8601.date(from: timeline.endedAt))
    let encodedDurationMicroseconds =
      Int64(
        (encodedEnd.timeIntervalSince(encodedStart) * 1_000).rounded()
      ) * 1_000

    XCTAssertGreaterThanOrEqual(encodedDurationMicroseconds, requiredEndMicroseconds)
    XCTAssertLessThan(encodedDurationMicroseconds - requiredEndMicroseconds, 1_000)
  }

  func testSubmissionRetryPreservesAlreadyClosedCaptureTimeline() throws {
    let projectId = UUID()
    let actorId = UUID()
    let tenantId = UUID()
    var closed = fixtureDraft(projectId: projectId, actorId: actorId, tenantId: tenantId)
    let captureEnd = closed.createdAt.addingTimeInterval(120)
    closed.segments[0].endedAtMicroseconds = 120_000_000
    closed.endedAt = captureEnd
    closed.updatedAt = captureEnd
    try C14_8ContractValidator.validate(draft: closed)

    let retried = C14_8GuidedCaptureModel.prepareSubmissionDraft(
      closed,
      at: captureEnd.addingTimeInterval(300)
    )

    XCTAssertEqual(retried.endedAt, captureEnd)
    XCTAssertEqual(retried.segments, closed.segments)
    XCTAssertGreaterThan(retried.updatedAt, closed.updatedAt)
    try C14_8ContractValidator.validate(draft: retried)
  }

  func testSubmissionFailuresDistinguishServiceOutageFromContractFailure() {
    XCTAssertEqual(
      C14_8GuidedCaptureModel.submissionFailure(for: EvidenceServiceError.unavailable),
      .failed(
        message:
          "The capture service became temporarily unavailable before envelope acceptance. Completed immutable uploads remain resumable; retry after service health returns.",
        retryable: true
      )
    )
    XCTAssertEqual(
      C14_8GuidedCaptureModel.submissionFailure(for: EvidenceServiceError.invalidResponse),
      .failed(
        message:
          "The capture service response did not match the accepted upload contract. No envelope was accepted.",
        retryable: false
      )
    )
    XCTAssertEqual(
      C14_8GuidedCaptureModel.submissionFailure(for: C7CaptureServiceError.unavailable),
      .failed(
        message:
          "The capture service became temporarily unavailable before envelope acceptance. Completed immutable uploads remain resumable; retry after service health returns.",
        retryable: true
      )
    )
    XCTAssertEqual(
      C14_8GuidedCaptureModel.submissionFailure(for: C14_8ContractError.invalidEvidence),
      .failed(
        message:
          "The protected capture draft failed local integrity validation before envelope acceptance. No source evidence was changed.",
        retryable: false
      )
    )
  }

  func testSimulatorCapabilityCannotClaimPhysicalSensors() throws {
    #if targetEnvironment(simulator)
      let capability = C14_8SystemCapabilityProvider().current()

      XCTAssertEqual(capability.runtime, .simulatorFixture)
      XCTAssertEqual(capability.qualityTier, .simulatorFixture)
      XCTAssertFalse(capability.arWorldTracking)
      XCTAssertFalse(capability.cameraIntrinsics)
      XCTAssertFalse(capability.cameraPoses)
      XCTAssertFalse(capability.sceneDepth)
      XCTAssertFalse(capability.roomPlan)
      XCTAssertTrue(capability.rgbKeyframes)
    #else
      throw XCTSkip("The system-provider branch is a Simulator-only assertion.")
    #endif
  }

  func testEveryRoomStartsWithExplicitCoverageAndSeparatedEvidenceLayers() throws {
    let segmentId = UUID()
    let room = C14_8RoomEnvelope.empty(label: "Living room", sequence: 1, segmentId: segmentId)

    XCTAssertEqual(room.coverage.count, 24)
    XCTAssertEqual(Set(room.coverage.map(\.id)).count, 24)
    XCTAssertTrue(room.coverage.allSatisfy { $0.status == .missing })
    XCTAssertEqual(Set(room.semanticDeclarations.map(\.layer)), Set(C14_8SemanticLayer.allCases))
    XCTAssertTrue(room.semanticDeclarations.allSatisfy { $0.status == .unknown })
    XCTAssertEqual(room.coordinateSegmentIds, [segmentId])
  }

  func testAddingRoomCreatesANewOriginOwnedOnlyByTheNewRoom() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-room-transition-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = makeModel(
      root: root,
      journal: C14_8ProtectedCaptureStore(root: root.appendingPathComponent("journal"))
    )

    await model.activate(projectId: UUID().uuidString, actor: actor(role: "owner"))
    let initialSegmentId = try XCTUnwrap(model.draft?.segments.first?.segmentId)
    model.addRoom()

    XCTAssertEqual(model.draft?.rooms.count, 2)
    XCTAssertEqual(model.draft?.rooms.first?.coordinateSegmentIds, [initialSegmentId])
    XCTAssertEqual(model.draft?.rooms.last?.coordinateSegmentIds.count, 1)
    XCTAssertNotEqual(model.draft?.rooms.last?.coordinateSegmentIds.first, initialSegmentId)
  }

  func testProtectedJournalIsProjectAndActorScopedWithoutPathsOrCredentials() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-protected-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let projectId = UUID()
    let actorId = UUID()
    let tenantId = UUID()
    let store = C14_8ProtectedCaptureStore(root: root)
    let draft = fixtureDraft(projectId: projectId, actorId: actorId, tenantId: tenantId)

    try await store.save(draft)
    let restored = try await store.load(projectId: projectId)
    let foreign = try await store.load(projectId: UUID())
    XCTAssertEqual(restored, draft)
    XCTAssertNil(foreign)

    let journal =
      root
      .appendingPathComponent(projectId.uuidString.lowercased(), isDirectory: true)
      .appendingPathComponent("journal.json")
    let text = String(decoding: try Data(contentsOf: journal), as: UTF8.self)
    XCTAssertFalse(text.contains("file://"))
    XCTAssertFalse(text.localizedCaseInsensitiveContains("signedurl"))
    XCTAssertFalse(text.localizedCaseInsensitiveContains("bearer"))
    XCTAssertFalse(text.localizedCaseInsensitiveContains("token"))
    XCTAssertFalse(text.contains("\"trainingUseConsent\":\"granted\""))
    XCTAssertTrue(text.localizedCaseInsensitiveContains(actorId.uuidString))
    XCTAssertTrue(text.localizedCaseInsensitiveContains(tenantId.uuidString))
  }

  func testProtectedJournalRejectsLateWritesAndPreservesNewestDraft() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-journal-order-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let projectId = UUID()
    let actorId = UUID()
    let tenantId = UUID()
    let store = C14_8ProtectedCaptureStore(root: root)
    var stale = fixtureDraft(projectId: projectId, actorId: actorId, tenantId: tenantId)
    stale.updatedAt = stale.updatedAt.addingTimeInterval(1)
    stale.rooms[0].label = "Stale room"
    var newest = stale
    newest.updatedAt = newest.updatedAt.addingTimeInterval(1)
    newest.rooms[0].label = "Newest room"

    try await store.save(newest)
    do {
      try await store.save(stale)
      XCTFail("A late journal write must not replace newer protected state.")
    } catch {
      XCTAssertEqual(error as? C14_8ProtectedStoreError, .staleWrite)
    }
    let restored = try await store.load(projectId: projectId)
    XCTAssertEqual(restored?.rooms[0].label, "Newest room")
  }

  func testCompletedMediaReceiptIsAtomicallyRecordedAndVerified() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-receipt-persistence-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let projectId = UUID()
    let actorId = UUID()
    let tenantId = UUID()
    let segmentId = UUID()
    let createdAt = Date()
    let room = C14_8RoomEnvelope.empty(
      label: "Synthetic room",
      sequence: 1,
      segmentId: segmentId
    )
    let mediaStore = C8ProtectedMediaStore(root: root.appendingPathComponent("media"))
    let destination = try await mediaStore.allocateDestination()
    let engine = C14_8FixtureGuidedCaptureEngine()
    try engine.start(telemetry: { _ in }, events: { _ in })
    let captured = try await engine.captureKeyframe(
      to: destination.url,
      localIdentifier: destination.id,
      roomId: room.roomId,
      segmentId: segmentId,
      captureStartedAt: createdAt,
      retentionMode: .manual,
      zoneId: try XCTUnwrap(room.zones?.first?.zoneId)
    )
    let handle = try await mediaStore.finalize(
      id: destination.id,
      mimeType: .jpeg,
      containsDepthData: false,
      origin: .syntheticSimulatorFixture
    )
    let segmentEnd = max(1, captured.sample.timestampMicroseconds)
    let endedAt = createdAt.addingTimeInterval(Double(segmentEnd + 1) / 1_000_000)
    let store = C14_8ProtectedCaptureStore(root: root.appendingPathComponent("journal"))
    let draft = C14_8GuidedCaptureDraft(
      acceptance: nil,
      actorUserId: actorId,
      capabilities: C14_8SystemCapabilityProvider().current(),
      captureSession: nil,
      createdAt: createdAt,
      depthHandles: [],
      depthReceipts: [],
      endedAt: endedAt,
      interruptionCount: 0,
      keyframes: [handle],
      mediaReceipts: [],
      projectId: projectId,
      roomPlanSources: [],
      rooms: [room],
      samples: [captured.sample],
      schemaVersion: C14_8CaptureContract.localJournalSchemaVersion,
      segments: [
        C14_8CoordinateSegment(
          coordinateSystem: "arkit-right-handed-y-up",
          endedAtMicroseconds: segmentEnd,
          reason: .initial,
          segmentId: segmentId,
          startedAtMicroseconds: 0,
          translationUnit: "micrometres",
          worldOriginRelationship: "independent-unless-later-registered"
        )
      ],
      tenantId: tenantId,
      updatedAt: endedAt
    )
    try await store.save(draft)
    let receipt = C14_8MediaReceipt(
      localIdentifier: handle.localIdentifier,
      receipt: C8ImmutableEvidenceReceipt(
        assetId: UUID(),
        byteSize: handle.byteSize,
        declaredMimeType: handle.mimeType,
        projectId: projectId,
        sha256: handle.sha256,
        status: .uploaded,
        trainingUseConsent: .denied
      ),
      transferPartCount: 1
    )

    let recorded = try await store.recordMediaReceipt(projectId: projectId, receipt: receipt)
    let restored = try await store.load(projectId: projectId)
    XCTAssertEqual(recorded.mediaReceipts, [receipt])
    XCTAssertEqual(restored?.mediaReceipts, [receipt])
  }

  func testDepthBytesAreOpaqueHashBoundAndCannotResolveAcrossProjects() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-depth-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let projectId = UUID()
    let values: [Float32] = [0.5, 0.75, 1.0, 1.25]
    let data = values.withUnsafeBytes { Data($0) }
    let store = C14_8ProtectedCaptureStore(root: root)

    let handle = try await store.storeDepth(
      projectId: projectId,
      sampleId: UUID(),
      data: data,
      width: 2,
      height: 2
    )

    XCTAssertEqual(handle.byteSize, Int64(data.count))
    XCTAssertEqual(
      handle.sha256,
      SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    )
    let resolved = try await store.resolveDepth(projectId: projectId, handle: handle)
    XCTAssertEqual(try Data(contentsOf: resolved), data)
    do {
      _ = try await store.resolveDepth(projectId: UUID(), handle: handle)
      XCTFail("A depth handle must not resolve outside its project directory.")
    } catch {
      XCTAssertEqual(error as? C14_8ProtectedStoreError, .missingFile)
    }
  }

  func testValidatorRejectsCapabilityInflationAndUnboundedCaptureDuration() throws {
    let projectId = UUID()
    let actorId = UUID()
    let tenantId = UUID()
    let invalidCapability = C14_8CapabilityDeclaration(
      appBuild: "test",
      appVersion: "1.0.0",
      arWorldTracking: false,
      cameraIntrinsics: false,
      cameraPoses: false,
      deviceModelIdentifier: "iPhone13,2",
      operatingSystemVersion: "26.0",
      qualityTier: .guidedRGB,
      rgbKeyframes: true,
      rgbVideo: false,
      roomPlan: false,
      runtime: .physicalDevice,
      sceneDepth: false,
      schemaVersion: "capture-capabilities-v1"
    )
    XCTAssertThrowsError(
      try C14_8ContractValidator.validate(
        draft: fixtureDraft(
          projectId: projectId,
          actorId: actorId,
          tenantId: tenantId,
          capability: invalidCapability
        )
      )
    ) { error in
      XCTAssertEqual(error as? C14_8ContractError, .invalidCapability)
    }

    var tooLong = fixtureDraft(projectId: projectId, actorId: actorId, tenantId: tenantId)
    tooLong.endedAt = tooLong.createdAt.addingTimeInterval(21_601)
    tooLong.updatedAt = tooLong.endedAt ?? tooLong.updatedAt
    XCTAssertThrowsError(try C14_8ContractValidator.validate(draft: tooLong))
  }

  func testSyntheticKeyframeIsExplicitAndContainsNoDepthClaim() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-fixture-frame-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let engine = C14_8FixtureGuidedCaptureEngine()
    try engine.start(telemetry: { _ in }, events: { _ in })

    let localIdentifier = UUID()
    let roomId = UUID()
    let segmentId = UUID()
    let frame = try await engine.captureKeyframe(
      to: root,
      localIdentifier: localIdentifier,
      roomId: roomId,
      segmentId: segmentId,
      captureStartedAt: Date(),
      retentionMode: .manual,
      zoneId: UUID()
    )

    XCTAssertTrue(FileManager.default.fileExists(atPath: root.path))
    XCTAssertNil(frame.depthData)
    XCTAssertEqual(frame.sample.sourceLocalIdentifier, localIdentifier)
    XCTAssertEqual(frame.sample.roomId, roomId)
    XCTAssertEqual(frame.sample.segmentId, segmentId)
  }

  func testActorAndRoleChangesMakeRecoveredCaptureReadOnly() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-model-isolation-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = C14_8ProtectedCaptureStore(root: root.appendingPathComponent("journal"))
    let projectId = UUID()
    let owner = actor(role: "owner")
    let model = makeModel(root: root, journal: journal)

    await model.activate(projectId: projectId.uuidString, actor: owner)
    await waitUntil { model.state == .ready && model.draft?.keyframes.count == 1 }
    XCTAssertEqual(model.state, .ready)
    XCTAssertTrue(model.canMutate)
    let originalLabel = model.currentRoom?.label

    await model.activate(projectId: projectId.uuidString, actor: actor(role: "owner"))
    XCTAssertEqual(model.state, .readOnly)
    XCTAssertFalse(model.canMutate)
    XCTAssertNil(model.draft)
    model.renameCurrentRoom("Must not cross actor boundary")
    XCTAssertNil(model.currentRoom)
    XCTAssertNotNil(originalLabel)

    await model.activate(
      projectId: projectId.uuidString,
      actor: C14_6Actor(
        displayName: owner.displayName,
        role: "viewer",
        subject: owner.subject,
        tenantId: owner.tenantId,
        userId: owner.userId
      )
    )
    XCTAssertEqual(model.state, .readOnly)
    XCTAssertFalse(model.canMutate)
  }

  func testRelaunchAndInterruptionAlwaysCreateIndependentSegments() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-model-relaunch-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let journal = C14_8ProtectedCaptureStore(root: root.appendingPathComponent("journal"))
    let projectId = UUID()
    let owner = actor(role: "owner")
    let model = makeModel(root: root, journal: journal)

    await model.activate(projectId: projectId.uuidString, actor: owner)
    await waitUntil { model.state == .ready && model.draft?.keyframes.count == 1 }
    XCTAssertEqual(model.draft?.segments.count, 1)
    model.reset()
    await model.activate(projectId: projectId.uuidString, actor: owner)
    XCTAssertEqual(model.state, .review)
    model.captureMore()
    await waitUntil { model.state == .ready && model.draft?.keyframes.count == 2 }
    XCTAssertEqual(model.draft?.segments.count, 2)
    XCTAssertEqual(model.draft?.segments.last?.reason, .relaunch)
    XCTAssertEqual(
      model.draft?.segments.last?.worldOriginRelationship,
      "independent-unless-later-registered"
    )

    model.handleBackgrounding()
    XCTAssertEqual(model.state, .interrupted)
    model.recoverAfterInterruption()
    await waitUntil { model.state == .ready && model.draft?.keyframes.count == 3 }
    XCTAssertEqual(model.draft?.segments.last?.reason, .interruption)
    XCTAssertEqual(Set(model.draft?.segments.map(\.segmentId) ?? []).count, 3)
  }

  func testLateProjectLoadCannotOverwriteCurrentProject() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-model-stale-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let firstProject = UUID()
    let secondProject = UUID()
    let owner = actor(role: "owner")
    let ownerId = try XCTUnwrap(UUID(uuidString: owner.userId))
    let tenantId = try XCTUnwrap(UUID(uuidString: owner.tenantId))
    let delayed = C14_8DelayedCaptureStore(
      delayedProjectId: firstProject,
      initial: fixtureDraft(projectId: firstProject, actorId: ownerId, tenantId: tenantId)
    )
    let model = makeModel(root: root, journal: delayed)

    let stale = Task { await model.activate(projectId: firstProject.uuidString, actor: owner) }
    await delayed.waitUntilLoadStarts()
    await model.activate(projectId: secondProject.uuidString, actor: owner)
    await delayed.releaseLoad()
    await stale.value
    await waitUntil { model.state == .ready && model.draft?.keyframes.count == 1 }

    XCTAssertEqual(model.draft?.projectId, secondProject)
    XCTAssertEqual(model.state, .ready)
    XCTAssertTrue(model.canMutate)
  }

  @MainActor
  private func waitUntil(
    attempts: Int = 500,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: @escaping @MainActor () -> Bool
  ) async {
    for _ in 0..<attempts {
      if condition() { return }
      try? await Task.sleep(nanoseconds: 10_000_000)
    }
    XCTFail("Timed out waiting for the deterministic capture state.", file: file, line: line)
  }

  private func fixtureDraft(
    projectId: UUID,
    actorId: UUID,
    tenantId: UUID,
    capability: C14_8CapabilityDeclaration? = nil
  ) -> C14_8GuidedCaptureDraft {
    let segmentId = UUID()
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    return C14_8GuidedCaptureDraft(
      acceptance: nil,
      actorUserId: actorId,
      capabilities: capability ?? C14_8TestCapabilityProvider().current(),
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
      rooms: [.empty(label: "Living room", sequence: 1, segmentId: segmentId)],
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
  }

  private func actor(role: String) -> C14_6Actor {
    C14_6Actor(
      displayName: "Synthetic homeowner",
      role: role,
      subject: "fixture|\(UUID().uuidString.lowercased())",
      tenantId: "14800000-0000-4000-8000-000000000010",
      userId: UUID().uuidString.lowercased()
    )
  }

  private func makeModel(
    root: URL,
    journal: any C14_8ProtectedCaptureStoring
  ) -> C14_8GuidedCaptureModel {
    let token = C14_8TestTokenProvider()
    let baseURL = URL(string: "http://127.0.0.1:4100")!
    let capture = C7CaptureAPIClient(baseURL: baseURL, tokenProvider: token)
    let evidence = C2EvidenceAPIClient(baseURL: baseURL, tokenProvider: token)
    return C14_8GuidedCaptureModel(
      capabilityProvider: C14_8TestCapabilityProvider(),
      permissionProvider: C14_8TestPermissionProvider(),
      engine: C14_8FixtureGuidedCaptureEngine(),
      captureService: capture,
      envelopeService: C14_8CaptureEnvelopeAPIClient(
        baseURL: baseURL,
        tokenProvider: token
      ),
      evidenceService: evidence,
      mediaUploader: C8ImmutableEvidenceUploader(service: evidence),
      depthUploader: C14_8DepthUploader(service: capture),
      journal: journal,
      mediaStore: C8ProtectedMediaStore(root: root.appendingPathComponent("media"))
    )
  }
}

@MainActor
private struct C14_8TestCapabilityProvider: C14_8CapabilityProviding {
  func current() -> C14_8CapabilityDeclaration {
    C14_8CapabilityDeclaration(
      appBuild: "test",
      appVersion: "1.0.0",
      arWorldTracking: false,
      cameraIntrinsics: false,
      cameraPoses: false,
      deviceModelIdentifier: "Synthetic Simulator",
      operatingSystemVersion: "test",
      qualityTier: .simulatorFixture,
      rgbKeyframes: true,
      rgbVideo: false,
      roomPlan: false,
      runtime: .simulatorFixture,
      sceneDepth: false,
      schemaVersion: "capture-capabilities-v1"
    )
  }
}

private actor C14_8TestTokenProvider: C7CaptureTokenProviding {
  func accessToken() -> String { "synthetic-unused-token" }
  func invalidate() {}
}

private final class C14_8TestPermissionProvider: C8CameraPermissionProviding, @unchecked Sendable {
  func currentPermission() -> C8CameraPermission { .denied }
  func requestPermission() async -> C8CameraPermission { .denied }
}

private actor C14_8DelayedCaptureStore: C14_8ProtectedCaptureStoring {
  private let delayedProjectId: UUID
  private var diagnostics: [UUID: C14_10SelectionDiagnostics] = [:]
  private var drafts: [UUID: C14_8GuidedCaptureDraft]
  private var loadContinuation: CheckedContinuation<Void, Never>?
  private var loadStarted = false

  init(delayedProjectId: UUID, initial: C14_8GuidedCaptureDraft) {
    self.delayedProjectId = delayedProjectId
    drafts = [delayedProjectId: initial]
  }

  func load(projectId: UUID) async throws -> C14_8GuidedCaptureDraft? {
    if projectId == delayedProjectId {
      loadStarted = true
      await withCheckedContinuation { continuation in
        loadContinuation = continuation
      }
    }
    return drafts[projectId]
  }

  func save(_ draft: C14_8GuidedCaptureDraft) {
    drafts[draft.projectId] = draft
  }

  func loadSelectionDiagnostics(projectId: UUID) -> C14_10SelectionDiagnostics? {
    diagnostics[projectId]
  }

  func saveSelectionDiagnostics(
    projectId: UUID,
    diagnostics: C14_10SelectionDiagnostics
  ) {
    self.diagnostics[projectId] = diagnostics
  }

  func recordMediaReceipt(
    projectId: UUID,
    receipt: C14_8MediaReceipt
  ) throws -> C14_8GuidedCaptureDraft {
    guard var draft = drafts[projectId] else { throw C14_8ProtectedStoreError.missingFile }
    if !draft.mediaReceipts.contains(where: { $0.localIdentifier == receipt.localIdentifier }) {
      draft.mediaReceipts.append(receipt)
      draft.updatedAt = max(Date(), draft.updatedAt.addingTimeInterval(0.001))
      drafts[projectId] = draft
    }
    return draft
  }

  func clear(projectId: UUID) { drafts[projectId] = nil }

  func resolveDepth(projectId: UUID, handle: C14_8DepthHandle) throws -> URL {
    _ = projectId
    _ = handle
    throw C14_8ProtectedStoreError.missingFile
  }

  func storeDepth(
    projectId: UUID,
    sampleId: UUID,
    data: Data,
    width: Int,
    height: Int
  ) throws -> C14_8DepthHandle {
    _ = projectId
    _ = sampleId
    _ = data
    _ = width
    _ = height
    throw C14_8ProtectedStoreError.missingFile
  }

  func waitUntilLoadStarts() async {
    while !loadStarted { await Task.yield() }
  }

  func releaseLoad() {
    loadContinuation?.resume()
    loadContinuation = nil
  }
}

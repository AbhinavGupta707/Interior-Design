import CryptoKit
import Foundation
import XCTest

@testable import HomeDesignCapture

@MainActor
final class C14_8CaptureFoundationTests: XCTestCase {
  func testSimulatorCapabilityCannotClaimPhysicalSensors() {
    let capability = C14_8SystemCapabilityProvider().current()

    XCTAssertEqual(capability.runtime, .simulatorFixture)
    XCTAssertEqual(capability.qualityTier, .simulatorFixture)
    XCTAssertFalse(capability.arWorldTracking)
    XCTAssertFalse(capability.cameraIntrinsics)
    XCTAssertFalse(capability.cameraPoses)
    XCTAssertFalse(capability.sceneDepth)
    XCTAssertFalse(capability.roomPlan)
    XCTAssertTrue(capability.rgbKeyframes)
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

    let journal = root
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
      captureStartedAt: Date()
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
    XCTAssertEqual(model.draft?.segments.count, 1)
    model.reset()
    await model.activate(projectId: projectId.uuidString, actor: owner)
    XCTAssertEqual(model.draft?.segments.count, 2)
    XCTAssertEqual(model.draft?.segments.last?.reason, .relaunch)
    XCTAssertEqual(
      model.draft?.segments.last?.worldOriginRelationship,
      "independent-unless-later-registered"
    )

    model.handleBackgrounding()
    XCTAssertEqual(model.state, .interrupted)
    model.recoverAfterInterruption()
    XCTAssertEqual(model.state, .ready)
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

    XCTAssertEqual(model.draft?.projectId, secondProject)
    XCTAssertEqual(model.state, .ready)
    XCTAssertTrue(model.canMutate)
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
      capabilities: capability ?? C14_8SystemCapabilityProvider().current(),
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
      capabilityProvider: C14_8SystemCapabilityProvider(),
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

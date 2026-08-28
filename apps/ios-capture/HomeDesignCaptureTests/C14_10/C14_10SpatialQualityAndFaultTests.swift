import XCTest

@testable import HomeDesignCapture

final class C14_10SpatialQualityAndFaultTests: XCTestCase {
  func testDirectionHeightGridCannotCompleteRotateInPlaceCapture() {
    let segmentId = UUID()
    var room = C14_8RoomEnvelope.empty(label: "Rectangular room", sequence: 1, segmentId: segmentId)
    for index in room.coverage.indices { room.coverage[index].status = .observed }
    let zoneId = room.zones![0].zoneId
    room.zones![0].status = .observed
    let samples = (0..<12).map {
      sample(
        index: $0,
        segmentId: segmentId,
        roomId: room.roomId,
        zoneId: zoneId,
        connected: $0 > 0,
        loopClosure: false,
        parallax: 0,
        span: 0,
        travel: 0,
        translation: 0
      )
    }

    let readiness = C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples)

    XCTAssertFalse(readiness.isReady)
    XCTAssertEqual(room.coverage.filter { $0.status == .observed }.count, 24)
    XCTAssertTrue(readiness.reasons.contains { $0.contains("walking, not only turning") })
    XCTAssertTrue(readiness.reasons.contains { $0.contains("sideways movement") })
  }

  func testConnectedRectangularLoopMeetsSpatialReadiness() {
    let segmentId = UUID()
    var room = C14_8RoomEnvelope.empty(label: "Living room", sequence: 1, segmentId: segmentId)
    let zoneId = room.zones![0].zoneId
    room.zones![0].status = .observed
    let samples = (0..<8).map {
      sample(
        index: $0,
        segmentId: segmentId,
        roomId: room.roomId,
        zoneId: zoneId,
        connected: $0 > 0,
        loopClosure: $0 == 7,
        parallax: $0 == 0 ? 0 : 240_000,
        span: min(1_400_000, Int64($0) * 240_000),
        travel: Int64($0) * 400_000,
        translation: $0 == 0 ? 0 : 400_000
      )
    }

    let readiness = C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples)

    XCTAssertTrue(readiness.isReady)
    XCTAssertEqual(readiness.connectedRatioMillionths, 1_000_000)
    XCTAssertEqual(readiness.loopClosureCount, 1)
  }

  func testIrregularMultiZoneRoomRequiresEvidenceInEveryDeclaredZone() {
    let segmentId = UUID()
    var room = C14_8RoomEnvelope.empty(label: "L-shaped kitchen", sequence: 1, segmentId: segmentId)
    let firstZone = room.zones![0].zoneId
    let secondZone = UUID()
    room.zones = [
      C14_10CaptureZone(label: "Kitchen run", status: .observed, zoneId: firstZone),
      C14_10CaptureZone(label: "Dining alcove", status: .missing, zoneId: secondZone),
    ]
    var samples = (0..<8).map {
      sample(
        index: $0,
        segmentId: segmentId,
        roomId: room.roomId,
        zoneId: firstZone,
        connected: $0 > 0,
        loopClosure: $0 == 7,
        parallax: $0 == 0 ? 0 : 220_000,
        span: min(1_500_000, Int64($0) * 250_000),
        travel: Int64($0) * 400_000,
        translation: $0 == 0 ? 0 : 400_000
      )
    }
    XCTAssertEqual(
      C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples).unresolvedZoneCount,
      1
    )

    room.zones![1].status = .observed
    samples[5] = replacingZone(samples[5], zoneId: secondZone)
    samples[6] = replacingZone(samples[6], zoneId: secondZone)

    XCTAssertTrue(C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples).isReady)
  }

  func testSingletonRelaunchSegmentRemainsExplicitlyDisconnected() {
    let initialSegment = UUID()
    let restartedSegment = UUID()
    var room = C14_8RoomEnvelope.empty(label: "Room", sequence: 1, segmentId: initialSegment)
    room.coordinateSegmentIds.append(restartedSegment)
    let zoneId = room.zones![0].zoneId
    room.zones![0].status = .observed
    var samples = (0..<8).map {
      sample(
        index: $0,
        segmentId: initialSegment,
        roomId: room.roomId,
        zoneId: zoneId,
        connected: $0 > 0,
        loopClosure: $0 == 7,
        parallax: $0 == 0 ? 0 : 220_000,
        span: min(1_500_000, Int64($0) * 250_000),
        travel: Int64($0) * 400_000,
        translation: $0 == 0 ? 0 : 400_000
      )
    }
    samples.append(
      sample(
        index: 9,
        segmentId: restartedSegment,
        roomId: room.roomId,
        zoneId: zoneId,
        connected: false,
        loopClosure: false,
        parallax: 0,
        span: 0,
        travel: 0,
        translation: 0
      )
    )

    let readiness = C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples)

    XCTAssertFalse(readiness.isReady)
    XCTAssertTrue(readiness.reasons.contains { $0.contains("isolated view") })
  }

  func testWeakInterruptedSegmentCannotBeMaskedByCompletedPrimaryLoop() {
    let primarySegment = UUID()
    let interruptedSegment = UUID()
    var room = C14_8RoomEnvelope.empty(
      label: "Interrupted room", sequence: 1, segmentId: primarySegment)
    room.coordinateSegmentIds.append(interruptedSegment)
    let zoneId = room.zones![0].zoneId
    room.zones![0].status = .observed
    var samples = (0..<8).map {
      sample(
        index: $0,
        segmentId: primarySegment,
        roomId: room.roomId,
        zoneId: zoneId,
        connected: $0 > 0,
        loopClosure: $0 == 7,
        parallax: $0 == 0 ? 0 : 220_000,
        span: min(1_500_000, Int64($0) * 250_000),
        travel: Int64($0) * 400_000,
        translation: $0 == 0 ? 0 : 400_000
      )
    }
    samples.append(
      contentsOf: (0..<8).map {
        sample(
          index: $0 + 20,
          segmentId: interruptedSegment,
          roomId: room.roomId,
          zoneId: zoneId,
          connected: $0 >= 4,
          loopClosure: $0 == 7,
          parallax: $0 == 0 ? 0 : 220_000,
          span: min(1_500_000, Int64($0) * 250_000),
          travel: Int64($0) * 400_000,
          translation: $0 == 0 ? 0 : 400_000
        )
      })

    let readiness = C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples)

    XCTAssertFalse(readiness.isReady)
    XCTAssertTrue(readiness.reasons.contains { $0.contains("previous wall or corner") })
  }

  func testExactSpatialThresholdsAreReady() {
    let segmentId = UUID()
    var room = C14_8RoomEnvelope.empty(label: "Small room", sequence: 1, segmentId: segmentId)
    let zoneId = room.zones![0].zoneId
    room.zones![0].status = .observed
    let samples = (0..<8).map {
      sample(
        index: $0,
        segmentId: segmentId,
        roomId: room.roomId,
        zoneId: zoneId,
        connected: $0 > 0,
        loopClosure: $0 == 7,
        parallax: $0 == 0 ? 0 : 80_000,
        span: $0 == 7 ? 1_200_000 : Int64($0) * 150_000,
        travel: $0 == 7 ? 2_400_000 : Int64($0) * 300_000,
        translation: $0 == 0 ? 0 : 120_000
      )
    }

    XCTAssertTrue(C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples).isReady)
  }

  func testAutomaticSelectorRequiresConnectedTranslationOverlapAndParallax() {
    let first = C14_10KeyframeSelector.decision(
      telemetry: telemetry(),
      retainedCount: 0,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertTrue(first.shouldRetain)

    let rotateInPlace = C14_10KeyframeSelector.decision(
      telemetry: telemetry(connected: true, overlap: 600_000, parallax: 0, translation: 0),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertEqual(rotateInPlace.reason, .insufficientTranslation)

    let useful = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: true,
        overlap: 600_000,
        parallax: 200_000,
        translation: 300_000
      ),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertTrue(useful.shouldRetain)
  }

  func testAutomaticSelectorRejectsNearDuplicatesAndEnforcesCooldown() {
    let nearDuplicate = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: true,
        overlap: C14_10SpatialCapturePolicy.maximumNearDuplicateOverlapScoreMillionths,
        parallax: 200_000,
        translation: 300_000
      ),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertEqual(nearDuplicate.reason, .nearDuplicate)

    let cooldown = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: true, overlap: 600_000, parallax: 200_000, translation: 300_000),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: 1_500_000,
      mode: .automatic
    )
    XCTAssertEqual(cooldown.reason, .cooldown)

    let exactInterval = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: true, overlap: 600_000, parallax: 200_000, translation: 300_000),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: 1_000_000,
      mode: .automatic
    )
    XCTAssertTrue(exactInterval.shouldRetain)
  }

  func testResourcePressureDegradesDepthAndAnalysisBeforeStoppingAutomaticSelection() {
    XCTAssertEqual(
      C14_10ResourcePolicy.policy(for: .nominal),
      C14_10ResourcePolicy(
        analysisStride: 1, automaticSelectionEnabled: true, optionalDepthEnabled: true)
    )
    XCTAssertEqual(
      C14_10ResourcePolicy.policy(for: .constrained),
      C14_10ResourcePolicy(
        analysisStride: 3, automaticSelectionEnabled: true, optionalDepthEnabled: false)
    )
    XCTAssertEqual(
      C14_10ResourcePolicy.policy(for: .critical),
      C14_10ResourcePolicy(
        analysisStride: 6, automaticSelectionEnabled: false, optionalDepthEnabled: false)
    )
  }

  @MainActor
  func testDeterministicFaultScriptAndAuthorityFailuresFailClosed() async throws {
    let injector = C14_10ScriptedFaultInjector(
      script: [.beforeUpload: [.offline, .signedURLExpired]]
    )
    for expected in [C14_10InjectedFault.offline, .signedURLExpired] {
      do {
        try await injector.checkpoint(.beforeUpload)
        XCTFail("Expected deterministic injected fault")
      } catch {
        XCTAssertEqual(error as? C14_10InjectedFault, expected)
      }
    }
    try await injector.checkpoint(.beforeUpload)
    let visited = await injector.visited
    XCTAssertEqual(visited, [.beforeUpload, .beforeUpload, .beforeUpload])

    for fault in [
      C14_10InjectedFault.projectChanged,
      .roleChanged,
      .rightsWithdrawn,
      .captureAuthorityExpired,
    ] {
      guard case .failed(_, let retryable) = C14_8GuidedCaptureModel.submissionFailure(for: fault)
      else { return XCTFail("Authority fault must fail closed") }
      XCTAssertFalse(retryable)
    }
    for fault in [
      C14_10InjectedFault.offline,
      .authenticationExpired,
      .signedURLExpired,
      .serviceUnavailable,
      .protectedStoragePressure,
    ] {
      guard case .failed(_, let retryable) = C14_8GuidedCaptureModel.submissionFailure(for: fault)
      else { return XCTFail("Recoverable software fault must retain recovery") }
      XCTAssertTrue(retryable)
    }
  }

  @MainActor
  func testInjectedRoleChangeBeforeRetentionPreservesEmptyProtectedDraft() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-10-role-fault-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let injector = C14_10ScriptedFaultInjector(
      script: [.beforeKeyframeRetention: [.roleChanged]]
    )
    let model = faultModel(root: root, injector: injector)

    await model.activate(projectId: UUID().uuidString, actor: faultActor())
    await waitUntil {
      if case .failed = model.state { return true }
      return false
    }

    XCTAssertEqual(model.draft?.keyframes.count, 0)
    XCTAssertNil(model.draft?.acceptance)
    let visited = await injector.visited
    XCTAssertEqual(visited, [.beforeKeyframeRetention])
  }

  @MainActor
  func testAutomaticCaptureStartsFreshIndependentSegmentAfterInterruption() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-10-auto-segment-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let injector = C14_10ScriptedFaultInjector(script: [:])
    let model = faultModel(root: root, injector: injector)

    await model.activate(projectId: UUID().uuidString, actor: faultActor())
    await waitUntil { model.draft?.samples.count == 1 && model.state == .ready }
    model.handleBackgrounding()
    model.recoverAfterInterruption()
    await waitUntil { model.draft?.samples.count == 2 && model.state == .ready }

    let samples = try XCTUnwrap(model.draft?.samples)
    XCTAssertEqual(Set(samples.map(\.segmentId)).count, 2)
    XCTAssertEqual(samples.last?.connectedToPrevious, false)
  }

  @MainActor
  func testRelaunchWithRetainedEvidenceRequiresFreshSegmentAndPreservesBytes() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-10-retained-relaunch-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let injector = C14_10ScriptedFaultInjector(script: [:])
    let model = faultModel(root: root, injector: injector)
    let projectId = UUID().uuidString

    await model.activate(projectId: projectId, actor: faultActor())
    await waitUntil { model.draft?.samples.count == 1 && model.state == .ready }
    let retainedHash = try XCTUnwrap(model.draft?.keyframes.first?.sha256)
    let retainedSegment = try XCTUnwrap(model.draft?.samples.first?.segmentId)

    model.reset()
    await model.activate(projectId: projectId, actor: faultActor())

    XCTAssertEqual(model.state, .review)
    XCTAssertEqual(model.draft?.keyframes.first?.sha256, retainedHash)
    XCTAssertEqual(model.draft?.segments.count, 1)

    model.captureMore()
    await waitUntil { model.draft?.samples.count == 2 && model.state == .ready }
    XCTAssertEqual(model.draft?.segments.count, 2)
    XCTAssertEqual(model.draft?.segments.last?.reason, .relaunch)
    XCTAssertNotEqual(model.draft?.samples.last?.segmentId, retainedSegment)
    XCTAssertEqual(model.draft?.samples.last?.connectedToPrevious, false)
    XCTAssertEqual(model.draft?.keyframes.first?.sha256, retainedHash)
  }

  @MainActor
  func testInjectedOfflineSubmissionKeepsRetainedEvidenceAndAcceptsNoEnvelope() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-10-offline-fault-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let injector = C14_10ScriptedFaultInjector(script: [.beforeSubmission: [.offline]])
    let model = faultModel(root: root, injector: injector)

    await model.activate(projectId: UUID().uuidString, actor: faultActor())
    await waitUntil { model.draft?.keyframes.count == 1 && model.state == .ready }
    model.automaticCaptureEnabled = false
    model.finishRoomReview()
    model.serviceProcessingConsent = true
    model.submit()
    await waitUntil {
      if case .failed = model.state { return true }
      return false
    }

    XCTAssertEqual(model.draft?.keyframes.count, 1)
    XCTAssertNil(model.draft?.acceptance)
    guard case .failed(let message, let retryable) = model.state else {
      return XCTFail("Offline injection must stop before acceptance")
    }
    XCTAssertTrue(retryable)
    XCTAssertTrue(message.localizedCaseInsensitiveContains("offline"))
    let visited = await injector.visited
    XCTAssertEqual(visited, [.beforeKeyframeRetention, .beforeSubmission])
  }

  private func telemetry(
    connected: Bool = false,
    overlap: Int = 0,
    parallax: Int = 0,
    translation: Int64 = 0
  ) -> C14_8LiveTelemetry {
    C14_8LiveTelemetry(
      ambientIntensity: 800,
      blurScoreMillionths: 900_000,
      coverageCellId: "north:middle",
      exposureScoreMillionths: 900_000,
      motionScoreMillionths: 0,
      spatialEvidence: C14_10LiveSpatialEvidence(
        connectedToPrevious: connected,
        featurePointCount: 180,
        loopClosureCandidate: false,
        overlapScoreMillionths: overlap,
        parallaxScoreMillionths: parallax,
        telemetryTimestampMicroseconds: 3_000_000,
        trajectorySpanMicrometres: translation,
        trajectoryTravelMicrometres: translation,
        translationFromPreviousMicrometres: translation
      ),
      trackingState: .normal
    )
  }

  @MainActor
  private func faultModel(
    root: URL,
    injector: C14_10ScriptedFaultInjector
  ) -> C14_8GuidedCaptureModel {
    let token = C14_10TestTokenProvider()
    let baseURL = URL(string: "http://127.0.0.1:4100")!
    let capture = C7CaptureAPIClient(baseURL: baseURL, tokenProvider: token)
    let evidence = C2EvidenceAPIClient(baseURL: baseURL, tokenProvider: token)
    return C14_8GuidedCaptureModel(
      capabilityProvider: C14_10PhysicalTestCapabilityProvider(),
      permissionProvider: C14_10AuthorisedPermissionProvider(),
      engine: C14_8FixtureGuidedCaptureEngine(),
      captureService: capture,
      envelopeService: C14_8CaptureEnvelopeAPIClient(baseURL: baseURL, tokenProvider: token),
      evidenceService: evidence,
      mediaUploader: C8ImmutableEvidenceUploader(service: evidence),
      depthUploader: C14_8DepthUploader(service: capture),
      faultInjector: injector,
      journal: C14_8ProtectedCaptureStore(root: root.appendingPathComponent("journal")),
      mediaStore: C8ProtectedMediaStore(root: root.appendingPathComponent("media"))
    )
  }

  private func faultActor() -> C14_6Actor {
    C14_6Actor(
      displayName: "Synthetic homeowner",
      role: "owner",
      subject: "fixture|c14-10-owner",
      tenantId: "14800000-0000-4000-8000-000000000010",
      userId: "14800000-0000-4000-8000-000000000011"
    )
  }

  @MainActor
  private func waitUntil(
    attempts: Int = 1_000,
    _ condition: @escaping @MainActor () -> Bool
  ) async {
    for _ in 0..<attempts {
      if condition() { return }
      await Task.yield()
    }
  }

  private func sample(
    index: Int,
    segmentId: UUID,
    roomId: UUID,
    zoneId: UUID,
    connected: Bool,
    loopClosure: Bool,
    parallax: Int,
    span: Int64,
    travel: Int64,
    translation: Int64
  ) -> C14_8LocalCameraSample {
    C14_8LocalCameraSample(
      ambientIntensity: 800,
      blurScoreMillionths: 900_000,
      cameraIntrinsicsMicropixels: C14_8CameraIntrinsics(
        cx: 640_000_000,
        cy: 480_000_000,
        fx: 900_000_000,
        fy: 900_000_000,
        imageHeightPixels: 960,
        imageWidthPixels: 1_280
      ),
      connectedToPrevious: connected,
      exposureScoreMillionths: 900_000,
      featurePointCount: 180,
      intrinsicsModel: "pinhole-native-camera-raster",
      loopClosureCandidate: loopClosure,
      motionScoreMillionths: 0,
      orientation: "portrait",
      overlapScoreMillionths: connected ? 600_000 : 0,
      parallaxScoreMillionths: parallax,
      poseTransform: "camera-to-world",
      quaternionOrder: "x-y-z-w",
      quaternionNanounits: [0, 0, 0, 1_000_000_000],
      roomId: roomId,
      sampleId: UUID(),
      segmentId: segmentId,
      sourceLocalIdentifier: UUID(),
      sourceTimestampMicroseconds: Int64(index + 1) * 2_000_000,
      timestampMicroseconds: Int64(index + 1) * 2_000_000,
      trackingState: .normal,
      trajectorySpanMicrometres: span,
      trajectoryTravelMicrometres: travel,
      translationFromPreviousMicrometres: translation,
      translationMicrometres: C14_8Translation(x: Int64(index) * 300_000, y: 1_500_000, z: 0),
      retentionMode: .automatic,
      zoneId: zoneId
    )
  }

  private func replacingZone(
    _ sample: C14_8LocalCameraSample,
    zoneId: UUID
  ) -> C14_8LocalCameraSample {
    C14_8LocalCameraSample(
      ambientIntensity: sample.ambientIntensity,
      blurScoreMillionths: sample.blurScoreMillionths,
      cameraIntrinsicsMicropixels: sample.cameraIntrinsicsMicropixels,
      connectedToPrevious: sample.connectedToPrevious,
      exposureScoreMillionths: sample.exposureScoreMillionths,
      featurePointCount: sample.featurePointCount,
      intrinsicsModel: sample.intrinsicsModel,
      loopClosureCandidate: sample.loopClosureCandidate,
      motionScoreMillionths: sample.motionScoreMillionths,
      orientation: sample.orientation,
      overlapScoreMillionths: sample.overlapScoreMillionths,
      parallaxScoreMillionths: sample.parallaxScoreMillionths,
      poseTransform: sample.poseTransform,
      quaternionOrder: sample.quaternionOrder,
      quaternionNanounits: sample.quaternionNanounits,
      roomId: sample.roomId,
      sampleId: sample.sampleId,
      segmentId: sample.segmentId,
      sourceLocalIdentifier: sample.sourceLocalIdentifier,
      sourceTimestampMicroseconds: sample.sourceTimestampMicroseconds,
      timestampMicroseconds: sample.timestampMicroseconds,
      trackingState: sample.trackingState,
      trajectorySpanMicrometres: sample.trajectorySpanMicrometres,
      trajectoryTravelMicrometres: sample.trajectoryTravelMicrometres,
      translationFromPreviousMicrometres: sample.translationFromPreviousMicrometres,
      translationMicrometres: sample.translationMicrometres,
      retentionMode: sample.retentionMode,
      zoneId: zoneId
    )
  }
}

@MainActor
private struct C14_10PhysicalTestCapabilityProvider: C14_8CapabilityProviding {
  func current() -> C14_8CapabilityDeclaration {
    C14_8CapabilityDeclaration(
      appBuild: "test",
      appVersion: "1.0.0",
      arWorldTracking: true,
      cameraIntrinsics: true,
      cameraPoses: true,
      deviceModelIdentifier: "SyntheticPhysicalPolicy",
      operatingSystemVersion: "test",
      qualityTier: .guidedRGB,
      rgbKeyframes: true,
      rgbVideo: false,
      roomPlan: false,
      runtime: .physicalDevice,
      sceneDepth: false,
      schemaVersion: "capture-capabilities-v1"
    )
  }
}

private final class C14_10AuthorisedPermissionProvider: C8CameraPermissionProviding,
  @unchecked Sendable
{
  func currentPermission() -> C8CameraPermission { .authorised }
  func requestPermission() async -> C8CameraPermission { .authorised }
}

private actor C14_10TestTokenProvider: C7CaptureTokenProviding {
  func accessToken() -> String { "synthetic-unused-token" }
  func invalidate() {}
}

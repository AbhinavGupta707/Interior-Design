@preconcurrency import ARKit
import XCTest

@testable import HomeDesignCapture

final class C14_10SpatialQualityAndFaultTests: XCTestCase {
  func testSelectionDiagnosticsPersistBoundedAutomaticOutcomes() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent(
        "c14-10-selection-diagnostics-\(UUID().uuidString)",
        isDirectory: true
      )
    defer { try? FileManager.default.removeItem(at: root) }
    let store = C14_8ProtectedCaptureStore(root: root)
    let projectId = UUID()
    var diagnostics = C14_10SelectionDiagnostics.empty(at: Date(timeIntervalSince1970: 1))

    diagnostics.record(.accepted, at: Date(timeIntervalSince1970: 2))
    diagnostics.record(
      .featurePoor,
      telemetry: telemetry(connected: true, overlap: 220_000, translation: 180_000),
      context: C14_10SelectionDiagnosticContext(
        coverageCellId: "north:middle",
        retainedCountAtStart: 4,
        segmentId: UUID(uuidString: "14800000-0000-4000-8000-000000000012"),
        zoneId: UUID(uuidString: "14800000-0000-4000-8000-000000000013")
      ),
      at: Date(timeIntervalSince1970: 3)
    )
    diagnostics.record(.insufficientOverlap, at: Date(timeIntervalSince1970: 4))
    try await store.saveSelectionDiagnostics(projectId: projectId, diagnostics: diagnostics)

    let loaded = try await store.loadSelectionDiagnostics(projectId: projectId)
    let restored = try XCTUnwrap(loaded)
    XCTAssertEqual(restored.totalAutomaticCandidateCount, 3)
    XCTAssertEqual(restored.retainedCandidateCount, 1)
    XCTAssertEqual(restored.skippedCandidateCount, 2)
    XCTAssertEqual(restored.count(for: .featurePoor), 1)
    XCTAssertEqual(restored.count(for: .insufficientOverlap), 1)
    let recent = try XCTUnwrap(restored.recentOutcomes)
    XCTAssertEqual(recent.count, 1)
    XCTAssertEqual(recent[0].reason, .featurePoor)
    XCTAssertEqual(recent[0].featurePointCount, 180)
    XCTAssertEqual(recent[0].overlapScoreMillionths, 220_000)
    XCTAssertEqual(recent[0].telemetryTimestampMicroseconds, 3_000_000)
    XCTAssertEqual(recent[0].translationFromPreviousMicrometres, 180_000)
    let detailed = try XCTUnwrap(restored.detailedOutcomes)
    XCTAssertEqual(detailed.count, 1)
    XCTAssertEqual(detailed[0].candidateSequence, 2)
    XCTAssertEqual(detailed[0].context.coverageCellId, "north:middle")
    XCTAssertEqual(detailed[0].context.retainedCountAtStart, 4)
    XCTAssertEqual(detailed[0].outcome.reason, .featurePoor)
    XCTAssertTrue(restored.isValid)
  }

  func testSelectionDiagnosticsPreserveInitialAndLatestBoundedRouteTimeline() {
    var diagnostics = C14_10SelectionDiagnostics.empty(at: Date(timeIntervalSince1970: 1))
    for index in 0...C14_10SelectionDiagnostics.maximumDetailedOutcomeCount {
      diagnostics.record(
        .featurePoor,
        telemetry: telemetry(connected: true, overlap: 220_000, translation: 180_000),
        at: Date(timeIntervalSince1970: Double(index + 2))
      )
    }

    let detailed = diagnostics.detailedOutcomes ?? []
    XCTAssertEqual(detailed.count, C14_10SelectionDiagnostics.maximumDetailedOutcomeCount)
    XCTAssertEqual(diagnostics.detailedOutcomeDroppedCount, 1)
    XCTAssertEqual(detailed.first?.candidateSequence, 1)
    XCTAssertEqual(
      detailed[C14_10SelectionDiagnostics.preservedInitialDetailedOutcomeCount - 1]
        .candidateSequence,
      C14_10SelectionDiagnostics.preservedInitialDetailedOutcomeCount
    )
    XCTAssertEqual(
      detailed[C14_10SelectionDiagnostics.preservedInitialDetailedOutcomeCount]
        .candidateSequence,
      C14_10SelectionDiagnostics.preservedInitialDetailedOutcomeCount + 2
    )
    XCTAssertEqual(
      detailed.last?.candidateSequence,
      C14_10SelectionDiagnostics.maximumDetailedOutcomeCount + 1
    )
    XCTAssertTrue(diagnostics.isValid)
  }

  func testFeatureGuidanceReconnectsToLastRetainedView() {
    XCTAssertEqual(
      C14_10KeyframeDecisionReason.featurePoor.homeownerInstruction(hasRetainedView: false),
      "Aim across a corner, opening or textured object."
    )
    XCTAssertTrue(
      C14_10KeyframeDecisionReason.featurePoor
        .homeownerInstruction(hasRetainedView: true)
        .contains("last retained wall or corner")
    )
    XCTAssertTrue(
      C14_10KeyframeDecisionReason.insufficientOverlap
        .homeownerInstruction(hasRetainedView: true)
        .contains("small overlapping arcs")
    )
  }

  func testCoverageGuidancePrioritizesUpperThenMiddleAndNeverClaimsReadiness() {
    let segmentId = UUID()
    var room = C14_8RoomEnvelope.empty(label: "Room", sequence: 1, segmentId: segmentId)
    for index in room.coverage.indices where room.coverage[index].verticalBand != .upper {
      room.coverage[index].status = .observed
    }

    let upper = C14_10CoverageGuidance.instruction(for: room.coverage)
    XCTAssertTrue(upper?.contains("8 upper directions remain") == true)
    XCTAssertTrue(upper?.contains("wall/ceiling junctions") == true)
    XCTAssertFalse(upper?.localizedCaseInsensitiveContains("ready") == true)

    for index in room.coverage.indices where room.coverage[index].verticalBand == .upper {
      room.coverage[index].status = .occluded
    }
    XCTAssertNil(C14_10CoverageGuidance.instruction(for: room.coverage))
  }

  func testLegacyAggregateDiagnosticsDecodeWithoutRecentOutcomes() throws {
    let data = Data(
      """
      {
        "outcomeCounts":{"tracking":1},
        "schemaVersion":"c14-10-selection-diagnostics-v1",
        "totalAutomaticCandidateCount":1,
        "updatedAt":0
      }
      """.utf8
    )

    let diagnostics = try JSONDecoder().decode(C14_10SelectionDiagnostics.self, from: data)

    XCTAssertNil(diagnostics.recentOutcomes)
    XCTAssertNil(diagnostics.detailedOutcomes)
    XCTAssertNil(diagnostics.detailedOutcomeDroppedCount)
    XCTAssertEqual(diagnostics.count(for: .tracking), 1)
    XCTAssertTrue(diagnostics.isValid)
  }

  func testLegacyRecentOutcomeDecodesWithoutNewPoseOrAnchorMetrics() throws {
    let data = Data(
      """
      {
        "blurScoreMillionths":900000,
        "completedAt":0,
        "featurePointCount":180,
        "motionScoreMillionths":0,
        "overlapScoreMillionths":220000,
        "parallaxScoreMillionths":90000,
        "reason":"featurePoor",
        "rotationFromPreviousMicroradians":0,
        "telemetryTimestampMicroseconds":3000000,
        "trackingState":"normal",
        "translationFromPreviousMicrometres":180000
      }
      """.utf8
    )

    let outcome = try JSONDecoder().decode(C14_10RecentSelectionOutcome.self, from: data)

    XCTAssertNil(outcome.cameraPositionMicrometres)
    XCTAssertNil(outcome.startAnchorDistanceMicrometres)
    XCTAssertEqual(outcome.reason, .featurePoor)
    XCTAssertTrue(outcome.isValid)
  }

  @MainActor
  func testRejectedFrameDiagnosticsStayProtectedBoundedAndReasonBound() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent(
        "c14-10-rejected-frame-diagnostics-\(UUID().uuidString)",
        isDirectory: true
      )
    let store = C14_10RejectedFrameDiagnosticStore(root: root)
    let engine = C14_8FixtureGuidedCaptureEngine()
    let projectId = UUID()
    let segmentId = UUID()

    for index in 0..<14 {
      let capturedAt = Date(timeIntervalSince1970: Double(index + 1))
      let reason: C14_10KeyframeDecisionReason =
        index == 13 ? .insufficientOverlap : .featurePoor
      let outcome = C14_10RecentSelectionOutcome(
        reason: reason,
        telemetry: telemetry(
          connected: true,
          overlap: index == 13 ? 120_000 : 220_000,
          parallax: 90_000,
          translation: 180_000
        ),
        completedAt: capturedAt
      )
      let thumbnail = try engine.captureRejectedDiagnosticThumbnail(
        capturedAt: capturedAt,
        maximumDimension: C14_10RejectedFrameDiagnosticPolicy.maximumPixelDimension,
        telemetryTimestampMicroseconds: 3_000_000
      )

      _ = try await store.save(
        projectId: projectId,
        segmentId: segmentId,
        thumbnail: thumbnail,
        outcome: outcome
      )
    }

    let loadedLatest = try await store.loadLatest(projectId: projectId)
    let latest = try XCTUnwrap(loadedLatest)
    XCTAssertEqual(latest.retainedCount, 7)
    XCTAssertEqual(latest.record.outcome.reason, .insufficientOverlap)
    XCTAssertEqual(latest.record.outcome.overlapScoreMillionths, 120_000)
    XCTAssertEqual(latest.record.outcome.telemetryTimestampMicroseconds, 3_000_000)
    XCTAssertEqual(latest.record.outcome.translationFromPreviousMicrometres, 180_000)
    XCTAssertEqual(latest.record.segmentId, segmentId)
    XCTAssertEqual(latest.jpegData.count, latest.record.imageByteCount)
    XCTAssertTrue(latest.record.isValid)
    let projectDirectory = root.appendingPathComponent(
      projectId.uuidString.lowercased(),
      isDirectory: true
    )
    let storedFiles = try FileManager.default.contentsOfDirectory(
      at: projectDirectory,
      includingPropertiesForKeys: nil
    )
    XCTAssertEqual(storedFiles.filter { $0.pathExtension == "jpg" }.count, 7)
    XCTAssertEqual(storedFiles.filter { $0.lastPathComponent == "manifest.json" }.count, 1)
    let manifestData = try Data(
      contentsOf: projectDirectory.appendingPathComponent("manifest.json")
    )
    let manifest = try JSONDecoder().decode(
      C14_10RejectedFrameDiagnosticManifestTestView.self,
      from: manifestData
    )
    XCTAssertEqual(
      manifest.records.map(\.outcome.reason),
      [
        .featurePoor, .featurePoor, .featurePoor, .featurePoor, .featurePoor, .featurePoor,
        .insufficientOverlap,
      ])
    let featureDates = manifest.records.filter { $0.outcome.reason == .featurePoor }
      .map(\.capturedAt)
    XCTAssertEqual(featureDates.count, 6)
    XCTAssertEqual(featureDates.first, Date(timeIntervalSince1970: 1))
    XCTAssertEqual(featureDates.last, Date(timeIntervalSince1970: 13))
    XCTAssertEqual(featureDates, featureDates.sorted())
    XCTAssertEqual(
      manifest.records.last?.capturedAt,
      Date(timeIntervalSince1970: 14)
    )
    XCTAssertEqual(Set(manifest.records.compactMap(\.segmentId)), [segmentId])

    let newestSegmentId = UUID()
    let newestReasons = C14_10KeyframeDecisionReason.allCases.filter { $0 != .accepted }
    for index in 0..<(newestReasons.count * 7) {
      let capturedAt = Date(timeIntervalSince1970: Double(index + 15))
      let outcome = C14_10RecentSelectionOutcome(
        reason: newestReasons[index % newestReasons.count],
        telemetry: telemetry(
          connected: true,
          overlap: 220_000,
          parallax: 90_000,
          translation: 180_000
        ),
        completedAt: capturedAt
      )
      let thumbnail = try engine.captureRejectedDiagnosticThumbnail(
        capturedAt: capturedAt,
        maximumDimension: C14_10RejectedFrameDiagnosticPolicy.maximumPixelDimension,
        telemetryTimestampMicroseconds: 3_000_000
      )
      _ = try await store.save(
        projectId: projectId,
        segmentId: newestSegmentId,
        thumbnail: thumbnail,
        outcome: outcome
      )
    }
    let newestManifest = try JSONDecoder().decode(
      C14_10RejectedFrameDiagnosticManifestTestView.self,
      from: Data(contentsOf: projectDirectory.appendingPathComponent("manifest.json"))
    )
    XCTAssertEqual(
      newestManifest.records.count,
      C14_10RejectedFrameDiagnosticPolicy.maximumRetainedCount
    )
    XCTAssertEqual(Set(newestManifest.records.compactMap(\.segmentId)), [newestSegmentId])
    XCTAssertEqual(
      newestManifest.records.map(\.capturedAt),
      newestManifest.records.map(\.capturedAt).sorted()
    )

    try await store.clear(projectId: projectId)
    let clearedLatest = try await store.loadLatest(projectId: projectId)
    XCTAssertNil(clearedLatest)
    if FileManager.default.fileExists(atPath: root.path) {
      try? FileManager.default.removeItem(at: root)
    }
  }

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

  func testConsecutiveLoopClosureViewsCountAsOneEpisode() {
    let segmentId = UUID()
    var room = C14_8RoomEnvelope.empty(label: "Living room", sequence: 1, segmentId: segmentId)
    let zoneId = room.zones![0].zoneId
    room.zones![0].status = .observed
    let samples = (0..<12).map {
      sample(
        index: $0,
        segmentId: segmentId,
        roomId: room.roomId,
        zoneId: zoneId,
        connected: $0 > 0,
        loopClosure: (7...9).contains($0) || $0 == 11,
        parallax: $0 == 0 ? 0 : 240_000,
        span: min(1_400_000, Int64($0) * 240_000),
        travel: Int64($0) * 400_000,
        translation: $0 == 0 ? 0 : 400_000
      )
    }

    let readiness = C14_10SpatialReadinessEvaluator.evaluate(room: room, samples: samples)

    XCTAssertTrue(readiness.isReady)
    XCTAssertEqual(readiness.loopClosureCount, 2)
    XCTAssertEqual(samples.filter { $0.loopClosureCandidate == true }.count, 4)
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
    let unconfirmedAnchor = C14_10KeyframeSelector.decision(
      telemetry: telemetry(),
      retainedCount: 0,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertEqual(unconfirmedAnchor.reason, .insufficientOverlap)

    let confirmedAnchor = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: true,
        overlap: 600_000,
        parallax: 200_000,
        translation: 300_000
      ),
      retainedCount: 0,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertTrue(confirmedAnchor.shouldRetain)

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

  func testAutomaticSelectorAcceptsOnlyConnectedRotationalCornerBridges() {
    let bridge = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: true,
        overlap: 450_000,
        parallax: 0,
        rotation: C14_10SpatialCapturePolicy.minimumConnectedBridgeRotationMicroradians,
        translation: 20_000
      ),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertTrue(bridge.shouldRetain)

    let tooLittleRotation = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: true,
        overlap: 450_000,
        parallax: 0,
        rotation: C14_10SpatialCapturePolicy.minimumConnectedBridgeRotationMicroradians - 1,
        translation: 20_000
      ),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertEqual(tooLittleRotation.reason, .insufficientTranslation)

    let disconnectedTurn = C14_10KeyframeSelector.decision(
      telemetry: telemetry(
        connected: false,
        overlap: C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths - 1,
        parallax: 0,
        rotation: 500_000,
        translation: 20_000
      ),
      retainedCount: 1,
      lastAutomaticTimestampMicroseconds: nil,
      mode: .automatic
    )
    XCTAssertEqual(disconnectedTurn.reason, .insufficientOverlap)
  }

  func testSpatialRotationUsesShortestQuaternionArc() {
    XCTAssertEqual(
      C14_10SpatialRotation.microradians(
        quaternionNanounits: [0, 0, 0, 1_000_000_000],
        [0, 0, 0, -1_000_000_000]
      ),
      0
    )
    XCTAssertEqual(
      C14_10SpatialRotation.microradians(
        quaternionNanounits: [0, 0, 0, 1_000_000_000],
        [0, 707_106_781, 0, 707_106_781]
      ),
      1_570_796,
      accuracy: 2
    )
  }

  func testLoopClosureUsesDistanceScaledOverlapWithoutAcceptingOppositeFacingPasses() {
    let intendedReturn = C14_10LoopClosureEvaluator.evaluate(
      retainedObservationCount: 164,
      trajectorySpanMicrometres: 4_318_269,
      trajectoryTravelMicrometres: 29_735_077,
      startAnchorDistanceMicrometres: 783_282,
      startAnchorOverlapScoreMillionths: 230_000,
      startAnchorRotationMicroradians: 199_840
    )
    XCTAssertEqual(intendedReturn.distanceThresholdMicrometres, 1_200_000)
    XCTAssertEqual(intendedReturn.requiredOverlapScoreMillionths, 221_196)
    XCTAssertTrue(intendedReturn.isCandidate)

    let weakVisualReturn = C14_10LoopClosureEvaluator.evaluate(
      retainedObservationCount: 164,
      trajectorySpanMicrometres: 4_318_269,
      trajectoryTravelMicrometres: 29_735_077,
      startAnchorDistanceMicrometres: 783_282,
      startAnchorOverlapScoreMillionths: intendedReturn.requiredOverlapScoreMillionths - 1,
      startAnchorRotationMicroradians: 199_840
    )
    XCTAssertFalse(weakVisualReturn.isCandidate)

    let oppositeFacingCoordinatePass = C14_10LoopClosureEvaluator.evaluate(
      retainedObservationCount: 55,
      trajectorySpanMicrometres: 2_500_000,
      trajectoryTravelMicrometres: 10_000_000,
      startAnchorDistanceMicrometres: 139_009,
      startAnchorOverlapScoreMillionths: 600_000,
      startAnchorRotationMicroradians: 2_379_766
    )
    XCTAssertFalse(oppositeFacingCoordinatePass.isCandidate)
  }

  func testLoopClosureAdaptiveToleranceIsBoundedAndStillRequiresCompleteRoute() {
    let minimumRoute = C14_10LoopClosureEvaluator.evaluate(
      retainedObservationCount: 7,
      trajectorySpanMicrometres: 1_200_000,
      trajectoryTravelMicrometres: 2_400_000,
      startAnchorDistanceMicrometres: 698_000,
      startAnchorOverlapScoreMillionths: 194_836,
      startAnchorRotationMicroradians: 100_000
    )
    XCTAssertEqual(minimumRoute.distanceThresholdMicrometres, 698_000)
    XCTAssertEqual(minimumRoute.requiredOverlapScoreMillionths, 194_836)
    XCTAssertTrue(minimumRoute.isCandidate)

    let outsideMaximum = C14_10LoopClosureEvaluator.evaluate(
      retainedObservationCount: 100,
      trajectorySpanMicrometres: 4_000_000,
      trajectoryTravelMicrometres: 40_000_000,
      startAnchorDistanceMicrometres: 1_200_001,
      startAnchorOverlapScoreMillionths: 1_000_000,
      startAnchorRotationMicroradians: 0
    )
    XCTAssertEqual(outsideMaximum.distanceThresholdMicrometres, 1_200_000)
    XCTAssertFalse(outsideMaximum.isCandidate)

    let tooShort = C14_10LoopClosureEvaluator.evaluate(
      retainedObservationCount: 7,
      trajectorySpanMicrometres: 1_200_000,
      trajectoryTravelMicrometres: 2_399_999,
      startAnchorDistanceMicrometres: 100_000,
      startAnchorOverlapScoreMillionths: 1_000_000,
      startAnchorRotationMicroradians: 0
    )
    XCTAssertFalse(tooShort.isCandidate)
  }

  func testRetainedEdgeContractAllowsConnectedCornerBridgeButNotSmallOrDisconnectedTurns() {
    let segmentId = UUID()
    let roomId = UUID()
    let zoneId = UUID()
    let anchor = sample(
      index: 0,
      segmentId: segmentId,
      roomId: roomId,
      zoneId: zoneId,
      connected: false,
      loopClosure: false,
      parallax: 0,
      span: 0,
      travel: 0,
      translation: 0
    )
    let bridge = sample(
      index: 1,
      segmentId: segmentId,
      roomId: roomId,
      zoneId: zoneId,
      connected: true,
      loopClosure: false,
      parallax: 0,
      quaternion: [0, 87_155_743, 0, 996_194_698],
      span: 0,
      travel: 20_000,
      translation: 20_000
    )
    XCTAssertTrue(C14_10RetainedEdgeValidator.isValid(previous: anchor, current: bridge))

    let smallTurn = sample(
      index: 1,
      segmentId: segmentId,
      roomId: roomId,
      zoneId: zoneId,
      connected: true,
      loopClosure: false,
      parallax: 0,
      quaternion: [0, 43_619_387, 0, 999_048_222],
      span: 0,
      travel: 20_000,
      translation: 20_000
    )
    XCTAssertFalse(C14_10RetainedEdgeValidator.isValid(previous: anchor, current: smallTurn))

    let disconnected = sample(
      index: 1,
      segmentId: segmentId,
      roomId: roomId,
      zoneId: zoneId,
      connected: false,
      loopClosure: false,
      parallax: 0,
      quaternion: [0, 87_155_743, 0, 996_194_698],
      span: 0,
      travel: 20_000,
      translation: 20_000
    )
    XCTAssertFalse(C14_10RetainedEdgeValidator.isValid(previous: anchor, current: disconnected))
  }

  func testProjectedOverlapSurvivesFeatureIdentifierChurnAndRejectsPointsBehindCamera() {
    let referencePoints = (-2...2).flatMap { x in
      (-2...2).map { y in
        SIMD3<Float>(Float(x) * 0.2, Float(y) * 0.2, -2)
      }
    }
    let viewport = CGSize(width: 100, height: 100)
    let projection: (SIMD3<Float>) -> CGPoint = { point in
      CGPoint(
        x: 50 + CGFloat(point.x * 50),
        y: 50 - CGFloat(point.y * 50)
      )
    }

    XCTAssertEqual(
      C14_10SpatialOverlap.identifierScore(left: [1, 2], right: [3, 4]),
      0
    )
    XCTAssertEqual(
      C14_10SpatialOverlap.score(
        currentFeatureIds: [1, 2],
        referenceFeatureIds: [3, 4],
        referenceFeaturePoints: referencePoints,
        currentCameraTransform: matrix_identity_float4x4,
        viewportSize: viewport,
        project: projection
      ),
      1_000_000
    )

    var oppositeCamera = matrix_identity_float4x4
    oppositeCamera.columns.0.x = -1
    oppositeCamera.columns.2.z = -1
    XCTAssertEqual(
      C14_10SpatialOverlap.score(
        currentFeatureIds: [1, 2],
        referenceFeatureIds: [3, 4],
        referenceFeaturePoints: referencePoints,
        currentCameraTransform: oppositeCamera,
        viewportSize: viewport,
        project: projection
      ),
      0
    )
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

  @MainActor
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
    XCTAssertEqual(C14_8ARKitGuidedCaptureEngine.resourcePressure(for: .nominal), .nominal)
    XCTAssertEqual(C14_8ARKitGuidedCaptureEngine.resourcePressure(for: .fair), .constrained)
    XCTAssertEqual(C14_8ARKitGuidedCaptureEngine.resourcePressure(for: .serious), .constrained)
    XCTAssertEqual(C14_8ARKitGuidedCaptureEngine.resourcePressure(for: .critical), .critical)
  }

  @MainActor
  func testFinalFrameRevalidationSkipsCandidateWithoutStoppingCapture() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-10-revalidation-skip-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = faultModel(
      root: root,
      injector: C14_10ScriptedFaultInjector(script: [:]),
      engine: C14_10RejectingCaptureEngine()
    )

    await model.activate(projectId: UUID().uuidString, actor: faultActor())
    XCTAssertFalse(model.captureArmed)
    XCTAssertEqual(model.draft?.keyframes.count, 0)
    model.armCapture()
    await waitUntil {
      model.state == .ready
        && model.selectionInstruction?.localizedCaseInsensitiveContains("new position") == true
    }

    XCTAssertEqual(model.draft?.keyframes.count, 0)
    XCTAssertEqual(model.draft?.samples.count, 0)
    model.handleBackgrounding()
    let finalOutcome = try XCTUnwrap(model.selectionDiagnostics.detailedOutcomes?.last)
    XCTAssertEqual(finalOutcome.outcome.reason, .nearDuplicate)
    XCTAssertEqual(finalOutcome.outcome.featurePointCount, 321)
    XCTAssertEqual(finalOutcome.context.coverageCellId, "south:upper")
  }

  @MainActor
  func testRetainedFrameMarksItsOwnCoverageCellInsteadOfStaleTelemetry() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-10-retained-coverage-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let model = faultModel(
      root: root,
      injector: C14_10ScriptedFaultInjector(script: [:]),
      engine: C14_10CoverageCaptureEngine()
    )

    await model.activate(projectId: UUID().uuidString, actor: faultActor())
    model.armCapture()
    await waitUntil { model.draft?.samples.count == 1 && model.state == .ready }

    XCTAssertEqual(
      model.currentRoom?.coverage.first(where: { $0.id == "south:middle" })?.status,
      .observed
    )
    XCTAssertEqual(
      model.currentRoom?.coverage.first(where: { $0.id == "north:middle" })?.status,
      .missing
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

  func testEveryLifecycleFaultCheckpointIsDeterministicallyScriptable() async throws {
    for checkpoint in C14_10FaultCheckpoint.allCases {
      let injector = C14_10ScriptedFaultInjector(
        script: [checkpoint: [.serviceUnavailable]]
      )
      do {
        try await injector.checkpoint(checkpoint)
        XCTFail("Expected a deterministic fault at \(checkpoint.rawValue)")
      } catch {
        XCTAssertEqual(error as? C14_10InjectedFault, .serviceUnavailable)
      }
      let visited = await injector.visited
      XCTAssertEqual(visited, [checkpoint])
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
    model.armCapture()
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
    XCTAssertFalse(model.captureArmed)
    XCTAssertEqual(model.draft?.samples.count, 0)
    model.armCapture()
    await waitUntil { model.draft?.samples.count == 1 && model.state == .ready }
    model.handleBackgrounding()
    model.recoverAfterInterruption()
    await waitUntil { model.state == .ready && !model.captureArmed }
    model.armCapture()
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
    model.armCapture()
    await waitUntil { model.draft?.samples.count == 1 && model.state == .ready }
    let retainedHash = try XCTUnwrap(model.draft?.keyframes.first?.sha256)
    let retainedSegment = try XCTUnwrap(model.draft?.samples.first?.segmentId)

    model.reset()
    await model.activate(projectId: projectId, actor: faultActor())

    XCTAssertEqual(model.state, .review)
    XCTAssertEqual(model.draft?.keyframes.first?.sha256, retainedHash)
    XCTAssertEqual(model.draft?.segments.count, 1)

    model.captureMore()
    await waitUntil { model.state == .ready && !model.captureArmed }
    model.armCapture()
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
    let model = faultModel(
      root: root,
      injector: injector,
      engine: C14_10PhysicalPolicyCaptureEngine()
    )

    await model.activate(projectId: UUID().uuidString, actor: faultActor())
    model.armCapture()
    await waitUntil { model.draft?.keyframes.count == 1 && model.state == .ready }
    model.automaticCaptureEnabled = false
    XCTAssertTrue(model.canStopCapture)
    model.finishRoomReview()
    XCTAssertFalse(model.captureArmed)
    XCTAssertFalse(model.canStopCapture)
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

  @MainActor
  func testSyntheticFixtureCannotReachSubmissionWithInflatedCapabilities() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-10-fixture-boundary-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let injector = C14_10ScriptedFaultInjector(script: [.beforeSubmission: [.offline]])
    let model = faultModel(root: root, injector: injector)

    await model.activate(projectId: UUID().uuidString, actor: faultActor())
    model.armCapture()
    await waitUntil { model.draft?.keyframes.count == 1 && model.state == .ready }
    model.automaticCaptureEnabled = false
    model.finishRoomReview()
    XCTAssertEqual(model.state, .fixtureReview)
    model.serviceProcessingConsent = true
    model.submit()

    XCTAssertEqual(model.state, .fixtureReview)
    XCTAssertNil(model.draft?.acceptance)
    let visited = await injector.visited
    XCTAssertEqual(visited, [.beforeKeyframeRetention])
  }

  private func telemetry(
    connected: Bool = false,
    overlap: Int = 0,
    parallax: Int = 0,
    rotation: Int = 0,
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
        rotationFromPreviousMicroradians: rotation,
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
    injector: C14_10ScriptedFaultInjector,
    engine: any C14_8GuidedCaptureServing = C14_8FixtureGuidedCaptureEngine()
  ) -> C14_8GuidedCaptureModel {
    let token = C14_10TestTokenProvider()
    let baseURL = URL(string: "http://127.0.0.1:4100")!
    let capture = C7CaptureAPIClient(baseURL: baseURL, tokenProvider: token)
    let evidence = C2EvidenceAPIClient(baseURL: baseURL, tokenProvider: token)
    return C14_8GuidedCaptureModel(
      capabilityProvider: C14_10PhysicalTestCapabilityProvider(),
      permissionProvider: C14_10AuthorisedPermissionProvider(),
      engine: engine,
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
    attempts: Int = 500,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: @escaping @MainActor () -> Bool
  ) async {
    for _ in 0..<attempts {
      if condition() { return }
      try? await Task.sleep(nanoseconds: 10_000_000)
    }
    XCTFail("Timed out waiting for asynchronous capture state to settle.", file: file, line: line)
  }

  private func sample(
    index: Int,
    segmentId: UUID,
    roomId: UUID,
    zoneId: UUID,
    connected: Bool,
    loopClosure: Bool,
    parallax: Int,
    quaternion: [Int64] = [0, 0, 0, 1_000_000_000],
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
      quaternionNanounits: quaternion,
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

private struct C14_10RejectedFrameDiagnosticManifestTestView: Decodable {
  struct Record: Decodable {
    struct Outcome: Decodable {
      let reason: C14_10KeyframeDecisionReason
    }

    let capturedAt: Date
    let outcome: Outcome
    let segmentId: UUID?
  }

  let records: [Record]
}

@MainActor
private final class C14_10RejectingCaptureEngine: C14_8GuidedCaptureServing {
  private let fixture = C14_8FixtureGuidedCaptureEngine()
  var previewSession: ARSession? { nil }
  let syntheticFixture = true

  func applyResourcePolicy(_ policy: C14_10ResourcePolicy) {
    fixture.applyResourcePolicy(policy)
  }

  func start(
    telemetry: @escaping @MainActor (C14_8LiveTelemetry) -> Void,
    events: @escaping @MainActor (C14_8GuidedCaptureEvent) -> Void
  ) throws {
    try fixture.start(telemetry: telemetry, events: events)
  }

  func stop() { fixture.stop() }

  func captureKeyframe(
    to destination: URL,
    localIdentifier: UUID,
    roomId: UUID,
    segmentId: UUID,
    captureStartedAt: Date,
    retentionMode: C14_10KeyframeRetentionMode,
    zoneId: UUID
  ) async throws -> C14_8CapturedKeyframe {
    _ = (destination, localIdentifier, roomId, segmentId, captureStartedAt, retentionMode, zoneId)
    throw C14_8GuidedCaptureEngineError.candidateRejected(
      .nearDuplicate,
      telemetry: C14_8LiveTelemetry(
        ambientIntensity: 900,
        blurScoreMillionths: 900_000,
        coverageCellId: "south:upper",
        exposureScoreMillionths: 900_000,
        motionScoreMillionths: 0,
        spatialEvidence: C14_10LiveSpatialEvidence(
          connectedToPrevious: true,
          featurePointCount: 321,
          loopClosureCandidate: false,
          overlapScoreMillionths: 950_000,
          parallaxScoreMillionths: 200_000,
          rotationFromPreviousMicroradians: 10_000,
          telemetryTimestampMicroseconds: 2_200_000,
          trajectorySpanMicrometres: 1_500_000,
          trajectoryTravelMicrometres: 2_500_000,
          translationFromPreviousMicrometres: 200_000
        ),
        trackingState: .normal
      )
    )
  }
}

@MainActor
private final class C14_10CoverageCaptureEngine: C14_8GuidedCaptureServing {
  private let fixture = C14_8FixtureGuidedCaptureEngine()
  var previewSession: ARSession? { nil }
  let syntheticFixture = true

  func applyResourcePolicy(_ policy: C14_10ResourcePolicy) {
    fixture.applyResourcePolicy(policy)
  }

  func start(
    telemetry: @escaping @MainActor (C14_8LiveTelemetry) -> Void,
    events: @escaping @MainActor (C14_8GuidedCaptureEvent) -> Void
  ) throws {
    try fixture.start(telemetry: telemetry, events: events)
  }

  func stop() { fixture.stop() }

  func captureKeyframe(
    to destination: URL,
    localIdentifier: UUID,
    roomId: UUID,
    segmentId: UUID,
    captureStartedAt: Date,
    retentionMode: C14_10KeyframeRetentionMode,
    zoneId: UUID
  ) async throws -> C14_8CapturedKeyframe {
    let captured = try await fixture.captureKeyframe(
      to: destination,
      localIdentifier: localIdentifier,
      roomId: roomId,
      segmentId: segmentId,
      captureStartedAt: captureStartedAt,
      retentionMode: retentionMode,
      zoneId: zoneId
    )
    return C14_8CapturedKeyframe(
      coverageCellId: "south:middle",
      depthData: captured.depthData,
      depthHeight: captured.depthHeight,
      depthWidth: captured.depthWidth,
      sample: captured.sample
    )
  }
}

/// Test-only physical policy double. The injected fault fires before any upload or acceptance, so
/// its synthetic bytes never leave the protected test directory and establish no device evidence.
@MainActor
private final class C14_10PhysicalPolicyCaptureEngine: C14_8GuidedCaptureServing {
  private let fixture = C14_8FixtureGuidedCaptureEngine()
  var previewSession: ARSession? { nil }
  let syntheticFixture = false

  func applyResourcePolicy(_ policy: C14_10ResourcePolicy) {
    fixture.applyResourcePolicy(policy)
  }

  func start(
    telemetry: @escaping @MainActor (C14_8LiveTelemetry) -> Void,
    events: @escaping @MainActor (C14_8GuidedCaptureEvent) -> Void
  ) throws {
    try fixture.start(telemetry: telemetry, events: events)
  }

  func stop() { fixture.stop() }

  func captureKeyframe(
    to destination: URL,
    localIdentifier: UUID,
    roomId: UUID,
    segmentId: UUID,
    captureStartedAt: Date,
    retentionMode: C14_10KeyframeRetentionMode,
    zoneId: UUID
  ) async throws -> C14_8CapturedKeyframe {
    try await fixture.captureKeyframe(
      to: destination,
      localIdentifier: localIdentifier,
      roomId: roomId,
      segmentId: segmentId,
      captureStartedAt: captureStartedAt,
      retentionMode: retentionMode,
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

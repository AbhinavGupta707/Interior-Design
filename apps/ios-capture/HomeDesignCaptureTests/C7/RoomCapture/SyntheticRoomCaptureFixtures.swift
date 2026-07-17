import Foundation

@testable import HomeDesignCapture

enum SyntheticRoomCaptureFixtures {
  static let projectId = uuid("10000000-0000-4000-8000-000000000001")
  static let sessionId = uuid("20000000-0000-4000-8000-000000000001")
  static let originA = uuid("30000000-0000-4000-8000-000000000001")
  static let originB = uuid("30000000-0000-4000-8000-000000000002")
  static let structureId = uuid("40000000-0000-4000-8000-000000000001")

  static func uuid(_ value: String) -> UUID {
    UUID(uuidString: value)!
  }

  static func run(mode: C7CaptureMode = .structure) -> RoomCaptureRun {
    RoomCaptureRun(
      captureSessionId: sessionId,
      mode: mode,
      projectId: projectId,
      rights: C7CaptureRights(basis: .ownedByUser, serviceProcessingConsent: true)
    )
  }

  static func surface(
    id: UUID = uuid("50000000-0000-4000-8000-000000000001"),
    parent: UUID? = nil,
    dimensions: RoomCaptureVector3 = .init(x: 4.000_001, y: 2.5, z: 0.12),
    transform: RoomCaptureTransform = .identity,
    polygonCorners: [RoomCaptureVector3] = [
      .init(x: -2, y: 0, z: 0),
      .init(x: 2, y: 0, z: 0),
    ],
    confidence: C7RoomPlanConfidence = .high
  ) -> RoomCaptureSurfaceObservation {
    RoomCaptureSurfaceObservation(
      category: .wall,
      completedEdges: [.right, .top, .left, .bottom],
      confidence: confidence,
      curve: RoomCaptureCurveObservation(
        centreXMetres: 0.000_000_5,
        centreZMetres: -0.000_000_5,
        endRadians: 1.5,
        radiusMetres: 2.25,
        startRadians: -1.5
      ),
      dimensionsMetres: dimensions,
      parentSourceIdentifier: parent,
      polygonCornersMetres: polygonCorners,
      sourceIdentifier: id,
      story: 0,
      transform: transform
    )
  }

  static func object(
    id: UUID = uuid("60000000-0000-4000-8000-000000000001"),
    parent: UUID? = uuid("50000000-0000-4000-8000-000000000001"),
    category: RoomCaptureObjectCategory = .chair,
    transform: RoomCaptureTransform = .identity,
    confidence: C7RoomPlanConfidence = .medium
  ) -> RoomCaptureObjectObservation {
    RoomCaptureObjectObservation(
      category: category,
      confidence: confidence,
      dimensionsMetres: .init(x: 0.5, y: 0.8, z: 0.5),
      parentSourceIdentifier: parent,
      sourceIdentifier: id,
      story: 0,
      transform: transform
    )
  }

  static func room(
    sequence: Int = 1,
    origin: UUID = originA,
    roomId: UUID? = nil,
    surfaceValues: [RoomCaptureSurfaceObservation]? = nil,
    objectValues: [RoomCaptureObjectObservation]? = nil,
    rawJSON: Data? = Data("{\"fixture\":\"synthetic-raw-room-data\"}".utf8),
    usdz: Data? = nil,
    isSyntheticFixture: Bool = true
  ) -> RoomCaptureRoomEvidence {
    let resolvedRoomId =
      roomId
      ?? uuid(
        sequence == 1
          ? "70000000-0000-4000-8000-000000000001"
          : "70000000-0000-4000-8000-000000000002"
      )
    let sourceRoomId = uuid(
      sequence == 1
        ? "71000000-0000-4000-8000-000000000001"
        : "71000000-0000-4000-8000-000000000002"
    )
    let wallId = uuid(
      sequence == 1
        ? "50000000-0000-4000-8000-000000000001"
        : "50000000-0000-4000-8000-000000000002"
    )
    let objectId = uuid(
      sequence == 1
        ? "60000000-0000-4000-8000-000000000001"
        : "60000000-0000-4000-8000-000000000002"
    )
    return RoomCaptureRoomEvidence(
      capturedRoomJSON: Data("{\"fixture\":\"synthetic-room-\(sequence)\"}".utf8),
      capturedRoomVersion: 1,
      isSyntheticFixture: isSyntheticFixture,
      objects: objectValues ?? [object(id: objectId, parent: wallId)],
      rawCapturedRoomDataJSON: rawJSON,
      roomId: resolvedRoomId,
      sequence: sequence,
      sourceRoomIdentifier: sourceRoomId,
      story: 0,
      surfaces: surfaceValues ?? [surface(id: wallId)],
      usdz: usdz,
      userLabel: "Synthetic room \(sequence)",
      worldOriginIdentifier: origin
    )
  }

  static func quality(
    lowSurfaceCount: Int = 0,
    lowObjectCount: Int = 0
  ) -> C7CaptureQualityManifest {
    C7CaptureQualityManifest(
      heuristicName: "c7-roomplan-quality",
      heuristicVersion: "1.0.0",
      instructionCounts: Dictionary(
        uniqueKeysWithValues: C7CaptureInstruction.allCases.map { ($0, 0) }
      ),
      interruptionCount: 0,
      lowConfidenceObjectCount: lowObjectCount,
      lowConfidenceSurfaceCount: lowSurfaceCount,
      relocalisationAttemptCount: 0,
      relocalisationSuccessCount: 0,
      scanDurationMilliseconds: 1_000,
      worldMappingStatusAtFinish: .mapped
    )
  }

  static let environment = RoomCaptureArtifactEnvironment(
    appBuild: "synthetic-build-1",
    appVersion: "0.1.0",
    operatingSystemVersion: "synthetic-os-1",
    producerVersion: RoomCaptureArtifactProducer.producerVersion,
    roomPlanFrameworkVersion: "synthetic-roomplan-fixture-1"
  )
}

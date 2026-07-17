import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C7 deterministic RoomPlan normalization")
struct RoomPlanNormalizerTests {
  @Test("normalizes deterministically with half-away rounding and source mappings")
  func deterministicNormalization() {
    let roomOne = SyntheticRoomCaptureFixtures.room(sequence: 1)
    #expect(roomOne.surfaces[0].dimensionsMetres.x == 4.000_001)
    #expect(
      (try? C7RoomPlanQuantization.micrometres(
        fromMetres: roomOne.surfaces[0].dimensionsMetres.x
      )) == 4_000_001
    )
    let roomTwo = SyntheticRoomCaptureFixtures.room(
      sequence: 2,
      objectValues: [
        SyntheticRoomCaptureFixtures.object(
          id: SyntheticRoomCaptureFixtures.uuid("60000000-0000-4000-8000-000000000002"),
          parent: SyntheticRoomCaptureFixtures.uuid("50000000-0000-4000-8000-000000000002"),
          category: .stove
        )
      ]
    )
    let measurement = C7ReferenceMeasurement(
      distanceMillimetres: 1_500,
      fromSourceEntityId: roomOne.surfaces[0].sourceIdentifier,
      measurementId: SyntheticRoomCaptureFixtures.uuid(
        "80000000-0000-4000-8000-000000000001"
      ),
      method: .laser,
      toSourceEntityId: roomOne.objects[0].sourceIdentifier
    )
    let input = RoomPlanNormalizer.Input(
      captureSessionId: SyntheticRoomCaptureFixtures.sessionId,
      projectId: SyntheticRoomCaptureFixtures.projectId,
      quality: SyntheticRoomCaptureFixtures.quality(),
      referenceMeasurements: [measurement],
      rooms: [roomTwo, roomOne],
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId
    )

    let first = RoomPlanNormalizer.normalize(input)
    let second = RoomPlanNormalizer.normalize(input)
    #expect(first == second)
    guard case .normalized(let result) = first else {
      Issue.record("Expected normalized result")
      return
    }
    #expect(result.normalized.schemaVersion == "c7-roomplan-normalized-v1")
    #expect(result.normalized.rooms.map(\.sequence) == [1, 2])
    #expect(result.normalized.surfaces[0].dimensionsMicrometres.x == 4_000_001)
    #expect(result.normalized.surfaces[0].curve?.centreXMicrometres == 1)
    #expect(result.normalized.surfaces[0].curve?.centreZMicrometres == -1)
    #expect(result.normalized.surfaces[0].completedEdges == [.top, .bottom, .left, .right])
    #expect(
      result.normalized.surfaces[0].transform.basisNanounits == [
        1_000_000_000, 0, 0,
        0, 1_000_000_000, 0,
        0, 0, 1_000_000_000,
      ])
    #expect(result.normalized.objects.contains { $0.category == .unknown })
    #expect(
      result.conversionInputs.findings.map(\.code) == [
        "UNSUPPORTED_ROOMPLAN_OBJECT_CATEGORY"
      ])
    #expect(result.conversionInputs.sourceMappings.count == 4)
    #expect(
      result.conversionInputs.sourceMappings.map(\.normalizedCollection) == [
        "surfaces", "surfaces", "objects", "objects",
      ])
  }

  @Test("non-finite values abstain")
  func nonFinite() {
    let badSurface = SyntheticRoomCaptureFixtures.surface(
      dimensions: .init(x: .nan, y: 2, z: 0.1)
    )
    #expect(
      reason(for: [SyntheticRoomCaptureFixtures.room(surfaceValues: [badSurface])])
        == .nonFiniteValue)
  }

  @Test("zero and oversized dimensions abstain", arguments: [0.0, 100.000_001])
  func invalidDimensions(_ x: Double) {
    let badSurface = SyntheticRoomCaptureFixtures.surface(
      dimensions: .init(x: x, y: 2, z: 0.1)
    )
    #expect(
      reason(for: [SyntheticRoomCaptureFixtures.room(surfaceValues: [badSurface])])
        == .invalidDimension)
  }

  @Test("malformed and extreme transforms abstain")
  func malformedTransforms() {
    let malformed = SyntheticRoomCaptureFixtures.surface(
      transform: .init(columnMajorValues: Array(repeating: 0, count: 15))
    )
    #expect(
      reason(for: [SyntheticRoomCaptureFixtures.room(surfaceValues: [malformed])])
        == .malformedTransform)

    var extremeValues = RoomCaptureTransform.identity.columnMajorValues
    extremeValues[12] = 1_000.000_001
    let extreme = SyntheticRoomCaptureFixtures.surface(
      transform: .init(columnMajorValues: extremeValues)
    )
    #expect(
      reason(for: [SyntheticRoomCaptureFixtures.room(surfaceValues: [extreme])])
        == .malformedTransform)
  }

  @Test("duplicate source identifiers abstain")
  func duplicateIdentifiers() {
    let duplicateId = SyntheticRoomCaptureFixtures.uuid(
      "50000000-0000-4000-8000-000000000001"
    )
    let room = SyntheticRoomCaptureFixtures.room(
      surfaceValues: [SyntheticRoomCaptureFixtures.surface(id: duplicateId)],
      objectValues: [SyntheticRoomCaptureFixtures.object(id: duplicateId, parent: duplicateId)]
    )
    #expect(reason(for: [room]) == .duplicateSourceIdentifier)
  }

  @Test("missing parents and measurement references abstain")
  func missingReferences() {
    let missing = SyntheticRoomCaptureFixtures.uuid(
      "99999999-0000-4000-8000-000000000001"
    )
    let room = SyntheticRoomCaptureFixtures.room(
      objectValues: [SyntheticRoomCaptureFixtures.object(parent: missing)]
    )
    #expect(reason(for: [room]) == .invalidParentReference)

    let validRoom = SyntheticRoomCaptureFixtures.room()
    let measurement = C7ReferenceMeasurement(
      distanceMillimetres: 1_000,
      fromSourceEntityId: validRoom.surfaces[0].sourceIdentifier,
      measurementId: SyntheticRoomCaptureFixtures.uuid(
        "80000000-0000-4000-8000-000000000002"
      ),
      method: .tape,
      toSourceEntityId: missing
    )
    let outcome = RoomPlanNormalizer.normalize(
      .init(
        captureSessionId: SyntheticRoomCaptureFixtures.sessionId,
        projectId: SyntheticRoomCaptureFixtures.projectId,
        quality: SyntheticRoomCaptureFixtures.quality(),
        referenceMeasurements: [measurement],
        rooms: [validRoom],
        structureIdentifier: nil
      ))
    guard case .abstained(let input) = outcome else {
      Issue.record("Expected measurement abstention")
      return
    }
    #expect(input.reason == .invalidRoomReference)
  }

  @Test("parents cannot cross room boundaries and coordinates stay bounded")
  func crossRoomParentAndCoordinateBounds() {
    let roomTwoWall = SyntheticRoomCaptureFixtures.uuid(
      "50000000-0000-4000-8000-000000000002"
    )
    let roomOne = SyntheticRoomCaptureFixtures.room(
      sequence: 1,
      objectValues: [SyntheticRoomCaptureFixtures.object(parent: roomTwoWall)]
    )
    let roomTwo = SyntheticRoomCaptureFixtures.room(sequence: 2)
    #expect(
      reason(
        for: [roomOne, roomTwo],
        structureId: SyntheticRoomCaptureFixtures.structureId
      ) == .invalidParentReference
    )

    let extremePoint = SyntheticRoomCaptureFixtures.surface(
      polygonCorners: [.init(x: 1_000.000_001, y: 0, z: 0)]
    )
    #expect(
      reason(for: [SyntheticRoomCaptureFixtures.room(surfaceValues: [extremePoint])])
        == .invalidCoordinate
    )
  }

  @Test("polygon, surface and room-origin bounds abstain")
  func countAndWorldOriginBounds() {
    let corners = Array(
      repeating: RoomCaptureVector3(x: 0, y: 0, z: 0),
      count: RoomPlanNormalizer.maximumPolygonCorners + 1
    )
    let polygon = SyntheticRoomCaptureFixtures.surface(polygonCorners: corners)
    #expect(
      reason(for: [SyntheticRoomCaptureFixtures.room(surfaceValues: [polygon])])
        == .countLimitExceeded)

    let tooMany = Array(
      repeating: SyntheticRoomCaptureFixtures.surface(),
      count: C7CaptureContract.maximumSurfaceCount + 1
    )
    #expect(
      reason(for: [SyntheticRoomCaptureFixtures.room(surfaceValues: tooMany)])
        == .countLimitExceeded)

    let incompatible = [
      SyntheticRoomCaptureFixtures.room(sequence: 1, origin: SyntheticRoomCaptureFixtures.originA),
      SyntheticRoomCaptureFixtures.room(sequence: 2, origin: SyntheticRoomCaptureFixtures.originB),
    ]
    #expect(
      reason(for: incompatible, structureId: SyntheticRoomCaptureFixtures.structureId)
        == .incompatibleWorldOrigin)
  }

  private func reason(
    for rooms: [RoomCaptureRoomEvidence],
    structureId: UUID? = nil
  ) -> RoomCaptureAbstentionReason? {
    let outcome = RoomPlanNormalizer.normalize(
      .init(
        captureSessionId: SyntheticRoomCaptureFixtures.sessionId,
        projectId: SyntheticRoomCaptureFixtures.projectId,
        quality: SyntheticRoomCaptureFixtures.quality(),
        referenceMeasurements: [],
        rooms: rooms,
        structureIdentifier: structureId
      ))
    guard case .abstained(let input) = outcome else { return nil }
    return input.reason
  }
}

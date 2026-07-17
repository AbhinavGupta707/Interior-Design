import Foundation

struct RoomPlanNormalizationResult: Equatable, Sendable {
  let conversionInputs: RoomCaptureConversionInputs
  let normalized: C7NormalizedRoomPlan
}

enum RoomPlanNormalizationOutcome: Equatable, Sendable {
  case abstained(RoomCaptureAbstentionInput)
  case normalized(RoomPlanNormalizationResult)
}

enum RoomPlanNormalizer {
  static let maximumPolygonCorners = 256
  static let maximumDimensionMicrometres: Int64 = 100_000_000

  struct Input: Equatable, Sendable {
    let captureSessionId: UUID
    let projectId: UUID
    let quality: C7CaptureQualityManifest
    let referenceMeasurements: [C7ReferenceMeasurement]
    let rooms: [RoomCaptureRoomEvidence]
    let structureIdentifier: UUID?
  }

  static func normalize(_ input: Input) -> RoomPlanNormalizationOutcome {
    do {
      return .normalized(try normalizeValidated(input))
    } catch let problem as NormalizationProblem {
      return .abstained(problem.abstention)
    } catch {
      return .abstained(
        RoomCaptureAbstentionInput(
          affectedSourceEntityIds: [],
          message: "RoomPlan normalization failed closed.",
          reason: .malformedTransform
        ))
    }
  }

  private static func normalizeValidated(_ input: Input) throws -> RoomPlanNormalizationResult {
    guard (1...C7CaptureContract.maximumRoomCount).contains(input.rooms.count) else {
      throw NormalizationProblem(reason: .countLimitExceeded, ids: [])
    }
    guard input.referenceMeasurements.count <= C7CaptureContract.maximumReferenceMeasurements else {
      throw NormalizationProblem(reason: .countLimitExceeded, ids: [])
    }

    let rooms = input.rooms.sorted {
      ($0.sequence, $0.roomId.uuidString.lowercased())
        < ($1.sequence, $1.roomId.uuidString.lowercased())
    }
    guard rooms.enumerated().allSatisfy({ $0.element.sequence == $0.offset + 1 }) else {
      throw NormalizationProblem(
        reason: .invalidRoomReference,
        ids: rooms.map(\.sourceRoomIdentifier)
      )
    }
    guard Set(rooms.map(\.roomId)).count == rooms.count else {
      throw NormalizationProblem(reason: .invalidRoomReference, ids: rooms.map(\.roomId))
    }
    guard Set(rooms.map(\.sourceRoomIdentifier)).count == rooms.count else {
      throw NormalizationProblem(
        reason: .duplicateSourceIdentifier,
        ids: duplicateIdentifiers(in: rooms.map(\.sourceRoomIdentifier))
      )
    }
    guard Set(rooms.map(\.worldOriginIdentifier)).count == 1 else {
      throw NormalizationProblem(
        reason: .incompatibleWorldOrigin,
        ids: rooms.map(\.sourceRoomIdentifier)
      )
    }
    guard
      (rooms.count == 1 && input.structureIdentifier == nil)
        || (rooms.count >= 2 && input.structureIdentifier != nil)
    else {
      throw NormalizationProblem(
        reason: .invalidRoomReference,
        ids: rooms.map(\.sourceRoomIdentifier)
      )
    }

    for room in rooms {
      let trimmedLabel = room.userLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
      guard
        room.surfaces.count <= C7CaptureContract.maximumSurfaceCount,
        room.objects.count <= C7CaptureContract.maximumObjectCount
      else {
        throw NormalizationProblem(reason: .countLimitExceeded, ids: [room.sourceRoomIdentifier])
      }
      guard
        (0...1_000_000).contains(room.capturedRoomVersion),
        !room.surfaces.isEmpty,
        trimmedLabel?.isEmpty != true,
        (trimmedLabel?.count ?? 0) <= 120
      else {
        throw NormalizationProblem(reason: .invalidRoomReference, ids: [room.sourceRoomIdentifier])
      }
    }

    let surfaceCount = rooms.reduce(0) { $0 + $1.surfaces.count }
    let objectCount = rooms.reduce(0) { $0 + $1.objects.count }
    guard
      surfaceCount <= C7CaptureContract.maximumSurfaceCount,
      objectCount <= C7CaptureContract.maximumObjectCount
    else {
      throw NormalizationProblem(reason: .countLimitExceeded, ids: [])
    }

    let allSourceIdentifiers = rooms.flatMap { room in
      room.surfaces.map(\.sourceIdentifier) + room.objects.map(\.sourceIdentifier)
    }
    guard Set(allSourceIdentifiers).count == allSourceIdentifiers.count else {
      throw NormalizationProblem(
        reason: .duplicateSourceIdentifier,
        ids: duplicateIdentifiers(in: allSourceIdentifiers)
      )
    }
    let sourceIdentifierSet = Set(allSourceIdentifiers)
    for room in rooms {
      let identifiersInRoom = Set(
        room.surfaces.map(\.sourceIdentifier) + room.objects.map(\.sourceIdentifier)
      )
      let parents =
        room.surfaces.compactMap(\.parentSourceIdentifier)
        + room.objects.compactMap(\.parentSourceIdentifier)
      guard parents.allSatisfy(identifiersInRoom.contains) else {
        throw NormalizationProblem(
          reason: .invalidParentReference,
          ids: parents.filter { !identifiersInRoom.contains($0) }
        )
      }
    }
    guard
      Set(input.referenceMeasurements.map(\.measurementId)).count
        == input.referenceMeasurements.count
    else {
      throw NormalizationProblem(
        reason: .duplicateSourceIdentifier,
        ids: duplicateIdentifiers(in: input.referenceMeasurements.map(\.measurementId))
      )
    }
    for measurement in input.referenceMeasurements {
      guard
        measurement.distanceMillimetres > 0,
        measurement.distanceMillimetres <= 100_000,
        measurement.fromSourceEntityId != measurement.toSourceEntityId,
        sourceIdentifierSet.contains(measurement.fromSourceEntityId),
        sourceIdentifierSet.contains(measurement.toSourceEntityId)
      else {
        throw NormalizationProblem(
          reason: .invalidRoomReference,
          ids: [measurement.fromSourceEntityId, measurement.toSourceEntityId]
        )
      }
    }

    var findings: [RoomCaptureFinding] = []
    var surfaces: [C7NormalizedRoomPlanSurface] = []
    var objects: [C7NormalizedRoomPlanObject] = []

    for room in rooms {
      guard (-20...200).contains(room.story) else {
        throw NormalizationProblem(reason: .invalidStory, ids: [room.sourceRoomIdentifier])
      }
      for surface in room.surfaces.sorted(by: sourceIdentifierOrder) {
        surfaces.append(try normalizedSurface(surface, room: room))
      }
      for object in room.objects.sorted(by: sourceIdentifierOrder) {
        let normalizedObject = try normalizedObject(object, room: room)
        objects.append(normalizedObject)
        if object.category == .stove || object.category == .unknown {
          findings.append(
            RoomCaptureFinding(
              affectedSourceEntityIds: [object.sourceIdentifier],
              code: "UNSUPPORTED_ROOMPLAN_OBJECT_CATEGORY",
              message:
                "A RoomPlan object category outside the frozen normalized set is preserved as unknown.",
              severity: .warning
            ))
        }
      }
    }

    let roomManifests = rooms.map { room in
      C7CaptureRoomManifest(
        capturedRoomVersion: room.capturedRoomVersion,
        roomId: room.roomId,
        sequence: room.sequence,
        sourceRoomIdentifier: room.sourceRoomIdentifier,
        story: room.story,
        userLabel: room.userLabel
      )
    }
    let sortedMeasurements = input.referenceMeasurements.sorted {
      $0.measurementId.uuidString.lowercased() < $1.measurementId.uuidString.lowercased()
    }
    let normalized = C7NormalizedRoomPlan(
      captureSessionId: input.captureSessionId,
      coordinateSystem: .roomPlanWorld,
      objects: objects,
      projectId: input.projectId,
      quality: input.quality,
      referenceMeasurements: sortedMeasurements,
      rooms: roomManifests,
      schemaVersion: C7CaptureContract.normalizedRoomPlanSchemaVersion,
      structureIdentifier: input.structureIdentifier,
      surfaces: surfaces
    )
    let surfaceMappings = surfaces.enumerated().map { index, surface in
      RoomCaptureSourceMapping(
        normalizedCollection: "surfaces",
        normalizedIndex: index,
        roomId: surface.roomId,
        sourceEntityId: surface.sourceIdentifier
      )
    }
    let objectMappings = objects.enumerated().map { index, object in
      RoomCaptureSourceMapping(
        normalizedCollection: "objects",
        normalizedIndex: index,
        roomId: object.roomId,
        sourceEntityId: object.sourceIdentifier
      )
    }
    return RoomPlanNormalizationResult(
      conversionInputs: RoomCaptureConversionInputs(
        abstentionInputs: [],
        findings: findings.sorted { $0.code < $1.code },
        sourceMappings: surfaceMappings + objectMappings
      ),
      normalized: normalized
    )
  }

  private static func normalizedSurface(
    _ surface: RoomCaptureSurfaceObservation,
    room: RoomCaptureRoomEvidence
  ) throws -> C7NormalizedRoomPlanSurface {
    guard (-20...200).contains(surface.story) else {
      throw NormalizationProblem(reason: .invalidStory, ids: [surface.sourceIdentifier])
    }
    guard surface.polygonCornersMetres.count <= maximumPolygonCorners else {
      throw NormalizationProblem(reason: .countLimitExceeded, ids: [surface.sourceIdentifier])
    }
    let category: C7RoomPlanSurfaceCategory =
      switch surface.category {
      case .door(let isOpen): isOpen ? .doorOpen : .doorClosed
      case .floor: .floor
      case .opening: .opening
      case .wall: .wall
      case .window: .window
      }
    return C7NormalizedRoomPlanSurface(
      category: category,
      completedEdges: surface.completedEdges.sorted(by: edgeOrder),
      confidence: surface.confidence,
      curve: try surface.curve.map {
        try normalizedCurve($0, sourceIdentifier: surface.sourceIdentifier)
      },
      dimensionsMicrometres: try normalizedDimensions(
        surface.dimensionsMetres,
        sourceIdentifier: surface.sourceIdentifier
      ),
      parentSourceIdentifier: surface.parentSourceIdentifier,
      polygonCornersMicrometres: try surface.polygonCornersMetres.map {
        try normalizedPoint($0, sourceIdentifier: surface.sourceIdentifier)
      },
      roomId: room.roomId,
      sourceIdentifier: surface.sourceIdentifier,
      story: surface.story,
      transform: try normalizedTransform(
        surface.transform,
        sourceIdentifier: surface.sourceIdentifier
      )
    )
  }

  private static func normalizedObject(
    _ object: RoomCaptureObjectObservation,
    room: RoomCaptureRoomEvidence
  ) throws -> C7NormalizedRoomPlanObject {
    guard (-20...200).contains(object.story) else {
      throw NormalizationProblem(reason: .invalidStory, ids: [object.sourceIdentifier])
    }
    let category: C7RoomPlanObjectCategory =
      switch object.category {
      case .bathtub: .bathtub
      case .bed: .bed
      case .chair: .chair
      case .dishwasher: .dishwasher
      case .fireplace: .fireplace
      case .oven: .oven
      case .refrigerator: .refrigerator
      case .sink: .sink
      case .sofa: .sofa
      case .stairs: .stairs
      case .storage: .storage
      case .stove: .unknown
      case .table: .table
      case .television: .television
      case .toilet: .toilet
      case .unknown: .unknown
      case .washerDryer: .washerDryer
      }
    return C7NormalizedRoomPlanObject(
      category: category,
      confidence: object.confidence,
      dimensionsMicrometres: try normalizedDimensions(
        object.dimensionsMetres,
        sourceIdentifier: object.sourceIdentifier
      ),
      parentSourceIdentifier: object.parentSourceIdentifier,
      roomId: room.roomId,
      sourceIdentifier: object.sourceIdentifier,
      story: object.story,
      transform: try normalizedTransform(
        object.transform,
        sourceIdentifier: object.sourceIdentifier
      )
    )
  }

  private static func normalizedCurve(
    _ curve: RoomCaptureCurveObservation,
    sourceIdentifier: UUID
  ) throws -> C7RoomPlanCurve {
    guard
      curve.centreXMetres.isFinite,
      curve.centreZMetres.isFinite,
      curve.endRadians.isFinite,
      curve.radiusMetres.isFinite,
      curve.startRadians.isFinite
    else { throw NormalizationProblem(reason: .nonFiniteValue, ids: [sourceIdentifier]) }
    guard
      abs(curve.centreXMetres) <= 1_000,
      abs(curve.centreZMetres) <= 1_000,
      abs(curve.endRadians) <= 7,
      abs(curve.startRadians) <= 7
    else {
      throw NormalizationProblem(reason: .invalidCoordinate, ids: [sourceIdentifier])
    }
    guard curve.radiusMetres > 0, curve.radiusMetres <= 100 else {
      throw NormalizationProblem(reason: .invalidDimension, ids: [sourceIdentifier])
    }
    let radius = try C7RoomPlanQuantization.micrometres(fromMetres: curve.radiusMetres)
    guard radius > 0, radius <= maximumDimensionMicrometres else {
      throw NormalizationProblem(reason: .invalidDimension, ids: [sourceIdentifier])
    }
    return C7RoomPlanCurve(
      centreXMicrometres: try C7RoomPlanQuantization.micrometres(
        fromMetres: curve.centreXMetres
      ),
      centreZMicrometres: try C7RoomPlanQuantization.micrometres(
        fromMetres: curve.centreZMetres
      ),
      endNanoradians: try C7RoomPlanQuantization.nanoradians(fromRadians: curve.endRadians),
      radiusMicrometres: radius,
      startNanoradians: try C7RoomPlanQuantization.nanoradians(fromRadians: curve.startRadians)
    )
  }

  private static func normalizedDimensions(
    _ value: RoomCaptureVector3,
    sourceIdentifier: UUID
  ) throws -> C7IntegerDimensions3 {
    guard value.x.isFinite, value.y.isFinite, value.z.isFinite else {
      throw NormalizationProblem(reason: .nonFiniteValue, ids: [sourceIdentifier])
    }
    guard
      value.x > 0, value.x <= 100,
      value.y > 0, value.y <= 100,
      value.z > 0, value.z <= 100
    else {
      throw NormalizationProblem(reason: .invalidDimension, ids: [sourceIdentifier])
    }
    let result = C7IntegerDimensions3(
      x: try C7RoomPlanQuantization.micrometres(fromMetres: value.x),
      y: try C7RoomPlanQuantization.micrometres(fromMetres: value.y),
      z: try C7RoomPlanQuantization.micrometres(fromMetres: value.z)
    )
    guard
      [result.x, result.y, result.z].allSatisfy({
        $0 > 0 && $0 <= maximumDimensionMicrometres
      })
    else {
      throw NormalizationProblem(reason: .invalidDimension, ids: [sourceIdentifier])
    }
    return result
  }

  private static func normalizedPoint(
    _ value: RoomCaptureVector3,
    sourceIdentifier: UUID
  ) throws -> C7IntegerPoint3 {
    guard value.x.isFinite, value.y.isFinite, value.z.isFinite else {
      throw NormalizationProblem(reason: .nonFiniteValue, ids: [sourceIdentifier])
    }
    guard abs(value.x) <= 1_000, abs(value.y) <= 1_000, abs(value.z) <= 1_000 else {
      throw NormalizationProblem(reason: .invalidCoordinate, ids: [sourceIdentifier])
    }
    return C7IntegerPoint3(
      x: try C7RoomPlanQuantization.micrometres(fromMetres: value.x),
      y: try C7RoomPlanQuantization.micrometres(fromMetres: value.y),
      z: try C7RoomPlanQuantization.micrometres(fromMetres: value.z)
    )
  }

  /// Basis order is RoomPlan/simd column-major: X column, then Y, then Z.
  private static func normalizedTransform(
    _ value: RoomCaptureTransform,
    sourceIdentifier: UUID
  ) throws -> C7RoomPlanTransform {
    let values = value.columnMajorValues
    guard values.count == 16 else {
      throw NormalizationProblem(reason: .malformedTransform, ids: [sourceIdentifier])
    }
    guard values.allSatisfy(\.isFinite) else {
      throw NormalizationProblem(reason: .nonFiniteValue, ids: [sourceIdentifier])
    }
    guard
      [0, 1, 2, 4, 5, 6, 8, 9, 10].allSatisfy({ abs(values[$0]) <= 1.1 }),
      abs(values[12]) <= 1_000,
      abs(values[13]) <= 1_000,
      abs(values[14]) <= 1_000
    else {
      throw NormalizationProblem(reason: .malformedTransform, ids: [sourceIdentifier])
    }
    guard
      abs(values[3]) <= 0.000_001,
      abs(values[7]) <= 0.000_001,
      abs(values[11]) <= 0.000_001,
      abs(values[15] - 1) <= 0.000_001
    else {
      throw NormalizationProblem(reason: .malformedTransform, ids: [sourceIdentifier])
    }
    let basis = [0, 1, 2, 4, 5, 6, 8, 9, 10]
    return C7RoomPlanTransform(
      basisNanounits: try basis.map { try C7RoomPlanQuantization.nanounits(values[$0]) },
      translationMicrometres: C7IntegerPoint3(
        x: try C7RoomPlanQuantization.micrometres(fromMetres: values[12]),
        y: try C7RoomPlanQuantization.micrometres(fromMetres: values[13]),
        z: try C7RoomPlanQuantization.micrometres(fromMetres: values[14])
      )
    )
  }

  private static func sourceIdentifierOrder<T>(
    _ lhs: T,
    _ rhs: T
  ) -> Bool where T: SourceIdentifiedRoomObservation {
    lhs.sourceIdentifier.uuidString.lowercased() < rhs.sourceIdentifier.uuidString.lowercased()
  }

  private static func edgeOrder(
    _ lhs: C7RoomPlanCompletedEdge,
    _ rhs: C7RoomPlanCompletedEdge
  ) -> Bool {
    let order: [C7RoomPlanCompletedEdge: Int] = [.top: 0, .bottom: 1, .left: 2, .right: 3]
    return order[lhs, default: 4] < order[rhs, default: 4]
  }

  private static func duplicateIdentifiers(in identifiers: [UUID]) -> [UUID] {
    var seen = Set<UUID>()
    var duplicates = Set<UUID>()
    for identifier in identifiers where !seen.insert(identifier).inserted {
      duplicates.insert(identifier)
    }
    return duplicates.sorted {
      $0.uuidString.lowercased() < $1.uuidString.lowercased()
    }
  }
}

private protocol SourceIdentifiedRoomObservation {
  var sourceIdentifier: UUID { get }
}

extension RoomCaptureSurfaceObservation: SourceIdentifiedRoomObservation {}
extension RoomCaptureObjectObservation: SourceIdentifiedRoomObservation {}

private struct NormalizationProblem: Error {
  let abstention: RoomCaptureAbstentionInput

  init(reason: RoomCaptureAbstentionReason, ids: [UUID]) {
    let sortedIds = Array(Set(ids)).sorted {
      $0.uuidString.lowercased() < $1.uuidString.lowercased()
    }
    abstention = RoomCaptureAbstentionInput(
      affectedSourceEntityIds: sortedIds,
      message: Self.message(for: reason),
      reason: reason
    )
  }

  private static func message(for reason: RoomCaptureAbstentionReason) -> String {
    switch reason {
    case .countLimitExceeded:
      "RoomPlan input exceeds a frozen collection bound."
    case .duplicateSourceIdentifier:
      "RoomPlan input contains duplicate source identifiers."
    case .incompatibleWorldOrigin:
      "Rooms do not share one compatible RoomPlan world origin."
    case .invalidCoordinate:
      "RoomPlan input contains an out-of-range coordinate."
    case .invalidDimension:
      "RoomPlan input contains a non-positive or out-of-range dimension."
    case .invalidParentReference:
      "RoomPlan input contains a missing parent source identifier."
    case .invalidRoomReference:
      "RoomPlan input contains an invalid room or measurement reference."
    case .invalidStory:
      "RoomPlan input contains an out-of-range story value."
    case .malformedTransform:
      "RoomPlan input contains a malformed affine transform."
    case .malformedSourceEncoding:
      "RoomPlan source evidence is missing or is not valid encoded Apple evidence."
    case .mixedFixtureEvidence:
      "Synthetic fixture evidence cannot be mixed with physical RoomPlan evidence."
    case .nonFiniteValue:
      "RoomPlan input contains a non-finite floating-point value."
    }
  }
}

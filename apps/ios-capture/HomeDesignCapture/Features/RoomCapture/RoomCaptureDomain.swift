import Foundation

enum RoomCaptureUpdateKind: String, CaseIterable, Codable, Sendable {
  case added
  case changed
  case removed
  case updated
}

struct RoomCaptureLiveUpdate: Equatable, Sendable {
  let kind: RoomCaptureUpdateKind
  let objectCount: Int
  let roomSourceIdentifier: UUID
  let surfaceCount: Int
}

struct RoomCaptureVector3: Equatable, Sendable {
  let x: Double
  let y: Double
  let z: Double

  static let zero = RoomCaptureVector3(x: 0, y: 0, z: 0)
}

/// Column-major 4x4 RoomPlan transform. Keeping the source doubles until this
/// boundary avoids repeated lossy conversion before the frozen integer DTO.
struct RoomCaptureTransform: Equatable, Sendable {
  let columnMajorValues: [Double]

  static let identity = RoomCaptureTransform(columnMajorValues: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ])
}

enum RoomCaptureSurfaceCategory: Equatable, Sendable {
  case door(isOpen: Bool)
  case floor
  case opening
  case wall
  case window
}

enum RoomCaptureObjectCategory: String, Equatable, Sendable {
  case bathtub
  case bed
  case chair
  case dishwasher
  case fireplace
  case oven
  case refrigerator
  case sink
  case sofa
  case stairs
  case storage
  case stove
  case table
  case television
  case toilet
  case unknown
  case washerDryer
}

struct RoomCaptureCurveObservation: Equatable, Sendable {
  let centreXMetres: Double
  let centreZMetres: Double
  let endRadians: Double
  let radiusMetres: Double
  let startRadians: Double
}

struct RoomCaptureSurfaceObservation: Equatable, Sendable {
  let category: RoomCaptureSurfaceCategory
  let completedEdges: Set<C7RoomPlanCompletedEdge>
  let confidence: C7RoomPlanConfidence
  let curve: RoomCaptureCurveObservation?
  let dimensionsMetres: RoomCaptureVector3
  let parentSourceIdentifier: UUID?
  let polygonCornersMetres: [RoomCaptureVector3]
  let sourceIdentifier: UUID
  let story: Int
  let transform: RoomCaptureTransform
}

struct RoomCaptureObjectObservation: Equatable, Sendable {
  let category: RoomCaptureObjectCategory
  let confidence: C7RoomPlanConfidence
  let dimensionsMetres: RoomCaptureVector3
  let parentSourceIdentifier: UUID?
  let sourceIdentifier: UUID
  let story: Int
  let transform: RoomCaptureTransform
}

struct RoomCaptureRoomEvidence: Equatable, Identifiable, Sendable {
  let capturedRoomJSON: Data
  let capturedRoomVersion: Int
  let isSyntheticFixture: Bool
  let objects: [RoomCaptureObjectObservation]
  let rawCapturedRoomDataJSON: Data?
  let roomId: UUID
  let sequence: Int
  let sourceRoomIdentifier: UUID
  let story: Int
  let surfaces: [RoomCaptureSurfaceObservation]
  let usdz: Data?
  let userLabel: String?
  let worldOriginIdentifier: UUID

  var id: UUID { roomId }

  func reviewed(userLabel: String?, story: Int) -> RoomCaptureRoomEvidence {
    RoomCaptureRoomEvidence(
      capturedRoomJSON: capturedRoomJSON,
      capturedRoomVersion: capturedRoomVersion,
      isSyntheticFixture: isSyntheticFixture,
      objects: objects,
      rawCapturedRoomDataJSON: rawCapturedRoomDataJSON,
      roomId: roomId,
      sequence: sequence,
      sourceRoomIdentifier: sourceRoomIdentifier,
      story: story,
      surfaces: surfaces,
      usdz: usdz,
      userLabel: userLabel,
      worldOriginIdentifier: worldOriginIdentifier
    )
  }
}

struct RoomCaptureStructureEvidence: Equatable, Sendable {
  let capturedStructureJSON: Data
  let isSyntheticFixture: Bool
  let rooms: [RoomCaptureRoomEvidence]
  let structureIdentifier: UUID
  let usdz: Data?
  let worldOriginIdentifier: UUID
}

struct RoomCaptureStartRequest: Equatable, Sendable {
  let includeUSDZ: Bool
  let roomSequence: Int
  let continuingWorldOrigin: UUID?
}

enum RoomCaptureEngineFailure: Error, Equatable, Sendable {
  case captureFailed(code: String)
  case deviceUnsupported
  case eventBufferOverflow
  case incompatibleWorldOrigin
  case malformedRoomEvidence
  case structureBuildFailed(code: String)
}

enum RoomCaptureEngineEvent: Equatable, Sendable {
  case failed(RoomCaptureEngineFailure)
  case instruction(C7CaptureInstruction)
  case interrupted
  case relocalisationBegan
  case relocalisationSucceeded
  case roomCompleted(RoomCaptureRoomEvidence)
  case roomUpdate(RoomCaptureLiveUpdate)
  case started(worldOriginIdentifier: UUID)
  case structureCompleted(RoomCaptureStructureEvidence)
  case worldMappingChanged(C7WorldMappingStatus)
}

@MainActor
protocol RoomCaptureEngine: AnyObject {
  var events: AsyncStream<RoomCaptureEngineEvent> { get }

  func buildStructure(from rooms: [RoomCaptureRoomEvidence]) async throws
  func discardRoom(_ roomId: UUID) async
  func safeRestart() async
  func startRoom(_ request: RoomCaptureStartRequest) async throws
  func stopRoom(pauseARSession: Bool) async
}

enum RoomCaptureFindingSeverity: String, Codable, Equatable, Sendable {
  case error
  case information
  case warning
}

struct RoomCaptureFinding: Codable, Equatable, Sendable {
  let affectedSourceEntityIds: [UUID]
  let code: String
  let message: String
  let severity: RoomCaptureFindingSeverity
}

enum RoomCaptureAbstentionReason: String, Codable, Equatable, Sendable {
  case countLimitExceeded = "COUNT_LIMIT_EXCEEDED"
  case duplicateSourceIdentifier = "DUPLICATE_SOURCE_IDENTIFIER"
  case incompatibleWorldOrigin = "INCOMPATIBLE_WORLD_ORIGIN"
  case invalidCoordinate = "INVALID_COORDINATE"
  case invalidDimension = "INVALID_DIMENSION"
  case invalidParentReference = "INVALID_PARENT_REFERENCE"
  case invalidRoomReference = "INVALID_ROOM_REFERENCE"
  case invalidStory = "INVALID_STORY"
  case malformedTransform = "MALFORMED_TRANSFORM"
  case malformedSourceEncoding = "MALFORMED_SOURCE_ENCODING"
  case mixedFixtureEvidence = "MIXED_FIXTURE_EVIDENCE"
  case nonFiniteValue = "NON_FINITE_ROOMPLAN_VALUE"
}

struct RoomCaptureAbstentionInput: Codable, Equatable, Sendable {
  let affectedSourceEntityIds: [UUID]
  let message: String
  let reason: RoomCaptureAbstentionReason
}

struct RoomCaptureSourceMapping: Codable, Equatable, Sendable {
  let normalizedCollection: String
  let normalizedIndex: Int
  let roomId: UUID
  let sourceEntityId: UUID
}

struct RoomCaptureConversionInputs: Codable, Equatable, Sendable {
  let abstentionInputs: [RoomCaptureAbstentionInput]
  let findings: [RoomCaptureFinding]
  let sourceMappings: [RoomCaptureSourceMapping]
}

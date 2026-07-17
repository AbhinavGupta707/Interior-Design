import Foundation

enum C7CaptureContract {
  static let capturePackageSchemaVersion = "c7-capture-package-v1"
  static let captureProposalSchemaVersion = "c7-capture-proposal-v1"
  static let captureSessionSchemaVersion = "c7-capture-session-v1"
  static let normalizedRoomPlanSchemaVersion = "c7-roomplan-normalized-v1"

  static let maximumArtifactBytes: Int64 = 536_870_912
  static let maximumArtifactCount = 256
  static let maximumObjectCount = 10_000
  static let maximumPackageBytes: Int64 = 2_147_483_648
  static let maximumReferenceMeasurements = 100
  static let maximumRoomCount = 64
  static let maximumSurfaceCount = 10_000
  static let maximumUploadPartCount = 10_000
  static let uploadPartSizeBytes = 8_388_608
}

enum C7CaptureMode: String, Codable, Sendable {
  case singleRoom = "single-room"
  case structure
}

enum C7RightsBasis: String, Codable, Sendable {
  case licensed
  case ownedByUser = "owned-by-user"
  case permissionGranted = "permission-granted"
  case publicDomain = "public-domain"
}

struct C7CaptureRights: Codable, Equatable, Sendable {
  let basis: C7RightsBasis
  let serviceProcessingConsent: Bool
  let trainingUseConsent: String

  init(basis: C7RightsBasis, serviceProcessingConsent: Bool) {
    self.basis = basis
    self.serviceProcessingConsent = serviceProcessingConsent
    trainingUseConsent = "denied"
  }
}

struct C7CreateCaptureSessionRequest: Codable, Equatable, Sendable {
  let captureLabel: String
  let deviceCapability: String
  let expectedRoomCount: Int?
  let mode: C7CaptureMode
  let rights: C7CaptureRights

  init(
    captureLabel: String,
    expectedRoomCount: Int?,
    mode: C7CaptureMode,
    rights: C7CaptureRights
  ) {
    self.captureLabel = captureLabel
    deviceCapability = "roomplan-lidar"
    self.expectedRoomCount = expectedRoomCount
    self.mode = mode
    self.rights = rights
  }
}

struct C7CaptureBrief: Codable, Equatable, Sendable {
  let captureLabel: String
  let captureSessionId: UUID
  let expiresAt: String
  let expectedRoomCount: Int?
  let instructionsVersion: String
  let mode: C7CaptureMode
  let projectId: UUID
  let rights: C7CaptureRights
  let schemaVersion: String
}

enum C7ServerCaptureState: String, Codable, Sendable {
  case abstained
  case cancelRequested = "cancel-requested"
  case cancelled
  case created
  case failed
  case processing
  case proposed
  case uploaded
  case uploading
}

struct C7CaptureSession: Codable, Equatable, Identifiable, Sendable {
  let brief: C7CaptureBrief
  let createdAt: String
  let id: UUID
  let packageId: UUID?
  let projectId: UUID
  let proposalId: UUID?
  let retryable: Bool
  let safeCode: String?
  let schemaVersion: String
  let state: C7ServerCaptureState
  let updatedAt: String
  let version: Int
}

enum C7CaptureInstruction: String, CaseIterable, Codable, Sendable {
  case lowTexture = "low-texture"
  case moveAwayFromWall = "move-away-from-wall"
  case moveCloseToWall = "move-close-to-wall"
  case normal
  case slowDown = "slow-down"
  case turnOnLight = "turn-on-light"
}

enum C7WorldMappingStatus: String, Codable, Sendable {
  case extending
  case limited
  case mapped
  case notAvailable = "not-available"
}

struct C7CaptureQualityManifest: Codable, Equatable, Sendable {
  let heuristicName: String
  let heuristicVersion: String
  let instructionCounts: [C7CaptureInstruction: Int]
  let interruptionCount: Int
  let lowConfidenceObjectCount: Int
  let lowConfidenceSurfaceCount: Int
  let relocalisationAttemptCount: Int
  let relocalisationSuccessCount: Int
  let scanDurationMilliseconds: Int
  let worldMappingStatusAtFinish: C7WorldMappingStatus
}

enum C7ReferenceMeasurementMethod: String, Codable, Sendable {
  case laser
  case tape
  case userEntered = "user-entered"
}

struct C7ReferenceMeasurement: Codable, Equatable, Identifiable, Sendable {
  let distanceMillimetres: Int
  let fromSourceEntityId: UUID
  let measurementId: UUID
  let method: C7ReferenceMeasurementMethod
  let toSourceEntityId: UUID

  var id: UUID { measurementId }
}

struct C7CaptureRoomManifest: Codable, Equatable, Identifiable, Sendable {
  let capturedRoomVersion: Int
  let roomId: UUID
  let sequence: Int
  let sourceRoomIdentifier: UUID
  let story: Int
  let userLabel: String?

  var id: UUID { roomId }
}

enum C7CaptureArtifactKind: String, Codable, Sendable {
  case capturedRoomDataJSON = "captured-room-data-json"
  case capturedRoomJSON = "captured-room-json"
  case capturedStructureJSON = "captured-structure-json"
  case qualityManifestJSON = "quality-manifest-json"
  case roomPlanNormalizedJSON = "roomplan-normalized-json"
  case structureUSDZ = "structure-usdz"
}

enum C7CaptureArtifactContentType: String, Codable, Sendable {
  case json = "application/json"
  case usdz = "model/vnd.usdz+zip"
}

struct C7CreateCaptureArtifactUploadRequest: Codable, Equatable, Sendable {
  let byteSize: Int64
  let contentType: C7CaptureArtifactContentType
  let kind: C7CaptureArtifactKind
  let roomId: UUID?
  let sha256: String
}

struct C7CaptureArtifactManifest: Codable, Equatable, Identifiable, Sendable {
  let artifactId: UUID
  let byteSize: Int64
  let contentType: C7CaptureArtifactContentType
  let kind: C7CaptureArtifactKind
  let roomId: UUID?
  let sha256: String

  var id: UUID { artifactId }
}

enum C7ArtifactUploadState: String, Codable, Sendable {
  case aborted
  case completed
  case expired
  case initiated
  case uploading
}

struct C7ArtifactUploadSession: Codable, Equatable, Sendable {
  let artifactId: UUID
  let captureSessionId: UUID
  let expiresAt: String
  let maximumPartCount: Int
  let minimumNonFinalPartSize: Int
  let partSize: Int
  let recordedPartNumbers: [Int]
  let state: C7ArtifactUploadState
  let uploadSessionId: UUID
}

struct C7SignArtifactPartRequest: Codable, Equatable, Sendable {
  let byteSize: Int
  let checksumSha256: String
  let partNumber: Int
}

struct C7SignedArtifactPart: Codable, Equatable, Sendable {
  let expiresAt: String
  let partNumber: Int
  let requiredHeaders: [String: String]
  let url: URL
}

struct C7CompletedArtifactPart: Codable, Equatable, Sendable {
  let checksumSha256: String
  let etag: String
  let partNumber: Int
}

struct C7CompleteArtifactUploadRequest: Codable, Equatable, Sendable {
  let parts: [C7CompletedArtifactPart]
}

struct C7CaptureDeviceManifest: Codable, Equatable, Sendable {
  let appBuild: String
  let appVersion: String
  let deviceModelIdentifier: String
  let operatingSystemVersion: String
  let roomPlanSupported: Bool
}

struct C7CreateCapturePackageRequest: Codable, Equatable, Sendable {
  let artifacts: [C7CaptureArtifactManifest]
  let captureSessionId: UUID
  let device: C7CaptureDeviceManifest
  let endedAt: String
  let mode: C7CaptureMode
  let projectId: UUID
  let quality: C7CaptureQualityManifest
  let referenceMeasurements: [C7ReferenceMeasurement]
  let rights: C7CaptureRights
  let rooms: [C7CaptureRoomManifest]
  let schemaVersion: String
  let sharedWorldOrigin: Bool
  let startedAt: String
}

struct C7IntegerPoint3: Codable, Equatable, Sendable {
  let x: Int64
  let y: Int64
  let z: Int64
}

struct C7IntegerDimensions3: Codable, Equatable, Sendable {
  let x: Int64
  let y: Int64
  let z: Int64
}

struct C7RoomPlanTransform: Codable, Equatable, Sendable {
  let basisNanounits: [Int64]
  let translationMicrometres: C7IntegerPoint3
}

enum C7RoomPlanConfidence: String, Codable, Sendable {
  case high
  case low
  case medium
}

enum C7RoomPlanSurfaceCategory: String, Codable, Sendable {
  case doorClosed = "door-closed"
  case doorOpen = "door-open"
  case floor
  case opening
  case wall
  case window
}

enum C7RoomPlanCompletedEdge: String, Codable, Sendable {
  case bottom
  case left
  case right
  case top
}

struct C7RoomPlanCurve: Codable, Equatable, Sendable {
  let centreXMicrometres: Int64
  let centreZMicrometres: Int64
  let endNanoradians: Int64
  let radiusMicrometres: Int64
  let startNanoradians: Int64
}

struct C7NormalizedRoomPlanSurface: Codable, Equatable, Sendable {
  let category: C7RoomPlanSurfaceCategory
  let completedEdges: [C7RoomPlanCompletedEdge]
  let confidence: C7RoomPlanConfidence
  let curve: C7RoomPlanCurve?
  let dimensionsMicrometres: C7IntegerDimensions3
  let parentSourceIdentifier: UUID?
  let polygonCornersMicrometres: [C7IntegerPoint3]
  let roomId: UUID
  let sourceIdentifier: UUID
  let story: Int
  let transform: C7RoomPlanTransform
}

enum C7RoomPlanObjectCategory: String, Codable, Sendable {
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
  case table
  case television
  case toilet
  case unknown
  case washerDryer = "washer-dryer"
}

struct C7NormalizedRoomPlanObject: Codable, Equatable, Sendable {
  let category: C7RoomPlanObjectCategory
  let confidence: C7RoomPlanConfidence
  let dimensionsMicrometres: C7IntegerDimensions3
  let parentSourceIdentifier: UUID?
  let roomId: UUID
  let sourceIdentifier: UUID
  let story: Int
  let transform: C7RoomPlanTransform
}

struct C7RoomPlanCoordinateSystem: Codable, Equatable, Sendable {
  let handedness: String
  let rotationUnit: String
  let source: String
  let translationUnit: String

  static let roomPlanWorld = C7RoomPlanCoordinateSystem(
    handedness: "right",
    rotationUnit: "nanounit-basis",
    source: "roomplan-world",
    translationUnit: "micrometre"
  )
}

struct C7NormalizedRoomPlan: Codable, Equatable, Sendable {
  let captureSessionId: UUID
  let coordinateSystem: C7RoomPlanCoordinateSystem
  let objects: [C7NormalizedRoomPlanObject]
  let projectId: UUID
  let quality: C7CaptureQualityManifest
  let referenceMeasurements: [C7ReferenceMeasurement]
  let rooms: [C7CaptureRoomManifest]
  let schemaVersion: String
  let structureIdentifier: UUID?
  let surfaces: [C7NormalizedRoomPlanSurface]
}

enum C7CaptureContractError: Error, Equatable, Sendable {
  case invalidCoordinate
  case invalidPackage
  case invalidRights
}

enum C7RoomPlanQuantization {
  static func micrometres(fromMetres value: Double) throws -> Int64 {
    try quantize(value, factor: 1_000_000, limit: 1_000_000_000)
  }

  static func nanoradians(fromRadians value: Double) throws -> Int64 {
    try quantize(value, factor: 1_000_000_000, limit: 7_000_000_000)
  }

  static func nanounits(_ value: Double) throws -> Int64 {
    try quantize(value, factor: 1_000_000_000, limit: 1_100_000_000)
  }

  private static func quantize(_ value: Double, factor: Double, limit: Int64) throws -> Int64 {
    guard value.isFinite else { throw C7CaptureContractError.invalidCoordinate }
    let scaled = (value * factor).rounded(.toNearestOrAwayFromZero)
    guard scaled >= Double(-limit), scaled <= Double(limit) else {
      throw C7CaptureContractError.invalidCoordinate
    }
    return Int64(scaled)
  }
}

enum C7CapturePackageValidator {
  static func validate(_ package: C7CreateCapturePackageRequest) throws {
    guard
      package.schemaVersion == C7CaptureContract.capturePackageSchemaVersion,
      package.rights.serviceProcessingConsent,
      package.rights.trainingUseConsent == "denied",
      (1...C7CaptureContract.maximumRoomCount).contains(package.rooms.count),
      (3...C7CaptureContract.maximumArtifactCount).contains(package.artifacts.count),
      package.quality.relocalisationSuccessCount <= package.quality.relocalisationAttemptCount
    else { throw C7CaptureContractError.invalidPackage }

    let roomIds = Set(package.rooms.map(\.roomId))
    let artifactIds = Set(package.artifacts.map(\.artifactId))
    guard roomIds.count == package.rooms.count, artifactIds.count == package.artifacts.count else {
      throw C7CaptureContractError.invalidPackage
    }
    guard package.artifacts.allSatisfy({ artifact in
      artifact.byteSize > 0
        && artifact.byteSize <= C7CaptureContract.maximumArtifactBytes
        && (artifact.roomId.map(roomIds.contains) ?? true)
    }) else { throw C7CaptureContractError.invalidPackage }

    let total = package.artifacts.reduce(Int64(0)) { $0 + $1.byteSize }
    guard total <= C7CaptureContract.maximumPackageBytes else {
      throw C7CaptureContractError.invalidPackage
    }
    for roomId in roomIds {
      guard package.artifacts.filter({
        $0.kind == .capturedRoomJSON && $0.roomId == roomId
      }).count == 1 else { throw C7CaptureContractError.invalidPackage }
    }
    guard package.artifacts.filter({ $0.kind == .roomPlanNormalizedJSON }).count == 1 else {
      throw C7CaptureContractError.invalidPackage
    }
    guard package.artifacts.filter({ $0.kind == .qualityManifestJSON }).count == 1 else {
      throw C7CaptureContractError.invalidPackage
    }
    if package.mode == .structure {
      guard
        package.sharedWorldOrigin,
        package.artifacts.filter({ $0.kind == .capturedStructureJSON }).count == 1
      else { throw C7CaptureContractError.invalidPackage }
    }
  }
}

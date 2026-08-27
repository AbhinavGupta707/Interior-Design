import Foundation

enum C14_8CaptureContract {
  static let envelopeSchemaVersion = "capture-envelope-v1"
  static let localJournalSchemaVersion = "c14-8-guided-capture-journal-v1"
  static let maximumCameraSamples = 10_000
  static let maximumRooms = 64
  static let maximumDurationMicroseconds: Int64 = 21_600_000_000
}

enum C14_8CaptureRuntime: String, Codable, Sendable {
  case physicalDevice = "physical-device"
  case simulatorFixture = "simulator-fixture"
}

enum C14_8CaptureQualityTier: String, Codable, Sendable {
  case guidedRGB = "guided-rgb"
  case guidedRGBDepth = "guided-rgb-depth"
  case guidedRGBDepthRoomPlan = "guided-rgb-depth-roomplan"
  case simulatorFixture = "simulator-fixture"
}

struct C14_8CapabilityDeclaration: Codable, Equatable, Sendable {
  let appBuild: String
  let appVersion: String
  let arWorldTracking: Bool
  let cameraIntrinsics: Bool
  let cameraPoses: Bool
  let deviceModelIdentifier: String
  let operatingSystemVersion: String
  let qualityTier: C14_8CaptureQualityTier
  let rgbKeyframes: Bool
  let rgbVideo: Bool
  let roomPlan: Bool
  let runtime: C14_8CaptureRuntime
  let sceneDepth: Bool
  let schemaVersion: String

  var qualityExplanation: String {
    switch qualityTier {
    case .guidedRGB:
      "Guided RGB with ARKit poses and camera intrinsics. LiDAR is not required."
    case .guidedRGBDepth:
      "Guided RGB, ARKit poses and intrinsics, plus synchronized scene depth."
    case .guidedRGBDepthRoomPlan:
      "Guided RGB and scene depth are available; RoomPlan can be added as separate evidence."
    case .simulatorFixture:
      "Synthetic journey fixture only. No physical camera, tracking, depth or RoomPlan claim."
    }
  }
}

enum C14_8HorizontalSector: String, CaseIterable, Codable, Identifiable, Sendable {
  case north
  case northEast = "north-east"
  case east
  case southEast = "south-east"
  case south
  case southWest = "south-west"
  case west
  case northWest = "north-west"

  var id: String { rawValue }
}

enum C14_8VerticalBand: String, CaseIterable, Codable, Identifiable, Sendable {
  case lower
  case middle
  case upper

  var id: String { rawValue }
}

enum C14_8CoverageStatus: String, Codable, Sendable {
  case missing
  case observed
  case occluded
  case unknown
}

struct C14_8CoverageCell: Codable, Equatable, Hashable, Identifiable, Sendable {
  let horizontalSector: C14_8HorizontalSector
  var status: C14_8CoverageStatus
  let verticalBand: C14_8VerticalBand

  var id: String { "\(horizontalSector.rawValue):\(verticalBand.rawValue)" }
}

enum C14_8SemanticLayer: String, CaseIterable, Codable, Identifiable, Sendable {
  case appearance
  case fixedFittings = "fixed-fittings"
  case movableFurniture = "movable-furniture"
  case structuralEvidence = "structural-evidence"
  case temporaryClutter = "temporary-clutter"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .appearance: "Appearance"
    case .fixedFittings: "Fixed fittings"
    case .movableFurniture: "Movable furniture"
    case .structuralEvidence: "Structural evidence"
    case .temporaryClutter: "Temporary clutter"
    }
  }
}

enum C14_8SemanticStatus: String, CaseIterable, Codable, Identifiable, Sendable {
  case observed
  case partiallyObserved = "partially-observed"
  case occluded
  case unknown

  var id: String { rawValue }
  var title: String { rawValue.replacingOccurrences(of: "-", with: " ").capitalized }
}

struct C14_8SemanticDeclaration: Codable, Equatable, Sendable {
  let layer: C14_8SemanticLayer
  let provenance: String
  var status: C14_8SemanticStatus
}

struct C14_8RoomEnvelope: Codable, Equatable, Identifiable, Sendable {
  var coordinateSegmentIds: [UUID]
  var coverage: [C14_8CoverageCell]
  var label: String
  let roomId: UUID
  var semanticDeclarations: [C14_8SemanticDeclaration]
  let sequence: Int
  var story: Int?

  var id: UUID { roomId }

  static func empty(label: String, sequence: Int, segmentId: UUID) -> Self {
    Self(
      coordinateSegmentIds: [segmentId],
      coverage: C14_8HorizontalSector.allCases.flatMap { sector in
        C14_8VerticalBand.allCases.map {
          C14_8CoverageCell(horizontalSector: sector, status: .missing, verticalBand: $0)
        }
      },
      label: label,
      roomId: UUID(),
      semanticDeclarations: C14_8SemanticLayer.allCases.map {
        C14_8SemanticDeclaration(layer: $0, provenance: "user-asserted", status: .unknown)
      },
      sequence: sequence,
      story: nil
    )
  }
}

enum C14_8SegmentReason: String, Codable, Sendable {
  case initial
  case interruption
  case manualRestart = "manual-restart"
  case relaunch
  case roomTransition = "room-transition"
}

struct C14_8CoordinateSegment: Codable, Equatable, Identifiable, Sendable {
  let coordinateSystem: String
  var endedAtMicroseconds: Int64
  let reason: C14_8SegmentReason
  let segmentId: UUID
  let startedAtMicroseconds: Int64
  let translationUnit: String
  let worldOriginRelationship: String

  var id: UUID { segmentId }
}

enum C14_8TrackingState: String, Codable, Sendable {
  case limitedFeatures = "limited-features"
  case limitedInitializing = "limited-initializing"
  case limitedMotion = "limited-motion"
  case normal
  case unavailable
}

struct C14_8CameraIntrinsics: Codable, Equatable, Sendable {
  let cx: Int64
  let cy: Int64
  let fx: Int64
  let fy: Int64
  let imageHeightPixels: Int
  let imageWidthPixels: Int
}

struct C14_8Translation: Codable, Equatable, Sendable {
  let x: Int64
  let y: Int64
  let z: Int64
}

struct C14_8LocalCameraSample: Codable, Equatable, Identifiable, Sendable {
  let ambientIntensity: Int?
  let blurScoreMillionths: Int
  let cameraIntrinsicsMicropixels: C14_8CameraIntrinsics
  let exposureScoreMillionths: Int
  let intrinsicsModel: String
  let motionScoreMillionths: Int
  let orientation: String
  let poseTransform: String
  let quaternionOrder: String
  let quaternionNanounits: [Int64]
  let roomId: UUID
  let sampleId: UUID
  let segmentId: UUID
  let sourceLocalIdentifier: UUID
  let sourceTimestampMicroseconds: Int64
  let timestampMicroseconds: Int64
  let trackingState: C14_8TrackingState
  let translationMicrometres: C14_8Translation

  var id: UUID { sampleId }
}

struct C14_8DepthHandle: Codable, Equatable, Identifiable, Sendable {
  let byteSize: Int64
  let heightPixels: Int
  let localIdentifier: UUID
  let sampleId: UUID
  let sha256: String
  let widthPixels: Int

  var id: UUID { localIdentifier }
}

struct C14_8CapturedKeyframe: Equatable, Sendable {
  let depthData: Data?
  let depthHeight: Int?
  let depthWidth: Int?
  let sample: C14_8LocalCameraSample
}

struct C14_8GuidedCaptureDraft: Codable, Equatable, Sendable {
  var acceptance: C14_8EnvelopeAcceptance?
  let actorUserId: UUID
  let capabilities: C14_8CapabilityDeclaration
  var captureSession: C7CaptureSession?
  let createdAt: Date
  var depthHandles: [C14_8DepthHandle]
  var depthReceipts: [C14_8DepthUploadReceipt]
  var endedAt: Date?
  var interruptionCount: Int
  var keyframes: [C8LocalMediaHandle]
  var mediaReceipts: [C14_8MediaReceipt]
  let projectId: UUID
  var roomPlanSources: [C14_8RoomPlanSource]
  var rooms: [C14_8RoomEnvelope]
  var samples: [C14_8LocalCameraSample]
  let schemaVersion: String
  var segments: [C14_8CoordinateSegment]
  let tenantId: UUID
  var updatedAt: Date
}

struct C14_8MediaReceipt: Codable, Equatable, Sendable {
  let localIdentifier: UUID
  let receipt: C8ImmutableEvidenceReceipt
  let transferPartCount: Int
}

struct C14_8TransferReceipt: Codable, Equatable, Sendable {
  let partCount: Int
  let reconciledAt: String
  let resumable: Bool
  let state: String
}

struct C14_8MediaSource: Codable, Equatable, Sendable {
  let assetId: UUID
  let byteSize: Int64
  let kind: String
  let mimeType: String
  let sha256: String
  let transfer: C14_8TransferReceipt
}

struct C14_8DepthSource: Codable, Equatable, Sendable {
  let alignment: String
  let artifactId: UUID
  let byteSize: Int64
  let format: String
  let heightPixels: Int
  let sampleIds: [UUID]
  let sha256: String
  let transfer: C14_8TransferReceipt
  let widthPixels: Int
}

struct C14_8CameraSample: Codable, Equatable, Sendable {
  let ambientIntensity: Int?
  let blurScoreMillionths: Int
  let cameraIntrinsicsMicropixels: C14_8CameraIntrinsics
  let exposureScoreMillionths: Int
  let intrinsicsModel: String
  let motionScoreMillionths: Int
  let orientation: String
  let poseTransform: String
  let quaternionOrder: String
  let quaternionNanounits: [Int64]
  let roomId: UUID
  let sampleId: UUID
  let segmentId: UUID
  let sourceAssetId: UUID
  let sourceTimestampMicroseconds: Int64
  let timestampMicroseconds: Int64
  let trackingState: C14_8TrackingState
  let translationMicrometres: C14_8Translation
}

struct C14_8QualitySummary: Codable, Equatable, Sendable {
  let interruptionCount: Int
  let lowLightSampleCount: Int
  let missingCoverageCellCount: Int
  let motionWarningSampleCount: Int
  let occludedCoverageCellCount: Int
  let trackingLimitedSampleCount: Int
  let unusableBlurSampleCount: Int
}

struct C14_8CaptureRights: Codable, Equatable, Sendable {
  let basis: EvidenceRightsBasis
  let serviceProcessingConsent: Bool
  let trainingUseConsent: TrainingUseConsent
}

struct C14_8EnvelopeGenerator: Codable, Equatable, Sendable {
  let name: String
  let version: String
}

struct C14_8CaptureEnvelopeRequest: Codable, Equatable, Sendable {
  let cameraSamples: [C14_8CameraSample]
  let capabilities: C14_8CapabilityDeclaration
  let captureSessionId: UUID
  let coordinateSegments: [C14_8CoordinateSegment]
  let depthSources: [C14_8DepthSource]
  let endedAt: String
  let generator: C14_8EnvelopeGenerator
  let intent: String
  let mediaSources: [C14_8MediaSource]
  let projectId: UUID
  let quality: C14_8QualitySummary
  let rights: C14_8CaptureRights
  let roomPlanSources: [C14_8RoomPlanSource]
  let rooms: [C14_8RoomEnvelope]
  let schemaVersion: String
  let startedAt: String
  let transferState: String
}

struct C14_8RoomPlanSource: Codable, Equatable, Sendable {
  let captureSessionId: UUID
  let packageId: UUID
  let packageManifestSha256: String
}

struct C14_8EnvelopeAcceptance: Codable, Equatable, Sendable {
  let acceptedAt: String
  let acceptedBy: UUID
  let captureSessionId: UUID
  let envelopeId: UUID
  let envelopeSha256: String
  let projectId: UUID
  let schemaVersion: String
}

struct C14_8EnvelopeRecord: Codable, Equatable, Sendable {
  let acceptance: C14_8EnvelopeAcceptance
  let envelope: C14_8CaptureEnvelopeRequest
}

struct C14_8DepthUploadReceipt: Codable, Equatable, Sendable {
  let artifactId: UUID
  let byteSize: Int64
  let heightPixels: Int
  let partCount: Int
  let reconciledAt: String
  let sampleId: UUID
  let sha256: String
  let widthPixels: Int
}

struct C14_8EnvelopeReconstruction: Codable, Equatable, Sendable {
  let captureSessionId: UUID
  let envelopeId: UUID
  let envelopeSha256: String
  let projectId: UUID
  let reconstructionJob: C14_7ReconstructionJob
  let schemaVersion: String
}

enum C14_8ContractError: Error, Equatable, Sendable {
  case incompleteCoverageDeclaration
  case invalidCapability
  case invalidEvidence
  case invalidScope
  case overBudget
  case staleOperation
}

enum C14_8ContractValidator {
  static func validate(draft: C14_8GuidedCaptureDraft) throws {
    let keyframeIds = Set(draft.keyframes.map(\.localIdentifier))
    let roomIds = Set(draft.rooms.map(\.roomId))
    let segmentIds = Set(draft.segments.map(\.segmentId))
    let sampleIds = Set(draft.samples.map(\.sampleId))
    let sampleTimestamps = Set(
      draft.samples.map { "\($0.segmentId.uuidString):\($0.timestampMicroseconds)" }
    )
    let roomPlanSourceIds = Set(
      draft.roomPlanSources.map { "\($0.captureSessionId.uuidString):\($0.packageId.uuidString)" }
    )
    let elapsedMicroseconds = max(
      1,
      Int64(
        ((draft.endedAt ?? draft.updatedAt).timeIntervalSince(draft.createdAt) * 1_000_000).rounded()
      )
    )
    guard draft.schemaVersion == C14_8CaptureContract.localJournalSchemaVersion,
      !draft.rooms.isEmpty,
      draft.rooms.count <= C14_8CaptureContract.maximumRooms,
      !draft.segments.isEmpty,
      draft.samples.count <= C14_8CaptureContract.maximumCameraSamples,
      draft.samples.count == draft.keyframes.count,
      keyframeIds.count == draft.keyframes.count,
      sampleIds.count == draft.samples.count,
      sampleTimestamps.count == draft.samples.count,
      segmentIds.count == draft.segments.count,
      roomIds.count == draft.rooms.count,
      roomPlanSourceIds.count == draft.roomPlanSources.count,
      draft.roomPlanSources.count <= C14_8CaptureContract.maximumRooms,
      (draft.roomPlanSources.isEmpty || draft.capabilities.roomPlan),
      draft.updatedAt >= draft.createdAt,
      draft.endedAt.map({ $0 >= draft.createdAt }) ?? true,
      draft.endedAt.map({ $0.timeIntervalSince(draft.createdAt) <= 21_600 }) ?? true
    else { throw C14_8ContractError.overBudget }
    guard draft.rooms.allSatisfy({ room in
      room.coverage.count == 24
        && Set(room.coverage.map(\.id)).count == 24
        && room.semanticDeclarations.count == C14_8SemanticLayer.allCases.count
        && Set(room.semanticDeclarations.map(\.layer)).count
          == C14_8SemanticLayer.allCases.count
        && !room.coordinateSegmentIds.isEmpty
        && Set(room.coordinateSegmentIds).count == room.coordinateSegmentIds.count
        && room.coordinateSegmentIds.allSatisfy(segmentIds.contains)
    }) else { throw C14_8ContractError.incompleteCoverageDeclaration }
    guard segmentIds.allSatisfy({ segmentId in
      draft.rooms.contains(where: { $0.coordinateSegmentIds.contains(segmentId) })
    }),
      draft.segments.allSatisfy({ segment in
        segment.coordinateSystem == "arkit-right-handed-y-up"
          && segment.translationUnit == "micrometres"
          && segment.startedAtMicroseconds >= 0
          && segment.endedAtMicroseconds > segment.startedAtMicroseconds
          && segment.endedAtMicroseconds <= elapsedMicroseconds + 1
          && segment.endedAtMicroseconds <= C14_8CaptureContract.maximumDurationMicroseconds
          && segment.worldOriginRelationship == "independent-unless-later-registered"
      }),
      draft.samples.allSatisfy({ sample in
        let room = draft.rooms.first(where: { $0.roomId == sample.roomId })
        let segment = draft.segments.first(where: { $0.segmentId == sample.segmentId })
        let quaternionLength = sqrt(
          sample.quaternionNanounits.reduce(0.0) { result, value in
            result + Double(value) * Double(value)
          }
        )
        return roomIds.contains(sample.roomId)
          && segmentIds.contains(sample.segmentId)
          && room?.coordinateSegmentIds.contains(sample.segmentId) == true
          && segment.map {
            sample.timestampMicroseconds >= $0.startedAtMicroseconds
              && sample.timestampMicroseconds <= $0.endedAtMicroseconds
          } == true
          && keyframeIds.contains(sample.sourceLocalIdentifier)
          && sample.timestampMicroseconds >= 0
          && sample.timestampMicroseconds <= C14_8CaptureContract.maximumDurationMicroseconds
          && sample.sourceTimestampMicroseconds >= 0
          && sample.sourceTimestampMicroseconds <= C14_8CaptureContract.maximumDurationMicroseconds
          && sample.intrinsicsModel == "pinhole-native-camera-raster"
          && sample.poseTransform == "camera-to-world"
          && sample.quaternionOrder == "x-y-z-w"
          && sample.quaternionNanounits.count == 4
          && quaternionLength >= 990_000_000
          && quaternionLength <= 1_010_000_000
          && sample.cameraIntrinsicsMicropixels.cx >= 0
          && sample.cameraIntrinsicsMicropixels.cy >= 0
          && sample.cameraIntrinsicsMicropixels.cx
            < Int64(sample.cameraIntrinsicsMicropixels.imageWidthPixels) * 1_000_000
          && sample.cameraIntrinsicsMicropixels.cy
            < Int64(sample.cameraIntrinsicsMicropixels.imageHeightPixels) * 1_000_000
          && sample.cameraIntrinsicsMicropixels.fx > 0
          && sample.cameraIntrinsicsMicropixels.fy > 0
      }),
      Set(draft.samples.map(\.sourceLocalIdentifier)) == keyframeIds,
      Set(draft.depthHandles.map(\.localIdentifier)).count == draft.depthHandles.count,
      Set(draft.depthHandles.map(\.sampleId)).count == draft.depthHandles.count,
      draft.depthHandles.allSatisfy({ handle in
        sampleIds.contains(handle.sampleId)
          && handle.widthPixels > 0 && handle.widthPixels <= 4_096
          && handle.heightPixels > 0 && handle.heightPixels <= 4_096
          && handle.byteSize
            == Int64(handle.widthPixels * handle.heightPixels * MemoryLayout<Float32>.size)
      }),
      Set(draft.mediaReceipts.map(\.localIdentifier)).count == draft.mediaReceipts.count,
      draft.mediaReceipts.allSatisfy({ mediaReceipt in
        draft.keyframes.contains(where: {
          $0.localIdentifier == mediaReceipt.localIdentifier
            && $0.byteSize == mediaReceipt.receipt.byteSize
            && $0.sha256 == mediaReceipt.receipt.sha256
            && mediaReceipt.receipt.projectId == draft.projectId
            && mediaReceipt.receipt.trainingUseConsent == .denied
        })
      }),
      Set(draft.depthReceipts.map(\.sampleId)).count == draft.depthReceipts.count,
      draft.depthReceipts.allSatisfy({ receipt in
        draft.depthHandles.contains(where: {
          $0.sampleId == receipt.sampleId
            && $0.byteSize == receipt.byteSize
            && $0.sha256 == receipt.sha256
            && $0.widthPixels == receipt.widthPixels
            && $0.heightPixels == receipt.heightPixels
        })
      }),
      draft.roomPlanSources.allSatisfy({ source in
        source.captureSessionId != draft.captureSession?.id
          && source.packageManifestSha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression)
            != nil
      })
    else { throw C14_8ContractError.invalidEvidence }
    let capability = draft.capabilities
    let physicalCapabilityValid = capability.runtime == .physicalDevice
      && capability.arWorldTracking
      && capability.cameraIntrinsics
      && capability.cameraPoses
      && capability.rgbKeyframes
      && capability.qualityTier != .simulatorFixture
      && (
        (capability.qualityTier == .guidedRGB && !capability.sceneDepth)
          || (capability.qualityTier == .guidedRGBDepth
            && capability.sceneDepth && !capability.roomPlan)
          || (capability.qualityTier == .guidedRGBDepthRoomPlan
            && capability.sceneDepth && capability.roomPlan)
      )
    let fixtureCapabilityValid = capability.runtime == .simulatorFixture
      && capability.qualityTier == .simulatorFixture
      && !capability.arWorldTracking
      && !capability.cameraIntrinsics
      && !capability.cameraPoses
      && !capability.sceneDepth
      && !capability.roomPlan
    guard physicalCapabilityValid || fixtureCapabilityValid
    else { throw C14_8ContractError.invalidCapability }
    if let session = draft.captureSession {
      guard session.projectId == draft.projectId,
        session.brief.projectId == draft.projectId,
        session.brief.captureSessionId == session.id,
        session.brief.rights.trainingUseConsent == "denied",
        session.brief.rights.serviceProcessingConsent,
        session.brief.deviceCapability
          == (capability.sceneDepth
            ? C7CaptureDeviceCapability.arkitRGBDepth.rawValue
            : C7CaptureDeviceCapability.arkitRGB.rawValue)
      else { throw C14_8ContractError.invalidScope }
    }
    if let acceptance = draft.acceptance {
      guard let session = draft.captureSession,
        acceptance.captureSessionId == session.id,
        acceptance.projectId == draft.projectId,
        draft.endedAt != nil,
        draft.mediaReceipts.count == draft.keyframes.count,
        draft.depthReceipts.count == draft.depthHandles.count
      else { throw C14_8ContractError.invalidScope }
    }
  }
}

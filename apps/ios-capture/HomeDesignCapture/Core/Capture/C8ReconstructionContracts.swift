import Foundation

enum C8ReconstructionContract {
  static let jobSchemaVersion = "c8-reconstruction-job-v1"
  static let mediaPreparationSchemaVersion = "c8-media-preparation-v1"
  static let maximumFramePixels = 50_000_000
  static let maximumSourceAssetBytes: Int64 = 21_474_836_480
  static let maximumSourceAssetCount = 512
}

enum C8MediaCaptureKind: String, CaseIterable, Codable, Identifiable, Sendable {
  case photo
  case video

  var id: String { rawValue }

  var title: String {
    switch self {
    case .photo: "Guided photos"
    case .video: "Guided video"
    }
  }
}

enum C8ReconstructionSourceKind: String, Codable, Sendable {
  case rgbImage = "rgb-image"
  case rgbVideo = "rgb-video"
}

enum C8MediaMIMEType: String, Codable, Sendable {
  case heic = "image/heic"
  case jpeg = "image/jpeg"
  case mp4 = "video/mp4"
  case png = "image/png"
  case quickTime = "video/quicktime"

  var evidenceKind: EvidenceKind {
    switch self {
    case .heic, .jpeg, .png: .photograph
    case .mp4, .quickTime: .video
    }
  }

  var reconstructionKind: C8ReconstructionSourceKind {
    switch self {
    case .heic, .jpeg, .png: .rgbImage
    case .mp4, .quickTime: .rgbVideo
    }
  }
}

struct C8MediaRights: Codable, Equatable, Sendable {
  let basis: EvidenceRightsBasis
  let serviceProcessingConsent: Bool
  let trainingUseConsent: TrainingUseConsent

  init(basis: EvidenceRightsBasis, serviceProcessingConsent: Bool) {
    self.basis = basis
    self.serviceProcessingConsent = serviceProcessingConsent
    trainingUseConsent = .denied
  }
}

enum C8CaptureEvidenceOrigin: String, Codable, Sendable {
  case physicalCamera = "physical-camera"
  case syntheticSimulatorFixture = "synthetic-simulator-fixture"
}

struct C8LocalMediaHandle: Codable, Equatable, Sendable {
  let byteSize: Int64
  let containsDepthData: Bool
  let createdAt: Date
  let localIdentifier: UUID
  let mimeType: C8MediaMIMEType
  let origin: C8CaptureEvidenceOrigin
  let sha256: String
}

struct C8ImmutableEvidenceUpload: Sendable {
  let fileURL: URL
  let handle: C8LocalMediaHandle
  let projectId: UUID
  let rights: C8MediaRights
}

/// Safe handoff from capture to C2. It intentionally contains no local path,
/// object key, signed URL, credential, raw bytes, or canonical-model operation.
struct C8ImmutableEvidenceReceipt: Codable, Equatable, Identifiable, Sendable {
  let assetId: UUID
  let byteSize: Int64
  let declaredMimeType: C8MediaMIMEType
  let projectId: UUID
  let sha256: String
  let status: EvidenceStatus
  let trainingUseConsent: TrainingUseConsent

  var id: UUID { assetId }
}

protocol C8ImmutableEvidenceUploading: Sendable {
  func upload(
    _ request: C8ImmutableEvidenceUpload,
    progress: @escaping @Sendable (Double) async -> Void
  ) async throws -> C8ImmutableEvidenceReceipt
}

struct C8ReadyReconstructionSource: Codable, Equatable, Sendable {
  let assetId: UUID
  let byteSize: Int64
  let detectedMimeType: C8MediaMIMEType
  let kind: C8ReconstructionSourceKind
  let sha256: String
}

enum C8CoverageSector: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
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

enum C8CaptureGuidance: String, Codable, Hashable, Sendable {
  case addParallax = "add-parallax"
  case completeCoverage = "complete-coverage"
  case holdSteady = "hold-steady"
  case improveLighting = "improve-lighting"
  case ready
  case slowDown = "slow-down"
}

struct C8CapturedMediaQuality: Codable, Equatable, Sendable {
  let blurScoreMillionths: Int
  let exposureScoreMillionths: Int
  let guidance: [C8CaptureGuidance]
}

struct C8NativeCaptureQualityManifest: Codable, Equatable, Sendable {
  let coveredSectors: [C8CoverageSector]
  let depthCaptureRequested: Bool
  let depthDeliveredCount: Int
  let interruptionCount: Int
  let media: [C8CapturedMediaQuality]
  let origin: C8CaptureEvidenceOrigin
  let resourcePressureCount: Int
  let schemaVersion: String
  let thermalInterruptionCount: Int

  init(
    coveredSectors: [C8CoverageSector],
    depthCaptureRequested: Bool,
    depthDeliveredCount: Int,
    interruptionCount: Int,
    media: [C8CapturedMediaQuality],
    origin: C8CaptureEvidenceOrigin,
    resourcePressureCount: Int,
    thermalInterruptionCount: Int
  ) {
    self.coveredSectors = coveredSectors
    self.depthCaptureRequested = depthCaptureRequested
    self.depthDeliveredCount = depthDeliveredCount
    self.interruptionCount = interruptionCount
    self.media = media
    self.origin = origin
    self.resourcePressureCount = resourcePressureCount
    schemaVersion = "c8-native-media-quality-v1"
    self.thermalInterruptionCount = thermalInterruptionCount
  }
}

enum C8CaptureContractError: Error, Equatable, Sendable {
  case depthClaimFromFixture
  case invalidHash
  case invalidReceipt
  case invalidRights
  case overBudget
  case sourceNotReady
  case sourceTypeMismatch
}

enum C8ReconstructionContractValidator {
  static func validate(upload: C8ImmutableEvidenceUpload) throws {
    guard upload.rights.serviceProcessingConsent,
      upload.rights.trainingUseConsent == .denied
    else { throw C8CaptureContractError.invalidRights }
    guard upload.handle.byteSize > 0,
      upload.handle.byteSize <= C8ReconstructionContract.maximumSourceAssetBytes
    else { throw C8CaptureContractError.overBudget }
    guard isSHA256(upload.handle.sha256) else {
      throw C8CaptureContractError.invalidHash
    }
    guard !upload.handle.containsDepthData || upload.handle.origin == .physicalCamera else {
      throw C8CaptureContractError.depthClaimFromFixture
    }
  }

  static func readySource(from asset: EvidenceAsset) throws -> C8ReadyReconstructionSource {
    guard asset.status == .ready else { throw C8CaptureContractError.sourceNotReady }
    guard let assetId = UUID(uuidString: asset.id),
      asset.source.byteSize > 0,
      asset.source.byteSize <= C8ReconstructionContract.maximumSourceAssetBytes,
      isSHA256(asset.source.sha256),
      asset.rights.serviceProcessingConsent,
      asset.rights.trainingUseConsent == .denied,
      let detected = asset.detectedMimeType.flatMap(C8MediaMIMEType.init(rawValue:))
    else { throw C8CaptureContractError.invalidReceipt }
    guard detected.evidenceKind == asset.kind else {
      throw C8CaptureContractError.sourceTypeMismatch
    }
    return C8ReadyReconstructionSource(
      assetId: assetId,
      byteSize: asset.source.byteSize,
      detectedMimeType: detected,
      kind: detected.reconstructionKind,
      sha256: asset.source.sha256
    )
  }

  static func validate(manifest: C8NativeCaptureQualityManifest) throws {
    guard manifest.schemaVersion == "c8-native-media-quality-v1" else {
      throw C8CaptureContractError.invalidReceipt
    }
    guard manifest.depthDeliveredCount >= 0,
      manifest.depthDeliveredCount <= manifest.media.count,
      Set(manifest.coveredSectors).count == manifest.coveredSectors.count,
      manifest.media.allSatisfy({
        (0...1_000_000).contains($0.blurScoreMillionths)
          && (0...1_000_000).contains($0.exposureScoreMillionths)
      })
    else { throw C8CaptureContractError.invalidReceipt }
    guard manifest.origin == .physicalCamera || manifest.depthDeliveredCount == 0 else {
      throw C8CaptureContractError.depthClaimFromFixture
    }
  }

  private static func isSHA256(_ value: String) -> Bool {
    let bytes = value.utf8
    return bytes.count == 64
      && bytes.allSatisfy { byte in
        (48...57).contains(byte) || (97...102).contains(byte)
      }
  }
}

import Foundation

enum C7CaptureServiceError: Error, Equatable, Sendable {
  case authenticationExpired
  case cancelled
  case captureExpired
  case checksumBindingMissing
  case checksumMismatch
  case conflict
  case forbidden
  case invalidResponse
  case offline
  case rightsWithdrawn
  case signedURLExpired
  case unavailable
}

extension C7CaptureServiceError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .authenticationExpired:
      "Authentication expired. Sign in again; protected local capture state remains available."
    case .cancelled:
      "The capture was cancelled."
    case .captureExpired:
      "The server-issued capture brief expired. Start a new capture session."
    case .checksumBindingMissing:
      "The signed upload was not bound to the requested checksum. Nothing was transferred."
    case .checksumMismatch:
      "A protected capture artifact no longer matches its recorded checksum. Upload stopped."
    case .conflict:
      "The server and local capture journal disagree. Refresh before retrying."
    case .forbidden:
      "This capture is unavailable for the current project or role. Other projects are not disclosed."
    case .invalidResponse:
      "The capture service response did not match the frozen C7 contract."
    case .offline:
      "You’re offline. Reconnect to reconcile recorded parts and continue."
    case .rightsWithdrawn:
      "Processing rights were withdrawn. Upload and publication are blocked."
    case .signedURLExpired:
      "A short-lived part URL expired before transfer. Retry requests a fresh URL."
    case .unavailable:
      "The capture service is unavailable. Retry when connectivity returns."
    }
  }
}

protocol C7CaptureClock: Sendable {
  func now() -> Date
}

struct C7SystemCaptureClock: C7CaptureClock {
  func now() -> Date { Date() }
}

enum C7ISO8601 {
  static func date(from value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }
    let standard = ISO8601DateFormatter()
    standard.formatOptions = [.withInternetDateTime]
    return standard.date(from: value)
  }

  static func string(from value: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: value)
  }
}

enum C7WorkspaceRole: String, Codable, Equatable, Sendable {
  case editor
  case owner
  case viewer

  var canMutate: Bool { self != .viewer }
}

enum C7JournalPhase: String, Codable, Equatable, Sendable {
  case abstained
  case cancelled
  case cancelPending = "cancel-pending"
  case expired
  case failed
  case interrupted
  case packaging
  case paused
  case permissionRequired = "permission-required"
  case processing
  case proposed
  case ready
  case relocalising
  case review
  case rightsWithdrawn = "rights-withdrawn"
  case scanning
  case sensorRestartRequired = "sensor-restart-required"
  case uploading
}

enum C7JournalRightsState: String, Codable, Equatable, Sendable {
  case granted
  case withdrawalPending = "withdrawal-pending"
  case withdrawn
}

struct C7JournalArtifact: Codable, Equatable, Identifiable, Sendable {
  let manifest: C7CaptureArtifactManifest
  let storageName: String
  var uploadSessionId: UUID?
  var uploadExpiresAt: String?
  var completedParts: [C7CompletedArtifactPart]
  var createUploadKey: String
  let completeUploadKey: String
  var signingGenerations: [Int: Int]
  var uploadAttempt: Int
  var completed: Bool

  var id: UUID { manifest.artifactId }
}

struct C7CaptureSyncSnapshot: Equatable, Sendable {
  let proposal: C7CaptureProposalResult?
  let record: C7CaptureJournalRecord
}

struct C7StoredCaptureReview: Codable, Equatable, Sendable {
  var device: C7CaptureDeviceManifest
  var endedAt: String
  let normalizedArtifactId: UUID
  let normalizedDraftStorageName: String
  var quality: C7CaptureQualityManifest
  let qualityArtifactId: UUID
  var referenceMeasurements: [C7ReferenceMeasurement]
  var rooms: [C7CaptureRoomManifest]
  var rawArtifacts: [C7JournalArtifact]
  let sourceEntityIds: [UUID]
  var sharedWorldOrigin: Bool
  var startedAt: String
}

struct C7StoredCapturePackage: Codable, Equatable, Sendable {
  let manifest: C7CreateCapturePackageRequest
  var artifacts: [C7JournalArtifact]
  let finalizeKey: String
}

struct C7CaptureJournalRecord: Codable, Equatable, Identifiable, Sendable {
  static let schemaVersion = "c7-protected-local-journal-v1"

  let brief: C7CaptureBrief
  let cancelKey: String
  let createdAt: Date
  let id: UUID
  var package: C7StoredCapturePackage?
  var phase: C7JournalPhase
  let projectId: UUID
  var retryCount: Int
  var revision: Int
  var rightsState: C7JournalRightsState
  var review: C7StoredCaptureReview?
  let schemaVersion: String
  var serverVersion: Int
  var updatedAt: Date
}

struct C7CaptureSessionIntent: Codable, Equatable, Sendable {
  static let schemaVersion = "c7-protected-session-intent-v1"

  let createdAt: Date
  let idempotencyKey: String
  let projectId: UUID
  let request: C7CreateCaptureSessionRequest
  let schemaVersion: String
}

struct C7CaptureRawArtifactSource: Equatable, Sendable {
  let artifactId: UUID
  let contentType: C7CaptureArtifactContentType
  let fileURL: URL
  let kind: C7CaptureArtifactKind
  let roomId: UUID?
}

struct C7CaptureReviewDraft: Equatable, Sendable {
  let device: C7CaptureDeviceManifest
  let endedAt: String
  let normalized: C7NormalizedRoomPlan
  let rawArtifacts: [C7CaptureRawArtifactSource]
  let sharedWorldOrigin: Bool
  let startedAt: String
}

enum C7CaptureLifecycleEvent: Equatable, Sendable {
  case interrupted
  case permissionRequired
  case relocalising
  case scanning
}

enum C7CaptureLaunchError: Error, Equatable, Sendable {
  case incompatibleWorldSpace
  case permissionDenied
  case relocalisationFailed
  case terminated
  case unavailable(String)
}

extension C7CaptureLaunchError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .incompatibleWorldSpace:
      "The rooms do not share a confirmed world origin. They cannot be labelled as one structure."
    case .permissionDenied:
      "Camera permission is required for RoomPlan. Use Settings or choose plan, photo, or manual evidence."
    case .relocalisationFailed:
      "The original coordinate space could not be confirmed. Restart this room rather than joining incompatible geometry."
    case .terminated:
      "The live sensor session ended. A terminated RoomPlan session cannot resume authoritatively."
    case .unavailable(let message):
      message
    }
  }
}

protocol C7CaptureLaunching: Sendable {
  func capture(
    brief: C7CaptureBrief,
    onEvent: @escaping @Sendable (C7CaptureLifecycleEvent) async -> Void
  ) async throws -> C7CaptureReviewDraft
}

struct C7UnavailableCaptureLauncher: C7CaptureLaunching {
  func capture(
    brief: C7CaptureBrief,
    onEvent: @escaping @Sendable (C7CaptureLifecycleEvent) async -> Void
  ) async throws -> C7CaptureReviewDraft {
    throw C7CaptureLaunchError.unavailable(
      "The RoomPlan capture engine is not registered in this build. Use plan, photo, or manual evidence."
    )
  }
}

enum C7ProposalFindingSeverity: String, Codable, Sendable {
  case error
  case information
  case warning
}

struct C7ProposalFinding: Codable, Equatable, Identifiable, Sendable {
  let affectedSourceEntityIds: [UUID]
  let code: String
  let message: String
  let severity: C7ProposalFindingSeverity

  var id: String { "\(code)-\(affectedSourceEntityIds.map(\.uuidString).joined(separator: ","))" }
}

struct C7CaptureModelProposalSummary: Codable, Equatable, Sendable {
  let captureSessionId: UUID
  let createdAt: String
  let findings: [C7ProposalFinding]
  let overallConfidence: Int
  let packageId: UUID
  let packageManifestSha256: String
  let projectId: UUID
  let proposalId: UUID
  let schemaVersion: String
  let unresolvedSourceEntityIds: [UUID]
}

enum C7CaptureAbstentionCode: String, Codable, Sendable {
  case ambiguousTopology = "ambiguous-topology"
  case conversionFailed = "conversion-failed"
  case incompatibleWorldSpace = "incompatible-world-space"
  case invalidNormalizedInput = "invalid-normalized-input"
  case lowQuality = "low-quality"
  case resourceLimit = "resource-limit"
  case rightsNotPermitted = "rights-not-permitted"
  case sourceMismatch = "source-mismatch"
  case unsupportedPackage = "unsupported-package"
}

enum C7CaptureNextAction: String, Codable, Sendable {
  case addReferenceMeasurement = "add-reference-measurement"
  case editManually = "edit-manually"
  case rescanRoom = "rescan-room"
  case usePlan = "use-plan"

  var title: String {
    switch self {
    case .addReferenceMeasurement: "Add a reference measurement"
    case .editManually: "Edit manually"
    case .rescanRoom: "Rescan the room"
    case .usePlan: "Use a plan"
    }
  }
}

struct C7CaptureAbstentionSummary: Codable, Equatable, Sendable {
  let captureSessionId: UUID
  let code: C7CaptureAbstentionCode
  let createdAt: String
  let detail: String
  let findings: [C7ProposalFinding]
  let nextActions: [C7CaptureNextAction]
  let packageId: UUID
  let packageManifestSha256: String
  let projectId: UUID
  let proposalId: UUID
  let retryable: Bool
  let schemaVersion: String
}

enum C7CaptureProposalResult: Equatable, Sendable, Decodable {
  case abstained(C7CaptureAbstentionSummary)
  case proposal(C7CaptureModelProposalSummary)

  private enum CodingKeys: String, CodingKey { case status }
  private enum Status: String, Decodable { case abstained, proposal }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Status.self, forKey: .status) {
    case .abstained:
      self = .abstained(try C7CaptureAbstentionSummary(from: decoder))
    case .proposal:
      self = .proposal(try C7CaptureModelProposalSummary(from: decoder))
    }
  }
}

enum C7CaptureDiagnosticEvent: String, Codable, CaseIterable, Sendable {
  case authenticationRejected = "authentication-rejected"
  case backgroundReconciled = "background-reconciled"
  case cancellationRequested = "cancellation-requested"
  case checksumRejected = "checksum-rejected"
  case contractRejected = "contract-rejected"
  case offlinePaused = "offline-paused"
  case partRecorded = "part-recorded"
  case rightsWithdrawn = "rights-withdrawn"
  case sessionRestored = "session-restored"
}

protocol C7CaptureDiagnosticsRecording: Sendable {
  func record(_ event: C7CaptureDiagnosticEvent) async
}

actor C7NoopCaptureDiagnostics: C7CaptureDiagnosticsRecording {
  func record(_ event: C7CaptureDiagnosticEvent) {}
}

enum C7CapturePartReconciler {
  static func reconcile(
    localParts: [C7CompletedArtifactPart],
    serverPartNumbers: [Int]
  ) throws -> [C7CompletedArtifactPart] {
    guard
      serverPartNumbers.count <= C7CaptureContract.maximumUploadPartCount,
      serverPartNumbers.allSatisfy({ (1...C7CaptureContract.maximumUploadPartCount).contains($0) }),
      serverPartNumbers == serverPartNumbers.sorted(),
      Set(serverPartNumbers).count == serverPartNumbers.count
    else {
      throw C7CaptureServiceError.invalidResponse
    }

    let localByNumber = Dictionary(grouping: localParts, by: \.partNumber)
    guard localByNumber.values.allSatisfy({ $0.count == 1 }) else {
      throw C7CaptureServiceError.conflict
    }
    let serverSet = Set(serverPartNumbers)
    return
      localParts
      .filter { serverSet.contains($0.partNumber) }
      .sorted { $0.partNumber < $1.partNumber }
  }
}

enum C7StrictCaptureValidator {
  static func validateSessionRequest(_ request: C7CreateCaptureSessionRequest) throws {
    let label = request.captureLabel.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      (1...120).contains(label.count),
      request.deviceCapability == "roomplan-lidar",
      request.rights.serviceProcessingConsent,
      request.rights.trainingUseConsent == "denied",
      request.expectedRoomCount.map({ (1...C7CaptureContract.maximumRoomCount).contains($0) })
        ?? true,
      request.mode == .structure || request.expectedRoomCount.map({ $0 == 1 }) ?? true
    else {
      throw C7CaptureServiceError.invalidResponse
    }
  }

  static func validateReview(_ draft: C7CaptureReviewDraft, brief: C7CaptureBrief) throws {
    guard
      draft.normalized.schemaVersion == C7CaptureContract.normalizedRoomPlanSchemaVersion,
      draft.normalized.captureSessionId == brief.captureSessionId,
      draft.normalized.projectId == brief.projectId,
      draft.normalized.rooms.count >= 1,
      draft.normalized.rooms.count <= C7CaptureContract.maximumRoomCount,
      draft.normalized.surfaces.count <= C7CaptureContract.maximumSurfaceCount,
      draft.normalized.objects.count <= C7CaptureContract.maximumObjectCount,
      draft.device.roomPlanSupported,
      let started = C7ISO8601.date(from: draft.startedAt),
      let ended = C7ISO8601.date(from: draft.endedAt),
      ended > started,
      ended.timeIntervalSince(started) <= 21_600
    else {
      throw C7CaptureServiceError.invalidResponse
    }
    try C7CaptureQualityEvaluator.validate(draft.normalized.quality)
    if brief.mode == .structure {
      guard draft.sharedWorldOrigin, draft.normalized.structureIdentifier != nil else {
        throw C7CaptureLaunchError.incompatibleWorldSpace
      }
    }

    let roomIds = Set(draft.normalized.rooms.map(\.roomId))
    let entityIds =
      draft.normalized.surfaces.map(\.sourceIdentifier)
      + draft.normalized.objects.map(\.sourceIdentifier)
    guard Set(entityIds).count == entityIds.count else {
      throw C7CaptureServiceError.invalidResponse
    }
    guard
      draft.normalized.surfaces.allSatisfy({ roomIds.contains($0.roomId) })
        && draft.normalized.objects.allSatisfy({ roomIds.contains($0.roomId) })
    else {
      throw C7CaptureServiceError.invalidResponse
    }

    let allowedRawKinds: Set<C7CaptureArtifactKind> = [
      .capturedRoomDataJSON,
      .capturedRoomJSON,
      .capturedStructureJSON,
      .structureUSDZ,
    ]
    guard
      draft.rawArtifacts.count <= C7CaptureContract.maximumArtifactCount - 2,
      Set(draft.rawArtifacts.map(\.artifactId)).count == draft.rawArtifacts.count,
      draft.rawArtifacts.allSatisfy({ allowedRawKinds.contains($0.kind) }),
      draft.rawArtifacts.allSatisfy({ source in
        let expectsRoom = source.kind == .capturedRoomJSON || source.kind == .capturedRoomDataJSON
        return expectsRoom == (source.roomId != nil)
          && (source.roomId.map(roomIds.contains) ?? true)
          && ((source.kind == .structureUSDZ) == (source.contentType == .usdz))
      })
    else {
      throw C7CaptureServiceError.invalidResponse
    }
    for roomId in roomIds {
      guard
        draft.rawArtifacts.filter({
          $0.kind == .capturedRoomJSON && $0.roomId == roomId
        }).count == 1
      else {
        throw C7CaptureServiceError.invalidResponse
      }
    }
    if brief.mode == .structure {
      guard draft.rawArtifacts.filter({ $0.kind == .capturedStructureJSON }).count == 1 else {
        throw C7CaptureServiceError.invalidResponse
      }
    }
  }

  static func validatePackage(_ package: C7CreateCapturePackageRequest) throws {
    try C7CapturePackageValidator.validate(package)
    guard
      let started = C7ISO8601.date(from: package.startedAt),
      let ended = C7ISO8601.date(from: package.endedAt),
      ended > started,
      ended.timeIntervalSince(started) <= 21_600,
      package.referenceMeasurements.count <= C7CaptureContract.maximumReferenceMeasurements,
      package.artifacts.allSatisfy({ artifact in
        artifact.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
          && ((artifact.kind == .structureUSDZ) == (artifact.contentType == .usdz))
      })
    else {
      throw C7CaptureServiceError.invalidResponse
    }
    try C7CaptureQualityEvaluator.validate(package.quality)
    let sequences = package.rooms.map(\.sequence).sorted()
    guard sequences == Array(1...package.rooms.count) else {
      throw C7CaptureServiceError.invalidResponse
    }
    let measurementIds = package.referenceMeasurements.map(\.measurementId)
    guard Set(measurementIds).count == measurementIds.count else {
      throw C7CaptureServiceError.invalidResponse
    }
  }
}

struct C7QualityWireManifest: Encodable, Sendable {
  let heuristicName: String
  let heuristicVersion: String
  let instructionCounts: [String: Int]
  let interruptionCount: Int
  let lowConfidenceObjectCount: Int
  let lowConfidenceSurfaceCount: Int
  let relocalisationAttemptCount: Int
  let relocalisationSuccessCount: Int
  let scanDurationMilliseconds: Int
  let worldMappingStatusAtFinish: C7WorldMappingStatus

  init(_ manifest: C7CaptureQualityManifest) {
    heuristicName = manifest.heuristicName
    heuristicVersion = manifest.heuristicVersion
    instructionCounts = Dictionary(
      uniqueKeysWithValues: manifest.instructionCounts.map { ($0.key.rawValue, $0.value) }
    )
    interruptionCount = manifest.interruptionCount
    lowConfidenceObjectCount = manifest.lowConfidenceObjectCount
    lowConfidenceSurfaceCount = manifest.lowConfidenceSurfaceCount
    relocalisationAttemptCount = manifest.relocalisationAttemptCount
    relocalisationSuccessCount = manifest.relocalisationSuccessCount
    scanDurationMilliseconds = manifest.scanDurationMilliseconds
    worldMappingStatusAtFinish = manifest.worldMappingStatusAtFinish
  }
}

struct C7CreateCapturePackageWireRequest: Encodable, Sendable {
  let artifacts: [C7CaptureArtifactManifest]
  let captureSessionId: UUID
  let device: C7CaptureDeviceManifest
  let endedAt: String
  let mode: C7CaptureMode
  let projectId: UUID
  let quality: C7QualityWireManifest
  let referenceMeasurements: [C7ReferenceMeasurement]
  let rights: C7CaptureRights
  let rooms: [C7CaptureRoomManifest]
  let schemaVersion: String
  let sharedWorldOrigin: Bool
  let startedAt: String

  init(_ package: C7CreateCapturePackageRequest) {
    artifacts = package.artifacts
    captureSessionId = package.captureSessionId
    device = package.device
    endedAt = package.endedAt
    mode = package.mode
    projectId = package.projectId
    quality = C7QualityWireManifest(package.quality)
    referenceMeasurements = package.referenceMeasurements
    rights = package.rights
    rooms = package.rooms
    schemaVersion = package.schemaVersion
    sharedWorldOrigin = package.sharedWorldOrigin
    startedAt = package.startedAt
  }
}

struct C7NormalizedRoomPlanWire: Encodable, Sendable {
  let captureSessionId: UUID
  let coordinateSystem: C7RoomPlanCoordinateSystem
  let objects: [C7NormalizedRoomPlanObject]
  let projectId: UUID
  let quality: C7QualityWireManifest
  let referenceMeasurements: [C7ReferenceMeasurement]
  let rooms: [C7CaptureRoomManifest]
  let schemaVersion: String
  let structureIdentifier: UUID?
  let surfaces: [C7NormalizedRoomPlanSurface]

  init(_ normalized: C7NormalizedRoomPlan) {
    captureSessionId = normalized.captureSessionId
    coordinateSystem = normalized.coordinateSystem
    objects = normalized.objects
    projectId = normalized.projectId
    quality = C7QualityWireManifest(normalized.quality)
    referenceMeasurements = normalized.referenceMeasurements
    rooms = normalized.rooms
    schemaVersion = normalized.schemaVersion
    structureIdentifier = normalized.structureIdentifier
    surfaces = normalized.surfaces
  }
}

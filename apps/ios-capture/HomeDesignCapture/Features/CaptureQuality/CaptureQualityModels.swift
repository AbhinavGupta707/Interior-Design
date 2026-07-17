import Foundation
import Observation

enum C7CaptureQualityError: Error, Equatable, Sendable {
  case countOutOfRange
  case duplicateMeasurement
  case invalidDuration
  case invalidMeasurement
  case measurementLimitReached
  case unknownSourceEntity
}

extension C7CaptureQualityError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .countOutOfRange:
      "A capture quality counter exceeded the C7 safety limit."
    case .duplicateMeasurement:
      "That source pair already has a reference measurement."
    case .invalidDuration:
      "The capture interval must be positive and no longer than six hours."
    case .invalidMeasurement:
      "Enter 1 to 100,000 mm between two different source entities."
    case .measurementLimitReached:
      "This capture already has the maximum 100 reference measurements."
    case .unknownSourceEntity:
      "Both reference points must be visible source entities from this capture."
    }
  }
}

enum C7QualityAttention: String, Codable, Equatable, Sendable {
  case limitedEvidence = "limited-evidence"
  case reviewRecommended = "review-recommended"
  case noHeuristicWarning = "no-heuristic-warning"

  var title: String {
    switch self {
    case .limitedEvidence: "Limited capture evidence"
    case .reviewRecommended: "Review recommended"
    case .noHeuristicWarning: "No heuristic warning"
    }
  }
}

struct C7QualityFinding: Codable, Equatable, Identifiable, Sendable {
  enum Code: String, Codable, Sendable {
    case interruptions
    case lowConfidenceObjects = "low-confidence-objects"
    case lowConfidenceSurfaces = "low-confidence-surfaces"
    case mappingLimited = "mapping-limited"
    case repeatedGuidance = "repeated-guidance"
    case relocalisationUnconfirmed = "relocalisation-unconfirmed"
  }

  let code: Code
  let message: String

  var id: Code { code }
}

struct C7CaptureQualityAssessment: Codable, Equatable, Sendable {
  let attention: C7QualityAttention
  let findings: [C7QualityFinding]

  var limitationText: String {
    "This product heuristic summarises capture conditions only. It does not prove completeness or measurement accuracy."
  }
}

enum C7CaptureQualityEvaluator {
  static func assess(_ manifest: C7CaptureQualityManifest) throws -> C7CaptureQualityAssessment {
    try validate(manifest)
    var findings: [C7QualityFinding] = []

    if manifest.worldMappingStatusAtFinish == .limited
      || manifest.worldMappingStatusAtFinish == .notAvailable
    {
      findings.append(
        C7QualityFinding(
          code: .mappingLimited,
          message:
            "World mapping remained limited. Review connections and dimensions before using the proposal."
        )
      )
    }
    if manifest.lowConfidenceSurfaceCount > 0 {
      findings.append(
        C7QualityFinding(
          code: .lowConfidenceSurfaces,
          message:
            "RoomPlan classified \(manifest.lowConfidenceSurfaceCount) surface observations with low confidence."
        )
      )
    }
    if manifest.lowConfidenceObjectCount > 0 {
      findings.append(
        C7QualityFinding(
          code: .lowConfidenceObjects,
          message:
            "RoomPlan classified \(manifest.lowConfidenceObjectCount) object observations with low confidence."
        )
      )
    }
    if manifest.interruptionCount > 0 {
      findings.append(
        C7QualityFinding(
          code: .interruptions,
          message:
            "The sensor session was interrupted \(manifest.interruptionCount) time(s). Confirm the retained rooms still share the intended origin."
        )
      )
    }
    if manifest.relocalisationSuccessCount < manifest.relocalisationAttemptCount {
      findings.append(
        C7QualityFinding(
          code: .relocalisationUnconfirmed,
          message:
            "At least one relocalisation attempt was not confirmed. A restarted coordinate space cannot be presented as one structure."
        )
      )
    }

    let guidanceCount = manifest.instructionCounts.reduce(0) { partial, item in
      item.key == .normal ? partial : partial + item.value
    }
    if guidanceCount >= 4 {
      findings.append(
        C7QualityFinding(
          code: .repeatedGuidance,
          message:
            "Capture guidance was shown repeatedly. Inspect the affected room rather than treating the count as an accuracy score."
        )
      )
    }

    let severe =
      manifest.worldMappingStatusAtFinish == .notAvailable
      || manifest.worldMappingStatusAtFinish == .limited
      || manifest.relocalisationSuccessCount < manifest.relocalisationAttemptCount
      || manifest.interruptionCount >= 3
      || manifest.lowConfidenceSurfaceCount + manifest.lowConfidenceObjectCount >= 20
    let attention: C7QualityAttention =
      if severe {
        .limitedEvidence
      } else if findings.isEmpty {
        .noHeuristicWarning
      } else {
        .reviewRecommended
      }
    return C7CaptureQualityAssessment(attention: attention, findings: findings)
  }

  static func validate(_ manifest: C7CaptureQualityManifest) throws {
    guard
      manifest.heuristicName == "c7-roomplan-quality",
      !manifest.heuristicVersion.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      manifest.scanDurationMilliseconds > 0,
      manifest.scanDurationMilliseconds <= 21_600_000,
      manifest.interruptionCount >= 0,
      manifest.interruptionCount <= 10_000,
      manifest.relocalisationAttemptCount >= 0,
      manifest.relocalisationAttemptCount <= 10_000,
      manifest.relocalisationSuccessCount >= 0,
      manifest.relocalisationSuccessCount <= manifest.relocalisationAttemptCount,
      manifest.lowConfidenceSurfaceCount >= 0,
      manifest.lowConfidenceSurfaceCount <= C7CaptureContract.maximumSurfaceCount,
      manifest.lowConfidenceObjectCount >= 0,
      manifest.lowConfidenceObjectCount <= C7CaptureContract.maximumObjectCount,
      Set(manifest.instructionCounts.keys) == Set(C7CaptureInstruction.allCases),
      manifest.instructionCounts.values.allSatisfy({ (0...1_000_000).contains($0) })
    else {
      throw C7CaptureQualityError.countOutOfRange
    }
  }
}

struct C7CaptureQualityAccumulator: Equatable, Sendable {
  private(set) var instructionCounts: [C7CaptureInstruction: Int]
  private(set) var interruptionCount = 0
  private(set) var relocalisationAttemptCount = 0
  private(set) var relocalisationSuccessCount = 0

  init() {
    instructionCounts = Dictionary(
      uniqueKeysWithValues: C7CaptureInstruction.allCases.map { ($0, 0) }
    )
  }

  mutating func record(instruction: C7CaptureInstruction) throws {
    let value = instructionCounts[instruction, default: 0]
    guard value < 1_000_000 else { throw C7CaptureQualityError.countOutOfRange }
    instructionCounts[instruction] = value + 1
  }

  mutating func recordInterruption() throws {
    guard interruptionCount < 10_000 else { throw C7CaptureQualityError.countOutOfRange }
    interruptionCount += 1
  }

  mutating func recordRelocalisation(succeeded: Bool) throws {
    guard relocalisationAttemptCount < 10_000 else {
      throw C7CaptureQualityError.countOutOfRange
    }
    relocalisationAttemptCount += 1
    if succeeded { relocalisationSuccessCount += 1 }
  }

  func manifest(
    startedAt: Date,
    endedAt: Date,
    lowConfidenceObjectCount: Int,
    lowConfidenceSurfaceCount: Int,
    worldMappingStatusAtFinish: C7WorldMappingStatus,
    heuristicVersion: String = "1.0.0"
  ) throws -> C7CaptureQualityManifest {
    let duration = endedAt.timeIntervalSince(startedAt) * 1_000
    guard duration.isFinite, duration >= 1, duration <= 21_600_000 else {
      throw C7CaptureQualityError.invalidDuration
    }
    let result = C7CaptureQualityManifest(
      heuristicName: "c7-roomplan-quality",
      heuristicVersion: heuristicVersion,
      instructionCounts: instructionCounts,
      interruptionCount: interruptionCount,
      lowConfidenceObjectCount: lowConfidenceObjectCount,
      lowConfidenceSurfaceCount: lowConfidenceSurfaceCount,
      relocalisationAttemptCount: relocalisationAttemptCount,
      relocalisationSuccessCount: relocalisationSuccessCount,
      scanDurationMilliseconds: Int(duration.rounded(.toNearestOrAwayFromZero)),
      worldMappingStatusAtFinish: worldMappingStatusAtFinish
    )
    try C7CaptureQualityEvaluator.validate(result)
    return result
  }
}

struct C7ReferenceMeasurementDraft: Equatable, Sendable {
  var distanceText = ""
  var fromSourceEntityId: UUID?
  var method: C7ReferenceMeasurementMethod = .tape
  var toSourceEntityId: UUID?
}

enum C7ReferenceMeasurementValidator {
  static func makeMeasurement(
    draft: C7ReferenceMeasurementDraft,
    measurementId: UUID,
    allowedSourceEntityIds: Set<UUID>,
    existing: [C7ReferenceMeasurement]
  ) throws -> C7ReferenceMeasurement {
    guard existing.count < C7CaptureContract.maximumReferenceMeasurements else {
      throw C7CaptureQualityError.measurementLimitReached
    }
    guard
      let from = draft.fromSourceEntityId,
      let to = draft.toSourceEntityId,
      from != to,
      let distance = Int(draft.distanceText.trimmingCharacters(in: .whitespacesAndNewlines)),
      (1...100_000).contains(distance)
    else {
      throw C7CaptureQualityError.invalidMeasurement
    }
    guard allowedSourceEntityIds.contains(from), allowedSourceEntityIds.contains(to) else {
      throw C7CaptureQualityError.unknownSourceEntity
    }
    let duplicate = existing.contains { measurement in
      (measurement.fromSourceEntityId == from && measurement.toSourceEntityId == to)
        || (measurement.fromSourceEntityId == to && measurement.toSourceEntityId == from)
    }
    guard !duplicate, !existing.contains(where: { $0.measurementId == measurementId }) else {
      throw C7CaptureQualityError.duplicateMeasurement
    }
    return C7ReferenceMeasurement(
      distanceMillimetres: distance,
      fromSourceEntityId: from,
      measurementId: measurementId,
      method: draft.method,
      toSourceEntityId: to
    )
  }
}

@MainActor
@Observable
final class C7ReferenceMeasurementModel {
  private(set) var measurements: [C7ReferenceMeasurement]
  private(set) var validationMessage: String?
  var draft = C7ReferenceMeasurementDraft()

  @ObservationIgnored private var allowedSourceEntityIds: Set<UUID>
  @ObservationIgnored private let idGenerator: @MainActor @Sendable () -> UUID

  init(
    allowedSourceEntityIds: Set<UUID> = [],
    measurements: [C7ReferenceMeasurement] = [],
    idGenerator: @escaping @MainActor @Sendable () -> UUID = UUID.init
  ) {
    self.allowedSourceEntityIds = allowedSourceEntityIds
    self.measurements = measurements
    self.idGenerator = idGenerator
  }

  func replaceSources(_ sourceIds: Set<UUID>, measurements: [C7ReferenceMeasurement]) {
    allowedSourceEntityIds = sourceIds
    self.measurements = measurements
    validationMessage = nil
    draft = C7ReferenceMeasurementDraft()
  }

  func add() {
    do {
      let measurement = try C7ReferenceMeasurementValidator.makeMeasurement(
        draft: draft,
        measurementId: idGenerator(),
        allowedSourceEntityIds: allowedSourceEntityIds,
        existing: measurements
      )
      measurements.append(measurement)
      measurements.sort { $0.measurementId.uuidString < $1.measurementId.uuidString }
      validationMessage = nil
      draft = C7ReferenceMeasurementDraft()
    } catch {
      validationMessage = error.localizedDescription
    }
  }

  func remove(id: UUID) {
    measurements.removeAll { $0.measurementId == id }
    validationMessage = nil
  }
}

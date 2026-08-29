import Foundation

enum C14_10KeyframeRetentionMode: String, Codable, Equatable, Sendable {
  case automatic
  case manual
}

enum C14_10SpatialCapturePolicy {
  static let automaticIntervalMicroseconds: Int64 = 2_000_000
  static let maximumKeyframesPerEnvelope = 512
  static let maximumKeyframesPerRoom = 256
  static let minimumConnectedRatioMillionths = 750_000
  static let minimumConnectedBridgeRotationMicroradians = 150_000
  static let minimumFeaturePointCount = 60
  static let minimumKeyframesPerRoom = 8
  static let minimumLoopClosureDistanceMicrometres: Int64 = 650_000
  static let maximumLoopClosureDistanceMicrometres: Int64 = 1_200_000
  static let maximumLoopClosureRotationMicroradians = 785_398
  static let maximumLoopClosureOverlapScoreMillionths = 350_000
  static let minimumOverlapScoreMillionths = 180_000
  static let maximumNearDuplicateOverlapScoreMillionths = 940_000
  static let minimumParallaxScoreMillionths = 80_000
  static let minimumParallaxSamples = 3
  static let minimumTrajectorySpanMicrometres: Int64 = 1_200_000
  static let minimumTrajectoryTravelMicrometres: Int64 = 2_400_000
  static let minimumTranslationMicrometres: Int64 = 120_000
  static let minimumZoneSamples = 2
}

struct C14_10LiveSpatialEvidence: Codable, Equatable, Sendable {
  let connectedToPrevious: Bool
  let featurePointCount: Int
  let loopClosureCandidate: Bool
  let loopClosureDistanceThresholdMicrometres: Int64?
  let loopClosureRequiredOverlapScoreMillionths: Int?
  let overlapScoreMillionths: Int
  let parallaxScoreMillionths: Int
  let rotationFromPreviousMicroradians: Int
  let startAnchorDistanceMicrometres: Int64?
  let startAnchorOverlapScoreMillionths: Int?
  let startAnchorRotationMicroradians: Int?
  let telemetryTimestampMicroseconds: Int64
  let trajectorySpanMicrometres: Int64
  let trajectoryTravelMicrometres: Int64
  let translationFromPreviousMicrometres: Int64

  init(
    connectedToPrevious: Bool,
    featurePointCount: Int,
    loopClosureCandidate: Bool,
    overlapScoreMillionths: Int,
    parallaxScoreMillionths: Int,
    rotationFromPreviousMicroradians: Int,
    telemetryTimestampMicroseconds: Int64,
    trajectorySpanMicrometres: Int64,
    trajectoryTravelMicrometres: Int64,
    translationFromPreviousMicrometres: Int64,
    loopClosureDistanceThresholdMicrometres: Int64? = nil,
    loopClosureRequiredOverlapScoreMillionths: Int? = nil,
    startAnchorDistanceMicrometres: Int64? = nil,
    startAnchorOverlapScoreMillionths: Int? = nil,
    startAnchorRotationMicroradians: Int? = nil
  ) {
    self.connectedToPrevious = connectedToPrevious
    self.featurePointCount = featurePointCount
    self.loopClosureCandidate = loopClosureCandidate
    self.loopClosureDistanceThresholdMicrometres = loopClosureDistanceThresholdMicrometres
    self.loopClosureRequiredOverlapScoreMillionths =
      loopClosureRequiredOverlapScoreMillionths
    self.overlapScoreMillionths = overlapScoreMillionths
    self.parallaxScoreMillionths = parallaxScoreMillionths
    self.rotationFromPreviousMicroradians = rotationFromPreviousMicroradians
    self.startAnchorDistanceMicrometres = startAnchorDistanceMicrometres
    self.startAnchorOverlapScoreMillionths = startAnchorOverlapScoreMillionths
    self.startAnchorRotationMicroradians = startAnchorRotationMicroradians
    self.telemetryTimestampMicroseconds = telemetryTimestampMicroseconds
    self.trajectorySpanMicrometres = trajectorySpanMicrometres
    self.trajectoryTravelMicrometres = trajectoryTravelMicrometres
    self.translationFromPreviousMicrometres = translationFromPreviousMicrometres
  }
}

struct C14_10LoopClosureAssessment: Equatable, Sendable {
  let distanceThresholdMicrometres: Int64
  let isCandidate: Bool
  let requiredOverlapScoreMillionths: Int
}

enum C14_10LoopClosureEvaluator {
  static func evaluate(
    retainedObservationCount: Int,
    trajectorySpanMicrometres: Int64,
    trajectoryTravelMicrometres: Int64,
    startAnchorDistanceMicrometres: Int64,
    startAnchorOverlapScoreMillionths: Int,
    startAnchorRotationMicroradians: Int
  ) -> C14_10LoopClosureAssessment {
    let distanceThreshold = distanceThresholdMicrometres(
      trajectoryTravelMicrometres: trajectoryTravelMicrometres)
    let requiredOverlap = requiredOverlapScoreMillionths(
      startAnchorDistanceMicrometres: startAnchorDistanceMicrometres)
    let isCandidate =
      retainedObservationCount >= C14_10SpatialCapturePolicy.minimumKeyframesPerRoom - 1
      && trajectorySpanMicrometres
        >= C14_10SpatialCapturePolicy.minimumTrajectorySpanMicrometres
      && trajectoryTravelMicrometres
        >= C14_10SpatialCapturePolicy.minimumTrajectoryTravelMicrometres
      && startAnchorDistanceMicrometres <= distanceThreshold
      && startAnchorOverlapScoreMillionths >= requiredOverlap
      && startAnchorRotationMicroradians
        <= C14_10SpatialCapturePolicy.maximumLoopClosureRotationMicroradians
    return C14_10LoopClosureAssessment(
      distanceThresholdMicrometres: distanceThreshold,
      isCandidate: isCandidate,
      requiredOverlapScoreMillionths: requiredOverlap
    )
  }

  static func distanceThresholdMicrometres(
    trajectoryTravelMicrometres: Int64
  ) -> Int64 {
    let base = C14_10SpatialCapturePolicy.minimumLoopClosureDistanceMicrometres
    let maximum = C14_10SpatialCapturePolicy.maximumLoopClosureDistanceMicrometres
    let boundedDriftAllowance = min(maximum - base, max(0, trajectoryTravelMicrometres) / 50)
    return base + boundedDriftAllowance
  }

  static func requiredOverlapScoreMillionths(
    startAnchorDistanceMicrometres: Int64
  ) -> Int {
    let baseDistance = C14_10SpatialCapturePolicy.minimumLoopClosureDistanceMicrometres
    let maximumDistance = C14_10SpatialCapturePolicy.maximumLoopClosureDistanceMicrometres
    let baseOverlap = C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
    let maximumOverlap = C14_10SpatialCapturePolicy.maximumLoopClosureOverlapScoreMillionths
    guard startAnchorDistanceMicrometres > baseDistance else { return baseOverlap }
    let boundedDistance = min(maximumDistance, startAnchorDistanceMicrometres)
    let distanceAboveBase = boundedDistance - baseDistance
    let distanceRange = maximumDistance - baseDistance
    let overlapRange = maximumOverlap - baseOverlap
    return baseOverlap + Int(distanceAboveBase * Int64(overlapRange) / distanceRange)
  }
}

enum C14_10CoverageGuidance {
  static func instruction(for coverage: [C14_8CoverageCell]) -> String? {
    for band in [C14_8VerticalBand.upper, .middle, .lower] {
      let unresolvedCount = coverage.filter {
        $0.verticalBand == band && ($0.status == .missing || $0.status == .unknown)
      }.count
      guard unresolvedCount > 0 else { continue }
      switch band {
      case .upper:
        return
          "Secondary guide: \(unresolvedCount) upper directions remain. Tilt toward wall/ceiling junctions while keeping the last wall visible."
      case .middle:
        return
          "Secondary guide: \(unresolvedCount) middle directions remain. Keep walls, openings and fixed fittings in overlapping views."
      case .lower:
        return
          "Secondary guide: \(unresolvedCount) lower directions remain. Tilt toward wall/floor junctions while keeping the last wall visible."
      }
    }
    return nil
  }
}

enum C14_10SpatialRotation {
  static func microradians(unitQuaternionDot: Double) -> Int {
    let clamped = min(1, max(0, abs(unitQuaternionDot)))
    return max(0, Int((2 * acos(clamped) * 1_000_000).rounded()))
  }

  static func microradians(
    quaternionNanounits left: [Int64],
    _ right: [Int64]
  ) -> Int {
    guard left.count == 4, right.count == 4 else { return 0 }
    let leftValues = left.map(Double.init)
    let rightValues = right.map(Double.init)
    let leftLength = sqrt(leftValues.reduce(0) { $0 + $1 * $1 })
    let rightLength = sqrt(rightValues.reduce(0) { $0 + $1 * $1 })
    guard leftLength > 0, rightLength > 0 else { return 0 }
    let dot = zip(leftValues, rightValues).reduce(0) { $0 + $1.0 * $1.1 }
    return microradians(unitQuaternionDot: dot / (leftLength * rightLength))
  }
}

enum C14_10KeyframeDecisionReason: String, CaseIterable, Codable, Equatable, Hashable, Sendable {
  case accepted
  case blurred
  case captureFailure
  case cooldown
  case exposure
  case featurePoor
  case insufficientOverlap
  case insufficientParallax
  case insufficientTranslation
  case motion
  case nearDuplicate
  case tracking

  var homeownerInstruction: String {
    switch self {
    case .accepted: "Keep walking slowly; the app will retain useful connected views."
    case .blurred: "Pause briefly so the view is sharp."
    case .captureFailure: "Hold position while protected capture recovers."
    case .cooldown: "Keep moving slowly along the room edge."
    case .exposure: "Move away from glare or add even room light."
    case .featurePoor: "Aim across a corner, opening or textured object."
    case .insufficientOverlap: "Keep part of the previous wall or corner in view."
    case .insufficientParallax: "Step sideways while keeping the same wall or corner visible."
    case .insufficientTranslation: "Walk a little farther; turning in place is not enough."
    case .motion: "Slow down and hold the phone steady."
    case .nearDuplicate: "Move to a new position before another view is needed."
    case .tracking: "Move slowly toward a textured surface until tracking recovers."
    }
  }

  func homeownerInstruction(hasRetainedView: Bool) -> String {
    if self == .featurePoor, hasRetainedView {
      return
        "Turn back until part of the last retained wall or corner is visible, then sidestep slowly."
    }
    if self == .insufficientOverlap, hasRetainedView {
      return
        "Return until the last retained wall is visible, then sweep the corner slowly in small overlapping arcs."
    }
    return homeownerInstruction
  }

  var homeownerLabel: String {
    switch self {
    case .accepted: "retained"
    case .blurred: "blur"
    case .captureFailure: "capture failure"
    case .cooldown: "two-second spacing"
    case .exposure: "exposure"
    case .featurePoor: "limited features"
    case .insufficientOverlap: "weak overlap"
    case .insufficientParallax: "low parallax"
    case .insufficientTranslation: "low translation"
    case .motion: "fast motion"
    case .nearDuplicate: "near duplicate"
    case .tracking: "limited tracking"
    }
  }
}

struct C14_10RecentSelectionOutcome: Codable, Equatable, Sendable {
  let blurScoreMillionths: Int
  let cameraPositionMicrometres: [Int64]?
  let cameraQuaternionNanounits: [Int64]?
  let completedAt: Date
  let featurePointCount: Int
  let loopClosureDistanceThresholdMicrometres: Int64?
  let loopClosureRequiredOverlapScoreMillionths: Int?
  let motionScoreMillionths: Int
  let overlapScoreMillionths: Int
  let parallaxScoreMillionths: Int
  let rotationFromPreviousMicroradians: Int?
  let reason: C14_10KeyframeDecisionReason
  let startAnchorDistanceMicrometres: Int64?
  let startAnchorOverlapScoreMillionths: Int?
  let startAnchorRotationMicroradians: Int?
  let telemetryTimestampMicroseconds: Int64
  let trackingState: C14_8TrackingState
  let translationFromPreviousMicrometres: Int64

  init(
    reason: C14_10KeyframeDecisionReason,
    telemetry: C14_8LiveTelemetry,
    completedAt: Date
  ) {
    blurScoreMillionths = telemetry.blurScoreMillionths
    cameraPositionMicrometres = telemetry.cameraPositionMicrometres
    cameraQuaternionNanounits = telemetry.cameraQuaternionNanounits
    self.completedAt = completedAt
    featurePointCount = telemetry.spatialEvidence.featurePointCount
    loopClosureDistanceThresholdMicrometres =
      telemetry.spatialEvidence.loopClosureDistanceThresholdMicrometres
    loopClosureRequiredOverlapScoreMillionths =
      telemetry.spatialEvidence.loopClosureRequiredOverlapScoreMillionths
    motionScoreMillionths = telemetry.motionScoreMillionths
    overlapScoreMillionths = telemetry.spatialEvidence.overlapScoreMillionths
    parallaxScoreMillionths = telemetry.spatialEvidence.parallaxScoreMillionths
    rotationFromPreviousMicroradians =
      telemetry.spatialEvidence.rotationFromPreviousMicroradians
    self.reason = reason
    startAnchorDistanceMicrometres = telemetry.spatialEvidence.startAnchorDistanceMicrometres
    startAnchorOverlapScoreMillionths =
      telemetry.spatialEvidence.startAnchorOverlapScoreMillionths
    startAnchorRotationMicroradians = telemetry.spatialEvidence.startAnchorRotationMicroradians
    telemetryTimestampMicroseconds = telemetry.spatialEvidence.telemetryTimestampMicroseconds
    trackingState = telemetry.trackingState
    translationFromPreviousMicrometres =
      telemetry.spatialEvidence.translationFromPreviousMicrometres
  }

  var isValid: Bool {
    blurScoreMillionths >= 0 && blurScoreMillionths <= 1_000_000
      && (cameraPositionMicrometres.map { $0.count == 3 } ?? true)
      && (cameraQuaternionNanounits.map { $0.count == 4 } ?? true)
      && featurePointCount >= 0 && featurePointCount <= 1_000_000
      && (loopClosureDistanceThresholdMicrometres.map {
        $0 >= C14_10SpatialCapturePolicy.minimumLoopClosureDistanceMicrometres
          && $0 <= C14_10SpatialCapturePolicy.maximumLoopClosureDistanceMicrometres
      } ?? true)
      && (loopClosureRequiredOverlapScoreMillionths.map {
        $0 >= C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
          && $0 <= C14_10SpatialCapturePolicy.maximumLoopClosureOverlapScoreMillionths
      } ?? true)
      && motionScoreMillionths >= 0 && motionScoreMillionths <= 1_000_000
      && overlapScoreMillionths >= 0 && overlapScoreMillionths <= 1_000_000
      && parallaxScoreMillionths >= 0 && parallaxScoreMillionths <= 1_000_000
      && (rotationFromPreviousMicroradians.map { $0 >= 0 && $0 <= 3_141_593 } ?? true)
      && (startAnchorDistanceMicrometres.map { $0 >= 0 } ?? true)
      && (startAnchorOverlapScoreMillionths.map { $0 >= 0 && $0 <= 1_000_000 } ?? true)
      && (startAnchorRotationMicroradians.map { $0 >= 0 && $0 <= 3_141_593 } ?? true)
      && telemetryTimestampMicroseconds >= 0
      && translationFromPreviousMicrometres >= 0
  }
}

struct C14_10RejectedDiagnosticThumbnail: Equatable, Sendable {
  let capturedAt: Date
  let jpegData: Data
  let pixelHeight: Int
  let pixelWidth: Int
  let telemetryTimestampMicroseconds: Int64
}

struct C14_10RejectedFrameDiagnosticRecord: Codable, Equatable, Sendable {
  let capturedAt: Date
  let diagnosticId: UUID
  let imageByteCount: Int
  let imageFilename: String
  let imageSHA256: String
  let outcome: C14_10RecentSelectionOutcome
  let pixelHeight: Int
  let pixelWidth: Int
  let segmentId: UUID?

  var isValid: Bool {
    capturedAt == outcome.completedAt
      && imageByteCount > 0
      && imageByteCount <= C14_10RejectedFrameDiagnosticPolicy.maximumImageBytes
      && imageFilename == "\(diagnosticId.uuidString.lowercased()).jpg"
      && imageSHA256.count == 64
      && imageSHA256.allSatisfy { $0.isHexDigit && !$0.isUppercase }
      && outcome.isValid
      && outcome.reason != .accepted
      && pixelHeight > 0
      && pixelHeight <= C14_10RejectedFrameDiagnosticPolicy.maximumPixelDimension
      && pixelWidth > 0
      && pixelWidth <= C14_10RejectedFrameDiagnosticPolicy.maximumPixelDimension
  }
}

struct C14_10RejectedFrameDiagnosticSnapshot: Equatable, Sendable {
  let jpegData: Data
  let record: C14_10RejectedFrameDiagnosticRecord
  let retainedCount: Int
}

enum C14_10RejectedFrameDiagnosticPolicy {
  static let maximumImageBytes = 512_000
  static let maximumPixelDimension = 640
  static let maximumRepresentativesPerReasonAndSegment = 6
  static let maximumRetainedCount = 64
  static let minimumSameReasonSnapshotIntervalMicroseconds: Int64 = 8_000_000
  static let schemaVersion = "c14-10-rejected-frame-diagnostics-v1"
}

struct C14_10SelectionDiagnosticContext: Codable, Equatable, Sendable {
  let coverageCellId: String?
  let retainedCountAtStart: Int
  let segmentId: UUID?
  let zoneId: UUID?

  static let empty = Self(
    coverageCellId: nil,
    retainedCountAtStart: 0,
    segmentId: nil,
    zoneId: nil
  )

  var isValid: Bool {
    (coverageCellId.map { !$0.isEmpty && $0.count <= 64 } ?? true)
      && retainedCountAtStart >= 0
  }
}

struct C14_10SelectionOutcomeDetail: Codable, Equatable, Sendable {
  let candidateSequence: Int
  let context: C14_10SelectionDiagnosticContext
  let outcome: C14_10RecentSelectionOutcome

  var isValid: Bool {
    candidateSequence > 0
      && context.isValid
      && outcome.isValid
  }
}

struct C14_10SelectionDiagnostics: Codable, Equatable, Sendable {
  static let schemaVersion = "c14-10-selection-diagnostics-v1"
  static let maximumCandidateCount = 20_000
  static let maximumDetailedOutcomeCount = 4_096
  static let preservedInitialDetailedOutcomeCount = 256
  static let maximumRecentOutcomeCount = 20

  var detailedOutcomeDroppedCount: Int?
  var detailedOutcomes: [C14_10SelectionOutcomeDetail]?
  var outcomeCounts: [String: Int]
  var recentOutcomes: [C14_10RecentSelectionOutcome]?
  let schemaVersion: String
  var totalAutomaticCandidateCount: Int
  var updatedAt: Date

  static func empty(at date: Date = Date()) -> Self {
    Self(
      detailedOutcomeDroppedCount: 0,
      detailedOutcomes: [],
      outcomeCounts: [:],
      recentOutcomes: [],
      schemaVersion: schemaVersion,
      totalAutomaticCandidateCount: 0,
      updatedAt: date
    )
  }

  var retainedCandidateCount: Int { count(for: .accepted) }
  var skippedCandidateCount: Int {
    max(0, totalAutomaticCandidateCount - retainedCandidateCount)
  }

  var rankedSkippedOutcomes: [(reason: C14_10KeyframeDecisionReason, count: Int)] {
    C14_10KeyframeDecisionReason.allCases
      .filter { $0 != .accepted }
      .compactMap { reason in
        let count = count(for: reason)
        return count > 0 ? (reason, count) : nil
      }
      .sorted {
        $0.count == $1.count
          ? $0.reason.rawValue < $1.reason.rawValue : $0.count > $1.count
      }
  }

  func count(for reason: C14_10KeyframeDecisionReason) -> Int {
    outcomeCounts[reason.rawValue] ?? 0
  }

  mutating func record(
    _ reason: C14_10KeyframeDecisionReason,
    telemetry: C14_8LiveTelemetry? = nil,
    context: C14_10SelectionDiagnosticContext = .empty,
    at date: Date = Date()
  ) {
    guard totalAutomaticCandidateCount < Self.maximumCandidateCount else { return }
    totalAutomaticCandidateCount += 1
    outcomeCounts[reason.rawValue, default: 0] += 1
    if let telemetry {
      let outcome = C14_10RecentSelectionOutcome(
        reason: reason,
        telemetry: telemetry,
        completedAt: date
      )
      var recent = recentOutcomes ?? []
      recent.append(outcome)
      if recent.count > Self.maximumRecentOutcomeCount {
        recent.removeFirst(recent.count - Self.maximumRecentOutcomeCount)
      }
      recentOutcomes = recent
      var detailed = detailedOutcomes ?? []
      if detailed.count == Self.maximumDetailedOutcomeCount {
        detailed.remove(at: Self.preservedInitialDetailedOutcomeCount)
        detailedOutcomeDroppedCount = (detailedOutcomeDroppedCount ?? 0) + 1
      }
      detailed.append(
        C14_10SelectionOutcomeDetail(
          candidateSequence: totalAutomaticCandidateCount,
          context: context,
          outcome: outcome
        )
      )
      detailedOutcomes = detailed
    }
    updatedAt = max(updatedAt, date)
  }

  var isValid: Bool {
    schemaVersion == Self.schemaVersion
      && totalAutomaticCandidateCount >= 0
      && totalAutomaticCandidateCount <= Self.maximumCandidateCount
      && outcomeCounts.keys.allSatisfy {
        C14_10KeyframeDecisionReason(rawValue: $0) != nil
      }
      && outcomeCounts.values.allSatisfy { $0 >= 0 }
      && outcomeCounts.values.reduce(0, +) == totalAutomaticCandidateCount
      && (detailedOutcomeDroppedCount ?? 0) >= 0
      && (detailedOutcomes?.count ?? 0) <= Self.maximumDetailedOutcomeCount
      && (detailedOutcomes ?? []).allSatisfy {
        $0.isValid && $0.candidateSequence <= totalAutomaticCandidateCount
      }
      && (recentOutcomes?.count ?? 0) <= Self.maximumRecentOutcomeCount
      && (recentOutcomes ?? []).allSatisfy(\.isValid)
  }
}

struct C14_10KeyframeDecision: Equatable, Sendable {
  let shouldRetain: Bool
  let reason: C14_10KeyframeDecisionReason
}

enum C14_10KeyframeSelector {
  static func decision(
    telemetry: C14_8LiveTelemetry,
    retainedCount: Int,
    lastAutomaticTimestampMicroseconds: Int64?,
    mode: C14_10KeyframeRetentionMode
  ) -> C14_10KeyframeDecision {
    guard telemetry.trackingState == .normal else { return reject(.tracking) }
    guard telemetry.motionScoreMillionths <= 400_000 else { return reject(.motion) }
    guard telemetry.blurScoreMillionths >= C8CaptureQualityEvaluator.minimumAcceptedBlur else {
      return reject(.blurred)
    }
    guard telemetry.exposureScoreMillionths >= C8CaptureQualityEvaluator.minimumAcceptedExposure,
      (telemetry.ambientIntensity ?? 1_000) >= 300
    else { return reject(.exposure) }
    let spatial = telemetry.spatialEvidence
    guard spatial.featurePointCount >= C14_10SpatialCapturePolicy.minimumFeaturePointCount else {
      return reject(.featurePoor)
    }
    if mode == .automatic, let lastAutomaticTimestampMicroseconds,
      spatial.telemetryTimestampMicroseconds - lastAutomaticTimestampMicroseconds
        < C14_10SpatialCapturePolicy.automaticIntervalMicroseconds
    {
      return reject(.cooldown)
    }
    if retainedCount == 0 {
      guard mode == .automatic else { return accept() }
      guard spatial.connectedToPrevious,
        spatial.overlapScoreMillionths >= C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
      else { return reject(.insufficientOverlap) }
      guard
        spatial.translationFromPreviousMicrometres
          >= C14_10SpatialCapturePolicy.minimumTranslationMicrometres
      else { return reject(.insufficientTranslation) }
      guard
        spatial.parallaxScoreMillionths
          >= C14_10SpatialCapturePolicy.minimumParallaxScoreMillionths
      else { return reject(.insufficientParallax) }
      guard
        spatial.overlapScoreMillionths
          < C14_10SpatialCapturePolicy.maximumNearDuplicateOverlapScoreMillionths
      else { return reject(.nearDuplicate) }
      return accept()
    }
    guard spatial.connectedToPrevious,
      spatial.overlapScoreMillionths >= C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
    else { return reject(.insufficientOverlap) }
    if spatial.loopClosureCandidate { return accept() }
    guard
      spatial.overlapScoreMillionths
        < C14_10SpatialCapturePolicy.maximumNearDuplicateOverlapScoreMillionths
    else { return reject(.nearDuplicate) }
    let hasTranslation =
      spatial.translationFromPreviousMicrometres
      >= C14_10SpatialCapturePolicy.minimumTranslationMicrometres
    let hasParallax =
      spatial.parallaxScoreMillionths
      >= C14_10SpatialCapturePolicy.minimumParallaxScoreMillionths
    if hasTranslation && hasParallax { return accept() }
    if spatial.rotationFromPreviousMicroradians
      >= C14_10SpatialCapturePolicy.minimumConnectedBridgeRotationMicroradians
    {
      return accept()
    }
    guard hasTranslation else { return reject(.insufficientTranslation) }
    guard hasParallax else { return reject(.insufficientParallax) }
    return accept()
  }

  private static func accept() -> C14_10KeyframeDecision {
    C14_10KeyframeDecision(shouldRetain: true, reason: .accepted)
  }

  private static func reject(_ reason: C14_10KeyframeDecisionReason) -> C14_10KeyframeDecision {
    C14_10KeyframeDecision(shouldRetain: false, reason: reason)
  }
}

struct C14_10CaptureReadiness: Equatable, Sendable {
  let connectedRatioMillionths: Int
  let isReady: Bool
  let keyframeCount: Int
  let loopClosureCount: Int
  let reasons: [String]
  let trajectorySpanMicrometres: Int64
  let trajectoryTravelMicrometres: Int64
  let unresolvedZoneCount: Int
}

enum C14_10SpatialReadinessEvaluator {
  static func evaluate(
    room: C14_8RoomEnvelope,
    samples: [C14_8LocalCameraSample]
  ) -> C14_10CaptureReadiness {
    let roomSamples = samples.filter { $0.roomId == room.roomId && $0.retentionMode != nil }
    let segmentGroups = Dictionary(grouping: roomSamples, by: \.segmentId).mapValues {
      $0.sorted { $0.timestampMicroseconds < $1.timestampMicroseconds }
    }
    let connected = segmentGroups.values.reduce(0) { total, segmentSamples in
      total + segmentSamples.dropFirst().filter { $0.connectedToPrevious == true }.count
    }
    let possibleEdges = segmentGroups.values.reduce(0) {
      $0 + max(0, $1.count - 1)
    }
    let connectedRatio = possibleEdges == 0 ? 0 : connected * 1_000_000 / possibleEdges
    let loopClosures = roomSamples.filter { $0.loopClosureCandidate == true }.count
    let span = roomSamples.compactMap(\.trajectorySpanMicrometres).max() ?? 0
    let travel = roomSamples.compactMap(\.trajectoryTravelMicrometres).max() ?? 0
    let zones = room.zones ?? []
    let unresolvedZones = zones.filter { zone in
      zone.status != .occluded
        && roomSamples.filter { $0.zoneId == zone.zoneId }.count
          < C14_10SpatialCapturePolicy.minimumZoneSamples
    }.count
    let segmentAssessments = segmentGroups.values.map { segmentSamples in
      let possibleSegmentEdges = max(0, segmentSamples.count - 1)
      let connectedSegmentEdges = segmentSamples.dropFirst().filter {
        $0.connectedToPrevious == true
      }.count
      let segmentConnectedRatio =
        possibleSegmentEdges == 0
        ? 0 : connectedSegmentEdges * 1_000_000 / possibleSegmentEdges
      let segmentSpan = segmentSamples.compactMap(\.trajectorySpanMicrometres).max() ?? 0
      let segmentTravel = segmentSamples.compactMap(\.trajectoryTravelMicrometres).max() ?? 0
      let segmentParallaxCount = segmentSamples.filter {
        ($0.parallaxScoreMillionths ?? 0)
          >= C14_10SpatialCapturePolicy.minimumParallaxScoreMillionths
      }.count
      let invalidFeatureCount = segmentSamples.filter {
        ($0.featurePointCount ?? 0) < C14_10SpatialCapturePolicy.minimumFeaturePointCount
      }.count
      let invalidOverlapCount =
        segmentSamples.dropFirst().filter { sample in
          sample.connectedToPrevious != true
            || (sample.overlapScoreMillionths ?? 0)
              < C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
            || (sample.loopClosureCandidate != true
              && (sample.overlapScoreMillionths ?? 0)
                >= C14_10SpatialCapturePolicy.maximumNearDuplicateOverlapScoreMillionths)
        }.count + (segmentSamples.first?.connectedToPrevious == true ? 1 : 0)
      let translationSampleCount = segmentSamples.filter {
        ($0.translationFromPreviousMicrometres ?? 0)
          >= C14_10SpatialCapturePolicy.minimumTranslationMicrometres
      }.count
      return C14_10SegmentAssessment(
        connectedRatioMillionths: segmentConnectedRatio,
        hasLoopClosure: segmentSamples.contains { $0.loopClosureCandidate == true },
        invalidFeatureCount: invalidFeatureCount,
        invalidOverlapCount: invalidOverlapCount,
        keyframeCount: segmentSamples.count,
        parallaxSampleCount: segmentParallaxCount,
        spanMicrometres: segmentSpan,
        translationSampleCount: translationSampleCount,
        travelMicrometres: segmentTravel
      )
    }
    var reasons: [String] = []
    if segmentAssessments.contains(where: {
      $0.keyframeCount < C14_10SpatialCapturePolicy.minimumKeyframesPerRoom
    }) || segmentAssessments.isEmpty {
      reasons.append("Keep walking around each active route; more connected views are needed.")
    }
    if segmentAssessments.contains(where: {
      $0.connectedRatioMillionths < C14_10SpatialCapturePolicy.minimumConnectedRatioMillionths
    }) {
      reasons.append("Keep the previous wall or corner visible between views.")
    }
    if segmentGroups.values.contains(where: { $0.count == 1 }) {
      reasons.append(
        "A restarted segment has only one isolated view; connect it with more views or leave it unresolved."
      )
    }
    if segmentAssessments.contains(where: {
      $0.translationSampleCount < C14_10SpatialCapturePolicy.minimumParallaxSamples
        || $0.spanMicrometres < C14_10SpatialCapturePolicy.minimumTrajectorySpanMicrometres
        || $0.travelMicrometres < C14_10SpatialCapturePolicy.minimumTrajectoryTravelMicrometres
    }) {
      reasons.append("Cover more of the room by walking, not only turning in place.")
    }
    if segmentAssessments.contains(where: {
      $0.parallaxSampleCount < C14_10SpatialCapturePolicy.minimumParallaxSamples
    }) {
      reasons.append("Add sideways movement while the same surfaces stay visible.")
    }
    if segmentAssessments.contains(where: { !$0.hasLoopClosure }) {
      reasons.append("Finish each active route near its starting view to close the loop.")
    }
    if segmentAssessments.contains(where: { $0.invalidFeatureCount > 0 }) {
      reasons.append("Add clear views of corners, openings or textured surfaces.")
    }
    if segmentAssessments.contains(where: { $0.invalidOverlapCount > 0 }) {
      reasons.append("Move between overlapping views without retaining near-duplicates.")
    }
    if unresolvedZones > 0 {
      reasons.append("Walk through every connected room zone before finishing.")
    }
    return C14_10CaptureReadiness(
      connectedRatioMillionths: connectedRatio,
      isReady: reasons.isEmpty,
      keyframeCount: roomSamples.count,
      loopClosureCount: loopClosures,
      reasons: reasons,
      trajectorySpanMicrometres: span,
      trajectoryTravelMicrometres: travel,
      unresolvedZoneCount: unresolvedZones
    )
  }
}

private struct C14_10SegmentAssessment {
  let connectedRatioMillionths: Int
  let hasLoopClosure: Bool
  let invalidFeatureCount: Int
  let invalidOverlapCount: Int
  let keyframeCount: Int
  let parallaxSampleCount: Int
  let spanMicrometres: Int64
  let translationSampleCount: Int
  let travelMicrometres: Int64
}

enum C14_10ResourcePressure: String, Codable, Equatable, Sendable {
  case nominal
  case constrained
  case critical
}

struct C14_10ResourcePolicy: Equatable, Sendable {
  let analysisStride: Int
  let automaticSelectionEnabled: Bool
  let optionalDepthEnabled: Bool

  static func policy(for pressure: C14_10ResourcePressure) -> Self {
    switch pressure {
    case .nominal:
      Self(analysisStride: 1, automaticSelectionEnabled: true, optionalDepthEnabled: true)
    case .constrained:
      Self(analysisStride: 3, automaticSelectionEnabled: true, optionalDepthEnabled: false)
    case .critical:
      Self(analysisStride: 6, automaticSelectionEnabled: false, optionalDepthEnabled: false)
    }
  }
}

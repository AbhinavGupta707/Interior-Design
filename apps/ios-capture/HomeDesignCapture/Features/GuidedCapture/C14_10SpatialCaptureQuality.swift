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
  static let minimumFeaturePointCount = 60
  static let minimumKeyframesPerRoom = 8
  static let minimumLoopClosureDistanceMicrometres: Int64 = 650_000
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
  let overlapScoreMillionths: Int
  let parallaxScoreMillionths: Int
  let telemetryTimestampMicroseconds: Int64
  let trajectorySpanMicrometres: Int64
  let trajectoryTravelMicrometres: Int64
  let translationFromPreviousMicrometres: Int64
}

enum C14_10KeyframeDecisionReason: String, Equatable, Sendable {
  case accepted
  case blurred
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
    if retainedCount == 0 { return accept() }
    guard spatial.connectedToPrevious,
      spatial.overlapScoreMillionths >= C14_10SpatialCapturePolicy.minimumOverlapScoreMillionths
    else { return reject(.insufficientOverlap) }
    if spatial.loopClosureCandidate { return accept() }
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

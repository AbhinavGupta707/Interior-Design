import CryptoKit
import Foundation

enum C14_10CaptureEnvelopeCodecError: Error, Equatable, Sendable {
  case canonicalization
  case invalidPayload
  case unknownField(String)
}

enum C14_10CaptureEnvelopeCodec {
  static func decodeStrict(_ data: Data) throws -> C14_8CaptureEnvelopeRequest {
    let raw = try JSONSerialization.jsonObject(with: data)
    guard let envelope = raw as? [String: Any] else { throw error() }
    try rejectNulls(raw)
    try validateShape(envelope)
    let decoded = try JSONDecoder().decode(C14_8CaptureEnvelopeRequest.self, from: data)
    try validate(decoded)
    return decoded
  }

  static func canonicalBytes(_ data: Data) throws -> Data {
    _ = try decodeStrict(data)
    let raw = try JSONSerialization.jsonObject(with: data)
    let normalized = normalize(raw)
    guard JSONSerialization.isValidJSONObject(normalized) else {
      throw C14_10CaptureEnvelopeCodecError.canonicalization
    }
    return try JSONSerialization.data(
      withJSONObject: normalized,
      options: [.sortedKeys, .withoutEscapingSlashes]
    )
  }

  static func canonicalSha256(_ data: Data) throws -> String {
    SHA256.hash(data: try canonicalBytes(data)).map { String(format: "%02x", $0) }.joined()
  }

  private static func validateShape(_ envelope: [String: Any]) throws {
    try assertKeys(
      envelope,
      allowed: [
        "cameraSamples", "capabilities", "captureSessionId", "coordinateSegments",
        "depthSources", "endedAt", "generator", "intent", "mediaSources", "projectId",
        "quality", "rights", "roomPlanSources", "rooms", "schemaVersion", "startedAt",
        "transferState",
      ],
      path: "$"
    )
    try object(envelope, "capabilities").checked(
      keys: [
        "appBuild", "appVersion", "arWorldTracking", "cameraIntrinsics", "cameraPoses",
        "deviceModelIdentifier", "operatingSystemVersion", "qualityTier", "rgbKeyframes",
        "rgbVideo", "roomPlan", "runtime", "sceneDepth", "schemaVersion",
      ],
      path: "$.capabilities"
    )
    try object(envelope, "generator").checked(keys: ["name", "version"], path: "$.generator")
    try object(envelope, "rights").checked(
      keys: ["basis", "serviceProcessingConsent", "trainingUseConsent"],
      path: "$.rights"
    )
    let quality = try object(envelope, "quality")
    try quality.checked(
      keys: [
        "interruptionCount", "lowLightSampleCount", "missingCoverageCellCount",
        "motionWarningSampleCount", "occludedCoverageCellCount", "spatialEvidence",
        "trackingLimitedSampleCount", "unusableBlurSampleCount",
      ],
      path: "$.quality"
    )
    if let spatial = quality["spatialEvidence"] as? [String: Any] {
      try spatial.checked(
        keys: [
          "automaticallySelectedSampleCount", "connectedSampleCount", "loopClosureSampleCount",
          "unresolvedRoomCount", "unresolvedZoneCount",
        ],
        path: "$.quality.spatialEvidence"
      )
    }
    for (index, sample) in try objects(envelope, "cameraSamples").enumerated() {
      let path = "$.cameraSamples[\(index)]"
      try sample.checked(
        keys: [
          "ambientIntensity", "blurScoreMillionths", "cameraIntrinsicsMicropixels",
          "connectedToPrevious", "exposureScoreMillionths", "featurePointCount",
          "intrinsicsModel", "loopClosureCandidate", "motionScoreMillionths", "orientation",
          "overlapScoreMillionths", "parallaxScoreMillionths", "poseTransform",
          "quaternionNanounits", "quaternionOrder", "retentionMode", "roomId", "sampleId",
          "segmentId", "sourceAssetId", "sourceTimestampMicroseconds", "timestampMicroseconds",
          "trackingState", "trajectorySpanMicrometres", "trajectoryTravelMicrometres",
          "translationFromPreviousMicrometres", "translationMicrometres", "zoneId",
        ],
        path: path
      )
      try object(sample, "cameraIntrinsicsMicropixels").checked(
        keys: ["cx", "cy", "fx", "fy", "imageHeightPixels", "imageWidthPixels"],
        path: "\(path).cameraIntrinsicsMicropixels"
      )
      try object(sample, "translationMicrometres").checked(
        keys: ["x", "y", "z"],
        path: "\(path).translationMicrometres"
      )
    }
    for (index, segment) in try objects(envelope, "coordinateSegments").enumerated() {
      try segment.checked(
        keys: [
          "coordinateSystem", "endedAtMicroseconds", "reason", "segmentId",
          "startedAtMicroseconds", "translationUnit", "worldOriginRelationship",
        ],
        path: "$.coordinateSegments[\(index)]"
      )
    }
    for (index, source) in try objects(envelope, "mediaSources").enumerated() {
      try source.checked(
        keys: ["assetId", "byteSize", "kind", "mimeType", "sha256", "transfer"],
        path: "$.mediaSources[\(index)]"
      )
      try object(source, "transfer").checked(
        keys: ["partCount", "reconciledAt", "resumable", "state"],
        path: "$.mediaSources[\(index)].transfer"
      )
    }
    for (index, source) in try objects(envelope, "depthSources").enumerated() {
      try source.checked(
        keys: [
          "alignment", "artifactId", "byteSize", "format", "heightPixels", "sampleIds",
          "sha256", "transfer", "widthPixels",
        ],
        path: "$.depthSources[\(index)]"
      )
      try object(source, "transfer").checked(
        keys: ["partCount", "reconciledAt", "resumable", "state"],
        path: "$.depthSources[\(index)].transfer"
      )
    }
    for (index, source) in try objects(envelope, "roomPlanSources").enumerated() {
      try source.checked(
        keys: ["captureSessionId", "packageId", "packageManifestSha256"],
        path: "$.roomPlanSources[\(index)]"
      )
    }
    for (roomIndex, room) in try objects(envelope, "rooms").enumerated() {
      let roomPath = "$.rooms[\(roomIndex)]"
      try room.checked(
        keys: [
          "coordinateSegmentIds", "coverage", "label", "roomId", "semanticDeclarations",
          "sequence", "story", "zones",
        ],
        path: roomPath
      )
      for (index, cell) in try objects(room, "coverage").enumerated() {
        try cell.checked(
          keys: ["horizontalSector", "status", "verticalBand"],
          path: "\(roomPath).coverage[\(index)]"
        )
      }
      for (index, semantic) in try objects(room, "semanticDeclarations").enumerated() {
        try semantic.checked(
          keys: ["layer", "provenance", "status"],
          path: "\(roomPath).semanticDeclarations[\(index)]"
        )
      }
      if room["zones"] != nil {
        for (index, zone) in try objects(room, "zones").enumerated() {
          try zone.checked(
            keys: ["label", "status", "zoneId"],
            path: "\(roomPath).zones[\(index)]"
          )
        }
      }
    }
  }

  private static func validate(_ envelope: C14_8CaptureEnvelopeRequest) throws {
    let capability = envelope.capabilities
    let physicalCapabilityValid =
      capability.runtime == .physicalDevice
      && capability.qualityTier != .simulatorFixture
      && capability.arWorldTracking
      && capability.cameraIntrinsics
      && capability.cameraPoses
      && capability.rgbKeyframes
      && ((capability.qualityTier == .guidedRGB && !capability.sceneDepth && !capability.roomPlan)
        || (capability.qualityTier == .guidedRGBDepth
          && capability.sceneDepth && !capability.roomPlan)
        || (capability.qualityTier == .guidedRGBDepthRoomPlan
          && capability.sceneDepth && capability.roomPlan))
    let fixtureCapabilityValid =
      capability.runtime == .simulatorFixture
      && capability.qualityTier == .simulatorFixture
      && !capability.arWorldTracking
      && !capability.cameraIntrinsics
      && !capability.cameraPoses
      && !capability.sceneDepth
      && !capability.roomPlan
    guard envelope.schemaVersion == C14_8CaptureContract.envelopeSchemaVersion,
      envelope.transferState == "complete",
      envelope.rights.serviceProcessingConsent,
      envelope.rights.trainingUseConsent == .denied,
      timestamp(envelope.startedAt),
      timestamp(envelope.endedAt),
      envelope.mediaSources.allSatisfy({ timestamp($0.transfer.reconciledAt) }),
      envelope.depthSources.allSatisfy({ timestamp($0.transfer.reconciledAt) }),
      let startedAt = C7ISO8601.date(from: envelope.startedAt),
      let endedAt = C7ISO8601.date(from: envelope.endedAt),
      endedAt > startedAt,
      endedAt.timeIntervalSince(startedAt) <= 21_600,
      !envelope.rooms.isEmpty,
      !envelope.coordinateSegments.isEmpty,
      !envelope.cameraSamples.isEmpty,
      Set(envelope.rooms.map(\.roomId)).count == envelope.rooms.count,
      Set(envelope.coordinateSegments.map(\.segmentId)).count == envelope.coordinateSegments.count,
      Set(envelope.cameraSamples.map(\.sampleId)).count == envelope.cameraSamples.count,
      Set(envelope.mediaSources.map(\.assetId)).count == envelope.mediaSources.count,
      physicalCapabilityValid || fixtureCapabilityValid
    else { throw error() }

    let segments = Dictionary(
      uniqueKeysWithValues: envelope.coordinateSegments.map { ($0.segmentId, $0) })
    let rooms = Dictionary(uniqueKeysWithValues: envelope.rooms.map { ($0.roomId, $0) })
    let sources = Set(envelope.mediaSources.map(\.assetId))
    for room in envelope.rooms {
      guard room.coverage.count == 24,
        Set(room.coverage.map(\.id)).count == 24,
        room.semanticDeclarations.count == 5,
        Set(room.semanticDeclarations.map(\.layer)).count == 5,
        Set(room.coordinateSegmentIds).count == room.coordinateSegmentIds.count,
        room.coordinateSegmentIds.allSatisfy({ segments[$0] != nil }),
        !room.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        room.label.trimmingCharacters(in: .whitespacesAndNewlines).count <= 120,
        room.zones.map({
          !$0.isEmpty && Set($0.map(\.zoneId)).count == $0.count
            && $0.allSatisfy {
              let label = $0.label.trimmingCharacters(in: .whitespacesAndNewlines)
              return !label.isEmpty && label.count <= 120
            }
        }) ?? true
      else { throw error() }
      let ordered = room.coordinateSegmentIds.compactMap { segments[$0] }
        .sorted { $0.startedAtMicroseconds < $1.startedAtMicroseconds }
      guard
        zip(ordered, ordered.dropFirst()).allSatisfy({ previous, current in
          previous.endedAtMicroseconds <= current.startedAtMicroseconds
        })
      else { throw error() }
    }
    for sample in envelope.cameraSamples {
      guard let segment = segments[sample.segmentId], let room = rooms[sample.roomId],
        room.coordinateSegmentIds.contains(sample.segmentId),
        sources.contains(sample.sourceAssetId),
        sample.timestampMicroseconds >= segment.startedAtMicroseconds,
        sample.timestampMicroseconds <= segment.endedAtMicroseconds,
        sample.zoneId.map({ zoneId in room.zones?.contains(where: { $0.zoneId == zoneId }) == true }
        )
          ?? true
      else { throw error() }
      let spatial: [Any?] = [
        sample.connectedToPrevious, sample.featurePointCount, sample.loopClosureCandidate,
        sample.overlapScoreMillionths, sample.parallaxScoreMillionths, sample.retentionMode,
        sample.trajectorySpanMicrometres, sample.trajectoryTravelMicrometres,
        sample.translationFromPreviousMicrometres, sample.zoneId,
      ]
      let populated = spatial.filter { $0 != nil }.count
      guard populated == 0 || populated == spatial.count else { throw error() }
    }
  }

  private static func timestamp(_ value: String) -> Bool {
    guard
      value.range(
        of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$"#,
        options: .regularExpression
      ) != nil
    else { return false }
    guard C7ISO8601.date(from: value) != nil else { return false }
    if value.hasSuffix("Z") { return true }
    let offset = value.suffix(6)
    guard offset.count == 6,
      let hour = Int(offset.dropFirst().prefix(2)),
      let minute = Int(offset.suffix(2))
    else { return false }
    return (0...23).contains(hour) && (0...59).contains(minute)
  }

  private static let uuidKeys: Set<String> = [
    "artifactId", "assetId", "captureSessionId", "packageId", "projectId", "roomId", "sampleId",
    "segmentId", "sourceAssetId", "zoneId",
  ]
  private static let uuidArrayKeys: Set<String> = ["coordinateSegmentIds", "sampleIds"]
  private static let trimmedKeys: Set<String> = [
    "appVersion", "label", "operatingSystemVersion", "version",
  ]

  private static func normalize(_ value: Any, key: String? = nil) -> Any {
    if let string = value as? String {
      if let key, uuidKeys.contains(key), UUID(uuidString: string) != nil {
        return string.lowercased()
      }
      if let key, trimmedKeys.contains(key) {
        return string.trimmingCharacters(in: .whitespacesAndNewlines)
      }
      return string
    }
    if let array = value as? [Any] {
      if let key, uuidArrayKeys.contains(key) {
        return array.map { child in
          guard let string = child as? String, UUID(uuidString: string) != nil else { return child }
          return string.lowercased()
        }
      }
      return array.map { normalize($0) }
    }
    if let object = value as? [String: Any] {
      return Dictionary(
        uniqueKeysWithValues: object.map { childKey, child in
          (childKey, normalize(child, key: childKey))
        })
    }
    return value
  }

  private static func rejectNulls(_ value: Any) throws {
    if value is NSNull { throw error() }
    if let array = value as? [Any] {
      for child in array { try rejectNulls(child) }
    }
    if let object = value as? [String: Any] {
      for child in object.values { try rejectNulls(child) }
    }
  }

  private static func object(_ parent: [String: Any], _ key: String) throws -> [String: Any] {
    guard let value = parent[key] as? [String: Any] else { throw error() }
    return value
  }

  private static func objects(_ parent: [String: Any], _ key: String) throws -> [[String: Any]] {
    guard let value = parent[key] as? [[String: Any]] else { throw error() }
    return value
  }

  private static func assertKeys(_ object: [String: Any], allowed: Set<String>, path: String) throws
  {
    if let unknown = Set(object.keys).subtracting(allowed).sorted().first {
      throw C14_10CaptureEnvelopeCodecError.unknownField("\(path).\(unknown)")
    }
  }

  private static func error() -> C14_10CaptureEnvelopeCodecError { .invalidPayload }
}

extension Dictionary where Key == String, Value == Any {
  fileprivate func checked(keys: Set<String>, path: String) throws {
    if let unknown = Set(self.keys).subtracting(keys).sorted().first {
      throw C14_10CaptureEnvelopeCodecError.unknownField("\(path).\(unknown)")
    }
  }
}

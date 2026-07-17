import CryptoKit
import Foundation

struct RoomCaptureArtifactPayload: Equatable, Identifiable, Sendable {
  let data: Data
  let manifest: C7CaptureArtifactManifest

  var id: UUID { manifest.artifactId }
}

struct RoomCaptureArtifactEnvironment: Codable, Equatable, Sendable {
  let appBuild: String
  let appVersion: String
  let operatingSystemVersion: String
  let producerVersion: String
  let roomPlanFrameworkVersion: String
}

struct RoomCaptureArtifactProvenance: Codable, Equatable, Sendable {
  let artifactIndexSHA256: String
  let environment: RoomCaptureArtifactEnvironment
  let normalizedArtifactSHA256: String
  let qualityArtifactSHA256: String
  let sourceArtifactSHA256: [String: String]
}

struct RoomCaptureArtifactBundle: Equatable, Sendable {
  let artifacts: [RoomCaptureArtifactPayload]
  let conversionInputs: RoomCaptureConversionInputs
  let isSyntheticFixture: Bool
  let normalized: C7NormalizedRoomPlan
  let provenance: RoomCaptureArtifactProvenance
}

enum RoomCaptureArtifactProductionOutcome: Equatable, Sendable {
  case abstained(RoomCaptureAbstentionInput)
  case produced(RoomCaptureArtifactBundle)
}

enum RoomCaptureArtifactProducer {
  static let producerVersion = "c7-roomplan-artifact-producer-1.0.0"

  struct Input: Equatable, Sendable {
    let captureSessionId: UUID
    let environment: RoomCaptureArtifactEnvironment
    let projectId: UUID
    let quality: C7CaptureQualityManifest
    let referenceMeasurements: [C7ReferenceMeasurement]
    let rooms: [RoomCaptureRoomEvidence]
    let structure: RoomCaptureStructureEvidence?
  }

  static func produce(_ input: Input) -> RoomCaptureArtifactProductionOutcome {
    if let abstention = evidenceGroupAbstention(input) {
      return .abstained(abstention)
    }
    guard validateEnvironment(input.environment) else {
      return .abstained(
        RoomCaptureAbstentionInput(
          affectedSourceEntityIds: [],
          message: "Capture producer metadata is missing or outside frozen bounds.",
          reason: .countLimitExceeded
        ))
    }
    guard validateQuality(input.quality) else {
      return .abstained(
        RoomCaptureAbstentionInput(
          affectedSourceEntityIds: [],
          message: "Capture quality metadata is incomplete or outside frozen bounds.",
          reason: .countLimitExceeded
        ))
    }
    let structureIdentifier = input.structure?.structureIdentifier
    let normalization = RoomPlanNormalizer.normalize(
      .init(
        captureSessionId: input.captureSessionId,
        projectId: input.projectId,
        quality: input.quality,
        referenceMeasurements: input.referenceMeasurements,
        rooms: input.rooms,
        structureIdentifier: structureIdentifier
      ))
    guard case .normalized(let normalizedResult) = normalization else {
      if case .abstained(let abstention) = normalization { return .abstained(abstention) }
      return .abstained(
        RoomCaptureAbstentionInput(
          affectedSourceEntityIds: [],
          message: "RoomPlan normalization failed closed.",
          reason: .malformedTransform
        ))
    }

    do {
      let encoder = deterministicEncoder()
      let normalizedJSON = try encoder.encode(normalizedResult.normalized)
      let qualityJSON = try encoder.encode(input.quality)
      var artifacts: [RoomCaptureArtifactPayload] = []

      for room in input.rooms.sorted(by: roomOrder) {
        try validateOpaqueJSON(room.capturedRoomJSON)
        artifacts.append(
          try artifact(
            data: room.capturedRoomJSON,
            kind: .capturedRoomJSON,
            roomId: room.roomId
          ))
        guard let rawData = room.rawCapturedRoomDataJSON else {
          throw ArtifactError.malformedSourceEncoding
        }
        try validateOpaqueJSON(rawData)
        artifacts.append(
          try artifact(
            data: rawData,
            kind: .capturedRoomDataJSON,
            roomId: room.roomId
          ))
      }
      if let structure = input.structure {
        try validateOpaqueJSON(structure.capturedStructureJSON)
        artifacts.append(
          try artifact(
            data: structure.capturedStructureJSON,
            kind: .capturedStructureJSON,
            roomId: nil
          ))
      }
      artifacts.append(
        try artifact(
          data: normalizedJSON,
          kind: .roomPlanNormalizedJSON,
          roomId: nil
        ))
      artifacts.append(
        try artifact(
          data: qualityJSON,
          kind: .qualityManifestJSON,
          roomId: nil
        ))

      let usdz = input.structure?.usdz ?? (input.rooms.count == 1 ? input.rooms[0].usdz : nil)
      if let usdz {
        artifacts.append(try artifact(data: usdz, kind: .structureUSDZ, roomId: nil))
      }
      guard artifacts.count <= C7CaptureContract.maximumArtifactCount else {
        throw ArtifactError.invalidArtifact
      }
      let totalBytes = artifacts.reduce(Int64(0)) { $0 + $1.manifest.byteSize }
      guard totalBytes <= C7CaptureContract.maximumPackageBytes else {
        throw ArtifactError.invalidArtifact
      }

      let sourceHashPairs: [(String, String)] = artifacts.compactMap { payload in
        guard
          payload.manifest.kind == .capturedRoomJSON
            || payload.manifest.kind == .capturedRoomDataJSON
            || payload.manifest.kind == .capturedStructureJSON
            || payload.manifest.kind == .structureUSDZ
        else { return nil }
        let scope = payload.manifest.roomId?.uuidString.lowercased() ?? "structure"
        return ("\(payload.manifest.kind.rawValue):\(scope)", payload.manifest.sha256)
      }
      let sourceHashes = [String: String](uniqueKeysWithValues: sourceHashPairs)
      let index = ArtifactIndex(
        artifacts: artifacts.map(\.manifest),
        environment: input.environment,
        schemaVersion: C7CaptureContract.capturePackageSchemaVersion,
        sourceArtifactSHA256: sourceHashes
      )
      let indexSHA256 = sha256Hex(try encoder.encode(index))
      let normalizedHash = sha256Hex(normalizedJSON)
      let qualityHash = sha256Hex(qualityJSON)
      let bundle = RoomCaptureArtifactBundle(
        artifacts: artifacts,
        conversionInputs: normalizedResult.conversionInputs,
        isSyntheticFixture: input.rooms.contains(where: \.isSyntheticFixture)
          || input.structure?.isSyntheticFixture == true,
        normalized: normalizedResult.normalized,
        provenance: RoomCaptureArtifactProvenance(
          artifactIndexSHA256: indexSHA256,
          environment: input.environment,
          normalizedArtifactSHA256: normalizedHash,
          qualityArtifactSHA256: qualityHash,
          sourceArtifactSHA256: sourceHashes
        )
      )
      return .produced(bundle)
    } catch ArtifactError.malformedSourceEncoding {
      return .abstained(
        RoomCaptureAbstentionInput(
          affectedSourceEntityIds: sortedSourceIdentifiers(input.rooms),
          message: "Apple RoomPlan source evidence is missing or malformed.",
          reason: .malformedSourceEncoding
        ))
    } catch {
      return .abstained(
        RoomCaptureAbstentionInput(
          affectedSourceEntityIds: [],
          message: "Capture artifacts could not be encoded within frozen bounds.",
          reason: .countLimitExceeded
        ))
    }
  }

  static func qualityManifest(
    from run: RoomCaptureRun,
    scanDurationMilliseconds: Int
  ) -> C7CaptureQualityManifest {
    let lowConfidenceSurfaceCount = run.completedRooms.reduce(0) { count, room in
      count + room.surfaces.filter { $0.confidence == .low }.count
    }
    let lowConfidenceObjectCount = run.completedRooms.reduce(0) { count, room in
      count + room.objects.filter { $0.confidence == .low }.count
    }
    return C7CaptureQualityManifest(
      heuristicName: "c7-roomplan-quality",
      heuristicVersion: "1.0.0",
      instructionCounts: Dictionary(
        uniqueKeysWithValues: C7CaptureInstruction.allCases.map {
          ($0, run.instructionCounts[$0] ?? 0)
        }
      ),
      interruptionCount: run.interruptionCount,
      lowConfidenceObjectCount: lowConfidenceObjectCount,
      lowConfidenceSurfaceCount: lowConfidenceSurfaceCount,
      relocalisationAttemptCount: run.relocalisationAttemptCount,
      relocalisationSuccessCount: run.relocalisationSuccessCount,
      scanDurationMilliseconds: scanDurationMilliseconds,
      worldMappingStatusAtFinish: run.worldMappingStatus
    )
  }

  private static func validateQuality(_ quality: C7CaptureQualityManifest) -> Bool {
    quality.heuristicName == "c7-roomplan-quality"
      && !quality.heuristicVersion.isEmpty
      && quality.heuristicVersion.count <= 100
      && quality.instructionCounts.count == C7CaptureInstruction.allCases.count
      && C7CaptureInstruction.allCases.allSatisfy {
        guard let count = quality.instructionCounts[$0] else { return false }
        return (0...1_000_000).contains(count)
      }
      && (0...10_000).contains(quality.interruptionCount)
      && (0...C7CaptureContract.maximumObjectCount).contains(quality.lowConfidenceObjectCount)
      && (0...C7CaptureContract.maximumSurfaceCount).contains(quality.lowConfidenceSurfaceCount)
      && (0...10_000).contains(quality.relocalisationAttemptCount)
      && (0...quality.relocalisationAttemptCount).contains(quality.relocalisationSuccessCount)
      && (1...21_600_000).contains(quality.scanDurationMilliseconds)
  }

  private static func validateEnvironment(_ environment: RoomCaptureArtifactEnvironment) -> Bool {
    let boundedValues = [
      environment.appBuild,
      environment.appVersion,
      environment.operatingSystemVersion,
      environment.producerVersion,
      environment.roomPlanFrameworkVersion,
    ]
    return boundedValues.allSatisfy { (1...200).contains($0.count) }
      && environment.producerVersion == producerVersion
  }

  private static func evidenceGroupAbstention(_ input: Input) -> RoomCaptureAbstentionInput? {
    var fixtureFlags = input.rooms.map(\.isSyntheticFixture)
    if let structure = input.structure {
      fixtureFlags.append(structure.isSyntheticFixture)
    }
    guard Set(fixtureFlags).count <= 1 else {
      return RoomCaptureAbstentionInput(
        affectedSourceEntityIds: sortedSourceIdentifiers(input.rooms),
        message: "Synthetic fixtures cannot be combined with physical RoomPlan evidence.",
        reason: .mixedFixtureEvidence
      )
    }

    guard let structure = input.structure else { return nil }
    guard
      input.rooms.count >= 2,
      structure.rooms.map(\.roomId) == input.rooms.map(\.roomId),
      structure.worldOriginIdentifier == input.rooms.first?.worldOriginIdentifier,
      structure.rooms.allSatisfy({
        $0.worldOriginIdentifier == structure.worldOriginIdentifier
          && $0.isSyntheticFixture == structure.isSyntheticFixture
      })
    else {
      return RoomCaptureAbstentionInput(
        affectedSourceEntityIds: sortedSourceIdentifiers(input.rooms),
        message: "CapturedStructure does not exactly match the reviewed compatible room group.",
        reason: .invalidRoomReference
      )
    }
    return nil
  }

  private static func validateOpaqueJSON(_ data: Data) throws {
    guard !data.isEmpty else { throw ArtifactError.malformedSourceEncoding }
    guard data.count <= C7CaptureContract.maximumArtifactBytes else {
      throw ArtifactError.invalidArtifact
    }
    guard (try? JSONSerialization.jsonObject(with: data)) != nil else {
      throw ArtifactError.malformedSourceEncoding
    }
  }

  private static func sortedSourceIdentifiers(
    _ rooms: [RoomCaptureRoomEvidence]
  ) -> [UUID] {
    Array(Set(rooms.map(\.sourceRoomIdentifier))).sorted {
      $0.uuidString.lowercased() < $1.uuidString.lowercased()
    }
  }

  private static func artifact(
    data: Data,
    kind: C7CaptureArtifactKind,
    roomId: UUID?
  ) throws -> RoomCaptureArtifactPayload {
    guard !data.isEmpty, data.count <= C7CaptureContract.maximumArtifactBytes else {
      throw ArtifactError.invalidArtifact
    }
    let hash = sha256Hex(data)
    let scope = roomId?.uuidString.lowercased() ?? "global"
    let artifactId = deterministicUUID(seed: "\(kind.rawValue):\(scope):\(hash)")
    return RoomCaptureArtifactPayload(
      data: data,
      manifest: C7CaptureArtifactManifest(
        artifactId: artifactId,
        byteSize: Int64(data.count),
        contentType: kind == .structureUSDZ ? .usdz : .json,
        kind: kind,
        roomId: roomId,
        sha256: hash
      )
    )
  }

  private static func deterministicEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }

  private static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  private static func deterministicUUID(seed: String) -> UUID {
    var bytes = Array(SHA256.hash(data: Data(seed.utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x50
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return UUID(
      uuid: (
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15]
      ))
  }

  private static func roomOrder(
    _ lhs: RoomCaptureRoomEvidence,
    _ rhs: RoomCaptureRoomEvidence
  ) -> Bool {
    (lhs.sequence, lhs.roomId.uuidString.lowercased())
      < (rhs.sequence, rhs.roomId.uuidString.lowercased())
  }
}

private struct ArtifactIndex: Codable {
  let artifacts: [C7CaptureArtifactManifest]
  let environment: RoomCaptureArtifactEnvironment
  let schemaVersion: String
  let sourceArtifactSHA256: [String: String]
}

private enum ArtifactError: Error {
  case invalidArtifact
  case malformedSourceEncoding
}

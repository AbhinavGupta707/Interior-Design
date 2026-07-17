import CryptoKit
import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C7 deterministic capture artifacts")
struct RoomCaptureArtifactTests {
  @Test("single-room artifacts and hashes are deterministic")
  func deterministicArtifacts() throws {
    let room = SyntheticRoomCaptureFixtures.room(
      usdz: Data("VISIBLY-SYNTHETIC-NOT-A-PHYSICAL-USDZ".utf8)
    )
    let input = RoomCaptureArtifactProducer.Input(
      captureSessionId: SyntheticRoomCaptureFixtures.sessionId,
      environment: SyntheticRoomCaptureFixtures.environment,
      projectId: SyntheticRoomCaptureFixtures.projectId,
      quality: SyntheticRoomCaptureFixtures.quality(),
      referenceMeasurements: [],
      rooms: [room],
      structure: nil
    )

    let first = RoomCaptureArtifactProducer.produce(input)
    let second = RoomCaptureArtifactProducer.produce(input)
    #expect(first == second)
    guard case .produced(let bundle) = first else {
      Issue.record("Expected artifact bundle")
      return
    }
    #expect(bundle.isSyntheticFixture)
    #expect(
      bundle.artifacts.map { $0.manifest.kind } == [
        .capturedRoomJSON,
        .capturedRoomDataJSON,
        .roomPlanNormalizedJSON,
        .qualityManifestJSON,
        .structureUSDZ,
      ])
    #expect(bundle.artifacts.last?.manifest.contentType == .usdz)
    #expect(
      bundle.provenance.environment.producerVersion == RoomCaptureArtifactProducer.producerVersion)
    #expect(bundle.provenance.sourceArtifactSHA256.count == 3)
    #expect(bundle.provenance.artifactIndexSHA256.count == 64)
    #expect(bundle.provenance.normalizedArtifactSHA256.count == 64)
    #expect(bundle.provenance.qualityArtifactSHA256.count == 64)

    for artifact in bundle.artifacts {
      #expect(artifact.manifest.sha256 == sha256Hex(artifact.data))
      #expect(artifact.manifest.byteSize == Int64(artifact.data.count))
      #expect(artifact.manifest.sha256.allSatisfy { $0.isHexDigit })
    }
  }

  @Test("normalized JSON has the exact frozen integer shape")
  func frozenNormalizedJSON() throws {
    let bundle = try producedBundle(rooms: [SyntheticRoomCaptureFixtures.room()])
    let payload = try #require(
      bundle.artifacts.first {
        $0.manifest.kind == .roomPlanNormalizedJSON
      })
    let decoded = try JSONDecoder().decode(C7NormalizedRoomPlan.self, from: payload.data)
    #expect(decoded.schemaVersion == C7CaptureContract.normalizedRoomPlanSchemaVersion)
    #expect(decoded.surfaces[0].dimensionsMicrometres.x == 4_000_001)

    let json = try #require(
      JSONSerialization.jsonObject(with: payload.data) as? [String: Any]
    )
    #expect(
      Set(json.keys) == [
        "captureSessionId", "coordinateSystem", "objects", "projectId", "quality",
        "referenceMeasurements", "rooms", "schemaVersion", "surfaces",
      ])
    let rawJSON = String(decoding: payload.data, as: UTF8.self)
    #expect(
      rawJSON.contains(
        #""dimensionsMicrometres":{"x":4000001,"y":2500000,"z":120000}"#
      ))
  }

  @Test("connected structure retains each Apple encoding and one structure encoding")
  func structureArtifacts() throws {
    let rooms = [
      SyntheticRoomCaptureFixtures.room(sequence: 1),
      SyntheticRoomCaptureFixtures.room(sequence: 2),
    ]
    let structure = RoomCaptureStructureEvidence(
      capturedStructureJSON: Data("{\"fixture\":\"synthetic-structure\"}".utf8),
      isSyntheticFixture: true,
      rooms: rooms,
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
      usdz: nil,
      worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA
    )
    let bundle = try producedBundle(rooms: rooms, structure: structure)
    #expect(bundle.artifacts.filter { $0.manifest.kind == .capturedRoomJSON }.count == 2)
    #expect(bundle.artifacts.filter { $0.manifest.kind == .capturedRoomDataJSON }.count == 2)
    #expect(bundle.artifacts.filter { $0.manifest.kind == .capturedStructureJSON }.count == 1)
    #expect(bundle.normalized.structureIdentifier == SyntheticRoomCaptureFixtures.structureId)
    #expect(bundle.conversionInputs.sourceMappings.count == 4)
  }

  @Test("malformed opaque Apple JSON abstains")
  func malformedAppleEncoding() {
    let malformed = SyntheticRoomCaptureFixtures.room(rawJSON: Data("not-json".utf8))
    let outcome = RoomCaptureArtifactProducer.produce(
      .init(
        captureSessionId: SyntheticRoomCaptureFixtures.sessionId,
        environment: SyntheticRoomCaptureFixtures.environment,
        projectId: SyntheticRoomCaptureFixtures.projectId,
        quality: SyntheticRoomCaptureFixtures.quality(),
        referenceMeasurements: [],
        rooms: [malformed],
        structure: nil
      ))
    guard case .abstained(let input) = outcome else {
      Issue.record("Expected abstention")
      return
    }
    #expect(input.reason == .malformedSourceEncoding)
  }

  @Test("missing raw Apple evidence and mixed fixtures abstain")
  func missingAndMixedEvidence() {
    let missingRaw = SyntheticRoomCaptureFixtures.room(rawJSON: nil)
    guard case .abstained(let missingInput) = produce(rooms: [missingRaw]) else {
      Issue.record("Expected missing raw evidence abstention")
      return
    }
    #expect(missingInput.reason == .malformedSourceEncoding)

    let physical = SyntheticRoomCaptureFixtures.room(
      sequence: 2,
      isSyntheticFixture: false
    )
    guard
      case .abstained(let mixedInput) = produce(
        rooms: [SyntheticRoomCaptureFixtures.room(sequence: 1), physical],
        structure: RoomCaptureStructureEvidence(
          capturedStructureJSON: Data("{\"fixture\":\"synthetic-structure\"}".utf8),
          isSyntheticFixture: true,
          rooms: [SyntheticRoomCaptureFixtures.room(sequence: 1), physical],
          structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
          usdz: nil,
          worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA
        )
      )
    else {
      Issue.record("Expected mixed fixture abstention")
      return
    }
    #expect(mixedInput.reason == .mixedFixtureEvidence)
  }

  @Test("quality manifest counts low confidence observations and every instruction")
  func qualityManifest() {
    let lowSurface = SyntheticRoomCaptureFixtures.surface(confidence: .low)
    let lowObject = SyntheticRoomCaptureFixtures.object(confidence: .low)
    let room = SyntheticRoomCaptureFixtures.room(
      surfaceValues: [lowSurface],
      objectValues: [lowObject]
    )
    var run = SyntheticRoomCaptureFixtures.run(mode: .singleRoom)
    run.completedRooms = [room]
    run.instructionCounts[.slowDown] = 3
    run.interruptionCount = 1
    run.relocalisationAttemptCount = 1
    run.relocalisationSuccessCount = 1
    run.worldMappingStatus = .extending

    let quality = RoomCaptureArtifactProducer.qualityManifest(
      from: run,
      scanDurationMilliseconds: 9_999
    )
    #expect(quality.lowConfidenceSurfaceCount == 1)
    #expect(quality.lowConfidenceObjectCount == 1)
    #expect(quality.instructionCounts.count == 6)
    #expect(quality.instructionCounts[.slowDown] == 3)
    #expect(quality.scanDurationMilliseconds == 9_999)
    #expect(quality.worldMappingStatusAtFinish == .extending)
  }

  @Test("producer environment metadata is bounded and version pinned")
  func environmentMetadataValidation() {
    let wrongProducer = RoomCaptureArtifactEnvironment(
      appBuild: "synthetic-build-1",
      appVersion: "0.1.0",
      operatingSystemVersion: "synthetic-os-1",
      producerVersion: "unexpected-producer",
      roomPlanFrameworkVersion: "synthetic-roomplan-fixture-1"
    )
    guard
      case .abstained(let input) = produce(
        environment: wrongProducer,
        rooms: [SyntheticRoomCaptureFixtures.room()]
      )
    else {
      Issue.record("Expected producer metadata abstention")
      return
    }
    #expect(input.reason == .countLimitExceeded)
  }

  private func producedBundle(
    rooms: [RoomCaptureRoomEvidence],
    structure: RoomCaptureStructureEvidence? = nil
  ) throws -> RoomCaptureArtifactBundle {
    let outcome = RoomCaptureArtifactProducer.produce(
      .init(
        captureSessionId: SyntheticRoomCaptureFixtures.sessionId,
        environment: SyntheticRoomCaptureFixtures.environment,
        projectId: SyntheticRoomCaptureFixtures.projectId,
        quality: SyntheticRoomCaptureFixtures.quality(),
        referenceMeasurements: [],
        rooms: rooms,
        structure: structure
      ))
    guard case .produced(let bundle) = outcome else {
      throw ArtifactTestError.notProduced
    }
    return bundle
  }

  private func produce(
    environment: RoomCaptureArtifactEnvironment = SyntheticRoomCaptureFixtures.environment,
    rooms: [RoomCaptureRoomEvidence],
    structure: RoomCaptureStructureEvidence? = nil
  ) -> RoomCaptureArtifactProductionOutcome {
    RoomCaptureArtifactProducer.produce(
      .init(
        captureSessionId: SyntheticRoomCaptureFixtures.sessionId,
        environment: environment,
        projectId: SyntheticRoomCaptureFixtures.projectId,
        quality: SyntheticRoomCaptureFixtures.quality(),
        referenceMeasurements: [],
        rooms: rooms,
        structure: structure
      ))
  }

  private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

private enum ArtifactTestError: Error {
  case notProduced
}

import Foundation
import Testing
@testable import HomeDesignCapture

@Suite("C7 capture contract")
struct C7CaptureContractTests {
  @Test("quantization is finite, bounded and half-away-from-zero")
  func quantization() throws {
    #expect(try C7RoomPlanQuantization.micrometres(fromMetres: 1.234_567_5) == 1_234_568)
    #expect(try C7RoomPlanQuantization.micrometres(fromMetres: -0.000_000_5) == -1)
    #expect(throws: C7CaptureContractError.invalidCoordinate) {
      try C7RoomPlanQuantization.micrometres(fromMetres: .infinity)
    }
  }

  @Test("validates one complete synthetic structure package")
  func packageValidation() throws {
    let projectId = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    let sessionId = UUID(uuidString: "20000000-0000-4000-8000-000000000001")!
    let roomId = UUID(uuidString: "30000000-0000-4000-8000-000000000001")!
    let room = C7CaptureRoomManifest(
      capturedRoomVersion: 1,
      roomId: roomId,
      sequence: 1,
      sourceRoomIdentifier: UUID(uuidString: "40000000-0000-4000-8000-000000000001")!,
      story: 0,
      userLabel: "Synthetic room"
    )
    let artifact: (C7CaptureArtifactKind, UUID?) -> C7CaptureArtifactManifest = { kind, roomId in
      C7CaptureArtifactManifest(
        artifactId: UUID(),
        byteSize: 1_024,
        contentType: .json,
        kind: kind,
        roomId: roomId,
        sha256: String(repeating: "a", count: 64)
      )
    }
    let quality = C7CaptureQualityManifest(
      heuristicName: "c7-roomplan-quality",
      heuristicVersion: "1.0.0",
      instructionCounts: Dictionary(uniqueKeysWithValues: C7CaptureInstruction.allCases.map { ($0, 0) }),
      interruptionCount: 0,
      lowConfidenceObjectCount: 0,
      lowConfidenceSurfaceCount: 0,
      relocalisationAttemptCount: 0,
      relocalisationSuccessCount: 0,
      scanDurationMilliseconds: 300_000,
      worldMappingStatusAtFinish: .mapped
    )
    let package = C7CreateCapturePackageRequest(
      artifacts: [
        artifact(.capturedRoomJSON, roomId),
        artifact(.capturedStructureJSON, nil),
        artifact(.roomPlanNormalizedJSON, nil),
        artifact(.qualityManifestJSON, nil),
      ],
      captureSessionId: sessionId,
      device: C7CaptureDeviceManifest(
        appBuild: "1",
        appVersion: "1.0.0",
        deviceModelIdentifier: "fixture-device",
        operatingSystemVersion: "fixture-os",
        roomPlanSupported: true
      ),
      endedAt: "2026-07-17T12:05:00.000Z",
      mode: .structure,
      projectId: projectId,
      quality: quality,
      referenceMeasurements: [],
      rights: C7CaptureRights(basis: .ownedByUser, serviceProcessingConsent: true),
      rooms: [room],
      schemaVersion: C7CaptureContract.capturePackageSchemaVersion,
      sharedWorldOrigin: true,
      startedAt: "2026-07-17T12:00:00.000Z"
    )

    try C7CapturePackageValidator.validate(package)
    #expect(package.rights.trainingUseConsent == "denied")
  }

  @Test("rejects structure packages without a shared world origin")
  func incompatibleWorldSpace() {
    let package = C7CreateCapturePackageRequest(
      artifacts: [],
      captureSessionId: UUID(),
      device: C7CaptureDeviceManifest(
        appBuild: "1",
        appVersion: "1.0.0",
        deviceModelIdentifier: "fixture-device",
        operatingSystemVersion: "fixture-os",
        roomPlanSupported: true
      ),
      endedAt: "2026-07-17T12:05:00.000Z",
      mode: .structure,
      projectId: UUID(),
      quality: C7CaptureQualityManifest(
        heuristicName: "c7-roomplan-quality",
        heuristicVersion: "1.0.0",
        instructionCounts: [:],
        interruptionCount: 0,
        lowConfidenceObjectCount: 0,
        lowConfidenceSurfaceCount: 0,
        relocalisationAttemptCount: 0,
        relocalisationSuccessCount: 0,
        scanDurationMilliseconds: 1,
        worldMappingStatusAtFinish: .limited
      ),
      referenceMeasurements: [],
      rights: C7CaptureRights(basis: .ownedByUser, serviceProcessingConsent: true),
      rooms: [],
      schemaVersion: C7CaptureContract.capturePackageSchemaVersion,
      sharedWorldOrigin: false,
      startedAt: "2026-07-17T12:00:00.000Z"
    )

    #expect(throws: C7CaptureContractError.invalidPackage) {
      try C7CapturePackageValidator.validate(package)
    }
  }
}

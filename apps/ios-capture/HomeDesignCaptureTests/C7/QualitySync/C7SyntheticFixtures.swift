import Foundation

@testable import HomeDesignCapture

struct C7FixedClock: C7CaptureClock {
  let value: Date
  func now() -> Date { value }
}

enum C7SyntheticFixture {
  static let now = Date(timeIntervalSince1970: 1_768_478_400)
  static let projectId = UUID(uuidString: "70000000-0000-4000-8000-000000000001")!
  static let sessionId = UUID(uuidString: "70000000-0000-4000-8000-000000000002")!
  static let roomId = UUID(uuidString: "70000000-0000-4000-8000-000000000003")!
  static let roomSourceId = UUID(uuidString: "70000000-0000-4000-8000-000000000004")!
  static let surfaceId = UUID(uuidString: "70000000-0000-4000-8000-000000000005")!
  static let objectId = UUID(uuidString: "70000000-0000-4000-8000-000000000006")!
  static let roomArtifactId = UUID(uuidString: "70000000-0000-4000-8000-000000000007")!
  static let packageId = UUID(uuidString: "70000000-0000-4000-8000-000000000008")!
  static let proposalId = UUID(uuidString: "70000000-0000-4000-8000-000000000009")!

  static var rights: C7CaptureRights {
    C7CaptureRights(basis: .ownedByUser, serviceProcessingConsent: true)
  }

  static func brief(
    mode: C7CaptureMode = .singleRoom,
    expiresAt: String = "2026-07-18T12:00:00.000Z"
  ) -> C7CaptureBrief {
    C7CaptureBrief(
      captureLabel: "VISIBLY SYNTHETIC capture",
      captureSessionId: sessionId,
      expiresAt: expiresAt,
      expectedRoomCount: mode == .singleRoom ? 1 : 2,
      instructionsVersion: "synthetic-instructions-v1",
      mode: mode,
      projectId: projectId,
      rights: rights,
      schemaVersion: C7CaptureContract.captureSessionSchemaVersion
    )
  }

  static func session(
    state: C7ServerCaptureState = .created,
    version: Int = 1,
    mode: C7CaptureMode = .singleRoom
  ) -> C7CaptureSession {
    let needsPackage: Bool = [.uploaded, .processing, .proposed, .abstained].contains(state)
    return C7CaptureSession(
      brief: brief(mode: mode),
      createdAt: "2026-07-17T12:00:00.000Z",
      id: sessionId,
      packageId: needsPackage ? packageId : nil,
      projectId: projectId,
      proposalId: state == .proposed ? proposalId : nil,
      retryable: state == .failed || state == .abstained,
      safeCode: state == .failed || state == .abstained ? "SYNTHETIC_SAFE_CODE" : nil,
      schemaVersion: C7CaptureContract.captureSessionSchemaVersion,
      state: state,
      updatedAt: "2026-07-17T12:05:00.000Z",
      version: version
    )
  }

  static var room: C7CaptureRoomManifest {
    C7CaptureRoomManifest(
      capturedRoomVersion: 1,
      roomId: roomId,
      sequence: 1,
      sourceRoomIdentifier: roomSourceId,
      story: 0,
      userLabel: "Synthetic room"
    )
  }

  static func quality(
    mapping: C7WorldMappingStatus = .mapped,
    lowSurfaces: Int = 0,
    interruptions: Int = 0,
    relocalisationAttempts: Int = 0,
    relocalisationSuccesses: Int = 0
  ) -> C7CaptureQualityManifest {
    C7CaptureQualityManifest(
      heuristicName: "c7-roomplan-quality",
      heuristicVersion: "synthetic-1.0.0",
      instructionCounts: Dictionary(
        uniqueKeysWithValues: C7CaptureInstruction.allCases.map { ($0, 0) }
      ),
      interruptionCount: interruptions,
      lowConfidenceObjectCount: 0,
      lowConfidenceSurfaceCount: lowSurfaces,
      relocalisationAttemptCount: relocalisationAttempts,
      relocalisationSuccessCount: relocalisationSuccesses,
      scanDurationMilliseconds: 60_000,
      worldMappingStatusAtFinish: mapping
    )
  }

  static var transform: C7RoomPlanTransform {
    C7RoomPlanTransform(
      basisNanounits: [
        1_000_000_000, 0, 0,
        0, 1_000_000_000, 0,
        0, 0, 1_000_000_000,
      ],
      translationMicrometres: C7IntegerPoint3(x: 0, y: 0, z: 0)
    )
  }

  static func normalized(
    quality: C7CaptureQualityManifest = quality()
  ) -> C7NormalizedRoomPlan {
    C7NormalizedRoomPlan(
      captureSessionId: sessionId,
      coordinateSystem: .roomPlanWorld,
      objects: [
        C7NormalizedRoomPlanObject(
          category: .table,
          confidence: .medium,
          dimensionsMicrometres: C7IntegerDimensions3(
            x: 1_000_000,
            y: 800_000,
            z: 750_000
          ),
          parentSourceIdentifier: nil,
          roomId: roomId,
          sourceIdentifier: objectId,
          story: 0,
          transform: transform
        )
      ],
      projectId: projectId,
      quality: quality,
      referenceMeasurements: [],
      rooms: [room],
      schemaVersion: C7CaptureContract.normalizedRoomPlanSchemaVersion,
      structureIdentifier: nil,
      surfaces: [
        C7NormalizedRoomPlanSurface(
          category: .wall,
          completedEdges: [.bottom, .left, .right, .top],
          confidence: .high,
          curve: nil,
          dimensionsMicrometres: C7IntegerDimensions3(
            x: 4_000_000,
            y: 100_000,
            z: 2_400_000
          ),
          parentSourceIdentifier: nil,
          polygonCornersMicrometres: [],
          roomId: roomId,
          sourceIdentifier: surfaceId,
          story: 0,
          transform: transform
        )
      ]
    )
  }

  static func review(sourceURL: URL) -> C7CaptureReviewDraft {
    C7CaptureReviewDraft(
      device: C7CaptureDeviceManifest(
        appBuild: "synthetic-build",
        appVersion: "synthetic-1.0",
        deviceModelIdentifier: "synthetic-lidar-device",
        operatingSystemVersion: "synthetic-os",
        roomPlanSupported: true
      ),
      endedAt: "2026-07-17T12:01:00.000Z",
      normalized: normalized(),
      rawArtifacts: [
        C7CaptureRawArtifactSource(
          artifactId: roomArtifactId,
          contentType: .json,
          fileURL: sourceURL,
          kind: .capturedRoomJSON,
          roomId: roomId
        )
      ],
      sharedWorldOrigin: true,
      startedAt: "2026-07-17T12:00:00.000Z"
    )
  }

  static func temporaryDirectory() throws -> URL {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("C7-SYNTHETIC-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
  }

  static func sourceFile(in root: URL, bytes: Int = 1024) throws -> URL {
    let url = root.appendingPathComponent("VISIBLY-SYNTHETIC-ROOM.json")
    let marker = Data("VISIBLY SYNTHETIC ROOMPLAN FIXTURE\n".utf8)
    var data = Data()
    while data.count < bytes { data.append(marker) }
    if data.count > bytes { data.removeSubrange(bytes..<data.count) }
    try data.write(to: url)
    return url
  }

  static func preparedJournal(
    root: URL,
    sourceBytes: Int = 1024,
    clock: C7FixedClock = C7FixedClock(value: now)
  ) async throws -> (C7ProtectedCaptureJournal, C7CaptureJournalRecord) {
    let journal = C7ProtectedCaptureJournal(root: root, clock: clock)
    var record = try await journal.create(brief: brief(), serverVersion: 1)
    let source = try sourceFile(in: root, bytes: sourceBytes)
    record = try await journal.stageReview(review(sourceURL: source), record: record)
    record = try await journal.finalizeReview(
      record: record,
      rooms: [room],
      referenceMeasurements: []
    )
    return (journal, record)
  }

  static func proposal() -> C7CaptureProposalResult {
    .proposal(
      C7CaptureModelProposalSummary(
        captureSessionId: sessionId,
        createdAt: "2026-07-17T12:05:00.000Z",
        findings: [],
        overallConfidence: 72,
        packageId: packageId,
        packageManifestSha256: String(repeating: "a", count: 64),
        projectId: projectId,
        proposalId: proposalId,
        schemaVersion: C7CaptureContract.captureProposalSchemaVersion,
        unresolvedSourceEntityIds: [objectId]
      )
    )
  }

  static func abstention() -> C7CaptureProposalResult {
    .abstained(
      C7CaptureAbstentionSummary(
        captureSessionId: sessionId,
        code: .lowQuality,
        createdAt: "2026-07-17T12:05:00.000Z",
        detail: "VISIBLY SYNTHETIC low-quality abstention.",
        findings: [],
        nextActions: [.rescanRoom, .usePlan],
        packageId: packageId,
        packageManifestSha256: String(repeating: "b", count: 64),
        projectId: projectId,
        proposalId: proposalId,
        retryable: true,
        schemaVersion: C7CaptureContract.captureProposalSchemaVersion
      )
    )
  }
}

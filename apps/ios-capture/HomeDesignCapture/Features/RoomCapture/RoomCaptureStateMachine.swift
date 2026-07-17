import Foundation

enum RoomCapturePermissionPhase: Equatable, Sendable {
  case cameraDenied
  case cameraNotDetermined
  case cameraRestricted
  case checking
  case unsupported(CaptureUnavailableReason)
}

enum RoomCaptureSafeFailure: String, Error, Equatable, Sendable {
  case captureEngineFailed = "CAPTURE_ENGINE_FAILED"
  case incompatibleWorldOrigin = "INCOMPATIBLE_WORLD_ORIGIN"
  case invalidTransition = "INVALID_LOCAL_TRANSITION"
  case relocalisationExhausted = "RELOCALISATION_EXHAUSTED"
  case reviewInvalid = "ROOM_REVIEW_INVALID"
}

struct RoomCaptureRun: Equatable, Sendable {
  let captureSessionId: UUID
  var completedRooms: [RoomCaptureRoomEvidence]
  var discardedRoomCount: Int
  var instructionCounts: [C7CaptureInstruction: Int]
  var interruptionCount: Int
  var lastInstruction: C7CaptureInstruction
  var lastRoomUpdate: RoomCaptureLiveUpdate?
  let mode: C7CaptureMode
  let projectId: UUID
  var relocalisationAttemptCount: Int
  var relocalisationSuccessCount: Int
  var restartCount: Int
  let rights: C7CaptureRights
  var worldMappingStatus: C7WorldMappingStatus
  var worldOriginIdentifier: UUID?

  init(
    captureSessionId: UUID,
    mode: C7CaptureMode,
    projectId: UUID,
    rights: C7CaptureRights
  ) {
    self.captureSessionId = captureSessionId
    completedRooms = []
    discardedRoomCount = 0
    instructionCounts = Dictionary(
      uniqueKeysWithValues: C7CaptureInstruction.allCases.map { ($0, 0) }
    )
    interruptionCount = 0
    lastInstruction = .normal
    lastRoomUpdate = nil
    self.mode = mode
    self.projectId = projectId
    relocalisationAttemptCount = 0
    relocalisationSuccessCount = 0
    restartCount = 0
    self.rights = rights
    worldMappingStatus = .notAvailable
    worldOriginIdentifier = nil
  }
}

struct RoomCaptureTransferProgress: Equatable, Sendable {
  let artifactCount: Int
  var uploadedArtifactCount: Int
}

enum RoomCaptureLocalState: Equatable, Sendable {
  case abstained(RoomCaptureAbstentionInput)
  case cancelled
  case failed(RoomCaptureSafeFailure)
  case interrupted(RoomCaptureRun)
  case offline(RoomCaptureTransferProgress)
  case packaging(RoomCaptureRun, RoomCaptureStructureEvidence?)
  case pausedUpload(RoomCaptureTransferProgress)
  case permission(RoomCapturePermissionPhase, RoomCaptureRun)
  case processing
  case proposed(UUID)
  case ready(RoomCaptureRun)
  case relocalising(RoomCaptureRun)
  case roomReview(RoomCaptureRun, RoomCaptureRoomEvidence)
  case scanning(RoomCaptureRun)
  case structureReview(RoomCaptureRun, RoomCaptureStructureEvidence)
  case uploading(RoomCaptureTransferProgress)
}

enum RoomCaptureStateEvent: Equatable, Sendable {
  case acceptRoom(userLabel: String?, story: Int)
  case acceptStructure
  case cameraPreflight(CapturePreflightDecision)
  case cancel
  case captureStarted(worldOriginIdentifier: UUID)
  case engineFailed(RoomCaptureEngineFailure)
  case instruction(C7CaptureInstruction)
  case interrupted
  case localAbstained(RoomCaptureAbstentionInput)
  case packageReady(artifactCount: Int, offline: Bool)
  case pauseUpload
  case proposalReceived(UUID)
  case rejectRoom
  case relocalisationBegan
  case relocalisationFailed
  case relocalisationSucceeded
  case resumeUpload(offline: Bool)
  case roomCompleted(RoomCaptureRoomEvidence)
  case roomUpdate(RoomCaptureLiveUpdate)
  case safeRestart
  case serverAbstained(RoomCaptureAbstentionInput)
  case structureCompleted(RoomCaptureStructureEvidence)
  case uploadCompleted
  case uploadProgress(Int)
  case worldMappingChanged(C7WorldMappingStatus)
}

struct RoomCaptureStateMachine: Equatable, Sendable {
  static let maximumRelocalisationAttempts = 2

  private(set) var state: RoomCaptureLocalState

  init(run: RoomCaptureRun) {
    state = .permission(.checking, run)
  }

  mutating func fail(_ failure: RoomCaptureSafeFailure) {
    guard !state.isTerminal else { return }
    state = .failed(failure)
  }

  mutating func transition(_ event: RoomCaptureStateEvent) throws {
    if case .cancel = event {
      guard !state.isTerminal else { throw RoomCaptureSafeFailure.invalidTransition }
      state = .cancelled
      return
    }

    if case .engineFailed = event {
      guard !state.isTerminal else { throw RoomCaptureSafeFailure.invalidTransition }
      state = .failed(.captureEngineFailed)
      return
    }

    if case .localAbstained(let abstention) = event {
      guard !state.isTerminal else { throw RoomCaptureSafeFailure.invalidTransition }
      state = .abstained(abstention)
      return
    }

    switch (state, event) {
    case (.permission(_, let run), .cameraPreflight(let decision)):
      switch decision {
      case .ready:
        state = .ready(run)
      case .cameraDenied:
        state = .permission(.cameraDenied, run)
      case .cameraNotDetermined:
        state = .permission(.cameraNotDetermined, run)
      case .cameraRestricted:
        state = .permission(.cameraRestricted, run)
      case .unavailable(let reason):
        state = .permission(.unsupported(reason), run)
      }

    case (.ready(var run), .captureStarted(let origin)):
      if let existingOrigin = run.worldOriginIdentifier, existingOrigin != origin {
        state = .abstained(Self.incompatibleWorldOriginAbstention())
      } else {
        run.worldOriginIdentifier = origin
        state = .scanning(run)
      }

    case (.scanning(var run), .instruction(let instruction)):
      let nextCount = (run.instructionCounts[instruction] ?? 0) + 1
      guard nextCount <= 1_000_000 else { throw RoomCaptureSafeFailure.reviewInvalid }
      run.instructionCounts[instruction] = nextCount
      run.lastInstruction = instruction
      state = .scanning(run)

    case (.scanning(var run), .roomUpdate(let update)):
      guard
        update.objectCount >= 0,
        update.objectCount <= C7CaptureContract.maximumObjectCount,
        update.surfaceCount >= 0,
        update.surfaceCount <= C7CaptureContract.maximumSurfaceCount
      else { throw RoomCaptureSafeFailure.reviewInvalid }
      run.lastRoomUpdate = update
      state = .scanning(run)

    case (.scanning(var run), .worldMappingChanged(let status)):
      run.worldMappingStatus = status
      state = .scanning(run)

    case (.scanning(var run), .interrupted):
      run.interruptionCount += 1
      state = .interrupted(run)

    case (.interrupted(var run), .relocalisationBegan):
      run.relocalisationAttemptCount += 1
      if run.relocalisationAttemptCount > Self.maximumRelocalisationAttempts {
        state = .failed(.relocalisationExhausted)
      } else {
        state = .relocalising(run)
      }

    case (.relocalising(var run), .relocalisationSucceeded):
      run.relocalisationSuccessCount += 1
      state = .scanning(run)

    case (.relocalising(let run), .relocalisationFailed):
      state =
        run.relocalisationAttemptCount >= Self.maximumRelocalisationAttempts
        ? .failed(.relocalisationExhausted)
        : .interrupted(run)

    case (.scanning(let run), .roomCompleted(let room)):
      guard room.sequence == run.completedRooms.count + 1 else {
        throw RoomCaptureSafeFailure.reviewInvalid
      }
      guard room.worldOriginIdentifier == run.worldOriginIdentifier else {
        state = .abstained(Self.incompatibleWorldOriginAbstention())
        return
      }
      state = .roomReview(run, room)

    case (
      .roomReview(var run, let room),
      .acceptRoom(userLabel: let userLabel, story: let story)
    ):
      let trimmedLabel = userLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
      guard
        (-20...200).contains(story),
        trimmedLabel?.isEmpty != true,
        (trimmedLabel?.count ?? 0) <= 120,
        run.completedRooms.count < C7CaptureContract.maximumRoomCount
      else { throw RoomCaptureSafeFailure.reviewInvalid }
      let reviewed = room.reviewed(userLabel: trimmedLabel, story: story)
      run.completedRooms.append(reviewed)
      state = run.mode == .singleRoom ? .packaging(run, nil) : .ready(run)

    case (.roomReview(var run, _), .rejectRoom):
      run.discardedRoomCount += 1
      state = .ready(run)

    case (.ready(let run), .structureCompleted(let structure)):
      guard run.mode == .structure, run.completedRooms.count >= 2 else {
        throw RoomCaptureSafeFailure.invalidTransition
      }
      guard
        structure.worldOriginIdentifier == run.worldOriginIdentifier,
        structure.rooms.map(\.roomId) == run.completedRooms.map(\.roomId)
      else {
        state = .abstained(Self.incompatibleWorldOriginAbstention())
        return
      }
      state = .structureReview(run, structure)

    case (.structureReview(let run, let structure), .acceptStructure):
      state = .packaging(run, structure)

    case (.ready(var run), .safeRestart),
      (.interrupted(var run), .safeRestart),
      (.relocalising(var run), .safeRestart):
      run.discardedRoomCount += run.completedRooms.count
      run.completedRooms = []
      run.lastRoomUpdate = nil
      run.restartCount += 1
      run.worldOriginIdentifier = nil
      state = .ready(run)

    case (.packaging(_, _), .packageReady(let artifactCount, let offline)):
      guard artifactCount >= 3, artifactCount <= C7CaptureContract.maximumArtifactCount else {
        throw RoomCaptureSafeFailure.reviewInvalid
      }
      let progress = RoomCaptureTransferProgress(
        artifactCount: artifactCount,
        uploadedArtifactCount: 0
      )
      state = offline ? .offline(progress) : .uploading(progress)

    case (.uploading(let progress), .pauseUpload):
      state = .pausedUpload(progress)

    case (.pausedUpload(let progress), .resumeUpload(let offline)),
      (.offline(let progress), .resumeUpload(let offline)):
      state = offline ? .offline(progress) : .uploading(progress)

    case (.uploading(var progress), .uploadProgress(let uploaded)):
      guard uploaded >= progress.uploadedArtifactCount, uploaded <= progress.artifactCount else {
        throw RoomCaptureSafeFailure.invalidTransition
      }
      progress.uploadedArtifactCount = uploaded
      state = .uploading(progress)

    case (.uploading(let progress), .uploadCompleted):
      guard progress.uploadedArtifactCount == progress.artifactCount else {
        throw RoomCaptureSafeFailure.invalidTransition
      }
      state = .processing

    case (.processing, .proposalReceived(let proposalId)):
      state = .proposed(proposalId)

    case (.processing, .serverAbstained(let abstention)):
      state = .abstained(abstention)

    default:
      throw RoomCaptureSafeFailure.invalidTransition
    }
  }

  private static func incompatibleWorldOriginAbstention() -> RoomCaptureAbstentionInput {
    RoomCaptureAbstentionInput(
      affectedSourceEntityIds: [],
      message: "Captured rooms do not share one compatible RoomPlan world origin.",
      reason: .incompatibleWorldOrigin
    )
  }
}

extension RoomCaptureLocalState {
  var isTerminal: Bool {
    switch self {
    case .abstained, .cancelled, .failed, .proposed:
      true
    case .interrupted, .offline, .packaging, .pausedUpload, .permission, .processing,
      .ready, .relocalising, .roomReview, .scanning, .structureReview, .uploading:
      false
    }
  }
}

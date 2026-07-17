import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C7 room capture state machine")
struct RoomCaptureStateMachineTests {
  @Test("single-room journey reaches packaging with exact updates")
  func singleRoomJourney() throws {
    var machine = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run(mode: .singleRoom))
    try machine.transition(.cameraPreflight(.ready))
    try machine.transition(
      .captureStarted(worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA))
    for instruction in C7CaptureInstruction.allCases {
      try machine.transition(.instruction(instruction))
    }
    let update = RoomCaptureLiveUpdate(
      kind: .changed,
      objectCount: 1,
      roomSourceIdentifier: SyntheticRoomCaptureFixtures.uuid(
        "71000000-0000-4000-8000-000000000001"
      ),
      surfaceCount: 1
    )
    try machine.transition(.roomUpdate(update))
    try machine.transition(.worldMappingChanged(.mapped))
    try machine.transition(.roomCompleted(SyntheticRoomCaptureFixtures.room()))
    guard case .roomReview(let run, _) = machine.state else {
      Issue.record("Expected room review")
      return
    }
    #expect(run.lastRoomUpdate == update)
    #expect(run.worldMappingStatus == .mapped)
    #expect(run.instructionCounts.values.reduce(0, +) == 6)

    try machine.transition(.acceptRoom(userLabel: " Kitchen ", story: 0))
    guard case .packaging(let packagingRun, nil) = machine.state else {
      Issue.record("Expected single-room packaging")
      return
    }
    #expect(packagingRun.completedRooms.count == 1)
    #expect(packagingRun.completedRooms[0].userLabel == "Kitchen")
  }

  @Test("continuous compatible rooms reach structure review and every sync state")
  func structureAndTransferJourney() throws {
    var machine = try twoRoomStructureMachine()
    let rooms = completedRooms(machine)
    let structure = RoomCaptureStructureEvidence(
      capturedStructureJSON: Data("{\"fixture\":\"synthetic-structure\"}".utf8),
      isSyntheticFixture: true,
      rooms: rooms,
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
      usdz: nil,
      worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA
    )

    try machine.transition(.structureCompleted(structure))
    guard case .structureReview = machine.state else {
      Issue.record("Expected structure review")
      return
    }
    try machine.transition(.acceptStructure)
    guard case .packaging = machine.state else {
      Issue.record("Expected packaging")
      return
    }
    try machine.transition(.packageReady(artifactCount: 5, offline: true))
    guard case .offline = machine.state else {
      Issue.record("Expected offline")
      return
    }
    try machine.transition(.resumeUpload(offline: false))
    try machine.transition(.uploadProgress(2))
    try machine.transition(.pauseUpload)
    guard case .pausedUpload = machine.state else {
      Issue.record("Expected paused upload")
      return
    }
    try machine.transition(.resumeUpload(offline: false))
    try machine.transition(.uploadProgress(5))
    try machine.transition(.uploadCompleted)
    #expect(machine.state == .processing)
    let proposalId = SyntheticRoomCaptureFixtures.uuid(
      "90000000-0000-4000-8000-000000000001"
    )
    try machine.transition(.proposalReceived(proposalId))
    #expect(machine.state == .proposed(proposalId))
  }

  @Test("interruption relocalises, then bounded exhaustion fails safely")
  func relocalisationAndExhaustion() throws {
    var machine = try scanningMachine()
    try machine.transition(.interrupted)
    guard case .interrupted = machine.state else {
      Issue.record("Expected interrupted")
      return
    }
    try machine.transition(.relocalisationBegan)
    guard case .relocalising = machine.state else {
      Issue.record("Expected relocalising")
      return
    }
    try machine.transition(.relocalisationSucceeded)
    guard case .scanning(let run) = machine.state else {
      Issue.record("Expected resumed scan")
      return
    }
    #expect(run.interruptionCount == 1)
    #expect(run.relocalisationAttemptCount == 1)
    #expect(run.relocalisationSuccessCount == 1)

    try machine.transition(.interrupted)
    try machine.transition(.relocalisationBegan)
    try machine.transition(.relocalisationFailed)
    #expect(machine.state == .failed(.relocalisationExhausted))
  }

  @Test("safe restart clears the prior world-origin group")
  func safeRestartClearsRooms() throws {
    var machine = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run())
    try machine.transition(.cameraPreflight(.ready))
    try machine.transition(
      .captureStarted(worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA))
    try machine.transition(.roomCompleted(SyntheticRoomCaptureFixtures.room()))
    try machine.transition(.acceptRoom(userLabel: nil, story: 0))
    try machine.transition(.safeRestart)
    guard case .ready(let run) = machine.state else {
      Issue.record("Expected ready after restart")
      return
    }
    #expect(run.completedRooms.isEmpty)
    #expect(run.discardedRoomCount == 1)
    #expect(run.restartCount == 1)
    #expect(run.worldOriginIdentifier == nil)
    try machine.transition(
      .captureStarted(worldOriginIdentifier: SyntheticRoomCaptureFixtures.originB))
    guard case .scanning(let restartedRun) = machine.state else {
      Issue.record("Expected restarted scan")
      return
    }
    #expect(restartedRun.worldOriginIdentifier == SyntheticRoomCaptureFixtures.originB)
  }

  @Test("incompatible room is never joined")
  func incompatibleRoom() throws {
    var machine = try scanningMachine()
    try machine.transition(.roomCompleted(SyntheticRoomCaptureFixtures.room(origin: .init())))
    guard case .abstained(let input) = machine.state else {
      Issue.record("Expected abstention")
      return
    }
    #expect(input.reason == .incompatibleWorldOrigin)
  }

  @Test(
    "permission decisions remain explicit",
    arguments: [
      (CapturePreflightDecision.cameraDenied, RoomCapturePermissionPhase.cameraDenied),
      (CapturePreflightDecision.cameraRestricted, RoomCapturePermissionPhase.cameraRestricted),
      (
        CapturePreflightDecision.cameraNotDetermined, RoomCapturePermissionPhase.cameraNotDetermined
      ),
      (
        CapturePreflightDecision.unavailable(.roomPlanUnsupported),
        RoomCapturePermissionPhase.unsupported(.roomPlanUnsupported)
      ),
    ])
  func permissionStates(
    decision: CapturePreflightDecision,
    expected: RoomCapturePermissionPhase
  ) throws {
    var machine = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run())
    try machine.transition(.cameraPreflight(decision))
    guard case .permission(let actual, _) = machine.state else {
      Issue.record("Expected permission state")
      return
    }
    #expect(actual == expected)
  }

  @Test("reject, cancel, engine failure, local and server abstention are explicit")
  func terminalAndRecoveryStates() throws {
    var rejected = try scanningMachine()
    try rejected.transition(.roomCompleted(SyntheticRoomCaptureFixtures.room()))
    try rejected.transition(.rejectRoom)
    guard case .ready(let run) = rejected.state else {
      Issue.record("Expected ready after rejection")
      return
    }
    #expect(run.discardedRoomCount == 1)

    var cancelled = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run())
    try cancelled.transition(.cancel)
    #expect(cancelled.state == .cancelled)

    var failed = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run())
    try failed.transition(.engineFailed(.deviceUnsupported))
    #expect(failed.state == .failed(.captureEngineFailed))

    let abstention = RoomCaptureAbstentionInput(
      affectedSourceEntityIds: [],
      message: "Synthetic abstention",
      reason: .invalidDimension
    )
    var local = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run())
    try local.transition(.localAbstained(abstention))
    #expect(local.state == .abstained(abstention))

    var processing = try processingMachine()
    try processing.transition(.serverAbstained(abstention))
    #expect(processing.state == .abstained(abstention))
  }

  @Test("invalid and non-monotonic transitions reject")
  func invalidTransitions() throws {
    var machine = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run())
    #expect(throws: RoomCaptureSafeFailure.invalidTransition) {
      try machine.transition(.acceptStructure)
    }
    machine = try scanningMachine()
    #expect(throws: RoomCaptureSafeFailure.invalidTransition) {
      try machine.transition(.uploadCompleted)
    }
  }

  private func scanningMachine() throws -> RoomCaptureStateMachine {
    var machine = RoomCaptureStateMachine(run: SyntheticRoomCaptureFixtures.run())
    try machine.transition(.cameraPreflight(.ready))
    try machine.transition(
      .captureStarted(worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA))
    return machine
  }

  private func twoRoomStructureMachine() throws -> RoomCaptureStateMachine {
    var machine = try scanningMachine()
    try machine.transition(.roomCompleted(SyntheticRoomCaptureFixtures.room(sequence: 1)))
    try machine.transition(.acceptRoom(userLabel: "Room one", story: 0))
    try machine.transition(
      .captureStarted(worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA))
    try machine.transition(.roomCompleted(SyntheticRoomCaptureFixtures.room(sequence: 2)))
    try machine.transition(.acceptRoom(userLabel: "Room two", story: 0))
    return machine
  }

  private func processingMachine() throws -> RoomCaptureStateMachine {
    var machine = try twoRoomStructureMachine()
    let rooms = completedRooms(machine)
    try machine.transition(
      .structureCompleted(
        RoomCaptureStructureEvidence(
          capturedStructureJSON: Data("{\"fixture\":true}".utf8),
          isSyntheticFixture: true,
          rooms: rooms,
          structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
          usdz: nil,
          worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA
        )))
    try machine.transition(.acceptStructure)
    try machine.transition(.packageReady(artifactCount: 3, offline: false))
    try machine.transition(.uploadProgress(3))
    try machine.transition(.uploadCompleted)
    return machine
  }

  private func completedRooms(_ machine: RoomCaptureStateMachine) -> [RoomCaptureRoomEvidence] {
    guard case .ready(let run) = machine.state else { return [] }
    return run.completedRooms
  }
}

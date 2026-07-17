import Combine
import Foundation

protocol RoomCaptureClock: Sendable {
  func now() -> Date
}

struct SystemRoomCaptureClock: RoomCaptureClock {
  func now() -> Date { Date() }
}

@MainActor
final class RoomCaptureCoordinator: ObservableObject {
  @Published private(set) var artifactBundle: RoomCaptureArtifactBundle?
  @Published private(set) var state: RoomCaptureLocalState

  private let clock: any RoomCaptureClock
  private let engine: any RoomCaptureEngine
  private let environment: RoomCaptureArtifactEnvironment
  private var eventTask: Task<Void, Never>?
  private var relocalisationTimeoutTask: Task<Void, Never>?
  private let referenceMeasurements: [C7ReferenceMeasurement]
  private var scanStartedAt: Date?
  private var stateMachine: RoomCaptureStateMachine

  init(
    engine: any RoomCaptureEngine,
    environment: RoomCaptureArtifactEnvironment,
    referenceMeasurements: [C7ReferenceMeasurement] = [],
    run: RoomCaptureRun,
    clock: any RoomCaptureClock = SystemRoomCaptureClock()
  ) {
    self.clock = clock
    self.engine = engine
    self.environment = environment
    self.referenceMeasurements = referenceMeasurements
    stateMachine = RoomCaptureStateMachine(run: run)
    state = stateMachine.state
    let events = engine.events
    eventTask = Task { @MainActor [weak self] in
      for await event in events {
        guard let self, !Task.isCancelled else { return }
        await handleEngineEvent(event)
      }
    }
  }

  deinit {
    eventTask?.cancel()
    relocalisationTimeoutTask?.cancel()
  }

  func prepare(using preflight: CapturePreflightEvaluator, requestPermission: Bool) async {
    let decision = await preflight.evaluate(requestIfNeeded: requestPermission)
    apply(.cameraPreflight(decision))
  }

  func startRoom(includeUSDZ: Bool) async {
    guard case .ready(let run) = state else {
      applyFailure(.invalidTransition)
      return
    }
    do {
      try await engine.startRoom(
        RoomCaptureStartRequest(
          includeUSDZ: includeUSDZ,
          roomSequence: run.completedRooms.count + 1,
          continuingWorldOrigin: run.worldOriginIdentifier
        ))
    } catch let failure as RoomCaptureEngineFailure {
      apply(.engineFailed(failure))
    } catch {
      apply(.engineFailed(.captureFailed(code: "CAPTURE_START_FAILED")))
    }
  }

  func stopCurrentRoom() async {
    guard case .scanning(let run) = state else {
      applyFailure(.invalidTransition)
      return
    }
    await engine.stopRoom(pauseARSession: run.mode == .singleRoom)
  }

  func acceptRoom(userLabel: String?, story: Int) {
    apply(.acceptRoom(userLabel: userLabel, story: story))
    if case .packaging(let run, let structure) = state {
      produceArtifacts(run: run, structure: structure)
    }
  }

  func rejectRoom() async {
    guard case .roomReview(_, let room) = state else {
      applyFailure(.invalidTransition)
      return
    }
    await engine.discardRoom(room.roomId)
    apply(.rejectRoom)
  }

  func reviewStructure() async {
    guard case .ready(let run) = state, run.mode == .structure else {
      applyFailure(.invalidTransition)
      return
    }
    do {
      try await engine.buildStructure(from: run.completedRooms)
    } catch let failure as RoomCaptureEngineFailure {
      if failure == .incompatibleWorldOrigin {
        apply(
          .localAbstained(
            RoomCaptureAbstentionInput(
              affectedSourceEntityIds: run.completedRooms.map(\.sourceRoomIdentifier),
              message: "Rooms could not be merged in one compatible RoomPlan world origin.",
              reason: .incompatibleWorldOrigin
            )))
      } else {
        apply(.engineFailed(failure))
      }
    } catch {
      apply(.engineFailed(.structureBuildFailed(code: "STRUCTURE_BUILD_FAILED")))
    }
  }

  func acceptStructure() {
    apply(.acceptStructure)
    if case .packaging(let run, let structure) = state {
      produceArtifacts(run: run, structure: structure)
    }
  }

  func safeRestart() async {
    relocalisationTimeoutTask?.cancel()
    await engine.safeRestart()
    apply(.safeRestart)
  }

  func cancel() {
    relocalisationTimeoutTask?.cancel()
    apply(.cancel)
  }

  private func handleEngineEvent(_ event: RoomCaptureEngineEvent) async {
    switch event {
    case .failed(let failure):
      apply(.engineFailed(failure))
    case .instruction(let instruction):
      apply(.instruction(instruction))
    case .interrupted:
      apply(.interrupted)
    case .relocalisationBegan:
      apply(.relocalisationBegan)
      scheduleRelocalisationTimeout()
    case .relocalisationSucceeded:
      relocalisationTimeoutTask?.cancel()
      apply(.relocalisationSucceeded)
    case .roomCompleted(let room):
      apply(.roomCompleted(room))
    case .roomUpdate(let update):
      apply(.roomUpdate(update))
    case .started(let worldOriginIdentifier):
      if scanStartedAt == nil { scanStartedAt = clock.now() }
      apply(.captureStarted(worldOriginIdentifier: worldOriginIdentifier))
    case .structureCompleted(let structure):
      apply(.structureCompleted(structure))
    case .worldMappingChanged(let status):
      apply(.worldMappingChanged(status))
    }
  }

  private func scheduleRelocalisationTimeout() {
    relocalisationTimeoutTask?.cancel()
    relocalisationTimeoutTask = Task { @MainActor [weak self] in
      do {
        try await Task.sleep(for: .seconds(30))
      } catch {
        return
      }
      guard let self, case .relocalising = state else { return }
      apply(.relocalisationFailed)
      if case .interrupted = state {
        apply(.relocalisationBegan)
        scheduleRelocalisationTimeout()
      }
    }
  }

  private func produceArtifacts(
    run: RoomCaptureRun,
    structure: RoomCaptureStructureEvidence?
  ) {
    let startedAt = scanStartedAt ?? clock.now()
    let elapsed = max(1, Int(clock.now().timeIntervalSince(startedAt) * 1_000))
    let boundedDuration = min(elapsed, 21_600_000)
    let quality = RoomCaptureArtifactProducer.qualityManifest(
      from: run,
      scanDurationMilliseconds: boundedDuration
    )
    switch RoomCaptureArtifactProducer.produce(
      .init(
        captureSessionId: run.captureSessionId,
        environment: environment,
        projectId: run.projectId,
        quality: quality,
        referenceMeasurements: referenceMeasurements,
        rooms: run.completedRooms,
        structure: structure
      ))
    {
    case .abstained(let abstention):
      apply(.localAbstained(abstention))
    case .produced(let bundle):
      artifactBundle = bundle
    }
  }

  private func apply(_ event: RoomCaptureStateEvent) {
    do {
      try stateMachine.transition(event)
      state = stateMachine.state
    } catch let failure as RoomCaptureSafeFailure {
      applyFailure(failure)
    } catch {
      applyFailure(.invalidTransition)
    }
  }

  private func applyFailure(_ failure: RoomCaptureSafeFailure) {
    stateMachine.fail(failure)
    state = stateMachine.state
  }
}

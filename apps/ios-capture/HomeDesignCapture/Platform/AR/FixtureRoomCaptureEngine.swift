import Foundation

/// Deterministic, visibly synthetic engine for Simulator and state tests. It
/// never claims RoomPlan, LiDAR, camera, tracking, or physical-device evidence.
@MainActor
final class FixtureRoomCaptureEngine: RoomCaptureEngine {
  let events: AsyncStream<RoomCaptureEngineEvent>
  private let continuation: AsyncStream<RoomCaptureEngineEvent>.Continuation
  private var originIndex = 0
  private var roomIndex = 0
  private let rooms: [RoomCaptureRoomEvidence]
  private let structureIdentifier: UUID
  private let worldOrigins: [UUID]
  private(set) var stopPauseValues: [Bool] = []

  init(
    rooms: [RoomCaptureRoomEvidence],
    structureIdentifier: UUID,
    worldOrigins: [UUID]
  ) {
    precondition(!worldOrigins.isEmpty, "Synthetic fixtures require a world-origin identifier.")
    precondition(
      Set(worldOrigins).count == worldOrigins.count,
      "Synthetic restart world origins must be unique."
    )
    precondition(
      rooms.allSatisfy(\.isSyntheticFixture),
      "The fixture engine accepts visibly synthetic evidence only."
    )
    var capturedContinuation: AsyncStream<RoomCaptureEngineEvent>.Continuation?
    events = AsyncStream(bufferingPolicy: .bufferingNewest(128)) {
      capturedContinuation = $0
    }
    continuation = capturedContinuation!
    self.rooms = rooms
    self.structureIdentifier = structureIdentifier
    self.worldOrigins = worldOrigins
  }

  func startRoom(_ request: RoomCaptureStartRequest) async throws {
    guard request.roomSequence == roomIndex + 1 else {
      throw RoomCaptureEngineFailure.malformedRoomEvidence
    }
    let origin = worldOrigins[originIndex]
    if let requestedOrigin = request.continuingWorldOrigin, requestedOrigin != origin {
      throw RoomCaptureEngineFailure.incompatibleWorldOrigin
    }
    yield(.started(worldOriginIdentifier: origin))
  }

  func stopRoom(pauseARSession: Bool) async {
    stopPauseValues.append(pauseARSession)
    guard roomIndex < rooms.count else {
      yield(.failed(.malformedRoomEvidence))
      return
    }
    let room = roomForCurrentGroup(rooms[roomIndex])
    roomIndex += 1
    yield(.roomCompleted(room))
  }

  func discardRoom(_ roomId: UUID) async {
    guard roomIndex > 0, rooms[roomIndex - 1].roomId == roomId else {
      yield(.failed(.malformedRoomEvidence))
      return
    }
    roomIndex -= 1
  }

  func buildStructure(from rooms: [RoomCaptureRoomEvidence]) async throws {
    guard rooms.count >= 2 else {
      throw RoomCaptureEngineFailure.structureBuildFailed(code: "INSUFFICIENT_INPUT")
    }
    let origins = Set(rooms.map(\.worldOriginIdentifier))
    guard origins.count == 1, origins.first == worldOrigins[originIndex] else {
      yield(.failed(.incompatibleWorldOrigin))
      return
    }
    let roomIds = rooms.map { $0.roomId.uuidString.lowercased() }.joined(separator: ",")
    let data = Data("{\"fixture\":\"synthetic-roomplan-structure\",\"rooms\":\"\(roomIds)\"}".utf8)
    yield(
      .structureCompleted(
        RoomCaptureStructureEvidence(
          capturedStructureJSON: data,
          isSyntheticFixture: true,
          rooms: rooms,
          structureIdentifier: structureIdentifier,
          usdz: nil,
          worldOriginIdentifier: worldOrigins[originIndex]
        )))
  }

  func safeRestart() async {
    roomIndex = 0
    guard originIndex + 1 < worldOrigins.count else {
      yield(.failed(.malformedRoomEvidence))
      return
    }
    originIndex += 1
  }

  func simulateInstruction(_ instruction: C7CaptureInstruction) {
    yield(.instruction(instruction))
  }

  func simulateInterruption() {
    yield(.interrupted)
  }

  func simulateRelocalisationBegan() {
    yield(.relocalisationBegan)
  }

  func simulateRelocalisationSucceeded() {
    yield(.relocalisationSucceeded)
  }

  func simulateRoomUpdate(_ update: RoomCaptureLiveUpdate) {
    yield(.roomUpdate(update))
  }

  func simulateWorldMapping(_ status: C7WorldMappingStatus) {
    yield(.worldMappingChanged(status))
  }

  private func yield(_ event: RoomCaptureEngineEvent) {
    if case .dropped = continuation.yield(event) {
      _ = continuation.yield(.failed(.eventBufferOverflow))
    }
  }

  private func roomForCurrentGroup(_ room: RoomCaptureRoomEvidence) -> RoomCaptureRoomEvidence {
    RoomCaptureRoomEvidence(
      capturedRoomJSON: room.capturedRoomJSON,
      capturedRoomVersion: room.capturedRoomVersion,
      isSyntheticFixture: true,
      objects: room.objects,
      rawCapturedRoomDataJSON: room.rawCapturedRoomDataJSON,
      roomId: room.roomId,
      sequence: room.sequence,
      sourceRoomIdentifier: room.sourceRoomIdentifier,
      story: room.story,
      surfaces: room.surfaces,
      usdz: room.usdz,
      userLabel: room.userLabel,
      worldOriginIdentifier: worldOrigins[originIndex]
    )
  }
}

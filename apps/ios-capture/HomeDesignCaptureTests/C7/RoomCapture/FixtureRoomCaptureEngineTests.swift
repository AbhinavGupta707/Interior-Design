import Testing

@testable import HomeDesignCapture

@MainActor
@Suite("C7 synthetic fixture capture engine")
struct FixtureRoomCaptureEngineTests {
  @Test("continuous fixture preserves one origin and pauseARSession false")
  func continuousFixture() async throws {
    let rooms = [
      SyntheticRoomCaptureFixtures.room(sequence: 1),
      SyntheticRoomCaptureFixtures.room(sequence: 2),
    ]
    let engine = FixtureRoomCaptureEngine(
      rooms: rooms,
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
      worldOrigins: [SyntheticRoomCaptureFixtures.originA]
    )
    var iterator = engine.events.makeAsyncIterator()

    try await engine.startRoom(
      .init(
        includeUSDZ: false,
        roomSequence: 1,
        continuingWorldOrigin: nil
      ))
    #expect(
      await iterator.next()
        == .started(
          worldOriginIdentifier: SyntheticRoomCaptureFixtures.originA
        ))
    engine.simulateInstruction(.lowTexture)
    #expect(await iterator.next() == .instruction(.lowTexture))
    let update = RoomCaptureLiveUpdate(
      kind: .updated,
      objectCount: 1,
      roomSourceIdentifier: rooms[0].sourceRoomIdentifier,
      surfaceCount: 1
    )
    engine.simulateRoomUpdate(update)
    #expect(await iterator.next() == .roomUpdate(update))
    await engine.stopRoom(pauseARSession: false)
    #expect(await iterator.next() == .roomCompleted(rooms[0]))

    try await engine.startRoom(
      .init(
        includeUSDZ: false,
        roomSequence: 2,
        continuingWorldOrigin: SyntheticRoomCaptureFixtures.originA
      ))
    _ = await iterator.next()
    await engine.stopRoom(pauseARSession: false)
    #expect(await iterator.next() == .roomCompleted(rooms[1]))
    try await engine.buildStructure(from: rooms)
    guard case .structureCompleted(let structure)? = await iterator.next() else {
      Issue.record("Expected structure")
      return
    }
    #expect(structure.isSyntheticFixture)
    #expect(structure.rooms == rooms)
    #expect(structure.worldOriginIdentifier == SyntheticRoomCaptureFixtures.originA)
    #expect(engine.stopPauseValues == [false, false])
  }

  @Test("safe restart rotates origin and rejects stale continuation")
  func safeRestart() async throws {
    let engine = FixtureRoomCaptureEngine(
      rooms: [SyntheticRoomCaptureFixtures.room()],
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
      worldOrigins: [SyntheticRoomCaptureFixtures.originA, SyntheticRoomCaptureFixtures.originB]
    )
    var iterator = engine.events.makeAsyncIterator()
    try await engine.startRoom(
      .init(
        includeUSDZ: false,
        roomSequence: 1,
        continuingWorldOrigin: nil
      ))
    _ = await iterator.next()
    await engine.safeRestart()

    await #expect(throws: RoomCaptureEngineFailure.incompatibleWorldOrigin) {
      try await engine.startRoom(
        .init(
          includeUSDZ: false,
          roomSequence: 1,
          continuingWorldOrigin: SyntheticRoomCaptureFixtures.originA
        ))
    }
    try await engine.startRoom(
      .init(
        includeUSDZ: false,
        roomSequence: 1,
        continuingWorldOrigin: SyntheticRoomCaptureFixtures.originB
      ))
    #expect(
      await iterator.next()
        == .started(
          worldOriginIdentifier: SyntheticRoomCaptureFixtures.originB
        ))
    await engine.stopRoom(pauseARSession: false)
    guard case .roomCompleted(let restartedRoom)? = await iterator.next() else {
      Issue.record("Expected restarted synthetic room")
      return
    }
    #expect(restartedRoom.worldOriginIdentifier == SyntheticRoomCaptureFixtures.originB)
    #expect(restartedRoom.isSyntheticFixture)
  }

  @Test("discarded review evidence can be rescanned without advancing sequence")
  func discardAndRescan() async throws {
    let room = SyntheticRoomCaptureFixtures.room()
    let engine = FixtureRoomCaptureEngine(
      rooms: [room],
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
      worldOrigins: [SyntheticRoomCaptureFixtures.originA]
    )
    var iterator = engine.events.makeAsyncIterator()
    let request = RoomCaptureStartRequest(
      includeUSDZ: false,
      roomSequence: 1,
      continuingWorldOrigin: nil
    )

    try await engine.startRoom(request)
    _ = await iterator.next()
    await engine.stopRoom(pauseARSession: false)
    #expect(await iterator.next() == .roomCompleted(room))
    await engine.discardRoom(room.roomId)

    try await engine.startRoom(request)
    _ = await iterator.next()
    await engine.stopRoom(pauseARSession: false)
    #expect(await iterator.next() == .roomCompleted(room))
  }

  @Test("incompatible rooms emit a safe failure instead of a structure")
  func incompatibleStructure() async throws {
    let rooms = [
      SyntheticRoomCaptureFixtures.room(sequence: 1, origin: SyntheticRoomCaptureFixtures.originA),
      SyntheticRoomCaptureFixtures.room(sequence: 2, origin: SyntheticRoomCaptureFixtures.originB),
    ]
    let engine = FixtureRoomCaptureEngine(
      rooms: rooms,
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
      worldOrigins: [SyntheticRoomCaptureFixtures.originA]
    )
    var iterator = engine.events.makeAsyncIterator()

    try await engine.buildStructure(from: rooms)
    #expect(await iterator.next() == .failed(.incompatibleWorldOrigin))
  }

  @Test("single room records pauseARSession true and remains visibly synthetic")
  func singleRoomFixture() async throws {
    let room = SyntheticRoomCaptureFixtures.room()
    let engine = FixtureRoomCaptureEngine(
      rooms: [room],
      structureIdentifier: SyntheticRoomCaptureFixtures.structureId,
      worldOrigins: [SyntheticRoomCaptureFixtures.originA]
    )
    var iterator = engine.events.makeAsyncIterator()
    try await engine.startRoom(
      .init(
        includeUSDZ: false,
        roomSequence: 1,
        continuingWorldOrigin: nil
      ))
    _ = await iterator.next()
    await engine.stopRoom(pauseARSession: true)
    guard case .roomCompleted(let captured)? = await iterator.next() else {
      Issue.record("Expected room")
      return
    }
    #expect(captured.isSyntheticFixture)
    #expect(engine.stopPauseValues == [true])
  }
}

@preconcurrency import ARKit
import Foundation
import RoomPlan
import simd

enum RoomPlanInstructionMapper {
  static func map(_ instruction: RoomCaptureSession.Instruction) -> C7CaptureInstruction? {
    switch instruction {
    case .lowTexture: .lowTexture
    case .moveAwayFromWall: .moveAwayFromWall
    case .moveCloseToWall: .moveCloseToWall
    case .normal: .normal
    case .slowDown: .slowDown
    case .turnOnLight: .turnOnLight
    @unknown default: nil
    }
  }
}

@MainActor
enum SystemRoomCaptureEngineFactory {
  static func make() throws -> RoomPlanCaptureEngineAdapter {
    #if targetEnvironment(simulator)
      throw RoomCaptureEngineFailure.deviceUnsupported
    #else
      guard RoomCaptureSession.isSupported else {
        throw RoomCaptureEngineFailure.deviceUnsupported
      }
      return RoomPlanCaptureEngineAdapter()
    #endif
  }
}

/// Physical-device RoomPlan adapter. Its event contract contains semantic room
/// updates and mapping status only: camera pixel buffers are never read or kept,
/// and ARWorldMap is never exposed to package production.
@MainActor
final class RoomPlanCaptureEngineAdapter: NSObject, RoomCaptureEngine {
  let events: AsyncStream<RoomCaptureEngineEvent>
  private let continuation: AsyncStream<RoomCaptureEngineEvent>.Continuation
  private var appleRooms: [UUID: CapturedRoom] = [:]
  private var arSession = ARSession()
  private var arSessionIdentifier: ObjectIdentifier!
  private(set) var captureView: RoomCaptureView!
  private var captureSessionIdentifier: ObjectIdentifier!
  private var currentSequence = 0
  private var includeUSDZ = false
  private var isRelocalising = false
  private var lastWorldMappingStatus: C7WorldMappingStatus = .notAvailable
  private var roomCaptureSession: RoomCaptureSession!
  private var worldOriginIdentifier = UUID()

  override init() {
    var capturedContinuation: AsyncStream<RoomCaptureEngineEvent>.Continuation?
    events = AsyncStream(bufferingPolicy: .bufferingNewest(512)) {
      capturedContinuation = $0
    }
    continuation = capturedContinuation!
    super.init()
    configureSession()
  }

  func startRoom(_ request: RoomCaptureStartRequest) async throws {
    #if targetEnvironment(simulator)
      throw RoomCaptureEngineFailure.deviceUnsupported
    #else
      guard RoomCaptureSession.isSupported else {
        throw RoomCaptureEngineFailure.deviceUnsupported
      }
      guard request.roomSequence == appleRooms.count + 1 else {
        throw RoomCaptureEngineFailure.malformedRoomEvidence
      }
      if let expectedOrigin = request.continuingWorldOrigin,
        expectedOrigin != worldOriginIdentifier
      {
        throw RoomCaptureEngineFailure.incompatibleWorldOrigin
      }
      includeUSDZ = request.includeUSDZ
      currentSequence = request.roomSequence
      var configuration = RoomCaptureSession.Configuration()
      configuration.isCoachingEnabled = true
      roomCaptureSession.run(configuration: configuration)
    #endif
  }

  func stopRoom(pauseARSession: Bool) async {
    roomCaptureSession.stop(pauseARSession: pauseARSession)
  }

  func discardRoom(_ roomId: UUID) async {
    appleRooms.removeValue(forKey: roomId)
  }

  func safeRestart() async {
    roomCaptureSession.delegate = nil
    roomCaptureSession.stop(pauseARSession: true)
    arSession.delegate = nil
    arSession.pause()
    appleRooms.removeAll(keepingCapacity: false)
    currentSequence = 0
    includeUSDZ = false
    isRelocalising = false
    lastWorldMappingStatus = .notAvailable
    worldOriginIdentifier = UUID()
    configureSession()
  }

  func buildStructure(from rooms: [RoomCaptureRoomEvidence]) async throws {
    guard rooms.count >= 2 else {
      throw RoomCaptureEngineFailure.structureBuildFailed(code: "INSUFFICIENT_INPUT")
    }
    guard Set(rooms.map(\.worldOriginIdentifier)) == [worldOriginIdentifier] else {
      throw RoomCaptureEngineFailure.incompatibleWorldOrigin
    }
    let capturedRooms = try rooms.map { room -> CapturedRoom in
      guard let capturedRoom = appleRooms[room.roomId] else {
        throw RoomCaptureEngineFailure.malformedRoomEvidence
      }
      return capturedRoom
    }
    do {
      let structure = try await StructureBuilder(options: []).capturedStructure(from: capturedRooms)
      let encoded = try Self.deterministicEncoder().encode(structure)
      let usdz = includeUSDZ ? try exportUSDZ(structure) : nil
      yield(
        .structureCompleted(
          RoomCaptureStructureEvidence(
            capturedStructureJSON: encoded,
            isSyntheticFixture: false,
            rooms: rooms,
            structureIdentifier: structure.identifier,
            usdz: usdz,
            worldOriginIdentifier: worldOriginIdentifier
          )))
    } catch let error as RoomCaptureEngineFailure {
      throw error
    } catch let error as StructureBuilder.BuildError {
      throw RoomCaptureEngineFailure.structureBuildFailed(code: Self.safeCode(error))
    } catch {
      throw RoomCaptureEngineFailure.structureBuildFailed(code: "STRUCTURE_BUILD_FAILED")
    }
  }

  private func configureSession() {
    arSession = ARSession()
    captureView = RoomCaptureView(frame: .zero, arSession: arSession)
    roomCaptureSession = captureView.captureSession
    captureSessionIdentifier = ObjectIdentifier(roomCaptureSession)
    roomCaptureSession.delegate = self
    arSessionIdentifier = ObjectIdentifier(arSession)
    arSession.delegate = self
    arSession.delegateQueue = .main
  }

  private func processRoomData(_ data: CapturedRoomData) async {
    do {
      let rawJSON = try Self.deterministicEncoder().encode(data)
      let capturedRoom = try await RoomBuilder(options: []).capturedRoom(from: data)
      let roomJSON = try Self.deterministicEncoder().encode(capturedRoom)
      let roomId = capturedRoom.identifier
      let evidence = RoomCaptureRoomEvidence(
        capturedRoomJSON: roomJSON,
        capturedRoomVersion: capturedRoom.version,
        isSyntheticFixture: false,
        objects: capturedRoom.objects.map(Self.objectObservation),
        rawCapturedRoomDataJSON: rawJSON,
        roomId: roomId,
        sequence: currentSequence,
        sourceRoomIdentifier: capturedRoom.identifier,
        story: capturedRoom.story,
        surfaces: try Self.surfaceObservations(capturedRoom),
        usdz: includeUSDZ ? try exportUSDZ(capturedRoom) : nil,
        userLabel: nil,
        worldOriginIdentifier: worldOriginIdentifier
      )
      appleRooms[roomId] = capturedRoom
      yield(.roomCompleted(evidence))
    } catch let error as RoomCaptureEngineFailure {
      yield(.failed(error))
    } catch let error as RoomBuilder.BuildError {
      yield(.failed(.captureFailed(code: Self.safeCode(error))))
    } catch {
      yield(.failed(.captureFailed(code: "ROOM_PROCESSING_FAILED")))
    }
  }

  private func exportUSDZ(_ room: CapturedRoom) throws -> Data {
    try withProtectedTemporaryExport(named: "captured-room.usdz") { url in
      try room.export(
        to: url,
        metadataURL: nil,
        modelProvider: nil,
        exportOptions: [.parametric, .mesh]
      )
    }
  }

  private func exportUSDZ(_ structure: CapturedStructure) throws -> Data {
    try withProtectedTemporaryExport(named: "captured-structure.usdz") { url in
      try structure.export(
        to: url,
        metadataURL: nil,
        modelProvider: nil,
        exportOptions: [.parametric, .mesh]
      )
    }
  }

  private func withProtectedTemporaryExport(
    named filename: String,
    export: (URL) throws -> Void
  ) throws -> Data {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("roomplan-export-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: false,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent(filename, isDirectory: false)
    try export(url)
    let values = try url.resourceValues(forKeys: [.fileSizeKey])
    guard
      let size = values.fileSize,
      size > 0,
      Int64(size) <= C7CaptureContract.maximumArtifactBytes
    else { throw RoomCaptureEngineFailure.malformedRoomEvidence }
    return try Data(contentsOf: url, options: [.mappedIfSafe])
  }

  private func yield(_ event: RoomCaptureEngineEvent) {
    if case .dropped = continuation.yield(event) {
      _ = continuation.yield(.failed(.eventBufferOverflow))
      roomCaptureSession.stop(pauseARSession: true)
    }
  }

  private func yield(
    _ event: RoomCaptureEngineEvent,
    fromCaptureSession sourceIdentifier: ObjectIdentifier
  ) {
    guard sourceIdentifier == captureSessionIdentifier else { return }
    yield(event)
  }

  private func yield(
    _ event: RoomCaptureEngineEvent,
    fromARSession sourceIdentifier: ObjectIdentifier
  ) {
    guard sourceIdentifier == arSessionIdentifier else { return }
    yield(event)
  }

  private func handleCaptureEnd(
    fromCaptureSession sourceIdentifier: ObjectIdentifier,
    data: CapturedRoomData,
    error: (any Error)?
  ) async {
    guard sourceIdentifier == captureSessionIdentifier else { return }
    if let failure = Self.captureFailure(error) {
      yield(.failed(failure))
      return
    }
    await processRoomData(data)
  }

  private func handleTrackingNormal() {
    guard isRelocalising else { return }
    isRelocalising = false
    yield(.relocalisationSucceeded)
  }

  private func handleWorldMappingStatus(_ status: C7WorldMappingStatus) {
    guard status != lastWorldMappingStatus else { return }
    lastWorldMappingStatus = status
    yield(.worldMappingChanged(status))
  }

  private static func deterministicEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }

  nonisolated private static func safeCode(_ error: RoomCaptureSession.CaptureError) -> String {
    switch error {
    case .deviceNotSupported: "DEVICE_NOT_SUPPORTED"
    case .deviceTooHot: "DEVICE_TOO_HOT"
    case .exceedSceneSizeLimit: "SCENE_SIZE_LIMIT"
    case .internalError: "ROOMPLAN_INTERNAL_ERROR"
    case .invalidARConfiguration: "INVALID_AR_CONFIGURATION"
    case .worldTrackingFailure: "WORLD_TRACKING_FAILURE"
    @unknown default: "ROOMPLAN_CAPTURE_FAILED"
    }
  }

  nonisolated private static func safeCode(_ error: RoomBuilder.BuildError) -> String {
    switch error {
    case .deviceNotSupported: "DEVICE_NOT_SUPPORTED"
    case .exceedSceneSizeLimit: "SCENE_SIZE_LIMIT"
    case .insufficientInput: "INSUFFICIENT_INPUT"
    case .internalError: "ROOMPLAN_INTERNAL_ERROR"
    case .invalidInput: "INVALID_ROOM_INPUT"
    @unknown default: "ROOM_BUILD_FAILED"
    }
  }

  nonisolated private static func safeCode(_ error: StructureBuilder.BuildError) -> String {
    switch error {
    case .deviceNotSupported: "DEVICE_NOT_SUPPORTED"
    case .exceedSceneSizeLimit: "SCENE_SIZE_LIMIT"
    case .insufficientInput: "INSUFFICIENT_INPUT"
    case .internalError: "ROOMPLAN_INTERNAL_ERROR"
    case .invalidInput: "INVALID_STRUCTURE_INPUT"
    case .invalidRoomLocation: "INCOMPATIBLE_WORLD_ORIGIN"
    @unknown default: "STRUCTURE_BUILD_FAILED"
    }
  }

  nonisolated private static func captureFailure(_ error: (any Error)?) -> RoomCaptureEngineFailure?
  {
    guard let error else { return nil }
    if let captureError = error as? RoomCaptureSession.CaptureError {
      return .captureFailed(code: safeCode(captureError))
    }
    return .captureFailed(code: "ROOMPLAN_CAPTURE_FAILED")
  }

  nonisolated private static func surfaceObservations(
    _ room: CapturedRoom
  ) throws -> [RoomCaptureSurfaceObservation] {
    try (room.walls + room.doors + room.windows + room.openings + room.floors)
      .map(surfaceObservation)
  }

  nonisolated private static func surfaceObservation(
    _ surface: CapturedRoom.Surface
  ) throws -> RoomCaptureSurfaceObservation {
    let category: RoomCaptureSurfaceCategory
    switch surface.category {
    case .door(let isOpen): category = .door(isOpen: isOpen)
    case .floor: category = .floor
    case .opening: category = .opening
    case .wall: category = .wall
    case .window: category = .window
    @unknown default: throw RoomCaptureEngineFailure.malformedRoomEvidence
    }

    var completedEdges = Set<C7RoomPlanCompletedEdge>()
    for edge in surface.completedEdges {
      switch edge {
      case .bottom: completedEdges.insert(.bottom)
      case .left: completedEdges.insert(.left)
      case .right: completedEdges.insert(.right)
      case .top: completedEdges.insert(.top)
      @unknown default: throw RoomCaptureEngineFailure.malformedRoomEvidence
      }
    }

    return RoomCaptureSurfaceObservation(
      category: category,
      completedEdges: completedEdges,
      confidence: confidence(surface.confidence),
      curve: surface.curve.map { curve in
        RoomCaptureCurveObservation(
          centreXMetres: Double(curve.center.x),
          centreZMetres: Double(curve.center.y),
          endRadians: curve.endAngle.converted(to: .radians).value,
          radiusMetres: Double(curve.radius),
          startRadians: curve.startAngle.converted(to: .radians).value
        )
      },
      dimensionsMetres: vector(surface.dimensions),
      parentSourceIdentifier: surface.parentIdentifier,
      polygonCornersMetres: surface.polygonCorners.map(vector),
      sourceIdentifier: surface.identifier,
      story: surface.story,
      transform: transform(surface.transform)
    )
  }

  nonisolated private static func objectObservation(
    _ object: CapturedRoom.Object
  ) -> RoomCaptureObjectObservation {
    let category: RoomCaptureObjectCategory =
      switch object.category {
      case .bathtub: .bathtub
      case .bed: .bed
      case .chair: .chair
      case .dishwasher: .dishwasher
      case .fireplace: .fireplace
      case .oven: .oven
      case .refrigerator: .refrigerator
      case .sink: .sink
      case .sofa: .sofa
      case .stairs: .stairs
      case .storage: .storage
      case .stove: .stove
      case .table: .table
      case .television: .television
      case .toilet: .toilet
      case .washerDryer: .washerDryer
      @unknown default: .unknown
      }

    return RoomCaptureObjectObservation(
      category: category,
      confidence: confidence(object.confidence),
      dimensionsMetres: vector(object.dimensions),
      parentSourceIdentifier: object.parentIdentifier,
      sourceIdentifier: object.identifier,
      story: object.story,
      transform: transform(object.transform)
    )
  }

  nonisolated private static func confidence(
    _ value: CapturedRoom.Confidence
  ) -> C7RoomPlanConfidence {
    switch value {
    case .high: .high
    case .low: .low
    case .medium: .medium
    @unknown default: .low
    }
  }

  nonisolated private static func vector(_ value: simd_float3) -> RoomCaptureVector3 {
    RoomCaptureVector3(x: Double(value.x), y: Double(value.y), z: Double(value.z))
  }

  nonisolated private static func transform(
    _ value: simd_float4x4
  ) -> RoomCaptureTransform {
    let columns = value.columns
    return RoomCaptureTransform(columnMajorValues: [
      Double(columns.0.x), Double(columns.0.y), Double(columns.0.z), Double(columns.0.w),
      Double(columns.1.x), Double(columns.1.y), Double(columns.1.z), Double(columns.1.w),
      Double(columns.2.x), Double(columns.2.y), Double(columns.2.z), Double(columns.2.w),
      Double(columns.3.x), Double(columns.3.y), Double(columns.3.z), Double(columns.3.w),
    ])
  }
}

extension RoomPlanCaptureEngineAdapter: RoomCaptureSessionDelegate {
  nonisolated func captureSession(
    _ session: RoomCaptureSession,
    didStartWith configuration: RoomCaptureSession.Configuration
  ) {
    let sourceIdentifier = ObjectIdentifier(session)
    Task { @MainActor [weak self] in
      guard let self else { return }
      yield(
        .started(worldOriginIdentifier: worldOriginIdentifier),
        fromCaptureSession: sourceIdentifier
      )
    }
  }

  nonisolated func captureSession(
    _ session: RoomCaptureSession,
    didProvide instruction: RoomCaptureSession.Instruction
  ) {
    let mapped = RoomPlanInstructionMapper.map(instruction)
    let sourceIdentifier = ObjectIdentifier(session)
    Task { @MainActor [weak self] in
      guard let self else { return }
      guard let mapped else {
        yield(
          .failed(.captureFailed(code: "UNSUPPORTED_ROOMPLAN_INSTRUCTION")),
          fromCaptureSession: sourceIdentifier
        )
        return
      }
      yield(.instruction(mapped), fromCaptureSession: sourceIdentifier)
    }
  }

  nonisolated func captureSession(
    _ session: RoomCaptureSession,
    didUpdate room: CapturedRoom
  ) {
    emitUpdate(.updated, room: room, sourceIdentifier: ObjectIdentifier(session))
  }

  nonisolated func captureSession(
    _ session: RoomCaptureSession,
    didAdd room: CapturedRoom
  ) {
    emitUpdate(.added, room: room, sourceIdentifier: ObjectIdentifier(session))
  }

  nonisolated func captureSession(
    _ session: RoomCaptureSession,
    didChange room: CapturedRoom
  ) {
    emitUpdate(.changed, room: room, sourceIdentifier: ObjectIdentifier(session))
  }

  nonisolated func captureSession(
    _ session: RoomCaptureSession,
    didRemove room: CapturedRoom
  ) {
    emitUpdate(.removed, room: room, sourceIdentifier: ObjectIdentifier(session))
  }

  nonisolated private func emitUpdate(
    _ kind: RoomCaptureUpdateKind,
    room: CapturedRoom,
    sourceIdentifier: ObjectIdentifier
  ) {
    let update = RoomCaptureLiveUpdate(
      kind: kind,
      objectCount: room.objects.count,
      roomSourceIdentifier: room.identifier,
      surfaceCount: room.walls.count + room.doors.count + room.windows.count
        + room.openings.count + room.floors.count
    )
    Task { @MainActor [weak self] in
      self?.yield(.roomUpdate(update), fromCaptureSession: sourceIdentifier)
    }
  }

  nonisolated func captureSession(
    _ session: RoomCaptureSession,
    didEndWith data: CapturedRoomData,
    error: (any Error)?
  ) {
    let sourceIdentifier = ObjectIdentifier(session)
    Task { @MainActor [weak self] in
      await self?.handleCaptureEnd(
        fromCaptureSession: sourceIdentifier,
        data: data,
        error: error
      )
    }
  }
}

extension RoomPlanCaptureEngineAdapter: ARSessionDelegate {
  nonisolated func sessionWasInterrupted(_ session: ARSession) {
    let sourceIdentifier = ObjectIdentifier(session)
    Task { @MainActor [weak self] in
      self?.yield(.interrupted, fromARSession: sourceIdentifier)
    }
  }

  nonisolated func sessionInterruptionEnded(_ session: ARSession) {
    let sourceIdentifier = ObjectIdentifier(session)
    Task { @MainActor [weak self] in
      guard let self else { return }
      guard sourceIdentifier == arSessionIdentifier else { return }
      isRelocalising = true
      yield(.relocalisationBegan)
    }
  }

  nonisolated func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool {
    true
  }

  nonisolated func session(
    _ session: ARSession,
    cameraDidChangeTrackingState camera: ARCamera
  ) {
    if case .normal = camera.trackingState {
      let sourceIdentifier = ObjectIdentifier(session)
      Task { @MainActor [weak self] in
        guard let self, sourceIdentifier == arSessionIdentifier else { return }
        handleTrackingNormal()
      }
    }
  }

  nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
    // Read mapping status only. Deliberately never access frame.capturedImage.
    let status: C7WorldMappingStatus =
      switch frame.worldMappingStatus {
      case .extending: .extending
      case .limited: .limited
      case .mapped: .mapped
      case .notAvailable: .notAvailable
      @unknown default: .notAvailable
      }
    let sourceIdentifier = ObjectIdentifier(session)
    Task { @MainActor [weak self] in
      guard let self, sourceIdentifier == arSessionIdentifier else { return }
      handleWorldMappingStatus(status)
    }
  }

  nonisolated func session(_ session: ARSession, didFailWithError error: any Error) {
    let sourceIdentifier = ObjectIdentifier(session)
    Task { @MainActor [weak self] in
      self?.yield(
        .failed(.captureFailed(code: "AR_SESSION_FAILED")),
        fromARSession: sourceIdentifier
      )
    }
  }
}

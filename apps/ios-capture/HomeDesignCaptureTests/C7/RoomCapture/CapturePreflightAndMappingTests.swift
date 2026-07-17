import RoomPlan
import Testing

@testable import HomeDesignCapture

@Suite("C7 capture preflight and Apple mapping")
struct CapturePreflightAndMappingTests {
  @Test("supported authorised fixture is ready")
  func supportedAuthorised() async {
    let probe = PermissionRequestProbe()
    let evaluator = CapturePreflightEvaluator(
      capability: CapabilityFixture(eligibility: .eligible),
      cameraPermission: PermissionFixture(state: .authorised, requestResult: false, probe: probe)
    )

    #expect(await evaluator.evaluate(requestIfNeeded: true) == .ready)
    #expect(await probe.count == 0)
  }

  @Test("unsupported capability is decided before permission")
  func unsupportedBeforePermission() async {
    let probe = PermissionRequestProbe()
    let evaluator = CapturePreflightEvaluator(
      capability: CapabilityFixture(eligibility: .unavailable(.simulatorUnsupported)),
      cameraPermission: PermissionFixture(state: .notDetermined, requestResult: true, probe: probe)
    )

    #expect(
      await evaluator.evaluate(requestIfNeeded: true)
        == .unavailable(.simulatorUnsupported)
    )
    #expect(await probe.count == 0)
  }

  @Test(
    "camera denial and restriction fail closed",
    arguments: [
      (CameraPermissionState.denied, CapturePreflightDecision.cameraDenied),
      (CameraPermissionState.restricted, CapturePreflightDecision.cameraRestricted),
    ])
  func deniedAndRestricted(
    state: CameraPermissionState,
    expected: CapturePreflightDecision
  ) async {
    let probe = PermissionRequestProbe()
    let evaluator = CapturePreflightEvaluator(
      capability: CapabilityFixture(eligibility: .eligible),
      cameraPermission: PermissionFixture(state: state, requestResult: true, probe: probe)
    )

    #expect(await evaluator.evaluate(requestIfNeeded: true) == expected)
    #expect(await probe.count == 0)
  }

  @Test("undetermined permission can defer or request")
  func undeterminedPermission() async {
    let probe = PermissionRequestProbe()
    let evaluator = CapturePreflightEvaluator(
      capability: CapabilityFixture(eligibility: .eligible),
      cameraPermission: PermissionFixture(state: .notDetermined, requestResult: false, probe: probe)
    )

    #expect(
      await evaluator.evaluate(requestIfNeeded: false) == .cameraNotDetermined
    )
    #expect(await evaluator.evaluate(requestIfNeeded: true) == .cameraDenied)
    #expect(await probe.count == 1)
  }

  @Test("all RoomCaptureSession instructions map exactly")
  func instructionMapping() {
    #expect(RoomPlanInstructionMapper.map(.normal) == .normal)
    #expect(RoomPlanInstructionMapper.map(.moveCloseToWall) == .moveCloseToWall)
    #expect(RoomPlanInstructionMapper.map(.moveAwayFromWall) == .moveAwayFromWall)
    #expect(RoomPlanInstructionMapper.map(.turnOnLight) == .turnOnLight)
    #expect(RoomPlanInstructionMapper.map(.slowDown) == .slowDown)
    #expect(RoomPlanInstructionMapper.map(.lowTexture) == .lowTexture)
  }

  @Test("all RoomCaptureSession update callbacks have distinct domain cases")
  func updateMappingInventory() {
    #expect(Set(RoomCaptureUpdateKind.allCases) == [.updated, .added, .changed, .removed])
  }

  #if targetEnvironment(simulator)
    @MainActor
    @Test("real adapter factory rejects Simulator")
    func simulatorCannotCreateRealAdapter() {
      #expect(throws: RoomCaptureEngineFailure.deviceUnsupported) {
        try SystemRoomCaptureEngineFactory.make()
      }
    }
  #endif
}

private struct CapabilityFixture: CaptureCapabilityChecking {
  let eligibility: CaptureEligibility

  func currentEligibility() -> CaptureEligibility { eligibility }
}

private actor PermissionRequestProbe {
  private(set) var count = 0

  func request(returning result: Bool) -> Bool {
    count += 1
    return result
  }
}

private struct PermissionFixture: CameraPermissionAuthorising {
  let state: CameraPermissionState
  let requestResult: Bool
  let probe: PermissionRequestProbe

  func currentPermission() -> CameraPermissionState { state }

  func requestPermission() async -> Bool {
    await probe.request(returning: requestResult)
  }
}

import XCTest

/// Integrated UI acceptance for the C7 fixture engine. These journeys are
/// deliberately opt-in until the C7 producer lanes have been merged and the
/// orchestrator has regenerated the Xcode project. A skipped invocation is
/// post-merge work, never evidence of RoomPlan or physical LiDAR behaviour.
final class C7AcceptanceUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
    guard ProcessInfo.processInfo.environment["C7_RUN_INTEGRATED_UI"] == "1" else {
      throw XCTSkip(
        "Set C7_RUN_INTEGRATED_UI=1 only after the integrated app exposes the frozen C7 fixture protocol."
      )
    }
  }

  @MainActor
  func testCapabilityPermissionAndManualFallbackJourneys() {
    assertScenario("capability-unsupported", screen: "c7.state.unsupported")
    assertScenario("permission-not-determined", screen: "c7.state.permission-not-determined")
    assertScenario("permission-denied", screen: "c7.state.permission-denied")
    assertScenario("permission-restricted", screen: "c7.state.permission-restricted")
    assertScenario("permission-authorised", screen: "c7.state.ready")

    let app = launch("permission-denied")
    let fallback = app.buttons["c7.action.manual-fallback"]
    XCTAssertTrue(fallback.waitForExistence(timeout: 5))
    XCTAssertTrue(fallback.isHittable)
    fallback.tap()
    XCTAssertTrue(app.otherElements["c7.state.manual-fallback"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["c7.copy.simulator-not-roomplan"].exists)
  }

  @MainActor
  func testProjectBriefLoadingAndEveryLocalStateHaveExplicitScreens() {
    for scenario in [
      "project-loading", "project-empty", "project-offline", "brief-loading", "brief-expired",
      "brief-forbidden",
    ] {
      assertScenario(scenario, screen: "c7.scenario.\(scenario)")
    }

    let localStates = [
      "capability-checking", "unsupported", "permission-not-determined", "permission-denied",
      "permission-restricted", "ready", "scanning", "interrupted", "relocalising",
      "room-review", "structure-review", "packaging", "offline-upload", "paused-upload",
      "uploading", "processing", "proposed", "abstained", "cancelled", "safe-failure",
      "manual-fallback",
    ]
    for state in localStates {
      assertScenario("state-\(state)", screen: "c7.state.\(state)")
    }
  }

  @MainActor
  func testEveryServerStateMapsToAnHonestLocalPresentation() {
    let stateMap = [
      "created": "ready",
      "uploading": "uploading",
      "uploaded": "processing",
      "processing": "processing",
      "proposed": "proposed",
      "abstained": "abstained",
      "cancel-requested": "cancelled",
      "cancelled": "cancelled",
      "failed": "safe-failure",
    ]
    for (serverState, localState) in stateMap.sorted(by: { $0.key < $1.key }) {
      assertScenario("server-\(serverState)", screen: "c7.state.\(localState)")
    }
  }

  @MainActor
  func testInstructionQualityAndReferenceMeasurementPresentation() {
    let app = launch("state-scanning-guidance")
    XCTAssertTrue(app.otherElements["c7.state.scanning"].waitForExistence(timeout: 5))
    for instruction in [
      "normal", "move-close-to-wall", "move-away-from-wall", "turn-on-light", "slow-down",
      "low-texture",
    ] {
      XCTAssertTrue(app.staticTexts["c7.instruction.\(instruction)"].exists)
    }
    XCTAssertTrue(app.staticTexts["c7.copy.quality-not-metric-accuracy"].exists)
    XCTAssertTrue(app.staticTexts["c7.reference.user-asserted"].exists)
    XCTAssertTrue(app.buttons["c7.action.add-reference-measurement"].isHittable)
  }

  @MainActor
  func testInterruptionRelocalisationAndExplicitSafeRestart() {
    let recovered = launch("interruption-relocalises")
    XCTAssertTrue(recovered.otherElements["c7.state.interrupted"].waitForExistence(timeout: 5))
    recovered.buttons["c7.action.attempt-relocalisation"].tap()
    XCTAssertTrue(recovered.otherElements["c7.state.relocalising"].waitForExistence(timeout: 5))
    XCTAssertTrue(recovered.otherElements["c7.state.scanning"].waitForExistence(timeout: 5))

    let restarted = launch("interruption-restart-required")
    XCTAssertTrue(restarted.otherElements["c7.state.safe-failure"].waitForExistence(timeout: 5))
    XCTAssertTrue(restarted.staticTexts["c7.safe-code.RELOCALISATION_FAILED"].exists)
    let restart = restarted.buttons["c7.action.safe-restart"]
    XCTAssertTrue(restart.isHittable)
    restart.tap()
    XCTAssertTrue(restarted.otherElements["c7.state.ready"].waitForExistence(timeout: 5))
    XCTAssertEqual(restarted.staticTexts.matching(identifier: "c7.review.room-row").count, 0)
  }

  @MainActor
  func testRoomAndTwoRoomStructureReviewNeverHideWorldSpaceCompatibility() {
    let room = launch("state-room-review")
    XCTAssertTrue(room.otherElements["c7.state.room-review"].waitForExistence(timeout: 5))
    XCTAssertTrue(room.staticTexts["c7.review.source-hash"].exists)
    XCTAssertTrue(room.buttons["c7.action.accept-room"].isHittable)

    let structure = launch("state-structure-review")
    XCTAssertTrue(structure.otherElements["c7.state.structure-review"].waitForExistence(timeout: 5))
    XCTAssertEqual(structure.staticTexts.matching(identifier: "c7.review.room-row").count, 2)
    XCTAssertTrue(structure.staticTexts["c7.review.shared-world-origin"].exists)
    structure.buttons["c7.action.accept-structure"].tap()
    XCTAssertTrue(structure.otherElements["c7.state.packaging"].waitForExistence(timeout: 5))

    let incompatible = launch("structure-incompatible-world-space")
    XCTAssertTrue(incompatible.otherElements["c7.state.abstained"].waitForExistence(timeout: 5))
    XCTAssertTrue(incompatible.staticTexts["c7.safe-code.INCOMPATIBLE_WORLD_SPACE"].exists)
    XCTAssertFalse(incompatible.staticTexts["c7.claim.structure-merged"].exists)
  }

  @MainActor
  func testOfflineBackgroundReconciliationUsesServerChecksums() {
    let app = launch("offline-upload-with-persisted-parts")
    XCTAssertTrue(app.otherElements["c7.state.offline-upload"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["c7.upload.persisted-checksum-count"].exists)
    app.buttons["c7.action.restore-network"].tap()
    XCTAssertTrue(app.otherElements["c7.state.uploading"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["c7.upload.server-reconciled"].exists)

    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(app.otherElements["c7.state.paused-upload"].waitForExistence(timeout: 5))
    app.buttons["c7.action.resume-upload"].tap()
    XCTAssertTrue(app.otherElements["c7.state.uploading"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["c7.upload.no-live-sensor-resume"].exists)
  }

  @MainActor
  func testExpiryForbiddenCancelAndRetryAreDistinct() {
    assertScenario("brief-expired", screen: "c7.scenario.brief-expired")
    assertScenario("brief-forbidden", screen: "c7.scenario.brief-forbidden")

    let cancelled = launch("upload-cancellable")
    cancelled.buttons["c7.action.cancel"].tap()
    XCTAssertTrue(cancelled.otherElements["c7.state.cancelled"].waitForExistence(timeout: 5))

    let retryable = launch("processing-retryable-failure")
    XCTAssertTrue(retryable.otherElements["c7.state.safe-failure"].waitForExistence(timeout: 5))
    let retry = retryable.buttons["c7.action.retry"]
    XCTAssertTrue(retry.isHittable)
    retry.tap()
    XCTAssertTrue(retryable.otherElements["c7.state.processing"].waitForExistence(timeout: 5))

    let terminal = launch("processing-terminal-failure")
    XCTAssertTrue(terminal.otherElements["c7.state.safe-failure"].waitForExistence(timeout: 5))
    XCTAssertFalse(terminal.buttons["c7.action.retry"].exists)
  }

  @MainActor
  func testAccessibilityAndAccessibilityDynamicTypeFallback() {
    let app = launch(
      "state-unsupported",
      extraArguments: [
        "-UIPreferredContentSizeCategoryName",
        "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
      ]
    )
    let screen = app.otherElements["c7.state.unsupported"]
    XCTAssertTrue(screen.waitForExistence(timeout: 5))
    let fallback = app.buttons["c7.action.manual-fallback"]
    XCTAssertTrue(fallback.isHittable)
    XCTAssertFalse(fallback.label.isEmpty)
    XCTAssertTrue(app.staticTexts["c7.copy.simulator-not-roomplan"].exists)
    XCTAssertLessThanOrEqual(screen.frame.width, app.windows.firstMatch.frame.width)
  }

  @MainActor
  private func assertScenario(_ scenario: String, screen identifier: String) {
    let app = launch(scenario)
    XCTAssertTrue(
      app.otherElements[identifier].waitForExistence(timeout: 5),
      "Missing \(identifier) for fixture scenario \(scenario)."
    )
    XCTAssertTrue(app.staticTexts["c7.copy.synthetic-fixture"].exists)
  }

  @MainActor
  private func launch(_ scenario: String, extraArguments: [String] = []) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launchEnvironment["C7_UI_TEST_MODE"] = "1"
    app.launchEnvironment["C7_UI_TEST_SCENARIO"] = scenario
    app.launchArguments += extraArguments
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    return app
  }
}

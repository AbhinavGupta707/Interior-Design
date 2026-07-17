import XCTest

/// C8 native acceptance contracts for the C8-L2 producer integration.
///
/// These journeys are deliberately fixture-only. They prove presentation and
/// accessibility contracts on a simulator; they are not evidence of a physical
/// camera, LiDAR, GPU, Nerfstudio, gsplat, or provider execution.
final class C8AcceptanceUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testPermissionDenialHasSettingsAndRightsClearedFallback() throws {
    let app = try launch("permission-denied")
    XCTAssertTrue(element(in: app, "c8.state.permission-denied").waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["c8.action.open-settings"].isHittable)
    let fallback = app.buttons["c8.action.use-rights-cleared-import"]
    XCTAssertTrue(fallback.isHittable)
    fallback.tap()
    XCTAssertTrue(element(in: app, "c8.state.import-fallback").waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["c8.copy.training-denied"].exists)
  }

  @MainActor
  func testInterruptionNeverPublishesLateAttemptAndRequiresExplicitRecovery() throws {
    let app = try launch("interrupted")
    XCTAssertTrue(element(in: app, "c8.state.interrupted").waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["c8.copy.attempt-one-terminal"].exists)
    XCTAssertFalse(app.staticTexts["c8.claim.appearance-published"].exists)

    app.buttons["c8.action.start-replacement-attempt"].tap()
    XCTAssertTrue(element(in: app, "c8.state.ready").waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["c8.copy.replacement-fenced"].exists)
  }

  @MainActor
  func testUnavailableDepthAndAppearanceToolsHaveHonestFallbacks() throws {
    let depth = try launch("depth-unavailable")
    XCTAssertTrue(element(in: depth, "c8.state.depth-unavailable").waitForExistence(timeout: 5))
    XCTAssertTrue(depth.buttons["c8.action.continue-rgb-only"].isHittable)
    XCTAssertTrue(depth.staticTexts["c8.copy.scale-unknown-until-validated"].exists)

    let appearance = try launch("appearance-tool-unavailable")
    XCTAssertTrue(element(in: appearance, "c8.state.appearance-unavailable").waitForExistence(timeout: 5))
    XCTAssertTrue(appearance.staticTexts["c8.safe-code.APPEARANCE_TOOL_UNAVAILABLE"].exists)
    XCTAssertTrue(appearance.staticTexts["c8.copy.geometry-proposal-preserved"].exists)
    XCTAssertFalse(appearance.staticTexts["c8.claim.metric-from-appearance"].exists)
  }

  @MainActor
  func testDurableStatusPresentsPartialDisconnectedUnknownScaleAndCompleted() throws {
    let expectations = [
      ("partial", "c8.state.partial", "c8.diagnostic.registered-frames"),
      ("disconnected", "c8.state.disconnected", "c8.diagnostic.component-count"),
      ("unknown-scale", "c8.state.unknown-scale", "c8.diagnostic.arbitrary-units"),
      ("completed", "c8.state.completed", "c8.diagnostic.non-dimensional-appearance"),
    ]

    for (scenario, state, diagnostic) in expectations {
      let app = try launch(scenario)
      XCTAssertTrue(element(in: app, state).waitForExistence(timeout: 5))
      XCTAssertTrue(app.staticTexts[diagnostic].exists)
      XCTAssertTrue(app.staticTexts["c8.copy.geometry-proposal-only"].exists)
      XCTAssertTrue(app.staticTexts["c8.copy.synthetic-fixture"].exists)
    }
  }

  @MainActor
  func testAccessibilityAtLargestDynamicTypeKeepsRecoveryReachable() throws {
    let app = try launch(
      "safe-error",
      arguments: [
        "-UIPreferredContentSizeCategoryName",
        "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
      ]
    )
    let screen = element(in: app, "c8.state.safe-error")
    XCTAssertTrue(screen.waitForExistence(timeout: 5))
    let recovery = app.buttons["c8.action.retry"]
    XCTAssertTrue(recovery.isHittable)
    XCTAssertFalse(recovery.label.isEmpty)
    XCTAssertTrue(app.staticTexts["c8.safe-code.RECONSTRUCTION_UNAVAILABLE"].exists)
    XCTAssertLessThanOrEqual(screen.frame.width, app.windows.firstMatch.frame.width)
  }

  @MainActor
  private func launch(_ scenario: String, arguments: [String] = []) throws -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launchEnvironment["C8_UI_TEST_MODE"] = "1"
    app.launchEnvironment["C8_UI_TEST_SCENARIO"] = scenario
    app.launchArguments += arguments
    app.launch()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

    guard app.staticTexts["c8.copy.synthetic-fixture"].waitForExistence(timeout: 2) else {
      throw XCTSkip(
        "Awaiting C8-L2 native fixture producer. This is NOT RUN evidence, not a product pass."
      )
    }
    return app
  }

  @MainActor
  private func element(in app: XCUIApplication, _ identifier: String) -> XCUIElement {
    app.descendants(matching: .any)[identifier]
  }
}

import XCTest

final class C14_7TerminalTwinJourneyUITests: XCTestCase {
  override func setUpWithError() throws { continueAfterFailure = false }

  @MainActor
  func testReviewedProposalConfirmsTwinAndEntersExistingDesignLoop() {
    let app = launch(scenario: "proposal-journey")
    XCTAssertTrue(app.staticTexts["From evidence to confirmed twin"].waitForExistence(timeout: 10))

    openStage("Plan proposal", app: app)
    let planJobPicker = app.buttons["c14_7.plan-job-picker"]
    tap(planJobPicker, app: app)
    let proposedJob = app.buttons.matching(
      NSPredicate(format: "label BEGINSWITH %@", "proposed · 14700000")
    ).firstMatch
    XCTAssertTrue(proposedJob.waitForExistence(timeout: 3))
    proposedJob.tap()
    tap(app.buttons["c14_7.load-plan-proposal"], app: app)
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Proposal only"))
        .firstMatch.waitForExistence(timeout: 5)
    )
    tap(app.buttons["c14_7.save-calibration"], app: app)
    XCTAssertTrue(
      app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Saved · residual"))
        .firstMatch.waitForExistence(timeout: 5)
    )

    let decision = app.buttons[
      "c14_7.candidate-decision.14700000-0000-4000-8000-000000000004"
    ]
    tap(decision, app: app)
    XCTAssertTrue(app.buttons["accepted"].waitForExistence(timeout: 3))
    app.buttons["accepted"].tap()
    tap(app.buttons["c14_7.create-plan-draft"], app: app)

    XCTAssertTrue(app.staticTexts["C5 explicit confirmation and C10 handoff"].waitForExistence(timeout: 5))
    tap(app.buttons["c14_7.create-preview"], app: app)
    XCTAssertTrue(app.staticTexts["Preview only"].waitForExistence(timeout: 5))
    tap(app.buttons["c14_7.confirm-preview"], app: app)
    let compile = app.buttons["c14_7.compile-twin"]
    tap(compile, app: app)
    let continueDesign = app.buttons["c14_7.continue-design"]
    XCTAssertTrue(continueDesign.waitForExistence(timeout: 10))
    tap(continueDesign, app: app)

    XCTAssertTrue(app.staticTexts["Explore the exact committed twin"].waitForExistence(timeout: 10))
    openStage("Design brief", app: app, pickerIdentifier: "c14_5.stage-picker")
    XCTAssertTrue(app.staticTexts["Shape and accept the design brief"].waitForExistence(timeout: 5))

    let evidence = XCTAttachment(screenshot: app.screenshot())
    evidence.name = "C14.7 proposal to confirmed twin to design loop"
    evidence.lifetime = .keepAlways
    add(evidence)
  }

  @MainActor
  func testConfirmedOwnerUsesAdaptiveLayoutAndKeepsEntryAccessible() {
    let app = launch(scenario: "confirmed-owner", accessibilityText: true)
    XCTAssertTrue(app.buttons["c14_7.continue-design"].waitForExistence(timeout: 10))
    if app.windows.firstMatch.frame.width > 700 {
      XCTAssertTrue(app.descendants(matching: .any)["c14_7.stage-sidebar"].exists)
    } else {
      XCTAssertTrue(app.buttons["c14_7.stage-picker"].exists)
    }
    let continueDesign = app.buttons["c14_7.continue-design"]
    scrollToElement(continueDesign, app: app)
    XCTAssertTrue(continueDesign.isHittable)
  }

  @MainActor
  func testViewerAndOfflineRefreshCannotAdvanceAuthoritativeState() {
    let viewer = launch(scenario: "viewer")
    XCTAssertTrue(viewer.staticTexts["Viewer access"].waitForExistence(timeout: 10))
    openStage("Confirm twin", app: viewer)
    XCTAssertFalse(viewer.buttons["c14_7.compile-twin"].isEnabled)
    viewer.terminate()

    let stale = launch(scenario: "stale")
    XCTAssertTrue(stale.staticTexts["From evidence to confirmed twin"].waitForExistence(timeout: 10))
    stale.buttons["Refresh"].tap()
    XCTAssertTrue(stale.staticTexts["Offline · read-only"].waitForExistence(timeout: 5))
    let initialize = stale.buttons["c14_7.initialize"]
    if initialize.exists {
      XCTAssertFalse(initialize.isEnabled)
    }
    stale.terminate()

    let offline = launch(scenario: "offline")
    XCTAssertTrue(offline.staticTexts["Offline · read-only"].waitForExistence(timeout: 10))
    let offlineInitialize = offline.buttons["c14_7.initialize"]
    if offlineInitialize.exists {
      XCTAssertFalse(offlineInitialize.isEnabled)
    }
    XCTAssertFalse(offline.buttons["c14_7.continue-design"].exists)
  }

  @MainActor
  private func launch(scenario: String, accessibilityText: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launchEnvironment["C14_7_UI_TEST_MODE"] = "1"
    app.launchEnvironment["C14_7_UI_TEST_SCENARIO"] = scenario
    if accessibilityText {
      app.launchArguments += [
        "-UIPreferredContentSizeCategoryName",
        "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
      ]
    }
    app.launch()
    return app
  }

  @MainActor
  private func openStage(
    _ title: String,
    app: XCUIApplication,
    pickerIdentifier: String = "c14_7.stage-picker"
  ) {
    let direct = app.buttons[title]
    if direct.exists {
      direct.tap()
      return
    }
    let picker = app.buttons[pickerIdentifier]
    XCTAssertTrue(picker.waitForExistence(timeout: 5))
    picker.tap()
    XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 3))
    app.buttons[title].tap()
  }

  @MainActor
  private func tap(_ element: XCUIElement, app: XCUIApplication) {
    scrollToElement(element, app: app)
    XCTAssertTrue(element.isHittable)
    element.tap()
  }

  @MainActor
  private func scrollToElement(_ element: XCUIElement, app: XCUIApplication) {
    var attempts = 0
    while (!element.exists || !element.isHittable), attempts < 10 {
      app.swipeUp()
      attempts += 1
    }
  }
}

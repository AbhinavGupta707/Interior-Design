import XCTest

final class C14_5HomeownerJourneyUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testEligibleHubOpensRealAdaptiveDesignJourney() {
    let app = launch(scenario: "eligible-owner")

    XCTAssertTrue(app.staticTexts["Homeowner hub"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Explicit C5 confirmation"].exists)
    let exactTwin = app.staticTexts.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Exact C10 twin")
    ).firstMatch
    scrollToElement(exactTwin, app: app)
    XCTAssertTrue(exactTwin.exists)

    let open = app.buttons["Open native design studio"]
    scrollToElement(open, app: app)
    XCTAssertTrue(open.isEnabled)
    open.tap()

    XCTAssertTrue(app.staticTexts["Explore the exact committed twin"].waitForExistence(timeout: 5))
    openStage("Design brief", app: app)
    XCTAssertTrue(app.staticTexts["Shape and accept the design brief"].waitForExistence(timeout: 5))
    openStage("Compare options", app: app)
    XCTAssertTrue(app.staticTexts["Generate, compare and confirm"].waitForExistence(timeout: 5))
    openStage("Materials", app: app)
    XCTAssertTrue(app.staticTexts["Decide materials and products"].waitForExistence(timeout: 5))
    openStage("Render still", app: app)
    XCTAssertTrue(app.staticTexts["Submit and view an authoritative still"].waitForExistence(timeout: 5))
    let hardwareEvidence = app.staticTexts.matching(
      NSPredicate(format: "label CONTAINS %@", "Hardware evidence")
    ).firstMatch
    XCTAssertTrue(hardwareEvidence.waitForExistence(timeout: 3))
    let evidence = XCTAttachment(screenshot: app.screenshot())
    evidence.name = "C14.5 authoritative render stage"
    evidence.lifetime = .keepAlways
    add(evidence)

    let viewResult = app.buttons["Verify and view result"]
    scrollToElement(viewResult, app: app)
    XCTAssertTrue(viewResult.isHittable)
    viewResult.tap()
    let verifiedResult = app.images["Verified geometry-safe render result"]
    XCTAssertTrue(verifiedResult.waitForExistence(timeout: 5))
    let resultEvidence = XCTAttachment(screenshot: app.screenshot())
    resultEvidence.name = "C14.5 verified geometry-safe result"
    resultEvidence.lifetime = .keepAlways
    add(resultEvidence)
  }

  @MainActor
  func testOfflineCacheCannotUnlockDesign() {
    let app = launch(scenario: "offline-recovery")

    let lastVerified = app.staticTexts.matching(
      NSPredicate(format: "label BEGINSWITH %@", "Last verified")
    ).firstMatch
    XCTAssertTrue(lastVerified.waitForExistence(timeout: 10))
    let cacheWarning = app.staticTexts.matching(
      NSPredicate(format: "label CONTAINS %@", "It cannot enable design while offline.")
    ).firstMatch
    scrollToElement(cacheWarning, app: app)
    XCTAssertTrue(cacheWarning.exists)
    XCTAssertFalse(app.buttons["Open native design studio"].exists)
    let retry = app.buttons["Retry server check"]
    scrollToElement(retry, app: app)
    XCTAssertTrue(retry.exists)
  }

  @MainActor
  func testAccessibilityTextSizeKeepsHubPrimaryActionOperable() {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launchEnvironment["C14_5_UI_SCENARIO"] = "eligible-owner"
    app.launchArguments += [
      "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
    ]
    app.launch()

    let open = app.buttons["Open native design studio"]
    XCTAssertTrue(app.staticTexts["Homeowner hub"].waitForExistence(timeout: 10))
    scrollToElement(open, app: app)
    XCTAssertTrue(open.exists)
    XCTAssertTrue(open.isHittable)
  }

  @MainActor
  private func launch(scenario: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launchEnvironment["C14_5_UI_SCENARIO"] = scenario
    app.launch()
    return app
  }

  @MainActor
  private func openStage(_ title: String, app: XCUIApplication) {
    let direct = app.buttons[title]
    if direct.exists {
      direct.tap()
      return
    }
    let picker = app.buttons["c14_5.stage-picker"]
    XCTAssertTrue(picker.waitForExistence(timeout: 3))
    picker.tap()
    let choice = app.buttons[title]
    XCTAssertTrue(choice.waitForExistence(timeout: 3))
    choice.tap()
  }

  @MainActor
  private func scrollToElement(_ element: XCUIElement, app: XCUIApplication) {
    var attempts = 0
    while (!element.exists || !element.isHittable), attempts < 8 {
      app.swipeUp()
      attempts += 1
    }
  }
}

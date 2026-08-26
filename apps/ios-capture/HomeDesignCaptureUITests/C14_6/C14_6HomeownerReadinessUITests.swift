import XCTest

final class C14_6HomeownerReadinessUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testColdLaunchProgressesToNativeProposalReadiness() {
    let app = launch(scenario: "cold-launch", clearsRecovery: true)

    let signIn = app.buttons["c14_6.sign-in"]
    XCTAssertTrue(signIn.waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Riverside terrace"].exists)
    signIn.tap()

    let project = app.staticTexts["Riverside terrace"]
    XCTAssertTrue(project.waitForExistence(timeout: 10))
    project.tap()
    XCTAssertTrue(app.staticTexts["Homeowner hub"].waitForExistence(timeout: 5))

    let setup = app.buttons["c14_6.open-home-setup"]
    XCTAssertTrue(setup.waitForExistence(timeout: 5))
    setup.tap()

    XCTAssertTrue(app.staticTexts["Prepare Riverside terrace"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "never an interior dimension")
      ).firstMatch.exists
    )
    let ready = app.descendants(matching: .any)["c14_6.proposal-ready"]
    for _ in 0..<8 { app.swipeUp() }
    XCTAssertTrue(ready.waitForExistence(timeout: 5))
    XCTAssertTrue(ready.label.contains("has not started, calibrated or reviewed C6"))

    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "C14.6 native homeowner readiness"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  @MainActor
  func testRelaunchRecoversOnlyThePreviouslyRevalidatedProject() {
    let app = launch(scenario: "cold-launch", clearsRecovery: true)
    XCTAssertTrue(app.buttons["c14_6.sign-in"].waitForExistence(timeout: 10))
    app.buttons["c14_6.sign-in"].tap()
    XCTAssertTrue(app.staticTexts["Riverside terrace"].waitForExistence(timeout: 5))
    app.staticTexts["Riverside terrace"].tap()
    XCTAssertTrue(app.staticTexts["Homeowner hub"].waitForExistence(timeout: 5))

    app.terminate()
    app.launchEnvironment["C14_6_UI_TEST_SCENARIO"] = "recovered-launch"
    app.launchEnvironment["C14_6_UI_CLEAR_RECOVERY"] = "0"
    app.launch()

    XCTAssertTrue(app.staticTexts["Homeowner hub"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Riverside terrace"].exists)
    XCTAssertFalse(app.buttons["c14_6.sign-in"].exists)
  }

  @MainActor
  func testAccessibilityTextKeepsPrimarySetupActionOperable() {
    let app = XCUIApplication()
    configure(app, scenario: "cold-launch", clearsRecovery: true)
    app.launchArguments += [
      "-UIPreferredContentSizeCategoryName",
      "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
    ]
    app.launch()

    XCTAssertTrue(app.buttons["c14_6.sign-in"].waitForExistence(timeout: 10))
    app.buttons["c14_6.sign-in"].tap()
    XCTAssertTrue(app.staticTexts["Riverside terrace"].waitForExistence(timeout: 5))
    app.staticTexts["Riverside terrace"].tap()
    let setup = app.buttons["c14_6.open-home-setup"]
    scrollToElement(setup, app: app)
    XCTAssertTrue(setup.exists)
    XCTAssertTrue(setup.isHittable)
  }

  @MainActor
  private func launch(scenario: String, clearsRecovery: Bool) -> XCUIApplication {
    let app = XCUIApplication()
    configure(app, scenario: scenario, clearsRecovery: clearsRecovery)
    app.launch()
    return app
  }

  @MainActor
  private func configure(_ app: XCUIApplication, scenario: String, clearsRecovery: Bool) {
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launchEnvironment["C14_6_UI_TEST_MODE"] = "1"
    app.launchEnvironment["C14_6_UI_TEST_SCENARIO"] = scenario
    app.launchEnvironment["C14_6_UI_CLEAR_RECOVERY"] = clearsRecovery ? "1" : "0"
  }

  @MainActor
  private func scrollToElement(_ element: XCUIElement, app: XCUIApplication) {
    var attempts = 0
    while (!element.exists || !element.isHittable), attempts < 12 {
      app.swipeUp()
      attempts += 1
    }
  }
}

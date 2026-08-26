import XCTest

final class AppLaunchUITests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testLaunchesIntoAnAccessibleProjectOrSignInState() {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launch()

    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    XCTAssertGreaterThan(app.windows.count, 0)
  }

  @MainActor
  func testColdJourneyReachesSecureEvidenceWorkspace() {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launchEnvironment["C14_6_UI_TEST_MODE"] = "1"
    app.launchEnvironment["C14_6_UI_TEST_SCENARIO"] = "cold-launch"
    app.launchEnvironment["C14_6_UI_CLEAR_RECOVERY"] = "1"
    app.launch()

    let signIn = app.buttons["c14_6.sign-in"]
    XCTAssertTrue(signIn.waitForExistence(timeout: 10))
    signIn.tap()
    let project = app.staticTexts["Riverside terrace"]
    XCTAssertTrue(project.waitForExistence(timeout: 5))
    project.tap()
    let evidence = app.buttons["Evidence and documents"]
    XCTAssertTrue(evidence.waitForExistence(timeout: 5))
    evidence.tap()
    XCTAssertTrue(app.buttons["Choose a file"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Training use"].exists)
  }
}

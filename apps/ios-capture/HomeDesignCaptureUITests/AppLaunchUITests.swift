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
  func testUnsupportedJourneyReachesSecureEvidenceWorkspace() {
    let app = XCUIApplication()
    app.launchEnvironment["HOME_DESIGN_ENVIRONMENT"] = "local"
    app.launch()

    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))

    let fixture = app.buttons["Use deterministic local fixture"]
    XCTAssertTrue(fixture.waitForExistence(timeout: 10))
    fixture.tap()

    let project = app.staticTexts["Sample terrace refresh"]
    XCTAssertTrue(project.waitForExistence(timeout: 5))
    project.tap()

    let manualRoute = app.buttons["View manual evidence route"]
    XCTAssertTrue(manualRoute.waitForExistence(timeout: 5))
    manualRoute.tap()

    let continueToChecklist = app.buttons["Continue with manual evidence"]
    XCTAssertTrue(continueToChecklist.waitForExistence(timeout: 5))
    continueToChecklist.tap()

    let continueToEvidence = app.buttons["Continue to secure evidence upload"]
    XCTAssertTrue(continueToEvidence.waitForExistence(timeout: 5))
    continueToEvidence.tap()

    XCTAssertTrue(app.buttons["Choose a file"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["Local fixture · Synthetic evidence only"].exists)
  }
}

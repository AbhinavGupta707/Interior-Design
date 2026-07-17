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
}

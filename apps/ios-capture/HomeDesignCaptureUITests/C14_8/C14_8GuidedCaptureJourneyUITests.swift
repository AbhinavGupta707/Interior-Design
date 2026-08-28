import XCTest

final class C14_8GuidedCaptureJourneyUITests: XCTestCase {
  @MainActor
  func testSimulatorJourneyDisclosesFixtureAndReviewsExplicitCoverage() throws {
    let app = XCUIApplication()
    app.launchEnvironment["C14_8_UI_TEST_SCENARIO"] = "guided-journey"
    app.launch()

    XCTAssertTrue(
      app.staticTexts[
        "SYNTHETIC SIMULATOR FIXTURE · NOT PHYSICAL CAMERA, ARKIT TRACKING, DEPTH OR ROOMPLAN EVIDENCE"
      ].waitForExistence(timeout: 10))
    let capture = app.buttons["c14_8.capture-keyframe"]
    for _ in 0..<3 where !capture.exists { app.swipeUp() }
    XCTAssertTrue(capture.waitForExistence(timeout: 10))
    capture.tap()

    let review = app.buttons["Review unresolved capture"]
    for _ in 0..<3 where !review.exists { app.swipeUp() }
    XCTAssertTrue(review.waitForExistence(timeout: 10))
    review.tap()

    for _ in 0..<4 { app.swipeDown() }
    XCTAssertTrue(app.staticTexts["Fixture journey complete"].waitForExistence(timeout: 10))
    for _ in 0..<6 { app.swipeUp() }
    XCTAssertFalse(app.buttons["c14_8.accept-envelope"].exists)
  }
}

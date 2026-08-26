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
    let sidebar = app.descendants(matching: .any)["c14_6.setup-sidebar"]
    if app.windows.firstMatch.frame.width > 700 {
      XCTAssertTrue(sidebar.waitForExistence(timeout: 5))
    }
    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "never an interior dimension")
      ).firstMatch.exists
    )
    selectRegularStepIfAvailable("readiness", app: app)
    let ready = app.descendants(matching: .any)["c14_6.proposal-ready"]
    scrollToElement(ready, app: app)
    XCTAssertTrue(ready.waitForExistence(timeout: 5))
    XCTAssertTrue(ready.label.contains("has not started, calibrated or reviewed C6"))

    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "C14.6 native homeowner readiness"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  @MainActor
  func testIntakeAndPropertyChoicesRemainExplicitServerMutations() {
    let app = launch(scenario: "cold-launch", clearsRecovery: true)
    navigateToSetup(app)

    let saveIntake = app.buttons["c14_6.save-intake"]
    scrollToElement(saveIntake, app: app)
    XCTAssertTrue(saveIntake.isHittable)
    saveIntake.tap()
    XCTAssertTrue(
      app.descendants(matching: .any)["c14_6.mutation-message"]
        .waitForExistence(timeout: 5)
    )
    XCTAssertTrue(
      app.descendants(matching: .any)["c14_6.mutation-message"].label
        .contains("server provenance")
    )

    selectRegularStepIfAvailable("property", app: app)
    let query = app.textFields["c14_6.property-query"]
    XCTAssertTrue(query.waitForExistence(timeout: 5))
    query.tap()
    query.typeText("12 Example Mews")
    app.buttons["c14_6.resolve-property"].tap()
    let candidate = app.buttons["c14_6.select-candidate"]
    XCTAssertTrue(candidate.waitForExistence(timeout: 5))
    candidate.tap()
    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "not interior geometry")
      ).firstMatch.waitForExistence(timeout: 5)
    )

    let manualLine = app.textFields["c14_6.manual-line1"]
    scrollToElement(manualLine, app: app)
    manualLine.tap()
    manualLine.typeText("14 User Entered Street")
    let postcode = app.textFields["c14_6.manual-postcode"]
    postcode.tap()
    postcode.typeText("SW1A 1AA")
    let saveManual = app.buttons["c14_6.save-manual-property"]
    scrollToElement(saveManual, app: app)
    XCTAssertTrue(saveManual.isHittable)
    saveManual.tap()
    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "Manual fallback")
      ).firstMatch.waitForExistence(timeout: 5)
    )
    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "Not supplied")
      ).firstMatch.exists
    )
  }

  @MainActor
  func testEvidenceConsentStartsSeparateAndTrainingDenied() {
    let app = launch(scenario: "cold-launch", clearsRecovery: true)
    navigateToSetup(app)

    selectRegularStepIfAvailable("evidence", app: app)
    scrollToElement(app.buttons["c14_6.open-evidence"], app: app)
    app.buttons["c14_6.open-evidence"].tap()

    let serviceConsent = app.switches["evidence.service-processing-consent"]
    let trainingConsent = app.switches["evidence.training-consent"]
    scrollToElement(serviceConsent, app: app)
    XCTAssertTrue(serviceConsent.waitForExistence(timeout: 5))
    XCTAssertEqual(serviceConsent.value as? String, "0")
    app.swipeUp()
    XCTAssertTrue(serviceConsent.isHittable)
    serviceConsent.coordinate(withNormalizedOffset: CGVector(dx: 0.88, dy: 0.5)).tap()
    let serviceEnabled = expectation(
      for: NSPredicate(format: "value == %@", "1"),
      evaluatedWith: serviceConsent
    )
    wait(for: [serviceEnabled], timeout: 5)
    scrollToElement(trainingConsent, app: app)
    XCTAssertTrue(trainingConsent.waitForExistence(timeout: 5))
    XCTAssertEqual(trainingConsent.value as? String, "0")
  }

  @MainActor
  func testOfflineSetupCannotUnlockProposalReadiness() {
    let app = launch(scenario: "offline", clearsRecovery: true)
    navigateToSetup(app)

    XCTAssertTrue(
      app.staticTexts.matching(
        NSPredicate(format: "label CONTAINS %@", "Reconnect to load evidence readiness")
      ).firstMatch.waitForExistence(timeout: 5)
    )
    selectRegularStepIfAvailable("readiness", app: app)
    let dimensionsMessage = app.staticTexts.matching(
      NSPredicate(format: "label CONTAINS %@", "never infers dimensions")
    ).firstMatch
    scrollToElement(dimensionsMessage, app: app)
    XCTAssertFalse(app.descendants(matching: .any)["c14_6.proposal-ready"].exists)
    XCTAssertTrue(dimensionsMessage.exists)
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
    setup.tap()

    let saveIntake = app.buttons["c14_6.save-intake"]
    scrollToElement(saveIntake, app: app)
    XCTAssertTrue(saveIntake.exists)
    XCTAssertTrue(saveIntake.isHittable)
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
  private func navigateToSetup(_ app: XCUIApplication) {
    XCTAssertTrue(app.buttons["c14_6.sign-in"].waitForExistence(timeout: 10))
    app.buttons["c14_6.sign-in"].tap()
    XCTAssertTrue(app.staticTexts["Riverside terrace"].waitForExistence(timeout: 5))
    app.staticTexts["Riverside terrace"].tap()
    let setup = app.buttons["c14_6.open-home-setup"]
    scrollToElement(setup, app: app)
    XCTAssertTrue(setup.isHittable)
    setup.tap()
    XCTAssertTrue(app.staticTexts["Prepare Riverside terrace"].waitForExistence(timeout: 5))
  }

  @MainActor
  private func scrollToElement(_ element: XCUIElement, app: XCUIApplication) {
    var attempts = 0
    while (!element.exists || !element.isHittable), attempts < 12 {
      app.swipeUp()
      attempts += 1
    }
  }

  @MainActor
  private func selectRegularStepIfAvailable(_ step: String, app: XCUIApplication) {
    let control = app.descendants(matching: .any)["c14_6.step-\(step)"]
    if control.waitForExistence(timeout: 1) {
      control.tap()
    }
  }
}

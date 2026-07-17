#if DEBUG
  import Foundation
  import XCTest

  @testable import HomeDesignCapture

  final class C7UITestFixtureScenarioTests: XCTestCase {
    private let localConfiguration = AppConfiguration(
      environment: .local,
      apiBaseURL: URL(string: "http://127.0.0.1:54321")!
    )

    func testRequiresExactOptInAndNonEmptyScenario() {
      XCTAssertNil(
        C7UITestFixtureScenario.current(
          configuration: localConfiguration,
          environment: [:]
        )
      )
      XCTAssertNil(
        C7UITestFixtureScenario.current(
          configuration: localConfiguration,
          environment: ["C7_UI_TEST_MODE": "true", "C7_UI_TEST_SCENARIO": "state-ready"]
        )
      )
      XCTAssertNil(
        C7UITestFixtureScenario.current(
          configuration: localConfiguration,
          environment: ["C7_UI_TEST_MODE": "1", "C7_UI_TEST_SCENARIO": "   "]
        )
      )
      XCTAssertEqual(
        C7UITestFixtureScenario.current(
          configuration: localConfiguration,
          environment: ["C7_UI_TEST_MODE": "1", "C7_UI_TEST_SCENARIO": "state-ready"]
        ),
        .named("state-ready")
      )
    }

    func testRefusesFixtureOutsideLocalEnvironment() {
      for environment in [AppEnvironment.staging, .production] {
        XCTAssertNil(
          C7UITestFixtureScenario.current(
            configuration: AppConfiguration(
              environment: environment,
              apiBaseURL: URL(string: "https://api.example.test")!
            ),
            environment: ["C7_UI_TEST_MODE": "1", "C7_UI_TEST_SCENARIO": "state-ready"]
          )
        )
      }
    }
  }
#endif

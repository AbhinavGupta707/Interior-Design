#if DEBUG
  import Foundation
  import XCTest

  @testable import HomeDesignCapture

  final class C8UITestFixtureScenarioTests: XCTestCase {
    private let localConfiguration = AppConfiguration(
      environment: .local,
      apiBaseURL: URL(string: "http://127.0.0.1:54321")!
    )

    func testRequiresExactLocalOptInAndKnownScenario() {
      XCTAssertNil(
        C8UITestFixtureScenario.current(configuration: localConfiguration, environment: [:])
      )
      XCTAssertNil(
        C8UITestFixtureScenario.current(
          configuration: localConfiguration,
          environment: ["C8_UI_TEST_MODE": "true", "C8_UI_TEST_SCENARIO": "completed"]
        )
      )
      XCTAssertNil(
        C8UITestFixtureScenario.current(
          configuration: localConfiguration,
          environment: ["C8_UI_TEST_MODE": "1", "C8_UI_TEST_SCENARIO": "unknown"]
        )
      )
      XCTAssertEqual(
        C8UITestFixtureScenario.current(
          configuration: localConfiguration,
          environment: ["C8_UI_TEST_MODE": "1", "C8_UI_TEST_SCENARIO": "completed"]
        ),
        .completed
      )
    }

    func testRefusesFixtureOutsideLocalEnvironment() {
      for environment in [AppEnvironment.staging, .production] {
        XCTAssertNil(
          C8UITestFixtureScenario.current(
            configuration: AppConfiguration(
              environment: environment,
              apiBaseURL: URL(string: "https://api.example.test")!
            ),
            environment: ["C8_UI_TEST_MODE": "1", "C8_UI_TEST_SCENARIO": "completed"]
          )
        )
      }
    }
  }
#endif

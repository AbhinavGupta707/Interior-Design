#if DEBUG
  import Foundation
  import XCTest
  @testable import HomeDesignCapture

  final class C14_6FixtureScenarioTests: XCTestCase {
    private let local = AppConfiguration(
      environment: .local,
      apiBaseURL: URL(string: "http://127.0.0.1:4100")!
    )

    func testFixtureRequiresExactLocalOptInAndKnownScenario() {
      XCTAssertNil(C14_6UITestScenario.current(configuration: local, environment: [:]))
      XCTAssertNil(
        C14_6UITestScenario.current(
          configuration: local,
          environment: ["C14_6_UI_TEST_MODE": "true", "C14_6_UI_TEST_SCENARIO": "cold-launch"]
        )
      )
      XCTAssertNil(
        C14_6UITestScenario.current(
          configuration: local,
          environment: ["C14_6_UI_TEST_MODE": "1", "C14_6_UI_TEST_SCENARIO": "unknown"]
        )
      )
      XCTAssertEqual(
        C14_6UITestScenario.current(
          configuration: local,
          environment: ["C14_6_UI_TEST_MODE": "1", "C14_6_UI_TEST_SCENARIO": "cold-launch"]
        )?.rawValue,
        "cold-launch"
      )
    }

    func testFixtureRefusesNonLocalBuilds() {
      for environment in [AppEnvironment.staging, .production] {
        let configuration = AppConfiguration(
          environment: environment,
          apiBaseURL: URL(string: "https://api.example.test")!
        )
        XCTAssertNil(
          C14_6UITestScenario.current(
            configuration: configuration,
            environment: ["C14_6_UI_TEST_MODE": "1", "C14_6_UI_TEST_SCENARIO": "cold-launch"]
          )
        )
      }
    }
  }
#endif

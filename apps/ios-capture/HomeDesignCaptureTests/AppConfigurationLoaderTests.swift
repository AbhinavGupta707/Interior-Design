import Foundation
import XCTest
@testable import HomeDesignCapture

final class AppConfigurationLoaderTests: XCTestCase {
  func testLoadsBundledLocalConfiguration() throws {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "local",
        "HomeDesignAPIBaseURL": "http://127.0.0.1:4100",
      ],
      processEnvironment: [:]
    )

    let configuration = try loader.load()

    XCTAssertEqual(configuration.environment, .local)
    XCTAssertEqual(configuration.apiBaseURL, URL(string: "http://127.0.0.1:4100"))
  }

  func testProcessValuesOverrideBundledValues() throws {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "local",
        "HomeDesignAPIBaseURL": "http://127.0.0.1:4100",
      ],
      processEnvironment: [
        "HOME_DESIGN_ENVIRONMENT": "staging",
        "HOME_DESIGN_API_BASE_URL": "https://staging.example.test/api",
      ]
    )

    let configuration = try loader.load()

    XCTAssertEqual(configuration.environment, .staging)
    XCTAssertEqual(configuration.apiBaseURL, URL(string: "https://staging.example.test/api"))
  }

  func testRejectsUnsupportedEnvironment() {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "preview",
        "HomeDesignAPIBaseURL": "https://preview.example.test",
      ],
      processEnvironment: [:]
    )

    XCTAssertThrowsError(try loader.load()) { error in
      XCTAssertEqual(error as? AppConfigurationError, .invalidEnvironment("preview"))
    }
  }

  func testRejectsRemotePlainHTTP() {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "local",
        "HomeDesignAPIBaseURL": "http://example.test",
      ],
      processEnvironment: [:]
    )

    XCTAssertThrowsError(try loader.load()) { error in
      XCTAssertEqual(error as? AppConfigurationError, .insecureRemoteURL)
    }
  }

  func testRequiresHTTPSOutsideLocalEnvironment() {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "production",
        "HomeDesignAPIBaseURL": "http://127.0.0.1:4100",
      ],
      processEnvironment: [:]
    )

    XCTAssertThrowsError(try loader.load()) { error in
      XCTAssertEqual(error as? AppConfigurationError, .secureTransportRequired(.production))
    }
  }

  func testRejectsCredentialsAndURLDecorations() {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "production",
        "HomeDesignAPIBaseURL": "https://user:password@example.test/api?token=value",
      ],
      processEnvironment: [:]
    )

    XCTAssertThrowsError(try loader.load()) { error in
      XCTAssertEqual(error as? AppConfigurationError, .credentialsNotAllowed)
    }
  }

  func testRejectsMissingValues() {
    let loader = AppConfigurationLoader(infoDictionary: [:], processEnvironment: [:])

    XCTAssertThrowsError(try loader.load()) { error in
      XCTAssertEqual(
        error as? AppConfigurationError,
        .missingValue("HomeDesignEnvironment")
      )
    }
  }
}

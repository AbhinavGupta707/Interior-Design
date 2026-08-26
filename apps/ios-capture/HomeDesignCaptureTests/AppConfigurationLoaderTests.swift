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
    XCTAssertEqual(configuration.identity, .localFixture)
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
    XCTAssertEqual(configuration.identity, .unavailable)
  }

  func testLoadsCompleteRemoteOIDCConfiguration() throws {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "production",
        "HomeDesignAPIBaseURL": "https://api.example.test",
        "HomeDesignOIDCAuthorizationEndpoint": "https://identity.example.test/authorize",
        "HomeDesignOIDCClientID": "native-public-client",
        "HomeDesignOIDCRedirectURI": "com.homedesignstudio.capture.auth:/oauth/callback",
        "HomeDesignOIDCScopes": "openid profile offline_access",
        "HomeDesignOIDCTokenEndpoint": "https://identity.example.test/oauth/token",
      ],
      processEnvironment: [:]
    )

    let configuration = try loader.load()

    guard case .oidc(let oidc) = configuration.identity else {
      return XCTFail("Expected configured OIDC identity")
    }
    XCTAssertEqual(oidc.clientId, "native-public-client")
    XCTAssertEqual(oidc.scopes, ["openid", "profile", "offline_access"])
    XCTAssertEqual(oidc.redirectURI.absoluteString, "com.homedesignstudio.capture.auth:/oauth/callback")
  }

  func testRejectsPartialOIDCConfiguration() {
    let loader = AppConfigurationLoader(
      infoDictionary: [
        "HomeDesignEnvironment": "production",
        "HomeDesignAPIBaseURL": "https://api.example.test",
        "HomeDesignOIDCClientID": "native-public-client",
      ],
      processEnvironment: [:]
    )

    XCTAssertThrowsError(try loader.load()) { error in
      XCTAssertEqual(error as? AppConfigurationError, .incompleteIdentityConfiguration)
    }
  }

  func testRejectsRemoteOIDCWithoutOfflineAccessAndExactRedirect() {
    let values: [String: Any] = [
      "HomeDesignEnvironment": "production",
      "HomeDesignAPIBaseURL": "https://api.example.test",
      "HomeDesignOIDCAuthorizationEndpoint": "https://identity.example.test/authorize",
      "HomeDesignOIDCClientID": "native-public-client",
      "HomeDesignOIDCRedirectURI": "other.app:/oauth/callback",
      "HomeDesignOIDCScopes": "openid profile",
      "HomeDesignOIDCTokenEndpoint": "https://identity.example.test/oauth/token",
    ]

    XCTAssertThrowsError(
      try AppConfigurationLoader(infoDictionary: values, processEnvironment: [:]).load()
    )
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

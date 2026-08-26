import Foundation

enum AppEnvironment: String, CaseIterable, Sendable {
  case local
  case staging
  case production

  var displayName: String {
    switch self {
    case .local:
      "Local"
    case .staging:
      "Staging"
    case .production:
      "Production"
    }
  }
}

struct AppConfiguration: Equatable, Sendable {
  let environment: AppEnvironment
  let apiBaseURL: URL
  let identity: C14_6IdentityConfiguration

  init(
    environment: AppEnvironment,
    apiBaseURL: URL,
    identity: C14_6IdentityConfiguration? = nil
  ) {
    self.environment = environment
    self.apiBaseURL = apiBaseURL
    self.identity = identity ?? (environment == .local ? .localFixture : .unavailable)
  }
}

enum C14_6IdentityConfiguration: Equatable, Sendable {
  case localFixture
  case oidc(C14_6OIDCConfiguration)
  case unavailable
}

struct C14_6OIDCConfiguration: Equatable, Sendable {
  let authorizationEndpoint: URL
  let clientId: String
  let redirectURI: URL
  let scopes: [String]
  let tokenEndpoint: URL
}

enum AppConfigurationError: Error, Equatable {
  case missingValue(String)
  case invalidEnvironment(String)
  case invalidURL(String)
  case credentialsNotAllowed
  case incompleteIdentityConfiguration
  case invalidIdentityConfiguration(String)
  case insecureRemoteURL
  case secureTransportRequired(AppEnvironment)
}

extension AppConfigurationError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .missingValue(let key):
      "Missing required configuration value: \(key)."
    case .invalidEnvironment(let value):
      "Unsupported app environment: \(value)."
    case .invalidURL(let value):
      "The configured API base URL is invalid: \(value)."
    case .credentialsNotAllowed:
      "The API base URL must not contain credentials, a query, or a fragment."
    case .incompleteIdentityConfiguration:
      "OIDC configuration is incomplete. Provide every identity value or remove them all."
    case .invalidIdentityConfiguration(let detail):
      "The OIDC configuration is invalid: \(detail)."
    case .insecureRemoteURL:
      "Plain HTTP is permitted only for a loopback API endpoint."
    case .secureTransportRequired(let environment):
      "The \(environment.rawValue) environment requires an HTTPS API endpoint."
    }
  }
}

struct AppConfigurationLoader {
  private enum Key {
    static let environmentInfo = "HomeDesignEnvironment"
    static let environmentProcess = "HOME_DESIGN_ENVIRONMENT"
    static let apiBaseURLInfo = "HomeDesignAPIBaseURL"
    static let apiBaseURLProcess = "HOME_DESIGN_API_BASE_URL"
    static let authorizationEndpointInfo = "HomeDesignOIDCAuthorizationEndpoint"
    static let authorizationEndpointProcess = "HOME_DESIGN_OIDC_AUTHORIZATION_ENDPOINT"
    static let clientIdInfo = "HomeDesignOIDCClientID"
    static let clientIdProcess = "HOME_DESIGN_OIDC_CLIENT_ID"
    static let redirectURIInfo = "HomeDesignOIDCRedirectURI"
    static let redirectURIProcess = "HOME_DESIGN_OIDC_REDIRECT_URI"
    static let scopesInfo = "HomeDesignOIDCScopes"
    static let scopesProcess = "HOME_DESIGN_OIDC_SCOPES"
    static let tokenEndpointInfo = "HomeDesignOIDCTokenEndpoint"
    static let tokenEndpointProcess = "HOME_DESIGN_OIDC_TOKEN_ENDPOINT"
  }

  private let infoDictionary: [String: Any]
  private let processEnvironment: [String: String]

  static var live: AppConfigurationLoader {
    AppConfigurationLoader(
      infoDictionary: Bundle.main.infoDictionary ?? [:],
      processEnvironment: ProcessInfo.processInfo.environment
    )
  }

  init(infoDictionary: [String: Any], processEnvironment: [String: String]) {
    self.infoDictionary = infoDictionary
    self.processEnvironment = processEnvironment
  }

  func load() throws -> AppConfiguration {
    let rawEnvironment = try requiredValue(
      processKey: Key.environmentProcess,
      infoKey: Key.environmentInfo
    )
    guard let environment = AppEnvironment(rawValue: rawEnvironment.lowercased()) else {
      throw AppConfigurationError.invalidEnvironment(rawEnvironment)
    }

    let rawAPIBaseURL = try requiredValue(
      processKey: Key.apiBaseURLProcess,
      infoKey: Key.apiBaseURLInfo
    )
    let apiBaseURL = try validatedURL(rawAPIBaseURL, environment: environment)

    return AppConfiguration(
      environment: environment,
      apiBaseURL: apiBaseURL,
      identity: try identityConfiguration(environment: environment)
    )
  }

  private func identityConfiguration(
    environment: AppEnvironment
  ) throws -> C14_6IdentityConfiguration {
    if environment == .local { return .localFixture }

    let values = [
      optionalValue(
        processKey: Key.authorizationEndpointProcess,
        infoKey: Key.authorizationEndpointInfo
      ),
      optionalValue(processKey: Key.clientIdProcess, infoKey: Key.clientIdInfo),
      optionalValue(processKey: Key.redirectURIProcess, infoKey: Key.redirectURIInfo),
      optionalValue(processKey: Key.scopesProcess, infoKey: Key.scopesInfo),
      optionalValue(processKey: Key.tokenEndpointProcess, infoKey: Key.tokenEndpointInfo),
    ]
    if values.allSatisfy({ $0 == nil }) { return .unavailable }
    guard values.allSatisfy({ $0 != nil }) else {
      throw AppConfigurationError.incompleteIdentityConfiguration
    }
    guard
      let authorization = values[0],
      let clientId = values[1],
      let redirect = values[2],
      let scopeValue = values[3],
      let token = values[4]
    else {
      throw AppConfigurationError.incompleteIdentityConfiguration
    }
    guard clientId.count <= 200,
          clientId.unicodeScalars.allSatisfy({ !$0.properties.isWhitespace })
    else {
      throw AppConfigurationError.invalidIdentityConfiguration("client ID")
    }
    let authorizationEndpoint = try validatedIdentityEndpoint(authorization)
    let tokenEndpoint = try validatedIdentityEndpoint(token)
    guard
      let redirectURI = URL(string: redirect),
      redirectURI.scheme == "com.homedesignstudio.capture.auth",
      redirectURI.host == nil,
      redirectURI.path == "/oauth/callback",
      redirectURI.user == nil,
      redirectURI.password == nil,
      redirectURI.query == nil,
      redirectURI.fragment == nil
    else {
      throw AppConfigurationError.invalidIdentityConfiguration("redirect URI")
    }
    let scopes = scopeValue.split(whereSeparator: \.isWhitespace).map(String.init)
    guard scopes.contains("openid"), scopes.contains("offline_access"),
          Set(scopes).count == scopes.count, scopes.count <= 20
    else {
      throw AppConfigurationError.invalidIdentityConfiguration(
        "scopes must include openid and offline_access"
      )
    }
    return .oidc(
      C14_6OIDCConfiguration(
        authorizationEndpoint: authorizationEndpoint,
        clientId: clientId,
        redirectURI: redirectURI,
        scopes: scopes,
        tokenEndpoint: tokenEndpoint
      )
    )
  }

  private func optionalValue(processKey: String, infoKey: String) -> String? {
    sanitised(processEnvironment[processKey]) ?? sanitised(infoDictionary[infoKey] as? String)
  }

  private func validatedIdentityEndpoint(_ rawValue: String) throws -> URL {
    guard
      let components = URLComponents(string: rawValue),
      components.scheme?.lowercased() == "https",
      let host = components.host,
      !host.isEmpty,
      components.user == nil,
      components.password == nil,
      components.query == nil,
      components.fragment == nil,
      let url = components.url
    else {
      throw AppConfigurationError.invalidIdentityConfiguration("endpoints must be undecorated HTTPS URLs")
    }
    return url
  }

  private func requiredValue(processKey: String, infoKey: String) throws -> String {
    if let override = sanitised(processEnvironment[processKey]) {
      return override
    }
    if let bundledValue = sanitised(infoDictionary[infoKey] as? String) {
      return bundledValue
    }
    throw AppConfigurationError.missingValue(infoKey)
  }

  private func sanitised(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func validatedURL(
    _ rawValue: String,
    environment: AppEnvironment
  ) throws -> URL {
    guard
      let components = URLComponents(string: rawValue),
      let rawScheme = components.scheme,
      let host = components.host,
      !host.isEmpty
    else {
      throw AppConfigurationError.invalidURL(rawValue)
    }

    let scheme = rawScheme.lowercased()
    guard scheme == "http" || scheme == "https", let url = components.url else {
      throw AppConfigurationError.invalidURL(rawValue)
    }
    guard
      components.user == nil,
      components.password == nil,
      components.query == nil,
      components.fragment == nil
    else {
      throw AppConfigurationError.credentialsNotAllowed
    }

    if environment != .local, scheme != "https" {
      throw AppConfigurationError.secureTransportRequired(environment)
    }
    if scheme == "http", !Self.loopbackHosts.contains(host.lowercased()) {
      throw AppConfigurationError.insecureRemoteURL
    }

    return url
  }

  private static let loopbackHosts: Set<String> = ["127.0.0.1", "::1", "localhost"]
}

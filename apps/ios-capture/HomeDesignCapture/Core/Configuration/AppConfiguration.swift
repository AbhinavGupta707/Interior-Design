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
}

enum AppConfigurationError: Error, Equatable {
  case missingValue(String)
  case invalidEnvironment(String)
  case invalidURL(String)
  case credentialsNotAllowed
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

    return AppConfiguration(environment: environment, apiBaseURL: apiBaseURL)
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

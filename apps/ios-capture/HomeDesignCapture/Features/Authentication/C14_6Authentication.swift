@preconcurrency import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import Security
import SwiftUI
import UIKit

struct C14_6Actor: Codable, Equatable, Sendable {
  let displayName: String
  let role: String
  let subject: String
  let tenantId: String
  let userId: String
}

struct C14_6Session: Codable, Equatable, Sendable {
  let actor: C14_6Actor
  let authMode: String
  let expiresAt: String
}

enum C14_6AuthenticationState: Equatable, Sendable {
  case restoring
  case signedOut(message: String?)
  case signingIn
  case authenticated(C14_6Session)
  case offline(message: String)
  case unavailable(message: String)
}

enum C14_6AuthenticationError: Error, Equatable, Sendable {
  case cancelled
  case configurationUnavailable
  case expired
  case invalidCallback
  case invalidResponse
  case keychainFailure
  case noCredential
  case offline
  case unavailable
}

protocol C14_6ProtectedStringStoring: Sendable {
  func delete() async throws
  func load() async throws -> String?
  func save(_ value: String) async throws
}

actor C14_6KeychainStringStore: C14_6ProtectedStringStoring {
  private let account: String
  private let service: String

  init(service: String, account: String) {
    self.service = service
    self.account = account
  }

  func save(_ value: String) throws {
    guard
      !value.isEmpty,
      value.count <= 8_192,
      let data = value.data(using: .utf8)
    else { throw C14_6AuthenticationError.keychainFailure }
    let query = baseQuery()
    let update: [CFString: Any] = [
      kSecValueData: data,
      kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var add = query
      add[kSecValueData] = data
      add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else {
        throw C14_6AuthenticationError.keychainFailure
      }
    } else if status != errSecSuccess {
      throw C14_6AuthenticationError.keychainFailure
    }
  }

  func load() throws -> String? {
    var query = baseQuery()
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard
      status == errSecSuccess,
      let data = result as? Data,
      let value = String(data: data, encoding: .utf8),
      !value.isEmpty,
      value.count <= 8_192
    else {
      try? delete()
      throw C14_6AuthenticationError.keychainFailure
    }
    return value
  }

  func delete() throws {
    let status = SecItemDelete(baseQuery() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw C14_6AuthenticationError.keychainFailure
    }
  }

  private func baseQuery() -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: service,
      kSecAttrAccount: account,
    ]
  }
}

struct C14_6AuthorizationRequest: Equatable, Sendable {
  let callbackScheme: String
  let state: String
  let url: URL
  let verifier: String
}

@MainActor
final class C14_6WebAuthenticationPresenter: NSObject,
  ASWebAuthenticationPresentationContextProviding
{
  private var session: ASWebAuthenticationSession?

  func present(_ request: C14_6AuthorizationRequest) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      let webSession = ASWebAuthenticationSession(
        url: request.url,
        callbackURLScheme: request.callbackScheme
      ) { [weak self] callbackURL, error in
        Task { @MainActor in
          self?.session = nil
          if let authenticationError = error as? ASWebAuthenticationSessionError,
             authenticationError.code == .canceledLogin
          {
            continuation.resume(throwing: C14_6AuthenticationError.cancelled)
          } else if error != nil {
            continuation.resume(throwing: C14_6AuthenticationError.unavailable)
          } else if let callbackURL {
            continuation.resume(returning: callbackURL)
          } else {
            continuation.resume(throwing: C14_6AuthenticationError.invalidCallback)
          }
        }
      }
      webSession.presentationContextProvider = self
      webSession.prefersEphemeralWebBrowserSession = true
      session = webSession
      if !webSession.start() {
        session = nil
        continuation.resume(throwing: C14_6AuthenticationError.unavailable)
      }
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }
}

actor C14_6SessionTokenProvider: C7CaptureTokenProviding {
  private struct TokenResponse: Decodable {
    let accessToken: String
    let expiresIn: Int
    let refreshToken: String?
    let tokenType: String

    enum CodingKeys: String, CodingKey {
      case accessToken = "access_token"
      case expiresIn = "expires_in"
      case refreshToken = "refresh_token"
      case tokenType = "token_type"
    }
  }

  private let accessStore: any C7CaptureTokenStoring
  private let clock: any C7CaptureClock
  private let identity: C14_6IdentityConfiguration
  private let localRefresher: any C7CaptureTokenRefreshing
  private let refreshStore: any C14_6ProtectedStringStoring
  private let transport: any C7CaptureAuthenticationTransport

  init(
    identity: C14_6IdentityConfiguration,
    baseURL: URL,
    accessStore: any C7CaptureTokenStoring = C7KeychainTokenStore(),
    refreshStore: any C14_6ProtectedStringStoring = C14_6KeychainStringStore(
      service: "com.homedesignstudio.capture.identity",
      account: "oidc-refresh-token"
    ),
    transport: any C7CaptureAuthenticationTransport = C7URLSessionAuthenticationTransport(),
    clock: any C7CaptureClock = C7SystemCaptureClock()
  ) {
    self.identity = identity
    self.accessStore = accessStore
    self.refreshStore = refreshStore
    self.transport = transport
    self.clock = clock
    localRefresher = C7LocalSessionTokenRefresher(
      baseURL: baseURL,
      transport: transport,
      clock: clock
    )
  }

  func accessToken() async throws -> String {
    if let stored = try await accessStore.load(), isUsable(stored) {
      return stored.value
    }
    switch identity {
    case .localFixture:
      let credential = try await localRefresher.refresh()
      try await accessStore.save(credential)
      return credential.value
    case .oidc(let configuration):
      guard let refreshToken = try await refreshStore.load() else {
        throw C14_6AuthenticationError.noCredential
      }
      return try await exchange(
        configuration: configuration,
        fields: [
          URLQueryItem(name: "grant_type", value: "refresh_token"),
          URLQueryItem(name: "refresh_token", value: refreshToken),
          URLQueryItem(name: "client_id", value: configuration.clientId),
        ],
        previousRefreshToken: refreshToken
      )
    case .unavailable:
      throw C14_6AuthenticationError.configurationUnavailable
    }
  }

  func makeAuthorizationRequest() throws -> C14_6AuthorizationRequest {
    guard case .oidc(let configuration) = identity else {
      throw C14_6AuthenticationError.configurationUnavailable
    }
    let verifier = try randomURLSafe(byteCount: 48)
    let state = try randomURLSafe(byteCount: 32)
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
    guard var components = URLComponents(url: configuration.authorizationEndpoint, resolvingAgainstBaseURL: false) else {
      throw C14_6AuthenticationError.configurationUnavailable
    }
    components.queryItems = [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: configuration.clientId),
      URLQueryItem(name: "redirect_uri", value: configuration.redirectURI.absoluteString),
      URLQueryItem(name: "scope", value: configuration.scopes.joined(separator: " ")),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
    ]
    guard let url = components.url, let scheme = configuration.redirectURI.scheme else {
      throw C14_6AuthenticationError.configurationUnavailable
    }
    return C14_6AuthorizationRequest(
      callbackScheme: scheme,
      state: state,
      url: url,
      verifier: verifier
    )
  }

  func completeAuthorization(
    callbackURL: URL,
    request: C14_6AuthorizationRequest
  ) async throws {
    guard case .oidc(let configuration) = identity,
          callbackURL.scheme == configuration.redirectURI.scheme,
          callbackURL.host == configuration.redirectURI.host,
          callbackURL.path == configuration.redirectURI.path,
          let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)
    else { throw C14_6AuthenticationError.invalidCallback }
    let items = components.queryItems ?? []
    guard Set(items.map(\.name)).count == items.count else {
      throw C14_6AuthenticationError.invalidCallback
    }
    let values = Dictionary(uniqueKeysWithValues: items.compactMap { item in
      item.value.map { (item.name, $0) }
    })
    guard values["state"] == request.state,
          values["error"] == nil,
          let code = values["code"],
          !code.isEmpty,
          code.count <= 4_096
    else { throw C14_6AuthenticationError.invalidCallback }
    _ = try await exchange(
      configuration: configuration,
      fields: [
        URLQueryItem(name: "grant_type", value: "authorization_code"),
        URLQueryItem(name: "code", value: code),
        URLQueryItem(name: "client_id", value: configuration.clientId),
        URLQueryItem(name: "redirect_uri", value: configuration.redirectURI.absoluteString),
        URLQueryItem(name: "code_verifier", value: request.verifier),
      ],
      previousRefreshToken: nil
    )
  }

  func invalidate() async {
    try? await accessStore.delete()
  }

  func signOut() async {
    try? await accessStore.delete()
    try? await refreshStore.delete()
  }

  private func exchange(
    configuration: C14_6OIDCConfiguration,
    fields: [URLQueryItem],
    previousRefreshToken: String?
  ) async throws -> String {
    var form = URLComponents()
    form.queryItems = fields
    guard let body = form.percentEncodedQuery?.data(using: .utf8) else {
      throw C14_6AuthenticationError.invalidResponse
    }
    var request = URLRequest(
      url: configuration.tokenEndpoint,
      cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
      timeoutInterval: 30
    )
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    request.httpBody = body
    do {
      let (data, response) = try await transport.data(for: request)
      if response.statusCode == 400 || response.statusCode == 401 {
        try? await accessStore.delete()
        try? await refreshStore.delete()
        throw C14_6AuthenticationError.expired
      }
      guard (200..<300).contains(response.statusCode), data.count <= 64_000 else {
        throw C14_6AuthenticationError.unavailable
      }
      guard
        let token = try? JSONDecoder().decode(TokenResponse.self, from: data),
        token.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
        token.accessToken.count >= 32,
        token.accessToken.count <= 8_192,
        token.accessToken.unicodeScalars.allSatisfy({ !$0.properties.isWhitespace }),
        (60...86_400).contains(token.expiresIn)
      else { throw C14_6AuthenticationError.invalidResponse }
      let refreshToken = token.refreshToken ?? previousRefreshToken
      guard let refreshToken, refreshToken.count >= 16, refreshToken.count <= 8_192 else {
        throw C14_6AuthenticationError.invalidResponse
      }
      let credential = C7AccessCredential(
        expiresAt: clock.now().addingTimeInterval(TimeInterval(token.expiresIn)),
        value: token.accessToken
      )
      try await refreshStore.save(refreshToken)
      try await accessStore.save(credential)
      return token.accessToken
    } catch let error as C14_6AuthenticationError {
      throw error
    } catch let error as URLError where error.code == .notConnectedToInternet {
      throw C14_6AuthenticationError.offline
    } catch {
      throw C14_6AuthenticationError.unavailable
    }
  }

  private func isUsable(_ credential: C7AccessCredential) -> Bool {
    credential.value.count >= 32
      && credential.value.count <= 8_192
      && credential.value.unicodeScalars.allSatisfy({ !$0.properties.isWhitespace })
      && credential.expiresAt.timeIntervalSince(clock.now()) > 30
  }

  private func randomURLSafe(byteCount: Int) throws -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    guard SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes) == errSecSuccess else {
      throw C14_6AuthenticationError.unavailable
    }
    return Data(bytes).base64URLEncodedString()
  }
}

actor C14_6SessionAPIClient {
  private let baseURL: URL
  private let tokenProvider: C14_6SessionTokenProvider
  private let transport: any C1HTTPTransport

  init(
    baseURL: URL,
    tokenProvider: C14_6SessionTokenProvider,
    transport: any C1HTTPTransport = URLSessionTransport()
  ) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.transport = transport
  }

  func session() async throws -> C14_6Session {
    for attempt in 0...1 {
      let token = try await tokenProvider.accessToken()
      var request = URLRequest(
        url: baseURL.appendingPathComponent("v1/session"),
        cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
        timeoutInterval: 30
      )
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
      do {
        let (data, response) = try await transport.data(for: request)
        if response.statusCode == 401, attempt == 0 {
          await tokenProvider.invalidate()
          continue
        }
        if response.statusCode == 401 { throw C14_6AuthenticationError.expired }
        guard (200..<300).contains(response.statusCode), data.count <= 64_000,
              let session = try? JSONDecoder().decode(C14_6Session.self, from: data),
              Self.valid(session)
        else {
          throw response.statusCode >= 500
            ? C14_6AuthenticationError.unavailable
            : C14_6AuthenticationError.invalidResponse
        }
        return session
      } catch let error as C14_6AuthenticationError {
        throw error
      } catch let error as URLError where error.code == .notConnectedToInternet {
        throw C14_6AuthenticationError.offline
      } catch {
        throw C14_6AuthenticationError.unavailable
      }
    }
    throw C14_6AuthenticationError.expired
  }

  private static func valid(_ session: C14_6Session) -> Bool {
    [session.actor.tenantId, session.actor.userId].allSatisfy { UUID(uuidString: $0) != nil }
      && !session.actor.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (3...200).contains(session.actor.subject.count)
      && ["owner", "editor", "viewer"].contains(session.actor.role)
      && ["local-fixture", "oidc"].contains(session.authMode)
      && (C14_6ContractValidation.date(session.expiresAt)?.timeIntervalSinceNow ?? 0) > 0
  }
}

@MainActor
@Observable
final class C14_6AuthenticationModel {
  private(set) var state: C14_6AuthenticationState = .restoring

  @ObservationIgnored private let identity: C14_6IdentityConfiguration
  @ObservationIgnored private let presenter: C14_6WebAuthenticationPresenter
  @ObservationIgnored private let sessionClient: C14_6SessionAPIClient
  @ObservationIgnored private let tokenProvider: C14_6SessionTokenProvider

  init(
    identity: C14_6IdentityConfiguration,
    tokenProvider: C14_6SessionTokenProvider,
    sessionClient: C14_6SessionAPIClient,
    presenter: C14_6WebAuthenticationPresenter = C14_6WebAuthenticationPresenter()
  ) {
    self.identity = identity
    self.tokenProvider = tokenProvider
    self.sessionClient = sessionClient
    self.presenter = presenter
  }

  var session: C14_6Session? {
    guard case .authenticated(let session) = state else { return nil }
    return session
  }

  var signInTitle: String {
    identity == .localFixture ? "Continue as local homeowner" : "Sign in securely"
  }

  func restore() async {
    state = .restoring
    do {
      state = .authenticated(try await sessionClient.session())
    } catch {
      handle(error, duringRestore: true)
    }
  }

  func signIn() async {
    state = .signingIn
    do {
      if case .oidc = identity {
        let request = try await tokenProvider.makeAuthorizationRequest()
        let callback = try await presenter.present(request)
        try await tokenProvider.completeAuthorization(callbackURL: callback, request: request)
      }
      state = .authenticated(try await sessionClient.session())
    } catch {
      handle(error, duringRestore: false)
    }
  }

  func signOut() async {
    await tokenProvider.signOut()
    state = .signedOut(message: "Signed out on this device. No server revocation endpoint is available in the frozen C1 contract.")
  }

  private func handle(_ error: Error, duringRestore: Bool) {
    switch error as? C14_6AuthenticationError {
    case .noCredential, .expired:
      state = .signedOut(message: duringRestore ? nil : "Your session expired. Sign in again.")
    case .cancelled:
      state = .signedOut(message: "Sign-in was cancelled. Nothing was changed.")
    case .offline:
      state = .offline(message: "You’re offline. A cached credential cannot authorise project data until the server session is revalidated.")
    case .configurationUnavailable:
      state = .unavailable(message: "Secure sign-in is not configured for this build. Add the complete OIDC endpoint, public client, redirect and scope configuration.")
    case .invalidCallback, .invalidResponse, .keychainFailure:
      state = .unavailable(message: "Sign-in failed closed because the callback, credential storage or server session did not match the frozen contract.")
    case .unavailable, .none:
      state = .unavailable(message: "The identity or session service is unavailable. Try again; no project authority was cached.")
    }
  }
}

struct C14_6AuthenticationView: View {
  @Bindable var model: C14_6AuthenticationModel
  let environmentLabel: String

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 22) {
        Image(systemName: "house.and.flag.fill")
          .font(.system(size: 52))
          .foregroundStyle(.tint)
          .accessibilityHidden(true)
        Text("Your home design workspace")
          .font(.largeTitle.bold())
        Text("Sign in before any project, address context or evidence is loaded. The server session and tenant membership remain authoritative after every launch.")
          .foregroundStyle(.secondary)
        stateContent
        Spacer()
        Text("\(environmentLabel) environment · Access and refresh credentials stay in this device’s protected Keychain and are never shown in diagnostics.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: 620, maxHeight: .infinity, alignment: .leading)
      .padding(28)
      .navigationTitle("Home Design Studio")
    }
  }

  @ViewBuilder
  private var stateContent: some View {
    switch model.state {
    case .restoring:
      Label("Recovering protected session…", systemImage: "key.viewfinder")
        .accessibilityIdentifier("c14_6.session-restoring")
    case .signingIn:
      HStack { ProgressView(); Text("Completing secure sign-in…") }
        .accessibilityIdentifier("c14_6.session-signing-in")
    case .signedOut(let message):
      if let message { status(message, symbol: "info.circle") }
      Button(model.signInTitle) { Task { await model.signIn() } }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .accessibilityIdentifier("c14_6.sign-in")
    case .offline(let message):
      status(message, symbol: "wifi.slash")
      Button("Retry session recovery") { Task { await model.restore() } }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c14_6.retry-session")
    case .unavailable(let message):
      status(message, symbol: "exclamationmark.triangle")
      Button("Try again") { Task { await model.restore() } }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("c14_6.retry-session")
    case .authenticated:
      EmptyView()
    }
  }

  private func status(_ message: String, symbol: String) -> some View {
    Label {
      Text(message)
    } icon: {
      Image(systemName: symbol)
    }
    .padding()
    .background(.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    .accessibilityElement(children: .combine)
  }
}

private extension Data {
  func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

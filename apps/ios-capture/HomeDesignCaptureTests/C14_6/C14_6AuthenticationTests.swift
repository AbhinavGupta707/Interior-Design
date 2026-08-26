import Foundation
import XCTest
@testable import HomeDesignCapture

final class C14_6AuthenticationTests: XCTestCase {
  private let oidc = C14_6OIDCConfiguration(
    authorizationEndpoint: URL(string: "https://identity.example.test/authorize")!,
    clientId: "native-public-client",
    redirectURI: URL(string: "com.homedesignstudio.capture.auth:/oauth/callback")!,
    scopes: ["openid", "profile", "offline_access"],
    tokenEndpoint: URL(string: "https://identity.example.test/oauth/token")!
  )

  func testAuthorizationRequestUsesPKCEStateAndNoClientSecret() async throws {
    let provider = C14_6SessionTokenProvider(
      identity: .oidc(oidc),
      baseURL: URL(string: "https://api.example.test")!,
      accessStore: C14_6MemoryAccessStore(),
      refreshStore: C14_6MemoryStringStore(),
      transport: C14_6AuthenticationTransport(),
      clock: C14_6FixedClock()
    )

    let request = try await provider.makeAuthorizationRequest()
    let components = try XCTUnwrap(URLComponents(url: request.url, resolvingAgainstBaseURL: false))
    let fields = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).compactMap {
      item in item.value.map { (item.name, $0) }
    })

    XCTAssertEqual(fields["response_type"], "code")
    XCTAssertEqual(fields["client_id"], oidc.clientId)
    XCTAssertEqual(fields["code_challenge_method"], "S256")
    XCTAssertEqual(fields["state"], request.state)
    XCTAssertNotNil(fields["code_challenge"])
    XCTAssertNil(fields["client_secret"])
    XCTAssertGreaterThanOrEqual(request.verifier.count, 43)
  }

  func testRefreshRecoveryRotatesProtectedCredential() async throws {
    let accessStore = C14_6MemoryAccessStore()
    let refreshStore = C14_6MemoryStringStore(value: "existing-refresh-token")
    let response = """
      {
        "access_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "expires_in":900,
        "refresh_token":"rotated-refresh-token",
        "token_type":"Bearer"
      }
      """.data(using: .utf8)!
    let transport = C14_6AuthenticationTransport(data: response, status: 200)
    let provider = C14_6SessionTokenProvider(
      identity: .oidc(oidc),
      baseURL: URL(string: "https://api.example.test")!,
      accessStore: accessStore,
      refreshStore: refreshStore,
      transport: transport,
      clock: C14_6FixedClock()
    )

    let token = try await provider.accessToken()
    let rotated = await refreshStore.load()
    let credentialDescription = await accessStore.load()?.description
    let observedRequest = await transport.lastRequest()

    XCTAssertEqual(token, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    XCTAssertEqual(rotated, "rotated-refresh-token")
    XCTAssertEqual(credentialDescription, "[REDACTED]")
    let sent = try XCTUnwrap(observedRequest)
    let body = String(data: try XCTUnwrap(sent.httpBody), encoding: .utf8)
    XCTAssertTrue(body?.contains("grant_type=refresh_token") == true)
    XCTAssertTrue(body?.contains("client_secret") == false)
    XCTAssertEqual(sent.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
    XCTAssertEqual(sent.value(forHTTPHeaderField: "Cache-Control"), "no-store")
  }

  func testMissingRefreshCredentialFailsClosed() async {
    let provider = C14_6SessionTokenProvider(
      identity: .oidc(oidc),
      baseURL: URL(string: "https://api.example.test")!,
      accessStore: C14_6MemoryAccessStore(),
      refreshStore: C14_6MemoryStringStore(),
      transport: C14_6AuthenticationTransport(),
      clock: C14_6FixedClock()
    )

    do {
      _ = try await provider.accessToken()
      XCTFail("Expected missing credential")
    } catch {
      XCTAssertEqual(error as? C14_6AuthenticationError, .noCredential)
    }
  }

  func testInvalidGrantClearsBothCredentialClasses() async throws {
    let accessStore = C14_6MemoryAccessStore(
      value: C7AccessCredential(
        expiresAt: C14_6FixedClock.now.addingTimeInterval(-60),
        value: String(repeating: "a", count: 48)
      )
    )
    let refreshStore = C14_6MemoryStringStore(value: "existing-refresh-token")
    let provider = C14_6SessionTokenProvider(
      identity: .oidc(oidc),
      baseURL: URL(string: "https://api.example.test")!,
      accessStore: accessStore,
      refreshStore: refreshStore,
      transport: C14_6AuthenticationTransport(data: Data(), status: 401),
      clock: C14_6FixedClock()
    )

    do {
      _ = try await provider.accessToken()
      XCTFail("Expected expiry")
    } catch {
      XCTAssertEqual(error as? C14_6AuthenticationError, .expired)
    }
    let access = await accessStore.load()
    let refresh = await refreshStore.load()
    XCTAssertNil(access)
    XCTAssertNil(refresh)
  }

  func testSessionAuthorityInvalidatesOneRejectedAccessTokenAndRefreshesOnce() async throws {
    let oldToken = String(repeating: "o", count: 48)
    let newToken = String(repeating: "n", count: 48)
    let accessStore = C14_6MemoryAccessStore(
      value: C7AccessCredential(
        expiresAt: C14_6FixedClock.now.addingTimeInterval(900),
        value: oldToken
      )
    )
    let refreshStore = C14_6MemoryStringStore(value: "existing-refresh-token")
    let refreshResponse = """
      {
        "access_token":"\(newToken)",
        "expires_in":900,
        "refresh_token":"rotated-refresh-token",
        "token_type":"Bearer"
      }
      """.data(using: .utf8)!
    let provider = C14_6SessionTokenProvider(
      identity: .oidc(oidc),
      baseURL: URL(string: "https://api.example.test")!,
      accessStore: accessStore,
      refreshStore: refreshStore,
      transport: C14_6AuthenticationTransport(data: refreshResponse, status: 200),
      clock: C14_6FixedClock()
    )
    let sessionData = Data(
      #"{"actor":{"displayName":"Home Owner","role":"owner","subject":"oidc-subject","tenantId":"11111111-1111-4111-8111-111111111111","userId":"22222222-2222-4222-8222-222222222222"},"authMode":"oidc","expiresAt":"2099-08-26T12:00:00Z"}"#.utf8
    )
    let transport = C14_6QueuedSessionTransport(
      responses: [
        C14_6SessionResponse(data: Data(), status: 401),
        C14_6SessionResponse(data: sessionData, status: 200),
      ]
    )
    let client = C14_6SessionAPIClient(
      baseURL: URL(string: "https://api.example.test")!,
      tokenProvider: provider,
      transport: transport
    )

    let session = try await client.session()
    let authorisation = await transport.authorisationHeaders()
    let rotatedRefresh = await refreshStore.load()

    XCTAssertEqual(session.actor.role, "owner")
    XCTAssertEqual(authorisation, ["Bearer \(oldToken)", "Bearer \(newToken)"])
    XCTAssertEqual(rotatedRefresh, "rotated-refresh-token")
  }

  func testSessionRejectsAnUnrecognisedServerRole() async throws {
    let provider = C14_6SessionTokenProvider(
      identity: .oidc(oidc),
      baseURL: URL(string: "https://api.example.test")!,
      accessStore: C14_6MemoryAccessStore(
        value: C7AccessCredential(
          expiresAt: C14_6FixedClock.now.addingTimeInterval(900),
          value: String(repeating: "a", count: 48)
        )
      ),
      refreshStore: C14_6MemoryStringStore(value: "existing-refresh-token"),
      transport: C14_6AuthenticationTransport(),
      clock: C14_6FixedClock()
    )
    let invalid = Data(
      #"{"actor":{"displayName":"Home Owner","role":"administrator","subject":"oidc-subject","tenantId":"11111111-1111-4111-8111-111111111111","userId":"22222222-2222-4222-8222-222222222222"},"authMode":"oidc","expiresAt":"2099-08-26T12:00:00Z"}"#.utf8
    )
    let client = C14_6SessionAPIClient(
      baseURL: URL(string: "https://api.example.test")!,
      tokenProvider: provider,
      transport: C14_6QueuedSessionTransport(
        responses: [C14_6SessionResponse(data: invalid, status: 200)]
      )
    )

    do {
      _ = try await client.session()
      XCTFail("Expected invalid session")
    } catch {
      XCTAssertEqual(error as? C14_6AuthenticationError, .invalidResponse)
    }
  }

  func testSignOutClearsAccessAndRefreshCredentials() async throws {
    let accessStore = C14_6MemoryAccessStore(
      value: C7AccessCredential(
        expiresAt: C14_6FixedClock.now.addingTimeInterval(900),
        value: String(repeating: "a", count: 48)
      )
    )
    let refreshStore = C14_6MemoryStringStore(value: "existing-refresh-token")
    let provider = C14_6SessionTokenProvider(
      identity: .oidc(oidc),
      baseURL: URL(string: "https://api.example.test")!,
      accessStore: accessStore,
      refreshStore: refreshStore,
      transport: C14_6AuthenticationTransport(),
      clock: C14_6FixedClock()
    )

    await provider.signOut()
    let access = await accessStore.load()
    let refresh = await refreshStore.load()

    XCTAssertNil(access)
    XCTAssertNil(refresh)
  }

  func testProtectedStringStoreRoundTripsAndDeletesThisDeviceOnlyItem() async throws {
    let store = C14_6KeychainStringStore(
      service: "com.homedesignstudio.capture.tests.\(UUID().uuidString)",
      account: "round-trip"
    )

    try await store.save("protected-refresh-token")
    let loaded = try await store.load()
    try await store.delete()
    let deleted = try await store.load()

    XCTAssertEqual(loaded, "protected-refresh-token")
    XCTAssertNil(deleted)
  }
}

private actor C14_6MemoryAccessStore: C7CaptureTokenStoring {
  private var value: C7AccessCredential?
  init(value: C7AccessCredential? = nil) { self.value = value }
  func delete() { value = nil }
  func load() -> C7AccessCredential? { value }
  func save(_ credential: C7AccessCredential) { value = credential }
}

private actor C14_6MemoryStringStore: C14_6ProtectedStringStoring {
  private var value: String?
  init(value: String? = nil) { self.value = value }
  func delete() { value = nil }
  func load() -> String? { value }
  func save(_ value: String) { self.value = value }
}

private actor C14_6AuthenticationTransport: C7CaptureAuthenticationTransport {
  private let data: Data
  private var request: URLRequest?
  private let status: Int

  init(data: Data = Data(), status: Int = 500) {
    self.data = data
    self.status = status
  }

  func data(for request: URLRequest) throws -> (Data, HTTPURLResponse) {
    self.request = request
    return (
      data,
      HTTPURLResponse(
        url: request.url!,
        statusCode: status,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
    )
  }

  func lastRequest() -> URLRequest? { request }
}

private struct C14_6SessionResponse: Sendable {
  let data: Data
  let status: Int
}

private actor C14_6QueuedSessionTransport: C1HTTPTransport {
  private var headers: [String] = []
  private var responses: [C14_6SessionResponse]

  init(responses: [C14_6SessionResponse]) { self.responses = responses }

  func data(for request: URLRequest) throws -> (Data, HTTPURLResponse) {
    headers.append(request.value(forHTTPHeaderField: "Authorization") ?? "")
    let response = responses.removeFirst()
    return (
      response.data,
      HTTPURLResponse(
        url: request.url!,
        statusCode: response.status,
        httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"]
      )!
    )
  }

  func authorisationHeaders() -> [String] { headers }
}

private struct C14_6FixedClock: C7CaptureClock {
  static let now = Date(timeIntervalSince1970: 1_788_256_800)
  func now() -> Date { Self.now }
}

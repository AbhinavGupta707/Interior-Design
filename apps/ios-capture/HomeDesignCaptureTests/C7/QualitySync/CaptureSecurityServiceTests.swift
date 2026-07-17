import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C7 authentication, transport, and safe diagnostics", .serialized)
struct CaptureSecurityServiceTests {
  @Test("Keychain-capable provider reuses valid credential and refreshes expired state")
  func tokenLifecycle() async throws {
    let clock = C7FixedClock(value: C7SyntheticFixture.now)
    let valid = C7AccessCredential(
      expiresAt: C7SyntheticFixture.now.addingTimeInterval(600),
      value: String(repeating: "v", count: 40)
    )
    let refreshed = C7AccessCredential(
      expiresAt: C7SyntheticFixture.now.addingTimeInterval(900),
      value: String(repeating: "r", count: 40)
    )
    let store = C7MemoryTokenStore(credential: valid)
    let refresher = C7TokenRefresherStub(credential: refreshed)
    let provider = C7KeychainBackedTokenProvider(
      store: store,
      refresher: refresher,
      clock: clock
    )

    #expect(try await provider.accessToken() == valid.value)
    #expect(await refresher.count() == 0)
    await provider.invalidate()
    #expect(try await provider.accessToken() == refreshed.value)
    #expect(await refresher.count() == 1)
  }

  @Test("expired and malformed credentials never leave the provider")
  func expiredTokenRefresh() async throws {
    let clock = C7FixedClock(value: C7SyntheticFixture.now)
    let store = C7MemoryTokenStore(
      credential: C7AccessCredential(
        expiresAt: C7SyntheticFixture.now,
        value: String(repeating: "x", count: 40)
      )
    )
    let refresher = C7TokenRefresherStub(
      credential: C7AccessCredential(
        expiresAt: C7SyntheticFixture.now.addingTimeInterval(900),
        value: String(repeating: "n", count: 40)
      )
    )
    let provider = C7KeychainBackedTokenProvider(
      store: store,
      refresher: refresher,
      clock: clock
    )

    #expect(try await provider.accessToken() == String(repeating: "n", count: 40))
    #expect(await refresher.count() == 1)
    #expect(await store.savedCredential()?.value == String(repeating: "n", count: 40))
  }

  @Test("credential description and diagnostics cannot render secret-bearing fields")
  func safeDescriptions() throws {
    let secret = "VISIBLY-SYNTHETIC-SECRET-TOKEN"
    let credential = C7AccessCredential(
      expiresAt: C7SyntheticFixture.now,
      value: secret
    )
    let diagnosticData = try JSONEncoder().encode(C7CaptureDiagnosticEvent.allCases)
    let diagnostics = try #require(String(data: diagnosticData, encoding: .utf8))

    #expect(credential.description == "[REDACTED]")
    #expect(!credential.description.contains(secret))
    #expect(!diagnostics.localizedCaseInsensitiveContains("token"))
    #expect(!diagnostics.localizedCaseInsensitiveContains("url"))
    #expect(!diagnostics.localizedCaseInsensitiveContains("path"))
    #expect(!diagnostics.localizedCaseInsensitiveContains("object-key"))
  }

  @Test("401 invalidates the provider and replays the same authenticated GET once")
  func authenticationReplay() async throws {
    let token = String(repeating: "t", count: 40)
    let provider = C7TokenProviderStub(token: token)
    let responseData = try JSONEncoder().encode(C7SyntheticFixture.session())
    let transport = C7HTTPTransportStub(
      responses: [
        (401, Data()),
        (200, responseData),
      ]
    )
    let client = C7CaptureAPIClient(
      baseURL: URL(string: "http://127.0.0.1:3001")!,
      tokenProvider: provider,
      transport: transport
    )

    let session = try await client.session(
      projectId: C7SyntheticFixture.projectId,
      captureSessionId: C7SyntheticFixture.sessionId
    )

    #expect(session.id == C7SyntheticFixture.sessionId)
    #expect(await provider.invalidationCount() == 1)
    #expect(await transport.dataRequestCount() == 2)
    #expect(await transport.allAuthorizationHeaders() == ["Bearer \(token)", "Bearer \(token)"])
  }

  @Test("missing checksum header blocks signed upload before transport")
  func missingChecksumBinding() async throws {
    let transport = C7HTTPTransportStub(responses: [])
    let client = C7CaptureAPIClient(
      baseURL: URL(string: "http://127.0.0.1:3001")!,
      tokenProvider: C7TokenProviderStub(token: String(repeating: "t", count: 40)),
      transport: transport,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let file = try C7SyntheticFixture.sourceFile(in: root)
    let signed = C7SignedArtifactPart(
      expiresAt: "2026-07-18T12:00:00.000Z",
      partNumber: 1,
      requiredHeaders: ["content-type": "application/json"],
      url: URL(string: "http://127.0.0.1:8333/synthetic")!
    )

    await #expect(throws: C7CaptureServiceError.checksumBindingMissing) {
      try await client.uploadArtifactPart(
        fileURL: file,
        signedPart: signed,
        expectedChecksum: "synthetic-checksum"
      )
    }
    #expect(await transport.uploadRequestCount() == 0)
  }

  @Test("remote plain HTTP signed upload is rejected")
  func insecureSignedURL() async throws {
    let transport = C7HTTPTransportStub(responses: [])
    let client = C7CaptureAPIClient(
      baseURL: URL(string: "https://api.example.invalid")!,
      tokenProvider: C7TokenProviderStub(token: String(repeating: "t", count: 40)),
      transport: transport,
      clock: C7FixedClock(value: C7SyntheticFixture.now)
    )
    let root = try C7SyntheticFixture.temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let file = try C7SyntheticFixture.sourceFile(in: root)
    let signed = C7SignedArtifactPart(
      expiresAt: "2026-07-18T12:00:00.000Z",
      partNumber: 1,
      requiredHeaders: ["x-amz-checksum-sha256": "synthetic-checksum"],
      url: URL(string: "http://uploads.example.invalid/synthetic")!
    )

    await #expect(throws: C7CaptureServiceError.checksumBindingMissing) {
      try await client.uploadArtifactPart(
        fileURL: file,
        signedPart: signed,
        expectedChecksum: "synthetic-checksum"
      )
    }
    #expect(await transport.uploadRequestCount() == 0)
  }
}

private actor C7MemoryTokenStore: C7CaptureTokenStoring {
  private var credential: C7AccessCredential?
  init(credential: C7AccessCredential?) { self.credential = credential }
  func delete() { credential = nil }
  func load() -> C7AccessCredential? { credential }
  func save(_ credential: C7AccessCredential) { self.credential = credential }
  func savedCredential() -> C7AccessCredential? { credential }
}

private actor C7TokenRefresherStub: C7CaptureTokenRefreshing {
  private let credential: C7AccessCredential
  private var refreshCount = 0
  init(credential: C7AccessCredential) { self.credential = credential }
  func refresh() -> C7AccessCredential {
    refreshCount += 1
    return credential
  }
  func count() -> Int { refreshCount }
}

private actor C7TokenProviderStub: C7CaptureTokenProviding {
  private let token: String
  private var invalidations = 0
  init(token: String) { self.token = token }
  func accessToken() -> String { token }
  func invalidate() { invalidations += 1 }
  func invalidationCount() -> Int { invalidations }
}

private actor C7HTTPTransportStub: C7CaptureHTTPTransport {
  private var responses: [(Int, Data)]
  private var dataRequests: [URLRequest] = []
  private var uploadRequests: [URLRequest] = []

  init(responses: [(Int, Data)]) { self.responses = responses }

  func data(for request: URLRequest) throws -> (Data, HTTPURLResponse) {
    dataRequests.append(request)
    guard !responses.isEmpty else { throw C7CaptureServiceError.unavailable }
    let next = responses.removeFirst()
    return (
      next.1,
      HTTPURLResponse(
        url: request.url!,
        statusCode: next.0,
        httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/json"]
      )!
    )
  }

  func upload(for request: URLRequest, fromFile fileURL: URL) -> (Data, HTTPURLResponse) {
    uploadRequests.append(request)
    return (
      Data(),
      HTTPURLResponse(
        url: request.url!,
        statusCode: 200,
        httpVersion: "HTTP/1.1",
        headerFields: ["ETag": "synthetic-etag"]
      )!
    )
  }

  func dataRequestCount() -> Int { dataRequests.count }
  func uploadRequestCount() -> Int { uploadRequests.count }
  func allAuthorizationHeaders() -> [String] {
    dataRequests.compactMap { $0.value(forHTTPHeaderField: "Authorization") }
  }
}

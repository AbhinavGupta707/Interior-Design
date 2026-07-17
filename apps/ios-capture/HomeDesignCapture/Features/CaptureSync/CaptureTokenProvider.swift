import Foundation
import Security

struct C7AccessCredential: Codable, Equatable, Sendable, CustomStringConvertible {
  let expiresAt: Date
  let value: String

  var description: String { "[REDACTED]" }
}

enum C7CaptureTokenError: Error, Equatable, Sendable {
  case invalidCredential
  case keychainFailure
  case unavailable
}

protocol C7CaptureTokenStoring: Sendable {
  func delete() async throws
  func load() async throws -> C7AccessCredential?
  func save(_ credential: C7AccessCredential) async throws
}

protocol C7CaptureTokenRefreshing: Sendable {
  func refresh() async throws -> C7AccessCredential
}

protocol C7CaptureTokenProviding: Sendable {
  func accessToken() async throws -> String
  func invalidate() async
}

actor C7KeychainTokenStore: C7CaptureTokenStoring {
  private let account: String
  private let service: String
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(
    service: String = "com.homedesignstudio.capture.api",
    account: String = "capture-bearer"
  ) {
    self.service = service
    self.account = account
  }

  func save(_ credential: C7AccessCredential) throws {
    let data = try encoder.encode(credential)
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
        throw C7CaptureTokenError.keychainFailure
      }
    } else if status != errSecSuccess {
      throw C7CaptureTokenError.keychainFailure
    }
  }

  func load() throws -> C7AccessCredential? {
    var query = baseQuery()
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw C7CaptureTokenError.keychainFailure
    }
    guard let credential = try? decoder.decode(C7AccessCredential.self, from: data) else {
      try? delete()
      throw C7CaptureTokenError.invalidCredential
    }
    return credential
  }

  func delete() throws {
    let status = SecItemDelete(baseQuery() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw C7CaptureTokenError.keychainFailure
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

actor C7KeychainBackedTokenProvider: C7CaptureTokenProviding {
  private let store: any C7CaptureTokenStoring
  private let refresher: any C7CaptureTokenRefreshing
  private let clock: any C7CaptureClock

  init(
    store: any C7CaptureTokenStoring,
    refresher: any C7CaptureTokenRefreshing,
    clock: any C7CaptureClock = C7SystemCaptureClock()
  ) {
    self.store = store
    self.refresher = refresher
    self.clock = clock
  }

  func accessToken() async throws -> String {
    if let stored = try await store.load(), isUsable(stored) {
      return stored.value
    }
    let refreshed = try await refresher.refresh()
    guard isUsable(refreshed) else { throw C7CaptureTokenError.invalidCredential }
    try await store.save(refreshed)
    return refreshed.value
  }

  func invalidate() async {
    try? await store.delete()
  }

  private func isUsable(_ credential: C7AccessCredential) -> Bool {
    credential.value.count >= 32
      && credential.value.unicodeScalars.allSatisfy({ !$0.properties.isWhitespace })
      && credential.expiresAt.timeIntervalSince(clock.now()) > 30
  }
}

protocol C7CaptureAuthenticationTransport: Sendable {
  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct C7URLSessionAuthenticationTransport: C7CaptureAuthenticationTransport, @unchecked Sendable {
  private let session: URLSession

  init(session: URLSession = .shared) {
    self.session = session
  }

  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw C7CaptureTokenError.unavailable
    }
    return (data, response)
  }
}

struct C7LocalSessionTokenRefresher: C7CaptureTokenRefreshing, Sendable {
  private struct Request: Encodable { let persona: String }
  private struct Response: Decodable { let accessToken: String }

  private let baseURL: URL
  private let transport: any C7CaptureAuthenticationTransport
  private let clock: any C7CaptureClock

  init(
    baseURL: URL,
    transport: any C7CaptureAuthenticationTransport = C7URLSessionAuthenticationTransport(),
    clock: any C7CaptureClock = C7SystemCaptureClock()
  ) {
    self.baseURL = baseURL
    self.transport = transport
    self.clock = clock
  }

  func refresh() async throws -> C7AccessCredential {
    var request = URLRequest(
      url: baseURL.appendingPathComponent("v1/auth/local/session")
    )
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(Request(persona: "homeowner-alpha"))
    do {
      let (data, response) = try await transport.data(for: request)
      guard (200..<300).contains(response.statusCode) else {
        throw C7CaptureTokenError.unavailable
      }
      guard
        let decoded = try? JSONDecoder().decode(Response.self, from: data),
        decoded.accessToken.count >= 32
      else {
        throw C7CaptureTokenError.invalidCredential
      }
      return C7AccessCredential(
        expiresAt: clock.now().addingTimeInterval(15 * 60),
        value: decoded.accessToken
      )
    } catch let error as C7CaptureTokenError {
      throw error
    } catch {
      throw C7CaptureTokenError.unavailable
    }
  }
}

struct C7UnavailableTokenRefresher: C7CaptureTokenRefreshing {
  func refresh() async throws -> C7AccessCredential {
    throw C7CaptureTokenError.unavailable
  }
}

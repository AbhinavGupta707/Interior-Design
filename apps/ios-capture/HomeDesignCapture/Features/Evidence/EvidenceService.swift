import CryptoKit
import Foundation
import UniformTypeIdentifiers

protocol EvidenceServing: Sendable {
  func abort(projectId: String, sessionId: String, idempotencyKey: String) async throws
  func access(projectId: String, assetId: String, representation: String) async throws -> EvidenceAccess
  func complete(
    projectId: String,
    sessionId: String,
    sha256: String,
    parts: [CompletedEvidencePart],
    idempotencyKey: String
  ) async throws -> EvidenceAsset
  func createSession(
    projectId: String,
    selection: EvidenceSelection,
    sha256: String,
    rights: EvidenceRightsAssertion,
    idempotencyKey: String
  ) async throws -> EvidenceUploadSession
  func list(projectId: String) async throws -> [EvidenceAsset]
  func session(projectId: String, sessionId: String) async throws -> EvidenceUploadSession
  func signPart(
    projectId: String,
    sessionId: String,
    partNumber: Int,
    byteSize: Int,
    checksumSha256: String,
    idempotencyKey: String
  ) async throws -> SignedEvidencePart
  func uploadPart(fileURL: URL, signedPart: SignedEvidencePart) async throws -> String
}

protocol EvidenceHTTPTransport: Sendable {
  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
  func upload(for request: URLRequest, fromFile fileURL: URL) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionEvidenceTransport: EvidenceHTTPTransport, @unchecked Sendable {
  private let foregroundSession: URLSession
  private let backgroundSession: URLSession

  init(
    foregroundSession: URLSession = .shared,
    backgroundIdentifier: String = "com.homedesignstudio.capture.c2-parts"
  ) {
    self.foregroundSession = foregroundSession
    let configuration = URLSessionConfiguration.background(withIdentifier: backgroundIdentifier)
    configuration.isDiscretionary = false
    configuration.sessionSendsLaunchEvents = true
    configuration.waitsForConnectivity = true
    backgroundSession = URLSession(configuration: configuration)
  }

  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await foregroundSession.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw EvidenceServiceError.invalidResponse
    }
    return (data, response)
  }

  func upload(for request: URLRequest, fromFile fileURL: URL) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await backgroundSession.upload(for: request, fromFile: fileURL)
    guard let response = response as? HTTPURLResponse else {
      throw EvidenceServiceError.invalidResponse
    }
    return (data, response)
  }
}

actor C2EvidenceAPIClient: EvidenceServing {
  private struct LocalSessionRequest: Encodable { let persona: String }
  private struct LocalSessionResponse: Decodable { let accessToken: String }
  private struct CreateRequest: Encodable {
    let byteSize: Int64
    let declaredMimeType: String
    let fileName: String
    let kind: EvidenceKind
    let rights: EvidenceRightsAssertion
    let sha256: String
  }
  private struct SignRequest: Encodable {
    let byteSize: Int
    let checksumSha256: String
    let partNumber: Int
  }
  private struct CompleteRequest: Encodable {
    let parts: [CompletedEvidencePart]
    let sha256: String
  }
  private struct AccessRequest: Encodable { let representation: String }

  private let baseURL: URL
  private let transport: any EvidenceHTTPTransport
  private var accessToken: String?
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(baseURL: URL, transport: any EvidenceHTTPTransport = URLSessionEvidenceTransport()) {
    self.baseURL = baseURL
    self.transport = transport
  }

  func list(projectId: String) async throws -> [EvidenceAsset] {
    try await send(path: "/v1/projects/\(projectId)/assets", response: [EvidenceAsset].self)
  }

  func createSession(
    projectId: String,
    selection: EvidenceSelection,
    sha256: String,
    rights: EvidenceRightsAssertion,
    idempotencyKey: String
  ) async throws -> EvidenceUploadSession {
    try await send(
      path: "/v1/projects/\(projectId)/assets/upload-sessions",
      method: "POST",
      body: CreateRequest(
        byteSize: selection.size,
        declaredMimeType: selection.mimeType,
        fileName: selection.fileName,
        kind: selection.kind,
        rights: rights,
        sha256: sha256
      ),
      idempotencyKey: idempotencyKey,
      response: EvidenceUploadSession.self
    )
  }

  func session(projectId: String, sessionId: String) async throws -> EvidenceUploadSession {
    try await send(
      path: "/v1/projects/\(projectId)/assets/upload-sessions/\(sessionId)",
      response: EvidenceUploadSession.self
    )
  }

  func signPart(
    projectId: String,
    sessionId: String,
    partNumber: Int,
    byteSize: Int,
    checksumSha256: String,
    idempotencyKey: String
  ) async throws -> SignedEvidencePart {
    try await send(
      path: "/v1/projects/\(projectId)/assets/upload-sessions/\(sessionId)/parts",
      method: "POST",
      body: SignRequest(
        byteSize: byteSize,
        checksumSha256: checksumSha256,
        partNumber: partNumber
      ),
      idempotencyKey: idempotencyKey,
      response: SignedEvidencePart.self
    )
  }

  func uploadPart(fileURL: URL, signedPart: SignedEvidencePart) async throws -> String {
    var request = URLRequest(url: signedPart.url)
    request.httpMethod = "PUT"
    for (name, value) in signedPart.requiredHeaders {
      request.setValue(value, forHTTPHeaderField: name)
    }
    let (_, response) = try await performUpload(request, fileURL: fileURL)
    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode == 403 { throw EvidenceServiceError.signedURLExpired }
      throw EvidenceServiceError.unavailable
    }
    guard let etag = response.value(forHTTPHeaderField: "ETag"), !etag.isEmpty else {
      throw EvidenceServiceError.invalidResponse
    }
    return etag
  }

  func complete(
    projectId: String,
    sessionId: String,
    sha256: String,
    parts: [CompletedEvidencePart],
    idempotencyKey: String
  ) async throws -> EvidenceAsset {
    try await send(
      path: "/v1/projects/\(projectId)/assets/upload-sessions/\(sessionId)/complete",
      method: "POST",
      body: CompleteRequest(parts: parts, sha256: sha256),
      idempotencyKey: idempotencyKey,
      response: EvidenceAsset.self
    )
  }

  func abort(projectId: String, sessionId: String, idempotencyKey: String) async throws {
    _ = try await send(
      path: "/v1/projects/\(projectId)/assets/upload-sessions/\(sessionId)",
      method: "DELETE",
      idempotencyKey: idempotencyKey,
      response: EvidenceUploadSession.self
    )
  }

  func access(projectId: String, assetId: String, representation: String) async throws -> EvidenceAccess {
    try await send(
      path: "/v1/projects/\(projectId)/assets/\(assetId)/access",
      method: "POST",
      body: AccessRequest(representation: representation),
      idempotencyKey: UUID().uuidString,
      response: EvidenceAccess.self
    )
  }

  private func authenticate() async throws -> String {
    if let accessToken { return accessToken }
    var request = URLRequest(url: endpoint("/v1/auth/local/session"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try encoder.encode(LocalSessionRequest(persona: "homeowner-alpha"))
    let (data, response) = try await perform(request)
    guard (200..<300).contains(response.statusCode),
          let session = try? decoder.decode(LocalSessionResponse.self, from: data),
          session.accessToken.count >= 32 else {
      throw EvidenceServiceError.invalidResponse
    }
    accessToken = session.accessToken
    return session.accessToken
  }

  private func send<Response: Decodable>(
    path: String,
    method: String = "GET",
    idempotencyKey: String? = nil,
    response: Response.Type
  ) async throws -> Response {
    try await send(path: path, method: method, bodyData: nil, idempotencyKey: idempotencyKey, response: response)
  }

  private func send<Body: Encodable, Response: Decodable>(
    path: String,
    method: String,
    body: Body,
    idempotencyKey: String? = nil,
    response: Response.Type
  ) async throws -> Response {
    try await send(
      path: path,
      method: method,
      bodyData: encoder.encode(body),
      idempotencyKey: idempotencyKey,
      response: response
    )
  }

  private func send<Response: Decodable>(
    path: String,
    method: String,
    bodyData: Data?,
    idempotencyKey: String?,
    response: Response.Type
  ) async throws -> Response {
    let token = try await authenticate()
    var request = URLRequest(url: endpoint(path))
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let bodyData {
      request.httpBody = bodyData
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    if let idempotencyKey {
      request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
    }
    let (data, httpResponse) = try await perform(request)
    try validate(httpResponse)
    guard let result = try? decoder.decode(response, from: data) else {
      throw EvidenceServiceError.invalidResponse
    }
    return result
  }

  private func endpoint(_ path: String) -> URL {
    baseURL.appendingPathComponent(String(path.dropFirst()))
  }

  private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    do {
      return try await transport.data(for: request)
    } catch let error as EvidenceServiceError {
      throw error
    } catch let error as URLError where error.code == .notConnectedToInternet {
      throw EvidenceServiceError.offline
    } catch {
      throw EvidenceServiceError.unavailable
    }
  }

  private func performUpload(_ request: URLRequest, fileURL: URL) async throws -> (Data, HTTPURLResponse) {
    do {
      return try await transport.upload(for: request, fromFile: fileURL)
    } catch let error as URLError where error.code == .notConnectedToInternet {
      throw EvidenceServiceError.offline
    } catch is CancellationError {
      throw CancellationError()
    } catch {
      throw EvidenceServiceError.unavailable
    }
  }

  private func validate(_ response: HTTPURLResponse) throws {
    switch response.statusCode {
    case 200..<300: return
    case 401:
      accessToken = nil
      throw EvidenceServiceError.expired
    case 403, 404: throw EvidenceServiceError.forbidden
    case 500..<600: throw EvidenceServiceError.unavailable
    default: throw EvidenceServiceError.invalidResponse
    }
  }
}

enum EvidenceFileSupport {
  static let maximumBytes: Int64 = 2_147_483_648

  static func mimeType(for url: URL) -> String? {
    guard let type = UTType(filenameExtension: url.pathExtension) else { return nil }
    if type.conforms(to: .jpeg) { return "image/jpeg" }
    if type.conforms(to: .png) { return "image/png" }
    if type.conforms(to: .heic) { return "image/heic" }
    if type.identifier == "public.heif" { return "image/heif" }
    if type.conforms(to: .pdf) { return "application/pdf" }
    if type.conforms(to: .svg) { return "image/svg+xml" }
    if type.conforms(to: .mpeg4Movie) { return "video/mp4" }
    if type.conforms(to: .quickTimeMovie) { return "video/quicktime" }
    return nil
  }

  static func validate(fileName: String, size: Int64, mimeType: String, kind: EvidenceKind) throws {
    guard size > 0 else { throw EvidenceServiceError.unsupported("The selected file is empty.") }
    guard size <= maximumBytes else {
      throw EvidenceServiceError.unsupported("The selected file is larger than the 2 GiB upload limit.")
    }
    guard !fileName.contains("/"), !fileName.contains("\\"),
          fileName.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value != 127 }) else {
      throw EvidenceServiceError.unsupported("The file name contains a path or control character.")
    }
    guard kind.allowedMIMETypes.contains(mimeType) else {
      throw EvidenceServiceError.unsupported("This file type is not supported for \(kind.title.lowercased()).")
    }
  }

  static func hash(fileURL: URL, progress: @Sendable (Double) async -> Void) async throws -> String {
    let values = try fileURL.resourceValues(forKeys: [.fileSizeKey])
    let total = max(values.fileSize ?? 0, 1)
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }
    var hasher = SHA256()
    var completed = 0
    while let data = try handle.read(upToCount: 4 * 1_024 * 1_024), !data.isEmpty {
      try Task.checkCancellation()
      hasher.update(data: data)
      completed += data.count
      await progress(min(Double(completed) / Double(total), 1))
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  static func checksumBase64(fileURL: URL) throws -> String {
    let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
    return Data(SHA256.hash(data: data)).base64EncodedString()
  }
}

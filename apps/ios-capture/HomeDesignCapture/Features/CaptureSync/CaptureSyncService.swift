import Foundation

protocol C7CaptureServing: Sendable {
  func cancelSession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) async throws -> C7CaptureSession
  func completeArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    parts: [C7CompletedArtifactPart],
    idempotencyKey: String
  ) async throws -> C7ArtifactUploadSession
  func createArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    request: C7CreateCaptureArtifactUploadRequest,
    idempotencyKey: String
  ) async throws -> C7ArtifactUploadSession
  func createSession(
    projectId: UUID,
    request: C7CreateCaptureSessionRequest,
    idempotencyKey: String
  ) async throws -> C7CaptureSession
  func finalizePackage(
    projectId: UUID,
    captureSessionId: UUID,
    package: C7CreateCapturePackageRequest,
    idempotencyKey: String
  ) async throws -> C7CaptureSession
  func listSessions(projectId: UUID) async throws -> [C7CaptureSession]
  func proposal(projectId: UUID, captureSessionId: UUID) async throws -> C7CaptureProposalResult
  func retrySession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) async throws -> C7CaptureSession
  func session(projectId: UUID, captureSessionId: UUID) async throws -> C7CaptureSession
  func signArtifactPart(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    request: C7SignArtifactPartRequest,
    idempotencyKey: String
  ) async throws -> C7SignedArtifactPart
  func uploadArtifactPart(
    fileURL: URL,
    signedPart: C7SignedArtifactPart,
    expectedChecksum: String
  ) async throws -> String
  func uploadSession(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID
  ) async throws -> C7ArtifactUploadSession
}

protocol C7CaptureHTTPTransport: Sendable {
  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
  func upload(for request: URLRequest, fromFile fileURL: URL) async throws -> (
    Data, HTTPURLResponse
  )
}

struct C7URLSessionCaptureTransport: C7CaptureHTTPTransport, @unchecked Sendable {
  private let foregroundSession: URLSession
  private let backgroundSession: URLSession

  init(
    foregroundSession: URLSession = .shared,
    backgroundIdentifier: String = "com.homedesignstudio.capture.c7-artifact-parts"
  ) {
    self.foregroundSession = foregroundSession
    let configuration = URLSessionConfiguration.background(withIdentifier: backgroundIdentifier)
    configuration.isDiscretionary = false
    configuration.sessionSendsLaunchEvents = true
    configuration.waitsForConnectivity = true
    configuration.httpMaximumConnectionsPerHost = 2
    backgroundSession = URLSession(configuration: configuration)
  }

  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await foregroundSession.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw C7CaptureServiceError.invalidResponse
    }
    return (data, response)
  }

  func upload(for request: URLRequest, fromFile fileURL: URL) async throws -> (
    Data, HTTPURLResponse
  ) {
    let (data, response) = try await backgroundSession.upload(for: request, fromFile: fileURL)
    guard let response = response as? HTTPURLResponse else {
      throw C7CaptureServiceError.invalidResponse
    }
    return (data, response)
  }
}

actor C7CaptureAPIClient: C7CaptureServing {
  private let baseURL: URL
  private let tokenProvider: any C7CaptureTokenProviding
  private let transport: any C7CaptureHTTPTransport
  private let clock: any C7CaptureClock
  private let encoder: JSONEncoder
  private let decoder = JSONDecoder()

  init(
    baseURL: URL,
    tokenProvider: any C7CaptureTokenProviding,
    transport: any C7CaptureHTTPTransport = C7URLSessionCaptureTransport(),
    clock: any C7CaptureClock = C7SystemCaptureClock()
  ) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.transport = transport
    self.clock = clock
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    self.encoder = encoder
  }

  func listSessions(projectId: UUID) async throws -> [C7CaptureSession] {
    try await send(path: sessionsPath(projectId), response: [C7CaptureSession].self)
  }

  func session(projectId: UUID, captureSessionId: UUID) async throws -> C7CaptureSession {
    try await send(path: sessionPath(projectId, captureSessionId), response: C7CaptureSession.self)
  }

  func createSession(
    projectId: UUID,
    request: C7CreateCaptureSessionRequest,
    idempotencyKey: String
  ) async throws -> C7CaptureSession {
    try C7StrictCaptureValidator.validateSessionRequest(request)
    return try await send(
      path: sessionsPath(projectId),
      method: "POST",
      body: request,
      idempotencyKey: idempotencyKey,
      response: C7CaptureSession.self
    )
  }

  func cancelSession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) async throws -> C7CaptureSession {
    try await send(
      path: "\(sessionPath(projectId, captureSessionId))/cancel",
      method: "POST",
      idempotencyKey: idempotencyKey,
      response: C7CaptureSession.self
    )
  }

  func retrySession(
    projectId: UUID,
    captureSessionId: UUID,
    idempotencyKey: String
  ) async throws -> C7CaptureSession {
    try await send(
      path: "\(sessionPath(projectId, captureSessionId))/retry",
      method: "POST",
      idempotencyKey: idempotencyKey,
      response: C7CaptureSession.self
    )
  }

  func createArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    request: C7CreateCaptureArtifactUploadRequest,
    idempotencyKey: String
  ) async throws -> C7ArtifactUploadSession {
    try await send(
      path: "\(sessionPath(projectId, captureSessionId))/artifact-upload-sessions",
      method: "POST",
      body: request,
      idempotencyKey: idempotencyKey,
      response: C7ArtifactUploadSession.self
    )
  }

  func uploadSession(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID
  ) async throws -> C7ArtifactUploadSession {
    try await send(
      path: uploadPath(projectId, captureSessionId, uploadSessionId),
      response: C7ArtifactUploadSession.self
    )
  }

  func signArtifactPart(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    request: C7SignArtifactPartRequest,
    idempotencyKey: String
  ) async throws -> C7SignedArtifactPart {
    try await send(
      path: "\(uploadPath(projectId, captureSessionId, uploadSessionId))/parts",
      method: "POST",
      body: request,
      idempotencyKey: idempotencyKey,
      response: C7SignedArtifactPart.self
    )
  }

  func uploadArtifactPart(
    fileURL: URL,
    signedPart: C7SignedArtifactPart,
    expectedChecksum: String
  ) async throws -> String {
    guard
      signedPart.partNumber > 0,
      let expiresAt = C7ISO8601.date(from: signedPart.expiresAt),
      expiresAt > clock.now(),
      isAllowedUploadURL(signedPart.url),
      signedPart.requiredHeaders.contains(where: { name, value in
        name.lowercased().contains("checksum-sha256") && value == expectedChecksum
      })
    else {
      if C7ISO8601.date(from: signedPart.expiresAt).map({ $0 <= clock.now() }) == true {
        throw C7CaptureServiceError.signedURLExpired
      }
      throw C7CaptureServiceError.checksumBindingMissing
    }
    var request = URLRequest(url: signedPart.url)
    request.httpMethod = "PUT"
    for (name, value) in signedPart.requiredHeaders {
      request.setValue(value, forHTTPHeaderField: name)
    }
    do {
      let (_, response) = try await transport.upload(for: request, fromFile: fileURL)
      switch response.statusCode {
      case 200..<300:
        guard let etag = response.value(forHTTPHeaderField: "ETag"), !etag.isEmpty,
          etag.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value != 127 })
        else {
          throw C7CaptureServiceError.invalidResponse
        }
        return etag
      case 401, 403, 410:
        throw C7CaptureServiceError.signedURLExpired
      case 412:
        throw C7CaptureServiceError.checksumMismatch
      case 500..<600:
        throw C7CaptureServiceError.unavailable
      default:
        throw C7CaptureServiceError.invalidResponse
      }
    } catch let error as C7CaptureServiceError {
      throw error
    } catch is CancellationError {
      throw CancellationError()
    } catch let error as URLError where error.code == .notConnectedToInternet {
      throw C7CaptureServiceError.offline
    } catch {
      throw C7CaptureServiceError.unavailable
    }
  }

  func completeArtifactUpload(
    projectId: UUID,
    captureSessionId: UUID,
    uploadSessionId: UUID,
    parts: [C7CompletedArtifactPart],
    idempotencyKey: String
  ) async throws -> C7ArtifactUploadSession {
    guard
      !parts.isEmpty,
      parts.count <= C7CaptureContract.maximumUploadPartCount,
      parts.enumerated().allSatisfy({ $0.element.partNumber == $0.offset + 1 })
    else {
      throw C7CaptureServiceError.conflict
    }
    return try await send(
      path: "\(uploadPath(projectId, captureSessionId, uploadSessionId))/complete",
      method: "POST",
      body: C7CompleteArtifactUploadRequest(parts: parts),
      idempotencyKey: idempotencyKey,
      response: C7ArtifactUploadSession.self
    )
  }

  func finalizePackage(
    projectId: UUID,
    captureSessionId: UUID,
    package: C7CreateCapturePackageRequest,
    idempotencyKey: String
  ) async throws -> C7CaptureSession {
    try C7StrictCaptureValidator.validatePackage(package)
    return try await send(
      path: "\(sessionPath(projectId, captureSessionId))/packages",
      method: "POST",
      body: C7CreateCapturePackageWireRequest(package),
      idempotencyKey: idempotencyKey,
      response: C7CaptureSession.self
    )
  }

  func proposal(projectId: UUID, captureSessionId: UUID) async throws -> C7CaptureProposalResult {
    try await send(
      path: "\(sessionPath(projectId, captureSessionId))/proposal",
      response: C7CaptureProposalResult.self
    )
  }

  private func send<Response: Decodable>(
    path: String,
    method: String = "GET",
    idempotencyKey: String? = nil,
    response: Response.Type
  ) async throws -> Response {
    try await send(
      path: path,
      method: method,
      bodyData: nil,
      idempotencyKey: idempotencyKey,
      response: response
    )
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
      bodyData: try encoder.encode(body),
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
    for attempt in 0...1 {
      let token: String
      do {
        token = try await tokenProvider.accessToken()
      } catch {
        throw C7CaptureServiceError.authenticationExpired
      }
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
      if httpResponse.statusCode == 401, attempt == 0 {
        await tokenProvider.invalidate()
        continue
      }
      try validate(httpResponse)
      do {
        return try decoder.decode(response, from: data)
      } catch {
        throw C7CaptureServiceError.invalidResponse
      }
    }
    throw C7CaptureServiceError.authenticationExpired
  }

  private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    do {
      return try await transport.data(for: request)
    } catch let error as C7CaptureServiceError {
      throw error
    } catch is CancellationError {
      throw CancellationError()
    } catch let error as URLError where error.code == .notConnectedToInternet {
      throw C7CaptureServiceError.offline
    } catch {
      throw C7CaptureServiceError.unavailable
    }
  }

  private func validate(_ response: HTTPURLResponse) throws {
    switch response.statusCode {
    case 200..<300: return
    case 401: throw C7CaptureServiceError.authenticationExpired
    case 403, 404: throw C7CaptureServiceError.forbidden
    case 409: throw C7CaptureServiceError.conflict
    case 410: throw C7CaptureServiceError.captureExpired
    case 412: throw C7CaptureServiceError.checksumMismatch
    case 422: throw C7CaptureServiceError.invalidResponse
    case 500..<600: throw C7CaptureServiceError.unavailable
    default: throw C7CaptureServiceError.invalidResponse
    }
  }

  private func endpoint(_ path: String) -> URL {
    baseURL.appendingPathComponent(String(path.dropFirst()))
  }

  private func sessionsPath(_ projectId: UUID) -> String {
    "/v1/projects/\(projectId.uuidString.lowercased())/capture-sessions"
  }

  private func sessionPath(_ projectId: UUID, _ captureSessionId: UUID) -> String {
    "\(sessionsPath(projectId))/\(captureSessionId.uuidString.lowercased())"
  }

  private func uploadPath(
    _ projectId: UUID,
    _ captureSessionId: UUID,
    _ uploadSessionId: UUID
  ) -> String {
    "\(sessionPath(projectId, captureSessionId))/artifact-upload-sessions/\(uploadSessionId.uuidString.lowercased())"
  }

  private func isAllowedUploadURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else {
      return false
    }
    if scheme == "https" { return true }
    return scheme == "http" && ["127.0.0.1", "::1", "localhost"].contains(host)
  }
}

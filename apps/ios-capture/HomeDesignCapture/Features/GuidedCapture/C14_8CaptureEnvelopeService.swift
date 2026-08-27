import Foundation

protocol C14_8CaptureEnvelopeServing: Sendable {
  func accept(
    projectId: UUID,
    captureSessionId: UUID,
    envelope: C14_8CaptureEnvelopeRequest,
    idempotencyKey: String
  ) async throws -> C14_8EnvelopeRecord
  func envelope(projectId: UUID, captureSessionId: UUID) async throws -> C14_8EnvelopeRecord
  func startReconstruction(
    projectId: UUID,
    captureSessionId: UUID,
    expectedEnvelopeSha256: String,
    includeAppearance: Bool,
    idempotencyKey: String
  ) async throws -> C14_8EnvelopeReconstruction
}

actor C14_8CaptureEnvelopeAPIClient: C14_8CaptureEnvelopeServing {
  private struct StartRequest: Codable, Sendable {
    let appearanceMode: String
    let expectedEnvelopeSha256: String
  }

  private let baseURL: URL
  private let decoder = JSONDecoder()
  private let encoder: JSONEncoder
  private let tokenProvider: any C7CaptureTokenProviding
  private let transport: any C7CaptureHTTPTransport

  init(
    baseURL: URL,
    tokenProvider: any C7CaptureTokenProviding,
    transport: any C7CaptureHTTPTransport = C7URLSessionCaptureTransport()
  ) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.transport = transport
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    self.encoder = encoder
  }

  func accept(
    projectId: UUID,
    captureSessionId: UUID,
    envelope: C14_8CaptureEnvelopeRequest,
    idempotencyKey: String
  ) async throws -> C14_8EnvelopeRecord {
    try await send(
      path: envelopePath(projectId, captureSessionId),
      method: "POST",
      body: envelope,
      idempotencyKey: idempotencyKey,
      response: C14_8EnvelopeRecord.self
    )
  }

  func envelope(projectId: UUID, captureSessionId: UUID) async throws -> C14_8EnvelopeRecord {
    try await send(
      path: envelopePath(projectId, captureSessionId),
      method: "GET",
      response: C14_8EnvelopeRecord.self
    )
  }

  func startReconstruction(
    projectId: UUID,
    captureSessionId: UUID,
    expectedEnvelopeSha256: String,
    includeAppearance: Bool,
    idempotencyKey: String
  ) async throws -> C14_8EnvelopeReconstruction {
    try await send(
      path: "\(envelopePath(projectId, captureSessionId))/reconstruction",
      method: "POST",
      body: StartRequest(
        appearanceMode: includeAppearance ? "optional" : "disabled",
        expectedEnvelopeSha256: expectedEnvelopeSha256
      ),
      idempotencyKey: idempotencyKey,
      response: C14_8EnvelopeReconstruction.self
    )
  }

  private func send<Response: Decodable>(
    path: String,
    method: String,
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
    idempotencyKey: String,
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
    for attempt in 0...1 {
      let token: String
      do {
        token = try await tokenProvider.accessToken()
      } catch {
        throw C7CaptureServiceError.authenticationExpired
      }
      var request = URLRequest(url: baseURL.appendingPathComponent(String(path.dropFirst())))
      request.httpMethod = method
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      if let bodyData {
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      }
      if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
      let result: (Data, HTTPURLResponse)
      do {
        result = try await transport.data(for: request)
      } catch let error as URLError where error.code == .notConnectedToInternet {
        throw C7CaptureServiceError.offline
      } catch is CancellationError {
        throw CancellationError()
      } catch {
        throw C7CaptureServiceError.unavailable
      }
      if result.1.statusCode == 401, attempt == 0 {
        await tokenProvider.invalidate()
        continue
      }
      try Self.validate(result.1)
      guard let decoded = try? decoder.decode(response, from: result.0) else {
        throw C7CaptureServiceError.invalidResponse
      }
      return decoded
    }
    throw C7CaptureServiceError.authenticationExpired
  }

  private func envelopePath(_ projectId: UUID, _ captureSessionId: UUID) -> String {
    "/v1/projects/\(projectId.uuidString.lowercased())/capture-sessions/\(captureSessionId.uuidString.lowercased())/envelope"
  }

  private static func validate(_ response: HTTPURLResponse) throws {
    switch response.statusCode {
    case 200..<300: return
    case 401: throw C7CaptureServiceError.authenticationExpired
    case 403, 404: throw C7CaptureServiceError.forbidden
    case 409: throw C7CaptureServiceError.conflict
    case 410: throw C7CaptureServiceError.captureExpired
    case 422: throw C7CaptureServiceError.invalidResponse
    case 500..<600: throw C7CaptureServiceError.unavailable
    default: throw C7CaptureServiceError.invalidResponse
    }
  }
}

protocol C14_8DepthUploading: Sendable {
  func upload(
    projectId: UUID,
    captureSessionId: UUID,
    handle: C14_8DepthHandle,
    fileURL: URL
  ) async throws -> C14_8DepthUploadReceipt
}

actor C14_8DepthUploader: C14_8DepthUploading {
  private let service: any C7CaptureServing

  init(service: any C7CaptureServing) {
    self.service = service
  }

  func upload(
    projectId: UUID,
    captureSessionId: UUID,
    handle: C14_8DepthHandle,
    fileURL: URL
  ) async throws -> C14_8DepthUploadReceipt {
    let actualSha256 = try C7CaptureFileHasher.sha256Hex(fileURL: fileURL)
    guard handle.byteSize > 0,
      handle.byteSize <= Int64(C7CaptureContract.uploadPartSizeBytes),
      actualSha256 == handle.sha256
    else { throw C14_8ContractError.invalidEvidence }
    let createKey = "c14-8-depth-create-\(handle.localIdentifier.uuidString.lowercased())"
    let upload = try await service.createArtifactUpload(
      projectId: projectId,
      captureSessionId: captureSessionId,
      request: C7CreateCaptureArtifactUploadRequest(
        byteSize: handle.byteSize,
        contentType: .binary,
        kind: .depthSequence,
        roomId: nil,
        sha256: handle.sha256
      ),
      idempotencyKey: createKey
    )
    let current = try await service.uploadSession(
      projectId: projectId,
      captureSessionId: captureSessionId,
      uploadSessionId: upload.uploadSessionId
    )
    if current.state != .completed {
      let checksum = try C7CaptureFileHasher.checksumBase64(fileURL: fileURL)
      var etag: String?
      for generation in 0...2 where etag == nil {
        let signed = try await service.signArtifactPart(
          projectId: projectId,
          captureSessionId: captureSessionId,
          uploadSessionId: upload.uploadSessionId,
          request: C7SignArtifactPartRequest(
            byteSize: Int(handle.byteSize),
            checksumSha256: checksum,
            partNumber: 1
          ),
          idempotencyKey:
            "c14-8-depth-sign-\(upload.uploadSessionId.uuidString.lowercased())-1-\(generation)"
        )
        do {
          etag = try await service.uploadArtifactPart(
            fileURL: fileURL,
            signedPart: signed,
            expectedChecksum: checksum
          )
        } catch C7CaptureServiceError.signedURLExpired where generation < 2 {
          continue
        }
      }
      guard let etag else { throw C7CaptureServiceError.signedURLExpired }
      let completed = try await service.completeArtifactUpload(
        projectId: projectId,
        captureSessionId: captureSessionId,
        uploadSessionId: upload.uploadSessionId,
        parts: [
          C7CompletedArtifactPart(checksumSha256: checksum, etag: etag, partNumber: 1)
        ],
        idempotencyKey: "c14-8-depth-complete-\(upload.uploadSessionId.uuidString.lowercased())"
      )
      guard completed.state == .completed else { throw C7CaptureServiceError.invalidResponse }
    }
    return C14_8DepthUploadReceipt(
      artifactId: upload.artifactId,
      byteSize: handle.byteSize,
      heightPixels: handle.heightPixels,
      partCount: 1,
      reconciledAt: C7ISO8601.string(from: Date()),
      sampleId: handle.sampleId,
      sha256: handle.sha256,
      widthPixels: handle.widthPixels
    )
  }
}

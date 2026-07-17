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
  private let tokenProvider: any C7CaptureTokenProviding
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(
    baseURL: URL,
    tokenProvider: any C7CaptureTokenProviding,
    transport: any EvidenceHTTPTransport = URLSessionEvidenceTransport()
  ) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
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
    for attempt in 0...1 {
      let token: String
      do {
        token = try await tokenProvider.accessToken()
      } catch {
        throw EvidenceServiceError.expired
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
      guard let result = try? decoder.decode(response, from: data) else {
        throw EvidenceServiceError.invalidResponse
      }
      return result
    }
    throw EvidenceServiceError.expired
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
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let data = try handle.read(upToCount: 4 * 1_024 * 1_024), !data.isEmpty {
      if Task.isCancelled { throw CancellationError() }
      hasher.update(data: data)
    }
    return Data(hasher.finalize()).base64EncodedString()
  }
}

/// C8 capture composes with the C2 immutable source boundary. Recovery contains
/// only opaque identifiers, checksums and completed-part receipts; bearer tokens
/// and signed URLs are never persisted.
actor C8ImmutableEvidenceUploader: C8ImmutableEvidenceUploading {
  private let recoveryStore: any EvidenceRecoveryStoring
  private let service: any EvidenceServing

  init(
    service: any EvidenceServing,
    recoveryStore: (any EvidenceRecoveryStoring)? = nil
  ) {
    self.service = service
    if let recoveryStore {
      self.recoveryStore = recoveryStore
    } else {
      let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("C8EvidenceRecovery", isDirectory: true)
      try? FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.complete]
      )
      var protectedRoot = root
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? protectedRoot.setResourceValues(values)
      self.recoveryStore = EvidenceRecoveryStore(root: root)
    }
  }

  func upload(
    _ request: C8ImmutableEvidenceUpload,
    progress: @escaping @Sendable (Double) async -> Void
  ) async throws -> C8ImmutableEvidenceReceipt {
    try C8ReconstructionContractValidator.validate(upload: request)
    let sourceValues = try request.fileURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard sourceValues.isRegularFile == true,
      Int64(sourceValues.fileSize ?? 0) == request.handle.byteSize,
      try await EvidenceFileSupport.hash(fileURL: request.fileURL, progress: { _ in })
        == request.handle.sha256
    else { throw EvidenceServiceError.invalidResponse }
    let selection = EvidenceSelection(
      fileName:
        "capture-\(request.handle.localIdentifier.uuidString.lowercased()).\(extensionFor(request.handle.mimeType))",
      fileURL: request.fileURL,
      kind: request.handle.mimeType.evidenceKind,
      mimeType: request.handle.mimeType.rawValue,
      size: request.handle.byteSize
    )
    try EvidenceFileSupport.validate(
      fileName: selection.fileName,
      size: selection.size,
      mimeType: selection.mimeType,
      kind: selection.kind
    )
    let rights = EvidenceRightsAssertion(
      attribution: request.handle.origin == .syntheticSimulatorFixture
        ? "Visibly synthetic, rights-cleared simulator fixture"
        : nil,
      basis: request.rights.basis,
      licenceUrl: nil,
      serviceProcessingConsent: request.rights.serviceProcessingConsent,
      trainingUseConsent: .denied
    )
    let projectId = request.projectId.uuidString.lowercased()
    var recovery: EvidenceRecoveryRecord
    let savedRecovery = try await recoveryStore.load(projectId: projectId)
    if let saved = savedRecovery,
      saved.sha256 == request.handle.sha256,
      saved.fileURL == request.fileURL
    {
      let session = try await service.session(projectId: projectId, sessionId: saved.sessionId)
      if session.state == .completed {
        try await recoveryStore.clear(projectId: projectId)
        return try receipt(from: session.asset, request: request)
      }
      guard session.state == .initiated || session.state == .uploading else {
        try await recoveryStore.clear(projectId: projectId)
        throw EvidenceServiceError.unavailable
      }
      recovery = EvidenceResumeReconciler.reconcile(
        saved,
        recordedPartNumbers: session.recordedPartNumbers
      )
    } else {
      if let saved = savedRecovery {
        try await service.abort(
          projectId: projectId,
          sessionId: saved.sessionId,
          idempotencyKey: "c8-replace-\(saved.sessionId)"
        )
        try await recoveryStore.clear(projectId: projectId)
      }
      let createKey =
        "c8-create-\(request.handle.localIdentifier.uuidString.lowercased())-\(request.handle.sha256.prefix(16))"
      let session = try await service.createSession(
        projectId: projectId,
        selection: selection,
        sha256: request.handle.sha256,
        rights: rights,
        idempotencyKey: createKey
      )
      recovery = EvidenceRecoveryRecord(
        assetId: session.asset.id,
        completedParts: [],
        completionKey: "c8-complete-\(session.sessionId)",
        fileName: selection.fileName,
        fileURL: request.fileURL,
        kind: selection.kind,
        partSize: session.partSize,
        projectId: projectId,
        sessionId: session.sessionId,
        sha256: request.handle.sha256,
        updatedAt: Date()
      )
    }
    guard recovery.partSize > 0,
      recovery.partSize <= 64 * 1_024 * 1_024
    else {
      throw EvidenceServiceError.invalidResponse
    }
    try await recoveryStore.save(recovery)
    let totalParts = Int(ceil(Double(request.handle.byteSize) / Double(recovery.partSize)))
    guard totalParts > 0, totalParts <= 10_000 else {
      throw EvidenceServiceError.unsupported("Captured media exceeds the immutable upload part budget.")
    }
    var completed = Set(recovery.completedParts.map(\.partNumber))
    await progress(Double(completed.count) / Double(totalParts))
    for partNumber in 1...totalParts where !completed.contains(partNumber) {
      try Task.checkCancellation()
      let offset = UInt64((partNumber - 1) * recovery.partSize)
      let length = min(
        recovery.partSize,
        Int(request.handle.byteSize) - Int(offset)
      )
      let partURL = try await recoveryStore.partFile(
        sourceURL: request.fileURL,
        offset: offset,
        length: length,
        partNumber: partNumber
      )
      defer { try? FileManager.default.removeItem(at: partURL) }
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.complete],
        ofItemAtPath: partURL.path
      )
      let checksum = try EvidenceFileSupport.checksumBase64(fileURL: partURL)
      let signed = try await service.signPart(
        projectId: projectId,
        sessionId: recovery.sessionId,
        partNumber: partNumber,
        byteSize: length,
        checksumSha256: checksum,
        idempotencyKey:
          "c8-part-\(recovery.sessionId)-\(partNumber)-\(request.handle.sha256.prefix(12))"
      )
      guard signed.requiredHeaders.contains(where: {
        $0.key.lowercased().contains("checksum-sha256") && $0.value == checksum
      }) else { throw EvidenceServiceError.checksumBindingMissing }
      let etag = try await service.uploadPart(fileURL: partURL, signedPart: signed)
      recovery.completedParts.append(
        CompletedEvidencePart(checksumSha256: checksum, etag: etag, partNumber: partNumber)
      )
      recovery.completedParts.sort { $0.partNumber < $1.partNumber }
      recovery.updatedAt = Date()
      completed.insert(partNumber)
      try await recoveryStore.save(recovery)
      await progress(Double(completed.count) / Double(totalParts))
    }
    let asset = try await service.complete(
      projectId: projectId,
      sessionId: recovery.sessionId,
      sha256: request.handle.sha256,
      parts: recovery.completedParts,
      idempotencyKey: recovery.completionKey
    )
    try await recoveryStore.clear(projectId: projectId)
    return try receipt(from: asset, request: request)
  }

  private func receipt(
    from asset: EvidenceAsset,
    request: C8ImmutableEvidenceUpload
  ) throws -> C8ImmutableEvidenceReceipt {
    guard let assetId = UUID(uuidString: asset.id),
      asset.projectId.lowercased() == request.projectId.uuidString.lowercased(),
      asset.declaredMimeType == request.handle.mimeType.rawValue,
      asset.kind == request.handle.mimeType.evidenceKind,
      asset.source.sha256 == request.handle.sha256,
      asset.source.byteSize == request.handle.byteSize,
      asset.rights.basis == request.rights.basis,
      asset.rights.serviceProcessingConsent == request.rights.serviceProcessingConsent,
      asset.rights.trainingUseConsent == .denied,
      [.uploaded, .processing, .ready, .quarantined, .rejected].contains(asset.status)
    else { throw EvidenceServiceError.invalidResponse }
    return C8ImmutableEvidenceReceipt(
      assetId: assetId,
      byteSize: asset.source.byteSize,
      declaredMimeType: request.handle.mimeType,
      projectId: request.projectId,
      sha256: asset.source.sha256,
      status: asset.status,
      trainingUseConsent: .denied
    )
  }

  private func extensionFor(_ mimeType: C8MediaMIMEType) -> String {
    switch mimeType {
    case .heic: "heic"
    case .jpeg: "jpg"
    case .mp4: "mp4"
    case .png: "png"
    case .quickTime: "mov"
    }
  }
}

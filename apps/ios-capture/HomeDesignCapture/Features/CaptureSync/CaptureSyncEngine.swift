import Foundation

actor C7CaptureSyncEngine {
  private let service: any C7CaptureServing
  private let journal: any C7CaptureJournalStoring
  private let diagnostics: any C7CaptureDiagnosticsRecording
  private let clock: any C7CaptureClock

  init(
    service: any C7CaptureServing,
    journal: any C7CaptureJournalStoring,
    diagnostics: any C7CaptureDiagnosticsRecording = C7NoopCaptureDiagnostics(),
    clock: any C7CaptureClock = C7SystemCaptureClock()
  ) {
    self.service = service
    self.journal = journal
    self.diagnostics = diagnostics
    self.clock = clock
  }

  func synchronize(
    _ initialRecord: C7CaptureJournalRecord,
    onProgress: @escaping @Sendable (Double) async -> Void
  ) async throws -> C7CaptureSyncSnapshot {
    var record = initialRecord
    try await validateUploadAuthority(&record)
    guard var package = record.package else { throw C7CaptureServiceError.conflict }
    var serverSession = try await service.session(
      projectId: record.projectId,
      captureSessionId: record.id
    )
    try bind(serverSession, to: record)
    record = try await apply(serverSession, to: record)
    if let terminal = try await terminalSnapshot(record: record, session: serverSession) {
      return terminal
    }

    record.phase = .uploading
    record = try await journal.save(record)
    package = record.package ?? package
    let totalPartCount = try package.artifacts.reduce(0) { partial, artifact in
      partial + (try partCount(for: artifact.manifest.byteSize))
    }
    var completedPartCount = 0
    await onProgress(0)

    for index in package.artifacts.indices {
      try Task.checkCancellation()
      package = record.package ?? package
      var artifact = package.artifacts[index]
      try await journal.verifyArtifact(record: record, artifact: artifact)
      if artifact.completed {
        completedPartCount += try partCount(for: artifact.manifest.byteSize)
        await onProgress(Double(completedPartCount) / Double(max(totalPartCount, 1)))
        continue
      }

      var uploadSession = try await resolvedUploadSession(
        record: &record,
        artifactIndex: index
      )
      package = record.package ?? package
      artifact = package.artifacts[index]
      artifact.completedParts = try C7CapturePartReconciler.reconcile(
        localParts: artifact.completedParts,
        serverPartNumbers: uploadSession.recordedPartNumbers
      )
      record = try await replaceArtifact(artifact, at: index, in: record)
      package = record.package ?? package
      artifact = package.artifacts[index]
      completedPartCount += artifact.completedParts.count
      await onProgress(Double(completedPartCount) / Double(max(totalPartCount, 1)))

      let count = try partCount(for: artifact.manifest.byteSize)
      let completedNumbers = Set(artifact.completedParts.map(\.partNumber))
      for partNumber in 1...count {
        try Task.checkCancellation()
        let length = partLength(
          byteSize: artifact.manifest.byteSize,
          partNumber: partNumber
        )
        let offset = UInt64((partNumber - 1) * C7CaptureContract.uploadPartSizeBytes)
        let partURL = try await journal.makePartFile(
          record: record,
          artifact: artifact,
          offset: offset,
          length: length,
          partNumber: partNumber
        )
        defer { try? FileManager.default.removeItem(at: partURL) }
        let checksum = try C7CaptureFileHasher.checksumBase64(fileURL: partURL)
        if completedNumbers.contains(partNumber) {
          guard
            artifact.completedParts.first(where: { $0.partNumber == partNumber })?.checksumSha256
              == checksum
          else {
            await diagnostics.record(.checksumRejected)
            throw C7CaptureServiceError.checksumMismatch
          }
          continue
        }

        let etag = try await uploadPart(
          partURL: partURL,
          checksum: checksum,
          byteSize: length,
          partNumber: partNumber,
          uploadSessionId: uploadSession.uploadSessionId,
          record: &record,
          artifactIndex: index
        )
        package = record.package ?? package
        artifact = package.artifacts[index]
        artifact.completedParts.removeAll { $0.partNumber == partNumber }
        artifact.completedParts.append(
          C7CompletedArtifactPart(
            checksumSha256: checksum,
            etag: etag,
            partNumber: partNumber
          )
        )
        artifact.completedParts.sort { $0.partNumber < $1.partNumber }
        record = try await replaceArtifact(artifact, at: index, in: record)
        completedPartCount += 1
        await diagnostics.record(.partRecorded)
        await onProgress(Double(completedPartCount) / Double(max(totalPartCount, 1)))
      }

      package = record.package ?? package
      artifact = package.artifacts[index]
      guard
        artifact.completedParts.enumerated().allSatisfy({
          $0.element.partNumber == $0.offset + 1
        })
      else {
        throw C7CaptureServiceError.conflict
      }
      uploadSession = try await service.completeArtifactUpload(
        projectId: record.projectId,
        captureSessionId: record.id,
        uploadSessionId: uploadSession.uploadSessionId,
        parts: artifact.completedParts,
        idempotencyKey: artifact.completeUploadKey
      )
      try validate(uploadSession, artifact: artifact, record: record)
      guard uploadSession.state == .completed else {
        throw C7CaptureServiceError.conflict
      }
      artifact.completed = true
      record = try await replaceArtifact(artifact, at: index, in: record)

      serverSession = try await service.session(
        projectId: record.projectId,
        captureSessionId: record.id
      )
      try bind(serverSession, to: record)
      if serverSession.state == .cancelRequested || serverSession.state == .cancelled {
        record = try await apply(serverSession, to: record)
        throw C7CaptureServiceError.cancelled
      }
    }

    try Task.checkCancellation()
    try await validateUploadAuthority(&record)
    serverSession = try await service.session(
      projectId: record.projectId,
      captureSessionId: record.id
    )
    try bind(serverSession, to: record)
    guard serverSession.state != .cancelRequested, serverSession.state != .cancelled else {
      record = try await apply(serverSession, to: record)
      throw C7CaptureServiceError.cancelled
    }
    guard let finalPackage = record.package,
      finalPackage.artifacts.allSatisfy(\.completed)
    else {
      throw C7CaptureServiceError.conflict
    }
    serverSession = try await service.finalizePackage(
      projectId: record.projectId,
      captureSessionId: record.id,
      package: finalPackage.manifest,
      idempotencyKey: finalPackage.finalizeKey
    )
    try bind(serverSession, to: record)
    record = try await apply(serverSession, to: record)
    return try await terminalSnapshot(record: record, session: serverSession)
      ?? C7CaptureSyncSnapshot(proposal: nil, record: record)
  }

  func refresh(_ initialRecord: C7CaptureJournalRecord) async throws -> C7CaptureSyncSnapshot {
    var record = initialRecord
    let session = try await service.session(
      projectId: record.projectId, captureSessionId: record.id)
    try bind(session, to: record)
    record = try await apply(session, to: record)
    return try await terminalSnapshot(record: record, session: session)
      ?? C7CaptureSyncSnapshot(proposal: nil, record: record)
  }

  func cancel(_ initialRecord: C7CaptureJournalRecord) async throws -> C7CaptureJournalRecord {
    var record = try await currentRecord(matching: initialRecord)
    if record.phase == .cancelled { return record }
    record.phase = .cancelPending
    record = try await journal.save(record)
    await diagnostics.record(.cancellationRequested)
    let session = try await service.cancelSession(
      projectId: record.projectId,
      captureSessionId: record.id,
      idempotencyKey: record.cancelKey
    )
    try bind(session, to: record)
    return try await apply(session, to: record)
  }

  func withdrawRights(
    _ initialRecord: C7CaptureJournalRecord
  ) async throws -> C7CaptureJournalRecord {
    var record = try await currentRecord(matching: initialRecord)
    guard record.rightsState != .withdrawn else { return record }
    record.rightsState = .withdrawalPending
    record.phase = .rightsWithdrawn
    record = try await journal.save(record)
    await diagnostics.record(.rightsWithdrawn)
    do {
      let session = try await service.cancelSession(
        projectId: record.projectId,
        captureSessionId: record.id,
        idempotencyKey: record.cancelKey
      )
      try bind(session, to: record)
      record.serverVersion = session.version
      record.rightsState = .withdrawn
      record.phase = .rightsWithdrawn
      return try await journal.save(record)
    } catch {
      // The pending state is already durable and blocks every upload/publication path.
      throw error
    }
  }

  func retry(_ initialRecord: C7CaptureJournalRecord) async throws -> C7CaptureJournalRecord {
    var record = try await currentRecord(matching: initialRecord)
    guard record.rightsState == .granted, record.retryCount < 100 else {
      throw C7CaptureServiceError.rightsWithdrawn
    }
    record.retryCount += 1
    record = try await journal.save(record)
    let key = "retry-\(record.id.uuidString.lowercased())-\(record.retryCount)"
    let session = try await service.retrySession(
      projectId: record.projectId,
      captureSessionId: record.id,
      idempotencyKey: key
    )
    try bind(session, to: record)
    return try await apply(session, to: record)
  }

  private func resolvedUploadSession(
    record: inout C7CaptureJournalRecord,
    artifactIndex: Int
  ) async throws -> C7ArtifactUploadSession {
    for _ in 0...1 {
      guard let package = record.package else { throw C7CaptureServiceError.conflict }
      var artifact = package.artifacts[artifactIndex]
      let session: C7ArtifactUploadSession
      if let uploadSessionId = artifact.uploadSessionId {
        session = try await service.uploadSession(
          projectId: record.projectId,
          captureSessionId: record.id,
          uploadSessionId: uploadSessionId
        )
      } else {
        session = try await service.createArtifactUpload(
          projectId: record.projectId,
          captureSessionId: record.id,
          request: C7CreateCaptureArtifactUploadRequest(
            byteSize: artifact.manifest.byteSize,
            contentType: artifact.manifest.contentType,
            kind: artifact.manifest.kind,
            roomId: artifact.manifest.roomId,
            sha256: artifact.manifest.sha256
          ),
          idempotencyKey: artifact.createUploadKey
        )
      }
      try validate(session, artifact: artifact, record: record)
      let expiredByTime = C7ISO8601.date(from: session.expiresAt).map({ $0 <= clock.now() }) ?? true
      if session.state == .expired || expiredByTime {
        guard artifact.uploadAttempt < 100 else { throw C7CaptureServiceError.captureExpired }
        artifact.uploadAttempt += 1
        artifact.createUploadKey =
          "artifact-\(artifact.id.uuidString.lowercased())-\(artifact.uploadAttempt)"
        artifact.uploadSessionId = nil
        artifact.uploadExpiresAt = nil
        artifact.completedParts = []
        artifact.completed = false
        record = try await replaceArtifact(artifact, at: artifactIndex, in: record)
        continue
      }
      guard session.state != .aborted else { throw C7CaptureServiceError.conflict }
      artifact.uploadSessionId = session.uploadSessionId
      artifact.uploadExpiresAt = session.expiresAt
      if session.state == .completed {
        let reconciled = try C7CapturePartReconciler.reconcile(
          localParts: artifact.completedParts,
          serverPartNumbers: session.recordedPartNumbers
        )
        guard reconciled.count == (try partCount(for: artifact.manifest.byteSize)) else {
          throw C7CaptureServiceError.conflict
        }
        artifact.completedParts = reconciled
        artifact.completed = true
      }
      record = try await replaceArtifact(artifact, at: artifactIndex, in: record)
      await diagnostics.record(.backgroundReconciled)
      return session
    }
    throw C7CaptureServiceError.captureExpired
  }

  private func uploadPart(
    partURL: URL,
    checksum: String,
    byteSize: Int,
    partNumber: Int,
    uploadSessionId: UUID,
    record: inout C7CaptureJournalRecord,
    artifactIndex: Int
  ) async throws -> String {
    for _ in 0...1 {
      guard let package = record.package else { throw C7CaptureServiceError.conflict }
      var artifact = package.artifacts[artifactIndex]
      let generation = artifact.signingGenerations[partNumber, default: 0]
      let checksumKey = checksum.unicodeScalars
        .filter { CharacterSet.alphanumerics.contains($0) }
        .prefix(12)
        .map(String.init)
        .joined()
      let key =
        "part-\(artifact.id.uuidString.lowercased())-\(partNumber)-\(generation)-\(checksumKey)"
      let signed = try await service.signArtifactPart(
        projectId: record.projectId,
        captureSessionId: record.id,
        uploadSessionId: uploadSessionId,
        request: C7SignArtifactPartRequest(
          byteSize: byteSize,
          checksumSha256: checksum,
          partNumber: partNumber
        ),
        idempotencyKey: key
      )
      guard signed.partNumber == partNumber else {
        throw C7CaptureServiceError.invalidResponse
      }
      do {
        return try await service.uploadArtifactPart(
          fileURL: partURL,
          signedPart: signed,
          expectedChecksum: checksum
        )
      } catch C7CaptureServiceError.signedURLExpired {
        guard generation < 100 else { throw C7CaptureServiceError.signedURLExpired }
        artifact.signingGenerations[partNumber] = generation + 1
        record = try await replaceArtifact(artifact, at: artifactIndex, in: record)
      }
    }
    throw C7CaptureServiceError.signedURLExpired
  }

  private func validateUploadAuthority(_ record: inout C7CaptureJournalRecord) async throws {
    guard record.rightsState == .granted, record.brief.rights.serviceProcessingConsent else {
      throw C7CaptureServiceError.rightsWithdrawn
    }
    guard let expiresAt = C7ISO8601.date(from: record.brief.expiresAt) else {
      throw C7CaptureServiceError.invalidResponse
    }
    guard expiresAt > clock.now() else {
      record.phase = .expired
      record = try await journal.save(record)
      throw C7CaptureServiceError.captureExpired
    }
  }

  private func bind(_ session: C7CaptureSession, to record: C7CaptureJournalRecord) throws {
    guard
      session.id == record.id,
      session.projectId == record.projectId,
      session.brief == record.brief,
      session.schemaVersion == C7CaptureContract.captureSessionSchemaVersion,
      session.version >= record.serverVersion
    else {
      throw C7CaptureServiceError.conflict
    }
    if record.phase == .proposed, session.state != .proposed {
      throw C7CaptureServiceError.conflict
    }
    if record.phase == .abstained, session.state != .abstained {
      throw C7CaptureServiceError.conflict
    }
  }

  private func validate(
    _ session: C7ArtifactUploadSession,
    artifact: C7JournalArtifact,
    record: C7CaptureJournalRecord
  ) throws {
    guard
      session.artifactId == artifact.id,
      session.captureSessionId == record.id,
      session.maximumPartCount == C7CaptureContract.maximumUploadPartCount,
      session.minimumNonFinalPartSize == 5_242_880,
      session.partSize == C7CaptureContract.uploadPartSizeBytes,
      session.recordedPartNumbers == session.recordedPartNumbers.sorted(),
      Set(session.recordedPartNumbers).count == session.recordedPartNumbers.count,
      C7ISO8601.date(from: session.expiresAt) != nil
    else {
      throw C7CaptureServiceError.invalidResponse
    }
  }

  private func apply(
    _ session: C7CaptureSession,
    to initialRecord: C7CaptureJournalRecord
  ) async throws -> C7CaptureJournalRecord {
    var record = initialRecord
    record.serverVersion = session.version
    switch session.state {
    case .created, .uploading:
      if record.package != nil { record.phase = .paused }
    case .uploaded, .processing:
      record.phase = .processing
    case .proposed:
      record.phase = .proposed
    case .abstained:
      record.phase = .abstained
    case .cancelRequested:
      record.phase = .cancelPending
    case .cancelled:
      record.phase = .cancelled
    case .failed:
      record.phase = .failed
    }
    return try await journal.save(record)
  }

  private func terminalSnapshot(
    record: C7CaptureJournalRecord,
    session: C7CaptureSession
  ) async throws -> C7CaptureSyncSnapshot? {
    switch session.state {
    case .proposed:
      let result = try await service.proposal(
        projectId: record.projectId, captureSessionId: record.id)
      guard case .proposal(let proposal) = result,
        proposal.captureSessionId == record.id,
        proposal.projectId == record.projectId,
        proposal.schemaVersion == C7CaptureContract.captureProposalSchemaVersion,
        (60...100).contains(proposal.overallConfidence)
      else {
        throw C7CaptureServiceError.invalidResponse
      }
      return C7CaptureSyncSnapshot(proposal: result, record: record)
    case .abstained:
      let result = try await service.proposal(
        projectId: record.projectId, captureSessionId: record.id)
      guard case .abstained(let abstention) = result,
        abstention.captureSessionId == record.id,
        abstention.projectId == record.projectId,
        abstention.schemaVersion == C7CaptureContract.captureProposalSchemaVersion,
        !abstention.nextActions.isEmpty
      else {
        throw C7CaptureServiceError.invalidResponse
      }
      return C7CaptureSyncSnapshot(proposal: result, record: record)
    case .cancelled:
      return C7CaptureSyncSnapshot(proposal: nil, record: record)
    case .created, .uploading, .uploaded, .processing, .cancelRequested, .failed:
      return nil
    }
  }

  private func replaceArtifact(
    _ artifact: C7JournalArtifact,
    at index: Int,
    in initialRecord: C7CaptureJournalRecord
  ) async throws -> C7CaptureJournalRecord {
    guard var package = initialRecord.package, package.artifacts.indices.contains(index),
      package.artifacts[index].id == artifact.id
    else {
      throw C7CaptureServiceError.conflict
    }
    package.artifacts[index] = artifact
    var record = initialRecord
    record.package = package
    return try await journal.save(record)
  }

  private func currentRecord(
    matching initialRecord: C7CaptureJournalRecord
  ) async throws -> C7CaptureJournalRecord {
    guard let current = try await journal.loadLatest(projectId: initialRecord.projectId),
      current.id == initialRecord.id
    else {
      throw C7CaptureServiceError.conflict
    }
    return current
  }

  private func partCount(for byteSize: Int64) throws -> Int {
    guard byteSize > 0 else { throw C7CaptureServiceError.invalidResponse }
    let count = Int(
      (byteSize + Int64(C7CaptureContract.uploadPartSizeBytes) - 1)
        / Int64(C7CaptureContract.uploadPartSizeBytes))
    guard (1...C7CaptureContract.maximumUploadPartCount).contains(count) else {
      throw C7CaptureServiceError.invalidResponse
    }
    return count
  }

  private func partLength(byteSize: Int64, partNumber: Int) -> Int {
    let offset = Int64(partNumber - 1) * Int64(C7CaptureContract.uploadPartSizeBytes)
    return Int(min(Int64(C7CaptureContract.uploadPartSizeBytes), byteSize - offset))
  }
}

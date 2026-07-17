import CryptoKit
import Foundation

enum C7CaptureJournalError: Error, Equatable, Sendable {
  case conflict
  case corrupt
  case invalidArtifact
  case missingArtifact
  case missingRecord
  case protectionFailed
}

extension C7CaptureJournalError: LocalizedError {
  var errorDescription: String? {
    switch self {
    case .conflict: "The protected journal changed. Reload before retrying."
    case .corrupt: "The protected capture journal is invalid."
    case .invalidArtifact: "A local capture artifact failed validation."
    case .missingArtifact: "A protected capture artifact is missing."
    case .missingRecord: "No protected capture journal was found."
    case .protectionFailed: "iOS data protection could not be applied to capture state."
    }
  }
}

protocol C7CaptureJournalStoring: Sendable {
  func clearIntent(projectId: UUID) async throws
  func create(brief: C7CaptureBrief, serverVersion: Int) async throws -> C7CaptureJournalRecord
  func finalizeReview(
    record: C7CaptureJournalRecord,
    rooms: [C7CaptureRoomManifest],
    referenceMeasurements: [C7ReferenceMeasurement]
  ) async throws -> C7CaptureJournalRecord
  func loadIntent(projectId: UUID) async throws -> C7CaptureSessionIntent?
  func loadLatest(projectId: UUID) async throws -> C7CaptureJournalRecord?
  func loadNormalizedDraft(record: C7CaptureJournalRecord) async throws -> C7NormalizedRoomPlan
  func makePartFile(
    record: C7CaptureJournalRecord,
    artifact: C7JournalArtifact,
    offset: UInt64,
    length: Int,
    partNumber: Int
  ) async throws -> URL
  func save(_ record: C7CaptureJournalRecord) async throws -> C7CaptureJournalRecord
  func saveIntent(_ intent: C7CaptureSessionIntent) async throws
  func stageReview(
    _ draft: C7CaptureReviewDraft,
    record: C7CaptureJournalRecord
  ) async throws -> C7CaptureJournalRecord
  func verifyArtifact(
    record: C7CaptureJournalRecord,
    artifact: C7JournalArtifact
  ) async throws
}

enum C7CaptureFileHasher {
  static func sha256Hex(fileURL: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 4 * 1_024 * 1_024), !chunk.isEmpty {
      hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  static func checksumBase64(fileURL: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: fileURL)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 1 * 1_024 * 1_024), !chunk.isEmpty {
      hasher.update(data: chunk)
    }
    return Data(hasher.finalize()).base64EncodedString()
  }
}

actor C7ProtectedCaptureJournal: C7CaptureJournalStoring {
  private let root: URL
  private let clock: any C7CaptureClock
  private let idGenerator: @Sendable () -> UUID
  private let encoder: JSONEncoder
  private let decoder = JSONDecoder()

  init(
    root: URL? = nil,
    clock: any C7CaptureClock = C7SystemCaptureClock(),
    idGenerator: @escaping @Sendable () -> UUID = UUID.init
  ) {
    self.root =
      root
      ?? FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
      )[0].appendingPathComponent("C7ProtectedCapture", isDirectory: true)
    self.clock = clock
    self.idGenerator = idGenerator
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    self.encoder = encoder
  }

  func saveIntent(_ intent: C7CaptureSessionIntent) throws {
    guard
      intent.schemaVersion == C7CaptureSessionIntent.schemaVersion,
      intent.request.rights.serviceProcessingConsent,
      intent.request.rights.trainingUseConsent == "denied"
    else {
      throw C7CaptureJournalError.corrupt
    }
    try ensureProtectedDirectory(projectDirectory(intent.projectId))
    try writeProtected(encoder.encode(intent), to: intentURL(intent.projectId))
  }

  func loadIntent(projectId: UUID) throws -> C7CaptureSessionIntent? {
    let url = intentURL(projectId)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let intent = try decoder.decode(C7CaptureSessionIntent.self, from: Data(contentsOf: url))
    guard intent.projectId == projectId,
      intent.schemaVersion == C7CaptureSessionIntent.schemaVersion
    else {
      throw C7CaptureJournalError.corrupt
    }
    return intent
  }

  func clearIntent(projectId: UUID) throws {
    let url = intentURL(projectId)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  func create(brief: C7CaptureBrief, serverVersion: Int) throws -> C7CaptureJournalRecord {
    guard
      brief.schemaVersion == C7CaptureContract.captureSessionSchemaVersion,
      brief.rights.serviceProcessingConsent,
      brief.rights.trainingUseConsent == "denied",
      serverVersion > 0
    else {
      throw C7CaptureJournalError.corrupt
    }
    let now = clock.now()
    let record = C7CaptureJournalRecord(
      brief: brief,
      cancelKey: "cancel-\(brief.captureSessionId.uuidString.lowercased())",
      createdAt: now,
      id: brief.captureSessionId,
      package: nil,
      phase: .ready,
      projectId: brief.projectId,
      retryCount: 0,
      revision: 1,
      rightsState: .granted,
      review: nil,
      schemaVersion: C7CaptureJournalRecord.schemaVersion,
      serverVersion: serverVersion,
      updatedAt: now
    )
    let directory = sessionDirectory(record)
    try ensureProtectedDirectory(directory)
    let url = recordURL(record)
    if FileManager.default.fileExists(atPath: url.path) {
      let existing = try loadRecord(at: url)
      guard existing.brief == brief else { throw C7CaptureJournalError.conflict }
      return existing
    }
    try writeProtected(encoder.encode(record), to: url)
    return record
  }

  func loadLatest(projectId: UUID) throws -> C7CaptureJournalRecord? {
    let directory = projectDirectory(projectId)
    guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
    let children = try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    )
    guard children.count <= C7CaptureContract.maximumRoomCount + 8 else {
      throw C7CaptureJournalError.corrupt
    }
    let records = try children.compactMap { child -> C7CaptureJournalRecord? in
      guard UUID(uuidString: child.lastPathComponent) != nil else { return nil }
      let url = child.appendingPathComponent("journal.json")
      guard FileManager.default.fileExists(atPath: url.path) else { return nil }
      return try loadRecord(at: url)
    }
    guard records.allSatisfy({ $0.projectId == projectId }) else {
      throw C7CaptureJournalError.corrupt
    }
    return records.sorted {
      if $0.updatedAt == $1.updatedAt { return $0.id.uuidString < $1.id.uuidString }
      return $0.updatedAt > $1.updatedAt
    }.first
  }

  func save(_ record: C7CaptureJournalRecord) throws -> C7CaptureJournalRecord {
    try validateRecord(record)
    let url = recordURL(record)
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw C7CaptureJournalError.missingRecord
    }
    let current = try loadRecord(at: url)
    guard current.revision == record.revision else { throw C7CaptureJournalError.conflict }
    guard
      current.id == record.id,
      current.projectId == record.projectId,
      current.brief == record.brief,
      current.createdAt == record.createdAt,
      current.cancelKey == record.cancelKey
    else {
      throw C7CaptureJournalError.conflict
    }
    var next = record
    next.revision += 1
    next.updatedAt = clock.now()
    try writeProtected(encoder.encode(next), to: url)
    return next
  }

  func stageReview(
    _ draft: C7CaptureReviewDraft,
    record initialRecord: C7CaptureJournalRecord
  ) throws -> C7CaptureJournalRecord {
    try C7StrictCaptureValidator.validateReview(draft, brief: initialRecord.brief)
    guard initialRecord.review == nil, initialRecord.package == nil else {
      throw C7CaptureJournalError.conflict
    }
    var record = initialRecord
    record.phase = .packaging
    record = try save(record)

    let directory = artifactDirectory(record)
    try ensureProtectedDirectory(directory)
    var storedArtifacts: [C7JournalArtifact] = []
    var totalBytes: Int64 = 0
    for source in draft.rawArtifacts.sorted(by: {
      $0.artifactId.uuidString < $1.artifactId.uuidString
    }) {
      let values = try source.fileURL.resourceValues(forKeys: [.fileSizeKey])
      let byteSize = Int64(values.fileSize ?? 0)
      guard byteSize > 0, byteSize <= C7CaptureContract.maximumArtifactBytes else {
        throw C7CaptureJournalError.invalidArtifact
      }
      totalBytes += byteSize
      guard totalBytes <= C7CaptureContract.maximumPackageBytes else {
        throw C7CaptureJournalError.invalidArtifact
      }
      let sha256 = try C7CaptureFileHasher.sha256Hex(fileURL: source.fileURL)
      let storageName = source.artifactId.uuidString.lowercased()
      let destination = directory.appendingPathComponent(storageName)
      if FileManager.default.fileExists(atPath: destination.path) {
        guard
          try fileSize(destination) == byteSize,
          try C7CaptureFileHasher.sha256Hex(fileURL: destination) == sha256
        else {
          throw C7CaptureJournalError.conflict
        }
      } else {
        let accessed = source.fileURL.startAccessingSecurityScopedResource()
        defer { if accessed { source.fileURL.stopAccessingSecurityScopedResource() } }
        try FileManager.default.copyItem(at: source.fileURL, to: destination)
        try protect(destination)
        guard try C7CaptureFileHasher.sha256Hex(fileURL: destination) == sha256 else {
          throw C7CaptureJournalError.invalidArtifact
        }
      }
      let manifest = C7CaptureArtifactManifest(
        artifactId: source.artifactId,
        byteSize: byteSize,
        contentType: source.contentType,
        kind: source.kind,
        roomId: source.roomId,
        sha256: sha256
      )
      storedArtifacts.append(makeStoredArtifact(manifest: manifest, storageName: storageName))
    }

    let normalizedStorageName = idGenerator().uuidString.lowercased()
    try writeProtected(
      encoder.encode(draft.normalized),
      to: directory.appendingPathComponent(normalizedStorageName)
    )
    let sourceIds = Set(
      draft.normalized.surfaces.map(\.sourceIdentifier)
        + draft.normalized.objects.map(\.sourceIdentifier)
    ).sorted { $0.uuidString < $1.uuidString }
    record.review = C7StoredCaptureReview(
      device: draft.device,
      endedAt: draft.endedAt,
      normalizedArtifactId: idGenerator(),
      normalizedDraftStorageName: normalizedStorageName,
      quality: draft.normalized.quality,
      qualityArtifactId: idGenerator(),
      referenceMeasurements: draft.normalized.referenceMeasurements,
      rooms: draft.normalized.rooms.sorted { $0.sequence < $1.sequence },
      rawArtifacts: storedArtifacts,
      sourceEntityIds: sourceIds,
      sharedWorldOrigin: draft.sharedWorldOrigin,
      startedAt: draft.startedAt
    )
    record.phase = .review
    return try save(record)
  }

  func loadNormalizedDraft(record: C7CaptureJournalRecord) throws -> C7NormalizedRoomPlan {
    guard let review = record.review else { throw C7CaptureJournalError.missingArtifact }
    let url = try artifactURL(record: record, storageName: review.normalizedDraftStorageName)
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw C7CaptureJournalError.missingArtifact
    }
    let normalized = try decoder.decode(C7NormalizedRoomPlan.self, from: Data(contentsOf: url))
    guard
      normalized.captureSessionId == record.id,
      normalized.projectId == record.projectId,
      normalized.schemaVersion == C7CaptureContract.normalizedRoomPlanSchemaVersion
    else {
      throw C7CaptureJournalError.corrupt
    }
    return normalized
  }

  func finalizeReview(
    record initialRecord: C7CaptureJournalRecord,
    rooms: [C7CaptureRoomManifest],
    referenceMeasurements: [C7ReferenceMeasurement]
  ) throws -> C7CaptureJournalRecord {
    guard var review = initialRecord.review, initialRecord.package == nil else {
      throw C7CaptureJournalError.conflict
    }
    let allowedIds = Set(review.sourceEntityIds)
    guard
      referenceMeasurements.allSatisfy({ measurement in
        measurement.fromSourceEntityId != measurement.toSourceEntityId
          && allowedIds.contains(measurement.fromSourceEntityId)
          && allowedIds.contains(measurement.toSourceEntityId)
          && (1...100_000).contains(measurement.distanceMillimetres)
      })
    else {
      throw C7CaptureQualityError.unknownSourceEntity
    }
    let normalizedDraft = try loadNormalizedDraft(record: initialRecord)
    let normalized = C7NormalizedRoomPlan(
      captureSessionId: normalizedDraft.captureSessionId,
      coordinateSystem: normalizedDraft.coordinateSystem,
      objects: normalizedDraft.objects,
      projectId: normalizedDraft.projectId,
      quality: review.quality,
      referenceMeasurements: referenceMeasurements,
      rooms: rooms,
      schemaVersion: normalizedDraft.schemaVersion,
      structureIdentifier: normalizedDraft.structureIdentifier,
      surfaces: normalizedDraft.surfaces
    )
    let directory = artifactDirectory(initialRecord)
    let normalizedName = review.normalizedArtifactId.uuidString.lowercased()
    let qualityName = review.qualityArtifactId.uuidString.lowercased()
    let normalizedData = try encoder.encode(C7NormalizedRoomPlanWire(normalized))
    let qualityData = try encoder.encode(C7QualityWireManifest(review.quality))
    let normalizedURL = directory.appendingPathComponent(normalizedName)
    let qualityURL = directory.appendingPathComponent(qualityName)
    try writeProtected(normalizedData, to: normalizedURL)
    try writeProtected(qualityData, to: qualityURL)

    let normalizedManifest = C7CaptureArtifactManifest(
      artifactId: review.normalizedArtifactId,
      byteSize: Int64(normalizedData.count),
      contentType: .json,
      kind: .roomPlanNormalizedJSON,
      roomId: nil,
      sha256: try C7CaptureFileHasher.sha256Hex(fileURL: normalizedURL)
    )
    let qualityManifest = C7CaptureArtifactManifest(
      artifactId: review.qualityArtifactId,
      byteSize: Int64(qualityData.count),
      contentType: .json,
      kind: .qualityManifestJSON,
      roomId: nil,
      sha256: try C7CaptureFileHasher.sha256Hex(fileURL: qualityURL)
    )
    var artifacts = review.rawArtifacts
    artifacts.append(makeStoredArtifact(manifest: normalizedManifest, storageName: normalizedName))
    artifacts.append(makeStoredArtifact(manifest: qualityManifest, storageName: qualityName))
    artifacts.sort { $0.manifest.artifactId.uuidString < $1.manifest.artifactId.uuidString }

    let package = C7CreateCapturePackageRequest(
      artifacts: artifacts.map(\.manifest),
      captureSessionId: initialRecord.id,
      device: review.device,
      endedAt: review.endedAt,
      mode: initialRecord.brief.mode,
      projectId: initialRecord.projectId,
      quality: review.quality,
      referenceMeasurements: referenceMeasurements,
      rights: initialRecord.brief.rights,
      rooms: rooms.sorted { $0.sequence < $1.sequence },
      schemaVersion: C7CaptureContract.capturePackageSchemaVersion,
      sharedWorldOrigin: review.sharedWorldOrigin,
      startedAt: review.startedAt
    )
    try C7StrictCaptureValidator.validatePackage(package)
    review.rooms = package.rooms
    review.referenceMeasurements = referenceMeasurements
    var record = initialRecord
    record.review = review
    record.package = C7StoredCapturePackage(
      manifest: package,
      artifacts: artifacts,
      finalizeKey: "package-\(record.id.uuidString.lowercased())"
    )
    record.phase = .paused
    return try save(record)
  }

  func verifyArtifact(
    record: C7CaptureJournalRecord,
    artifact: C7JournalArtifact
  ) throws {
    let url = try artifactURL(record: record, storageName: artifact.storageName)
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw C7CaptureJournalError.missingArtifact
    }
    guard
      try fileSize(url) == artifact.manifest.byteSize,
      try C7CaptureFileHasher.sha256Hex(fileURL: url) == artifact.manifest.sha256
    else {
      throw C7CaptureServiceError.checksumMismatch
    }
  }

  func makePartFile(
    record: C7CaptureJournalRecord,
    artifact: C7JournalArtifact,
    offset: UInt64,
    length: Int,
    partNumber: Int
  ) throws -> URL {
    guard
      length > 0,
      length <= C7CaptureContract.uploadPartSizeBytes,
      (1...C7CaptureContract.maximumUploadPartCount).contains(partNumber)
    else {
      throw C7CaptureJournalError.invalidArtifact
    }
    let sourceURL = try artifactURL(record: record, storageName: artifact.storageName)
    let parts = sessionDirectory(record).appendingPathComponent("parts", isDirectory: true)
    try ensureProtectedDirectory(parts)
    let partURL = parts.appendingPathComponent(
      "\(artifact.manifest.artifactId.uuidString.lowercased())-\(partNumber)"
    )
    if FileManager.default.fileExists(atPath: partURL.path) {
      try FileManager.default.removeItem(at: partURL)
    }
    guard FileManager.default.createFile(atPath: partURL.path, contents: nil) else {
      throw C7CaptureJournalError.invalidArtifact
    }
    let source = try FileHandle(forReadingFrom: sourceURL)
    let target = try FileHandle(forWritingTo: partURL)
    defer {
      try? source.close()
      try? target.close()
    }
    try source.seek(toOffset: offset)
    guard let data = try source.read(upToCount: length), data.count == length else {
      throw C7CaptureJournalError.invalidArtifact
    }
    try target.write(contentsOf: data)
    try protect(partURL)
    return partURL
  }

  private func makeStoredArtifact(
    manifest: C7CaptureArtifactManifest,
    storageName: String
  ) -> C7JournalArtifact {
    let suffix = manifest.artifactId.uuidString.lowercased()
    return C7JournalArtifact(
      manifest: manifest,
      storageName: storageName,
      uploadSessionId: nil,
      uploadExpiresAt: nil,
      completedParts: [],
      createUploadKey: "artifact-\(suffix)",
      completeUploadKey: "complete-\(suffix)",
      signingGenerations: [:],
      uploadAttempt: 0,
      completed: false
    )
  }

  private func validateRecord(_ record: C7CaptureJournalRecord) throws {
    guard
      record.schemaVersion == C7CaptureJournalRecord.schemaVersion,
      record.id == record.brief.captureSessionId,
      record.projectId == record.brief.projectId,
      record.revision > 0,
      record.serverVersion > 0,
      record.retryCount >= 0,
      record.retryCount <= 100,
      record.brief.rights.trainingUseConsent == "denied",
      !record.cancelKey.isEmpty
    else {
      throw C7CaptureJournalError.corrupt
    }
    if let package = record.package {
      try C7StrictCaptureValidator.validatePackage(package.manifest)
      guard package.artifacts.map(\.manifest) == package.manifest.artifacts else {
        throw C7CaptureJournalError.corrupt
      }
      guard
        package.artifacts.allSatisfy({ artifact in
          artifact.uploadAttempt >= 0
            && artifact.uploadAttempt <= 100
            && artifact.signingGenerations.count <= C7CaptureContract.maximumUploadPartCount
            && artifact.signingGenerations.allSatisfy({ part, generation in
              (1...C7CaptureContract.maximumUploadPartCount).contains(part)
                && (0...100).contains(generation)
            })
        })
      else {
        throw C7CaptureJournalError.corrupt
      }
    }
  }

  private func loadRecord(at url: URL) throws -> C7CaptureJournalRecord {
    let record = try decoder.decode(C7CaptureJournalRecord.self, from: Data(contentsOf: url))
    try validateRecord(record)
    return record
  }

  private func projectDirectory(_ projectId: UUID) -> URL {
    root.appendingPathComponent(projectId.uuidString.lowercased(), isDirectory: true)
  }

  private func sessionDirectory(_ record: C7CaptureJournalRecord) -> URL {
    projectDirectory(record.projectId)
      .appendingPathComponent(record.id.uuidString.lowercased(), isDirectory: true)
  }

  private func artifactDirectory(_ record: C7CaptureJournalRecord) -> URL {
    sessionDirectory(record).appendingPathComponent("artifacts", isDirectory: true)
  }

  private func recordURL(_ record: C7CaptureJournalRecord) -> URL {
    sessionDirectory(record).appendingPathComponent("journal.json")
  }

  private func intentURL(_ projectId: UUID) -> URL {
    projectDirectory(projectId).appendingPathComponent("session-intent.json")
  }

  private func artifactURL(record: C7CaptureJournalRecord, storageName: String) throws -> URL {
    guard UUID(uuidString: storageName)?.uuidString.lowercased() == storageName.lowercased() else {
      throw C7CaptureJournalError.corrupt
    }
    return artifactDirectory(record).appendingPathComponent(storageName.lowercased())
  }

  private func fileSize(_ url: URL) throws -> Int64 {
    Int64(try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
  }

  private func ensureProtectedDirectory(_ url: URL) throws {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    try protect(url)
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableURL = url
    try mutableURL.setResourceValues(values)
  }

  private func writeProtected(_ data: Data, to url: URL) throws {
    try ensureProtectedDirectory(url.deletingLastPathComponent())
    try data.write(to: url, options: [.atomic])
    try protect(url)
  }

  private func protect(_ url: URL) throws {
    do {
      try FileManager.default.setAttributes(
        [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
        ofItemAtPath: url.path
      )
    } catch {
      throw C7CaptureJournalError.protectionFailed
    }
  }
}

import CryptoKit
import Foundation
import ImageIO

protocol C14_8ProtectedCaptureStoring: Sendable {
  func clear(projectId: UUID) async throws
  func load(projectId: UUID) async throws -> C14_8GuidedCaptureDraft?
  func loadSelectionDiagnostics(projectId: UUID) async throws -> C14_10SelectionDiagnostics?
  func recordMediaReceipt(
    projectId: UUID,
    receipt: C14_8MediaReceipt
  ) async throws -> C14_8GuidedCaptureDraft
  func resolveDepth(projectId: UUID, handle: C14_8DepthHandle) async throws -> URL
  func save(_ draft: C14_8GuidedCaptureDraft) async throws
  func saveSelectionDiagnostics(
    projectId: UUID,
    diagnostics: C14_10SelectionDiagnostics
  ) async throws
  func storeDepth(
    projectId: UUID,
    sampleId: UUID,
    data: Data,
    width: Int,
    height: Int
  ) async throws -> C14_8DepthHandle
}

enum C14_8ProtectedStoreError: Error, Equatable, Sendable {
  case corrupt
  case invalidPath
  case missingFile
  case overBudget
  case staleWrite
}

protocol C14_10RejectedFrameDiagnosticStoring: Sendable {
  func clear(projectId: UUID) async throws
  func loadLatest(projectId: UUID) async throws -> C14_10RejectedFrameDiagnosticSnapshot?
  func save(
    projectId: UUID,
    thumbnail: C14_10RejectedDiagnosticThumbnail,
    outcome: C14_10RecentSelectionOutcome
  ) async throws -> C14_10RejectedFrameDiagnosticSnapshot
}

private struct C14_10RejectedFrameDiagnosticManifest: Codable, Equatable, Sendable {
  let projectId: UUID
  var records: [C14_10RejectedFrameDiagnosticRecord]
  let schemaVersion: String
  var updatedAt: Date

  var isValid: Bool {
    schemaVersion == C14_10RejectedFrameDiagnosticPolicy.schemaVersion
      && records.count <= C14_10RejectedFrameDiagnosticPolicy.maximumRetainedCount
      && Set(records.map(\.diagnosticId)).count == records.count
      && records.allSatisfy(\.isValid)
      && records.map(\.capturedAt) == records.map(\.capturedAt).sorted()
  }
}

actor C14_10RejectedFrameDiagnosticStore: C14_10RejectedFrameDiagnosticStoring {
  private let decoder = JSONDecoder()
  private let encoder: JSONEncoder
  private let fileManager: FileManager
  private let root: URL

  init(root: URL? = nil, fileManager: FileManager = .default) {
    self.fileManager = fileManager
    self.root =
      root
      ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("C14_10RejectedFrameDiagnostics", isDirectory: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    self.encoder = encoder
  }

  func clear(projectId: UUID) throws {
    let directory = projectDirectory(projectId)
    if fileManager.fileExists(atPath: directory.path) {
      try fileManager.removeItem(at: directory)
    }
  }

  func loadLatest(projectId: UUID) throws -> C14_10RejectedFrameDiagnosticSnapshot? {
    guard let manifest = try loadManifest(projectId: projectId), let record = manifest.records.last
    else { return nil }
    let imageURL = projectDirectory(projectId).appendingPathComponent(record.imageFilename)
    let data = try Data(contentsOf: imageURL, options: [.mappedIfSafe])
    guard data.count == record.imageByteCount,
      Self.sha256(data) == record.imageSHA256,
      let dimensions = Self.imageDimensions(data),
      dimensions.width == record.pixelWidth,
      dimensions.height == record.pixelHeight
    else { throw C14_8ProtectedStoreError.corrupt }
    return C14_10RejectedFrameDiagnosticSnapshot(
      jpegData: data,
      record: record,
      retainedCount: manifest.records.count
    )
  }

  func save(
    projectId: UUID,
    thumbnail: C14_10RejectedDiagnosticThumbnail,
    outcome: C14_10RecentSelectionOutcome
  ) throws -> C14_10RejectedFrameDiagnosticSnapshot {
    guard thumbnail.capturedAt == outcome.completedAt,
      thumbnail.telemetryTimestampMicroseconds == outcome.telemetryTimestampMicroseconds,
      !thumbnail.jpegData.isEmpty,
      thumbnail.jpegData.count <= C14_10RejectedFrameDiagnosticPolicy.maximumImageBytes,
      let dimensions = Self.imageDimensions(thumbnail.jpegData),
      dimensions.width == thumbnail.pixelWidth,
      dimensions.height == thumbnail.pixelHeight,
      thumbnail.pixelWidth <= C14_10RejectedFrameDiagnosticPolicy.maximumPixelDimension,
      thumbnail.pixelHeight <= C14_10RejectedFrameDiagnosticPolicy.maximumPixelDimension,
      outcome.reason != .accepted,
      outcome.isValid
    else { throw C14_8ProtectedStoreError.overBudget }
    try prepare(projectId: projectId)
    var manifest =
      try loadManifest(projectId: projectId)
      ?? C14_10RejectedFrameDiagnosticManifest(
        projectId: projectId,
        records: [],
        schemaVersion: C14_10RejectedFrameDiagnosticPolicy.schemaVersion,
        updatedAt: thumbnail.capturedAt
      )
    let diagnosticId = UUID()
    let filename = "\(diagnosticId.uuidString.lowercased()).jpg"
    let record = C14_10RejectedFrameDiagnosticRecord(
      capturedAt: thumbnail.capturedAt,
      diagnosticId: diagnosticId,
      imageByteCount: thumbnail.jpegData.count,
      imageFilename: filename,
      imageSHA256: Self.sha256(thumbnail.jpegData),
      outcome: outcome,
      pixelHeight: thumbnail.pixelHeight,
      pixelWidth: thumbnail.pixelWidth
    )
    guard record.isValid else { throw C14_8ProtectedStoreError.corrupt }
    let imageURL = projectDirectory(projectId).appendingPathComponent(filename)
    try thumbnail.jpegData.write(to: imageURL, options: [.atomic, .completeFileProtection])
    manifest.records.append(record)
    let excess = max(
      0,
      manifest.records.count - C14_10RejectedFrameDiagnosticPolicy.maximumRetainedCount
    )
    let removed = Array(manifest.records.prefix(excess))
    if excess > 0 { manifest.records.removeFirst(excess) }
    manifest.updatedAt = max(manifest.updatedAt, thumbnail.capturedAt)
    do {
      guard manifest.projectId == projectId, manifest.isValid else {
        throw C14_8ProtectedStoreError.corrupt
      }
      try encoder.encode(manifest).write(
        to: manifestURL(projectId),
        options: [.atomic, .completeFileProtection]
      )
      for stale in removed {
        let staleURL = projectDirectory(projectId).appendingPathComponent(stale.imageFilename)
        try? fileManager.removeItem(at: staleURL)
      }
    } catch {
      try? fileManager.removeItem(at: imageURL)
      throw error
    }
    return C14_10RejectedFrameDiagnosticSnapshot(
      jpegData: thumbnail.jpegData,
      record: record,
      retainedCount: manifest.records.count
    )
  }

  private func loadManifest(projectId: UUID) throws -> C14_10RejectedFrameDiagnosticManifest? {
    let url = manifestURL(projectId)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    let manifest = try decoder.decode(
      C14_10RejectedFrameDiagnosticManifest.self,
      from: Data(contentsOf: url)
    )
    guard manifest.projectId == projectId, manifest.isValid else {
      throw C14_8ProtectedStoreError.corrupt
    }
    return manifest
  }

  private func prepare(projectId: UUID) throws {
    try protectedDirectory(root)
    try protectedDirectory(projectDirectory(projectId))
  }

  private func protectedDirectory(_ url: URL) throws {
    try fileManager.createDirectory(
      at: url,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    var protectedURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try protectedURL.setResourceValues(values)
  }

  private func projectDirectory(_ projectId: UUID) -> URL {
    root.appendingPathComponent(projectId.uuidString.lowercased(), isDirectory: true)
  }

  private func manifestURL(_ projectId: UUID) -> URL {
    projectDirectory(projectId).appendingPathComponent("manifest.json", isDirectory: false)
  }

  private static func imageDimensions(_ data: Data) -> (width: Int, height: Int)? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      CGImageSourceGetCount(source) == 1,
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    return (width, height)
  }

  private static func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

actor C14_8ProtectedCaptureStore: C14_8ProtectedCaptureStoring {
  private let decoder = JSONDecoder()
  private let encoder: JSONEncoder
  private let fileManager: FileManager
  private let root: URL

  init(root: URL? = nil, fileManager: FileManager = .default) {
    self.fileManager = fileManager
    self.root =
      root
      ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("C14_8GuidedCapture", isDirectory: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    self.encoder = encoder
  }

  func load(projectId: UUID) throws -> C14_8GuidedCaptureDraft? {
    let url = journalURL(projectId)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    let draft = try decoder.decode(C14_8GuidedCaptureDraft.self, from: Data(contentsOf: url))
    guard draft.projectId == projectId else { throw C14_8ProtectedStoreError.corrupt }
    try C14_8ContractValidator.validate(draft: draft)
    return draft
  }

  func loadSelectionDiagnostics(projectId: UUID) throws -> C14_10SelectionDiagnostics? {
    let url = selectionDiagnosticsURL(projectId)
    guard fileManager.fileExists(atPath: url.path) else { return nil }
    let diagnostics = try decoder.decode(
      C14_10SelectionDiagnostics.self,
      from: Data(contentsOf: url)
    )
    guard diagnostics.isValid else { throw C14_8ProtectedStoreError.corrupt }
    return diagnostics
  }

  func save(_ draft: C14_8GuidedCaptureDraft) throws {
    try C14_8ContractValidator.validate(draft: draft)
    try prepare(projectId: draft.projectId)
    let url = journalURL(draft.projectId)
    if fileManager.fileExists(atPath: url.path) {
      let current = try decoder.decode(C14_8GuidedCaptureDraft.self, from: Data(contentsOf: url))
      guard current.projectId == draft.projectId,
        current.actorUserId == draft.actorUserId,
        current.tenantId == draft.tenantId
      else { throw C14_8ProtectedStoreError.corrupt }
      guard draft.updatedAt >= current.updatedAt else {
        throw C14_8ProtectedStoreError.staleWrite
      }
    }
    try encoder.encode(draft).write(
      to: url,
      options: [.atomic, .completeFileProtection]
    )
  }

  func saveSelectionDiagnostics(
    projectId: UUID,
    diagnostics: C14_10SelectionDiagnostics
  ) throws {
    guard diagnostics.isValid else { throw C14_8ProtectedStoreError.corrupt }
    try prepare(projectId: projectId)
    let url = selectionDiagnosticsURL(projectId)
    if fileManager.fileExists(atPath: url.path) {
      let current = try decoder.decode(
        C14_10SelectionDiagnostics.self,
        from: Data(contentsOf: url)
      )
      guard current.isValid,
        diagnostics.updatedAt >= current.updatedAt,
        diagnostics.totalAutomaticCandidateCount >= current.totalAutomaticCandidateCount
      else { throw C14_8ProtectedStoreError.staleWrite }
    }
    try encoder.encode(diagnostics).write(
      to: url,
      options: [.atomic, .completeFileProtection]
    )
  }

  func recordMediaReceipt(
    projectId: UUID,
    receipt: C14_8MediaReceipt
  ) throws -> C14_8GuidedCaptureDraft {
    guard var current = try load(projectId: projectId), current.acceptance == nil else {
      throw C14_8ProtectedStoreError.corrupt
    }
    if let existing = current.mediaReceipts.first(where: {
      $0.localIdentifier == receipt.localIdentifier
    }) {
      guard existing == receipt else { throw C14_8ProtectedStoreError.corrupt }
      return current
    }
    guard
      current.keyframes.contains(where: {
        $0.localIdentifier == receipt.localIdentifier
          && $0.byteSize == receipt.receipt.byteSize
          && $0.sha256 == receipt.receipt.sha256
      })
    else { throw C14_8ProtectedStoreError.corrupt }
    current.mediaReceipts.append(receipt)
    current.updatedAt = max(Date(), current.updatedAt.addingTimeInterval(0.001))
    try C14_8ContractValidator.validate(draft: current)
    try encoder.encode(current).write(
      to: journalURL(projectId),
      options: [.atomic, .completeFileProtection]
    )
    guard try load(projectId: projectId) == current else {
      throw C14_8ProtectedStoreError.corrupt
    }
    return current
  }

  func storeDepth(
    projectId: UUID,
    sampleId: UUID,
    data: Data,
    width: Int,
    height: Int
  ) throws -> C14_8DepthHandle {
    guard !data.isEmpty,
      data.count <= Int(C7CaptureContract.maximumArtifactBytes),
      width > 0,
      height > 0,
      data.count == width * height * MemoryLayout<Float32>.size
    else { throw C14_8ProtectedStoreError.overBudget }
    try prepare(projectId: projectId)
    let localIdentifier = UUID()
    let url = depthURL(projectId, localIdentifier)
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return C14_8DepthHandle(
      byteSize: Int64(data.count),
      heightPixels: height,
      localIdentifier: localIdentifier,
      sampleId: sampleId,
      sha256: digest,
      widthPixels: width
    )
  }

  func resolveDepth(projectId: UUID, handle: C14_8DepthHandle) throws -> URL {
    let url = depthURL(projectId, handle.localIdentifier)
    guard
      url.deletingLastPathComponent().standardizedFileURL
        == depthDirectory(projectId).standardizedFileURL,
      fileManager.fileExists(atPath: url.path),
      Int64((try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0) == handle.byteSize
    else { throw C14_8ProtectedStoreError.missingFile }
    return url
  }

  func clear(projectId: UUID) throws {
    let directory = projectDirectory(projectId)
    if fileManager.fileExists(atPath: directory.path) {
      try fileManager.removeItem(at: directory)
    }
  }

  private func prepare(projectId: UUID) throws {
    try protectedDirectory(root)
    try protectedDirectory(projectDirectory(projectId))
    try protectedDirectory(depthDirectory(projectId))
  }

  private func protectedDirectory(_ url: URL) throws {
    try fileManager.createDirectory(
      at: url,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    var protectedURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try protectedURL.setResourceValues(values)
  }

  private func projectDirectory(_ projectId: UUID) -> URL {
    root.appendingPathComponent(projectId.uuidString.lowercased(), isDirectory: true)
  }

  private func depthDirectory(_ projectId: UUID) -> URL {
    projectDirectory(projectId).appendingPathComponent("depth", isDirectory: true)
  }

  private func journalURL(_ projectId: UUID) -> URL {
    projectDirectory(projectId).appendingPathComponent("journal.json", isDirectory: false)
  }

  private func selectionDiagnosticsURL(_ projectId: UUID) -> URL {
    projectDirectory(projectId).appendingPathComponent(
      "selection-diagnostics.json",
      isDirectory: false
    )
  }

  private func depthURL(_ projectId: UUID, _ identifier: UUID) -> URL {
    depthDirectory(projectId).appendingPathComponent(identifier.uuidString.lowercased())
  }
}

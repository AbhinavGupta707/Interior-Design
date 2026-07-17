import CryptoKit
import Foundation

protocol C8ProtectedMediaStoring: Sendable {
  func allocateDestination() async throws -> (id: UUID, url: URL)
  func delete(_ handle: C8LocalMediaHandle) async throws
  func finalize(
    id: UUID,
    mimeType: C8MediaMIMEType,
    containsDepthData: Bool,
    origin: C8CaptureEvidenceOrigin
  ) async throws -> C8LocalMediaHandle
  func resolve(_ handle: C8LocalMediaHandle) async throws -> URL
}

enum C8ProtectedMediaStoreError: Error, Equatable, Sendable {
  case invalidIdentifier
  case missingFile
  case overBudget
}

actor C8ProtectedMediaStore: C8ProtectedMediaStoring {
  private let fileManager: FileManager
  private let root: URL

  init(root: URL? = nil, fileManager: FileManager = .default) {
    self.fileManager = fileManager
    self.root =
      root
      ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("C8ProtectedMedia", isDirectory: true)
  }

  func allocateDestination() throws -> (id: UUID, url: URL) {
    try prepareRoot()
    let id = UUID()
    let destination = url(for: id)
    guard !fileManager.fileExists(atPath: destination.path) else {
      throw C8ProtectedMediaStoreError.invalidIdentifier
    }
    return (id, destination)
  }

  func finalize(
    id: UUID,
    mimeType: C8MediaMIMEType,
    containsDepthData: Bool,
    origin: C8CaptureEvidenceOrigin
  ) async throws -> C8LocalMediaHandle {
    let source = url(for: id)
    guard fileManager.fileExists(atPath: source.path) else {
      throw C8ProtectedMediaStoreError.missingFile
    }
    let values = try source.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    let byteSize = Int64(values.fileSize ?? 0)
    guard values.isRegularFile == true, byteSize > 0 else {
      throw C8ProtectedMediaStoreError.missingFile
    }
    guard byteSize <= C8ReconstructionContract.maximumSourceAssetBytes else {
      throw C8ProtectedMediaStoreError.overBudget
    }
    let sha256 = try await Self.sha256(of: source)
    try fileManager.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: source.path
    )
    return C8LocalMediaHandle(
      byteSize: byteSize,
      containsDepthData: containsDepthData,
      createdAt: Date(),
      localIdentifier: id,
      mimeType: mimeType,
      origin: origin,
      sha256: sha256
    )
  }

  func resolve(_ handle: C8LocalMediaHandle) throws -> URL {
    let candidate = url(for: handle.localIdentifier)
    guard candidate.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL,
      fileManager.fileExists(atPath: candidate.path)
    else { throw C8ProtectedMediaStoreError.invalidIdentifier }
    return candidate
  }

  func delete(_ handle: C8LocalMediaHandle) throws {
    let candidate = url(for: handle.localIdentifier)
    guard candidate.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL
    else {
      throw C8ProtectedMediaStoreError.invalidIdentifier
    }
    if fileManager.fileExists(atPath: candidate.path) {
      try fileManager.removeItem(at: candidate)
    }
  }

  private func prepareRoot() throws {
    try fileManager.createDirectory(
      at: root,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var protectedRoot = root
    try protectedRoot.setResourceValues(values)
  }

  private func url(for id: UUID) -> URL {
    root.appendingPathComponent(id.uuidString.lowercased(), isDirectory: false)
  }

  private nonisolated static func sha256(of url: URL) async throws -> String {
    try await Task.detached(priority: .utility) {
      let handle = try FileHandle(forReadingFrom: url)
      defer { try? handle.close() }
      var hasher = SHA256()
      while let data = try handle.read(upToCount: 4 * 1_024 * 1_024), !data.isEmpty {
        try Task.checkCancellation()
        hasher.update(data: data)
      }
      return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }.value
  }
}

struct C8MediaCaptureDraft: Codable, Equatable, Sendable {
  var coveredSectors: [C8CoverageSector]
  var depthDeliveredCount: Int
  var depthRequested: Bool
  var handles: [C8LocalMediaHandle]
  var interruptionCount: Int
  var kind: C8MediaCaptureKind
  var mediaQuality: [C8CapturedMediaQuality]
  var origin: C8CaptureEvidenceOrigin
  let projectId: UUID
  var receipts: [C8ImmutableEvidenceReceipt]
  var resourcePressureCount: Int
  var thermalInterruptionCount: Int
  var updatedAt: Date
}

protocol C8CaptureJournalStoring: Sendable {
  func clear(projectId: UUID) async throws
  func load(projectId: UUID) async throws -> C8MediaCaptureDraft?
  func save(_ draft: C8MediaCaptureDraft) async throws
}

actor C8ProtectedCaptureJournal: C8CaptureJournalStoring {
  private let fileManager: FileManager
  private let root: URL

  init(root: URL? = nil, fileManager: FileManager = .default) {
    self.fileManager = fileManager
    self.root =
      root
      ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("C8CaptureJournal", isDirectory: true)
  }

  func load(projectId: UUID) throws -> C8MediaCaptureDraft? {
    let file = url(for: projectId)
    guard fileManager.fileExists(atPath: file.path) else { return nil }
    return try JSONDecoder().decode(C8MediaCaptureDraft.self, from: Data(contentsOf: file))
  }

  func save(_ draft: C8MediaCaptureDraft) throws {
    try fileManager.createDirectory(
      at: root,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    var protectedRoot = root
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try protectedRoot.setResourceValues(values)
    let data = try JSONEncoder().encode(draft)
    try data.write(to: url(for: draft.projectId), options: [.atomic, .completeFileProtection])
  }

  func clear(projectId: UUID) throws {
    let file = url(for: projectId)
    if fileManager.fileExists(atPath: file.path) { try fileManager.removeItem(at: file) }
  }

  private func url(for projectId: UUID) -> URL {
    root.appendingPathComponent("project-\(projectId.uuidString.lowercased()).json")
  }
}

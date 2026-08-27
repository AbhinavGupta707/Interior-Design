import CryptoKit
import Foundation

protocol C14_8ProtectedCaptureStoring: Sendable {
  func clear(projectId: UUID) async throws
  func load(projectId: UUID) async throws -> C14_8GuidedCaptureDraft?
  func recordMediaReceipt(
    projectId: UUID,
    receipt: C14_8MediaReceipt
  ) async throws -> C14_8GuidedCaptureDraft
  func resolveDepth(projectId: UUID, handle: C14_8DepthHandle) async throws -> URL
  func save(_ draft: C14_8GuidedCaptureDraft) async throws
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
    guard current.keyframes.contains(where: {
      $0.localIdentifier == receipt.localIdentifier
        && $0.byteSize == receipt.receipt.byteSize
        && $0.sha256 == receipt.receipt.sha256
    }) else { throw C14_8ProtectedStoreError.corrupt }
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
    guard url.deletingLastPathComponent().standardizedFileURL
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

  private func depthURL(_ projectId: UUID, _ identifier: UUID) -> URL {
    depthDirectory(projectId).appendingPathComponent(identifier.uuidString.lowercased())
  }
}

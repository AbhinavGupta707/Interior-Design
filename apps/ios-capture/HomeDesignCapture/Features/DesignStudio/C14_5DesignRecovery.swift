import Foundation

struct C14_5RecoverySummary: Codable, Equatable, Sendable {
  let confirmedBranchId: UUID?
  let designEligible: Bool
  let latestRenderJobId: UUID?
  let latestRenderState: String?
  let optionJobId: UUID?
  let projectId: UUID
  let sceneJobId: UUID?
  let snapshotId: UUID?
  let snapshotSha256: String?
  let verifiedAt: Date

  static func make(projectId: UUID, workspace: C14_5Workspace, now: Date = Date()) -> Self {
    C14_5RecoverySummary(
      confirmedBranchId: workspace.confirmedBranch?.id,
      designEligible: workspace.designEligible,
      latestRenderJobId: workspace.renderJobs.last?.id,
      latestRenderState: workspace.renderJobs.last?.state,
      optionJobId: workspace.options?.jobId,
      projectId: projectId,
      sceneJobId: workspace.exactSceneJob?.id,
      snapshotId: workspace.snapshot?.id,
      snapshotSha256: workspace.snapshot?.snapshotSha256,
      verifiedAt: now
    )
  }

  func validated(for expectedProjectId: UUID, now: Date = Date()) -> C14_5RecoverySummary? {
    guard projectId == expectedProjectId,
          now.timeIntervalSince(verifiedAt) >= -300,
          now.timeIntervalSince(verifiedAt) <= 30 * 24 * 60 * 60,
          latestRenderState.map(Self.allowedRenderStates.contains) ?? true,
          snapshotSha256.map(C14_5ContractValidator.sha256) ?? true
    else { return nil }
    return self
  }

  private static let allowedRenderStates: Set<String> = [
    "queued", "preparing", "rendering-safe", "validating-safe", "publishing-safe", "succeeded",
    "cancel-requested", "cancelled", "failed",
  ]
}

protocol C14_5RecoveryStoring: Sendable {
  func load(projectId: UUID) async throws -> C14_5RecoverySummary?
  func save(_ summary: C14_5RecoverySummary) async throws
}

actor C14_5ProtectedRecoveryStore: C14_5RecoveryStoring {
  private let root: URL

  init(root: URL? = nil) {
    self.root = root
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("C14_5DesignRecovery", isDirectory: true)
  }

  func load(projectId: UUID) throws -> C14_5RecoverySummary? {
    let url = recordURL(projectId: projectId)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let data = try Data(contentsOf: url, options: [.mappedIfSafe])
    guard data.count <= 4_096,
          let summary = try? JSONDecoder().decode(C14_5RecoverySummary.self, from: data),
          let validated = summary.validated(for: projectId)
    else {
      try? FileManager.default.removeItem(at: url)
      return nil
    }
    return validated
  }

  func save(_ summary: C14_5RecoverySummary) throws {
    guard summary.validated(for: summary.projectId) != nil else {
      throw C14_5DesignStudioError.invalidResponse
    }
    try FileManager.default.createDirectory(
      at: root,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    )
    let data = try JSONEncoder().encode(summary)
    guard data.count <= 4_096 else { throw C14_5DesignStudioError.invalidResponse }
    let url = recordURL(projectId: summary.projectId)
    try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: url.path
    )
  }

  private func recordURL(projectId: UUID) -> URL {
    root.appendingPathComponent(projectId.uuidString.lowercased()).appendingPathExtension("json")
  }
}

import CrossDeviceContinuityClient
import CryptoKit
import Foundation
import ImageIO

enum C14_5DesignStudioError: Error, Equatable, Sendable {
  case offline
  case expired
  case forbidden
  case notFound
  case stale
  case gone
  case rejected
  case throttled
  case unavailable
  case invalidResponse
}

enum C14_5ArtifactVerifier {
  static let maximumViewableArtifactBytes = 64 * 1_024 * 1_024

  static func verify(
    bytes: Data,
    responseMediaType: String?,
    access: C14_5ArtifactAccess,
    expected: C14_5RenderArtifact,
    expectedManifestSha256: String
  ) throws {
    let digest = Data(SHA256.hash(data: bytes)).map { String(format: "%02x", $0) }.joined()
    guard expected.byteLength <= maximumViewableArtifactBytes,
          access.byteLength <= maximumViewableArtifactBytes,
          bytes.count <= maximumViewableArtifactBytes,
          expected.id == access.artifactId,
          expected.byteLength == access.byteLength,
          expected.sha256 == access.sha256,
          expected.mediaType == access.mediaType,
          expected.role == access.role,
          expectedManifestSha256 == access.manifestSha256,
          responseMediaType == access.mediaType,
          bytes.count == access.byteLength,
          digest == access.sha256
    else { throw C14_5DesignStudioError.invalidResponse }

    guard bytes.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
          let expectedWidth = expected.widthPx,
          let expectedHeight = expected.heightPx,
          (64...4_096).contains(expectedWidth),
          (64...4_096).contains(expectedHeight),
          expectedWidth * expectedHeight <= 16_777_216,
          let source = CGImageSourceCreateWithData(bytes as CFData, nil),
          CGImageSourceGetCount(source) == 1,
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
            as? [CFString: Any],
          let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
          let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
          width == expectedWidth,
          height == expectedHeight
    else { throw C14_5DesignStudioError.invalidResponse }
  }
}

struct C14_5PendingMutationKeys: Sendable {
  struct Token: Equatable, Sendable {
    let entryId: UUID
    let issuedAt: Date
    let key: UUID
  }

  private var pendingByOperationAndFingerprint: [String: Token] = [:]

  mutating func key(operation: String, fingerprint: String) -> UUID {
    token(operation: operation, fingerprint: fingerprint).key
  }

  mutating func token(operation: String, fingerprint: String) -> Token {
    let storageKey = storageKey(operation: operation, fingerprint: fingerprint)
    if let pending = pendingByOperationAndFingerprint[storageKey] { return pending }
    let token = Token(entryId: UUID(), issuedAt: Date(), key: UUID())
    pendingByOperationAndFingerprint[storageKey] = token
    return token
  }

  mutating func complete(operation: String, fingerprint: String) {
    pendingByOperationAndFingerprint[storageKey(operation: operation, fingerprint: fingerprint)] = nil
  }

  private func storageKey(operation: String, fingerprint: String) -> String {
    "\(operation.utf8.count):\(operation)|\(fingerprint.utf8.count):\(fingerprint)"
  }
}

protocol C14_5DesignStudioServing: Sendable {
  func loadWorkspace(projectId: UUID) async throws -> C14_5Workspace
  func updateBrief(
    projectId: UUID,
    actorId: UUID,
    expectedRevision: Int,
    statement: String,
    category: String,
    classification: String
  ) async throws
  func acceptBrief(projectId: UUID, expectedRevision: Int) async throws
  func createOptions(
    projectId: UUID,
    brief: C14_5BriefRecord,
    snapshot: C14_5Snapshot
  ) async throws
  func confirmOption(
    projectId: UUID,
    job: C14_5OptionJob,
    option: C14_5DesignOption,
    set: C14_5OptionSet,
    brief: C14_5BriefRecord,
    snapshot: C14_5Snapshot
  ) async throws -> OptionConfirmation
  func createSpecification(
    projectId: UUID,
    confirmation: OptionConfirmation,
    release: C14_5CatalogRelease
  ) async throws
  func createSubstitutionPreview(
    projectId: UUID,
    specification: C14_5Specification,
    line: C14_5SpecificationLine,
    replacement: C14_5CatalogAsset
  ) async throws -> C14_5SubstitutionPreview
  func confirmSubstitution(
    projectId: UUID,
    specification: C14_5Specification,
    preview: C14_5SubstitutionPreview
  ) async throws
  func createRender(
    projectId: UUID,
    source: RenderEligibleSource,
    camera: RenderEligibleCamera,
    profileId: String
  ) async throws
  func verifiedArtifact(
    projectId: UUID,
    jobId: UUID,
    artifact: C14_5RenderArtifact,
    manifestSha256: String
  ) async throws -> C14_5VerifiedArtifact
}

actor C14_5DesignStudioAPIClient: C14_5DesignStudioServing {
  private struct Empty: Codable, Sendable {}
  private struct BriefEntryBody: Codable, Sendable {
    let category: String
    let classification: String
    let id: UUID
    let priority: Int
    let provenance: Provenance
    let roomOrLevelElementIds: [UUID]
    let statement: String
    let status: String

    struct Provenance: Codable, Sendable {
      let capturedAt: String
      let method: String
      let statedByUserId: UUID
    }
  }
  private struct BriefOperation: Codable, Sendable {
    let entry: BriefEntryBody
    let kind: String
  }
  private struct BriefUpdate: Codable, Sendable {
    let expectedRevision: Int
    let idempotencyKey: UUID
    let operations: [BriefOperation]
  }
  private struct ExpectedRevision: Codable, Sendable {
    let expectedRevision: Int
    let idempotencyKey: UUID
  }
  private struct OptionCreate: Codable, Sendable {
    let baseBrief: C14_5AcceptedBrief
    let requestedDirections: [String]
    let requestedOptionCount: Int
    let sourceModel: C14_5OptionSource
  }
  private struct OptionConfirm: Codable, Sendable {
    let expectedBriefContentSha256: String
    let expectedBriefRevision: Int
    let expectedJobVersion: Int
    let expectedOptionStatus: String
    let expectedOptionSetSha256: String
    let expectedSourceSnapshotSha256: String
    let idempotencyKey: UUID
  }
  private struct SpecificationCreate: Codable, Sendable {
    let catalogReleaseId: UUID
    let catalogReleaseSha256: String
    let confirmationId: UUID
  }
  private struct SubstitutionCreate: Codable, Sendable {
    let elementId: UUID
    let expectedBranchRevision: Int
    let expectedSpecificationRevision: Int
    let replacementAssetVersionId: UUID
  }
  private struct SubstitutionConfirm: Codable, Sendable {
    let expectedCandidateSnapshotSha256: String
    let expectedSpecificationRevision: Int
    let previewId: UUID
  }
  private struct RenderSpecification: Codable, Sendable {
    let specificationId: UUID
    let specificationRevision: Int
  }
  private struct RenderCreate: Codable, Sendable {
    let cameraId: UUID
    let enhancement: String
    let label: String
    let lightingPresetId: String
    let profileId: String
    let sourceSceneJobId: UUID
    let specification: RenderSpecification?
  }

  private let baseURL: URL
  private let tokenProvider: any C7CaptureTokenProviding
  private let session: URLSession
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()
  private var mutationKeys = C14_5PendingMutationKeys()

  init(
    baseURL: URL,
    tokenProvider: any C7CaptureTokenProviding,
    session: URLSession = C14_5DesignStudioAPIClient.ephemeralSession()
  ) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.session = session
  }

  nonisolated static func ephemeralSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    configuration.urlCache = nil
    configuration.waitsForConnectivity = false
    configuration.timeoutIntervalForRequest = 30
    return URLSession(configuration: configuration)
  }

  func loadWorkspace(projectId: UUID) async throws -> C14_5Workspace {
    let project = id(projectId)
    let session: C14_5Session = try await get("/v1/session")
    let snapshot: C14_5Snapshot? = try await optionalGet(
      "/v1/projects/\(project)/models/existing"
    )
    let branchResponse: C14_5BranchesResponse = try await get(
      "/v1/projects/\(project)/models/existing/branches"
    )
    let sceneJobResponse: C14_5SceneJobsResponse = try await get(
      "/v1/projects/\(project)/scene-jobs"
    )

    let changedBranch = snapshot.flatMap { current in
      branchResponse.branches.first {
        $0.projectId == projectId && $0.revision > 0
          && $0.headSnapshotId == current.id && $0.headSnapshotSha256 == current.snapshotSha256
          && $0.headSnapshotId != $0.sourceSnapshotId
      }
    }
    let exactSceneJob: C14_5SceneJob? = snapshot.flatMap { current in
      guard changedBranch != nil else { return nil }
      return sceneJobResponse.jobs.first {
        $0.projectId == projectId && $0.state == "succeeded"
          && $0.sceneId != nil
          && $0.request.sourceSnapshot.projectId == current.projectId
          && $0.request.sourceSnapshot.modelId == current.modelId
          && $0.request.sourceSnapshot.profile == "existing"
          && $0.request.sourceSnapshot.schemaVersion == current.schemaVersion
          && $0.request.sourceSnapshot.snapshotId == current.id
          && $0.request.sourceSnapshot.snapshotSha256 == current.snapshotSha256
      }
    }
    let scene: C14_5Scene?
    if let exactSceneJob {
      scene = try await optionalGet(
        "/v1/projects/\(project)/scene-jobs/\(id(exactSceneJob.id))/scene"
      )
    } else {
      scene = nil
    }

    let prerequisiteWorkspace = C14_5Workspace(
      session: session,
      snapshot: snapshot,
      branches: branchResponse.branches,
      sceneJobs: sceneJobResponse.jobs,
      scene: scene,
      brief: nil,
      optionJobs: [],
      options: nil,
      recoveredConfirmation: nil,
      catalogReleases: [],
      catalogAssets: [],
      specifications: [],
      eligibleSources: nil,
      renderCapabilities: nil,
      renderJobs: [],
      renderResult: nil
    )
    try C14_5ContractValidator.validate(prerequisiteWorkspace, projectId: projectId)
    guard prerequisiteWorkspace.designEligible else { return prerequisiteWorkspace }

    let brief = try await loadBrief(projectId: projectId)
    let optionJobsResponse: C14_5OptionJobsResponse = try await get(
      "/v1/projects/\(project)/design-option-jobs"
    )
    guard optionJobsResponse.projectId == projectId else {
      throw C14_5DesignStudioError.invalidResponse
    }
    let exactOptionJob = optionJobsResponse.jobs.reversed().first { job in
      guard let brief, let snapshot else { return false }
      return brief.brief.status == "accepted"
        && job.state == "succeeded"
        && job.baseBrief.briefId == brief.brief.id
        && job.baseBrief.revision == brief.brief.revision
        && job.baseBrief.contentSha256 == brief.contentSha256
        && job.sourceModel.modelId == snapshot.modelId
        && job.sourceModel.snapshotId == snapshot.id
        && job.sourceModel.snapshotSha256 == snapshot.snapshotSha256
        && job.sourceModel.snapshotVersion == snapshot.version
    }
    let options: C14_5OptionsResponse?
    if let exactOptionJob {
      let response: C14_5OptionsResponse? = try await optionalGet(
        "/v1/projects/\(project)/design-option-jobs/\(id(exactOptionJob.id))/options"
      )
      guard response?.jobId == exactOptionJob.id,
            response?.projectId == projectId
      else { throw C14_5DesignStudioError.invalidResponse }
      options = response
    } else {
      options = nil
    }
    let confirmedOption = options?.options.first(where: { $0.status == "confirmed" })
    let recoveredConfirmation: OptionConfirmation?
    if let confirmedOption, let exactOptionJob {
      recoveredConfirmation = try await getConfirmation(
        projectId: projectId,
        jobId: exactOptionJob.id,
        optionId: confirmedOption.id
      )
    } else {
      recoveredConfirmation = nil
    }

    let releasesResponse: C14_5CatalogReleasesResponse = try await get(
      "/v1/projects/\(project)/catalog/releases"
    )
    let releasesValid = releasesResponse.releases.allSatisfy {
      C14_5ContractValidator.sha256($0.manifestSha256)
    }
    guard releasesResponse.releases.count <= 512,
          releasesValid
    else { throw C14_5DesignStudioError.invalidResponse }
    let release = releasesResponse.releases.last(where: { $0.status == "published" })
    let assets: [C14_5CatalogAsset]
    if let release {
      let response: C14_5CatalogAssetsResponse = try await get(
        "/v1/projects/\(project)/catalog/releases/\(id(release.releaseId))/assets?limit=24&rights=approved&source=all"
      )
      let assetsValid = response.assets.allSatisfy {
        $0.rights.review.state == "approved"
          && C14_5ContractValidator.sha256($0.versionSha256)
      }
      guard response.releaseId == release.releaseId, response.assets.count <= 24,
            assetsValid
      else { throw C14_5DesignStudioError.invalidResponse }
      assets = response.assets
    } else {
      assets = []
    }

    let specificationsResponse: C14_5SpecificationsResponse = try await get(
      "/v1/projects/\(project)/specifications"
    )
    guard specificationsResponse.projectId == projectId else {
      throw C14_5DesignStudioError.invalidResponse
    }
    let eligibleSources = try await listEligibleSources(projectId: projectId)
    let capabilities: C14_5RenderCapabilities = try await get(
      "/v1/projects/\(project)/render-capabilities"
    )
    let renderJobsResponse: C14_5RenderJobsResponse = try await get(
      "/v1/projects/\(project)/render-jobs"
    )
    let succeededRender = renderJobsResponse.jobs.first { $0.state == "succeeded" }
    let renderResult: C14_5RenderResult?
    if let succeededRender {
      renderResult = try await optionalGet(
        "/v1/projects/\(project)/render-jobs/\(id(succeededRender.id))/result"
      )
    } else {
      renderResult = nil
    }

    let workspace = C14_5Workspace(
      session: session,
      snapshot: snapshot,
      branches: branchResponse.branches,
      sceneJobs: sceneJobResponse.jobs,
      scene: scene,
      brief: brief,
      optionJobs: optionJobsResponse.jobs,
      options: options,
      recoveredConfirmation: recoveredConfirmation,
      catalogReleases: releasesResponse.releases,
      catalogAssets: assets,
      specifications: specificationsResponse.specifications,
      eligibleSources: eligibleSources,
      renderCapabilities: capabilities,
      renderJobs: renderJobsResponse.jobs,
      renderResult: renderResult
    )
    try C14_5ContractValidator.validate(workspace, projectId: projectId)
    return workspace
  }

  func updateBrief(
    projectId: UUID,
    actorId: UUID,
    expectedRevision: Int,
    statement: String,
    category: String,
    classification: String
  ) async throws {
    let trimmed = statement.trimmingCharacters(in: .whitespacesAndNewlines)
    guard expectedRevision >= 0,
          C14_5ContractValidator.bounded(trimmed, maximum: 500),
          Self.briefCategories.contains(category),
          Self.briefClassifications.contains(classification)
    else { throw C14_5DesignStudioError.rejected }
    let mutationFingerprint = fingerprint([
      id(projectId), id(actorId), String(expectedRevision), category, classification, trimmed,
    ])
    let pending = mutationKeys.token(
      operation: "brief.update",
      fingerprint: mutationFingerprint
    )
    let key = pending.key
    let body = BriefUpdate(
      expectedRevision: expectedRevision,
      idempotencyKey: key,
      operations: [
        BriefOperation(
          entry: BriefEntryBody(
            category: category,
            classification: classification,
            id: pending.entryId,
            priority: classification == "hard-constraint" ? 1 : 3,
            provenance: BriefEntryBody.Provenance(
              capturedAt: ISO8601DateFormatter().string(from: pending.issuedAt),
              method: "user-stated",
              statedByUserId: actorId
            ),
            roomOrLevelElementIds: [],
            statement: trimmed,
            status: "active"
          ),
          kind: "entry.add"
        ),
      ]
    )
    let response = try await sendRaw(
      path: "/v1/projects/\(id(projectId))/design-brief",
      method: "PUT",
      body: body,
      idempotencyKey: nil
    )
    let brief: C14_5Brief = try decode(response.data)
    try validateBrief(brief, projectId: projectId, expectedMinimumRevision: expectedRevision + 1)
    try validateBriefHash(response.response)
    mutationKeys.complete(operation: "brief.update", fingerprint: mutationFingerprint)
  }

  func acceptBrief(projectId: UUID, expectedRevision: Int) async throws {
    guard expectedRevision > 0 else { throw C14_5DesignStudioError.rejected }
    let mutationFingerprint = fingerprint([id(projectId), String(expectedRevision)])
    let key = mutationKeys.key(
      operation: "brief.accept",
      fingerprint: mutationFingerprint
    )
    let response = try await sendRaw(
      path: "/v1/projects/\(id(projectId))/design-brief/accept",
      method: "POST",
      body: ExpectedRevision(expectedRevision: expectedRevision, idempotencyKey: key),
      idempotencyKey: nil
    )
    let brief: C14_5Brief = try decode(response.data)
    try validateBrief(brief, projectId: projectId, expectedMinimumRevision: expectedRevision + 1)
    guard brief.status == "accepted" else { throw C14_5DesignStudioError.invalidResponse }
    try validateBriefHash(response.response)
    mutationKeys.complete(operation: "brief.accept", fingerprint: mutationFingerprint)
  }

  func createOptions(
    projectId: UUID,
    brief: C14_5BriefRecord,
    snapshot: C14_5Snapshot
  ) async throws {
    guard brief.brief.projectId == projectId, brief.brief.status == "accepted",
          snapshot.projectId == projectId, snapshot.profile == "existing"
    else { throw C14_5DesignStudioError.rejected }
    let body = OptionCreate(
      baseBrief: C14_5AcceptedBrief(
        briefId: brief.brief.id,
        contentSha256: brief.contentSha256,
        revision: brief.brief.revision
      ),
      requestedDirections: ["circulation-first", "storage-first"],
      requestedOptionCount: 2,
      sourceModel: C14_5OptionSource(
        modelId: snapshot.modelId,
        profile: "existing",
        snapshotId: snapshot.id,
        snapshotSha256: snapshot.snapshotSha256,
        snapshotVersion: snapshot.version
      )
    )
    let mutationFingerprint = fingerprint([
      id(projectId), id(brief.brief.id), String(brief.brief.revision), brief.contentSha256,
      id(snapshot.id), snapshot.snapshotSha256, String(snapshot.version),
    ])
    let key = mutationKeys.key(
      operation: "options.create",
      fingerprint: mutationFingerprint
    )
    let job: C14_5OptionJob = try await post(
      "/v1/projects/\(id(projectId))/design-option-jobs",
      body: body,
      idempotencyKey: key
    )
    guard job.projectId == projectId, job.baseBrief == body.baseBrief,
          job.sourceModel == body.sourceModel, job.requestedOptionCount == 2
    else { throw C14_5DesignStudioError.invalidResponse }
    mutationKeys.complete(operation: "options.create", fingerprint: mutationFingerprint)
  }

  func confirmOption(
    projectId: UUID,
    job: C14_5OptionJob,
    option: C14_5DesignOption,
    set: C14_5OptionSet,
    brief: C14_5BriefRecord,
    snapshot: C14_5Snapshot
  ) async throws -> OptionConfirmation {
    guard job.projectId == projectId, option.projectId == projectId,
          option.jobId == job.id, option.status == "pending",
          set.projectId == projectId, set.jobId == job.id, set.optionIds.contains(option.id),
          brief.brief.projectId == projectId, brief.brief.status == "accepted",
          job.baseBrief.briefId == brief.brief.id,
          job.baseBrief.revision == brief.brief.revision,
          job.baseBrief.contentSha256 == brief.contentSha256,
          snapshot.projectId == projectId,
          job.sourceModel.modelId == snapshot.modelId,
          job.sourceModel.profile == snapshot.profile,
          job.sourceModel.snapshotId == snapshot.id,
          job.sourceModel.snapshotSha256 == snapshot.snapshotSha256,
          job.sourceModel.snapshotVersion == snapshot.version
    else { throw C14_5DesignStudioError.rejected }
    let mutationFingerprint = fingerprint([
      id(projectId), id(job.id), String(job.version), id(option.id), set.setSha256,
      id(brief.brief.id), String(brief.brief.revision), brief.contentSha256,
      id(snapshot.id), snapshot.snapshotSha256, String(snapshot.version),
    ])
    let key = mutationKeys.key(
      operation: "options.confirm",
      fingerprint: mutationFingerprint
    )
    let body = OptionConfirm(
      expectedBriefContentSha256: brief.contentSha256,
      expectedBriefRevision: brief.brief.revision,
      expectedJobVersion: job.version,
      expectedOptionStatus: "pending",
      expectedOptionSetSha256: set.setSha256,
      expectedSourceSnapshotSha256: snapshot.snapshotSha256,
      idempotencyKey: key
    )
    let _: OptionConfirmation = try await post(
      "/v1/projects/\(id(projectId))/design-option-jobs/\(id(job.id))/options/\(id(option.id))/confirm",
      body: body,
      idempotencyKey: key
    )
    let confirmation = try await getConfirmation(
      projectId: projectId,
      jobId: job.id,
      optionId: option.id
    )
    mutationKeys.complete(operation: "options.confirm", fingerprint: mutationFingerprint)
    return confirmation
  }

  func createSpecification(
    projectId: UUID,
    confirmation: OptionConfirmation,
    release: C14_5CatalogRelease
  ) async throws {
    guard confirmation.projectId == projectId, release.status == "published",
          C14_5ContractValidator.sha256(release.manifestSha256)
    else { throw C14_5DesignStudioError.rejected }
    let mutationFingerprint = fingerprint([
      id(projectId), id(confirmation.id), confirmation.resultSnapshotSha256,
      id(release.releaseId), release.manifestSha256,
    ])
    let key = mutationKeys.key(
      operation: "specification.create",
      fingerprint: mutationFingerprint
    )
    let specification: C14_5Specification = try await post(
      "/v1/projects/\(id(projectId))/specifications/from-c12-confirmation",
      body: SpecificationCreate(
        catalogReleaseId: release.releaseId,
        catalogReleaseSha256: release.manifestSha256,
        confirmationId: confirmation.id
      ),
      idempotencyKey: key
    )
    guard specification.projectId == projectId,
          specification.currentRevision.sourceConfirmation.confirmationId == confirmation.id
    else { throw C14_5DesignStudioError.invalidResponse }
    mutationKeys.complete(operation: "specification.create", fingerprint: mutationFingerprint)
  }

  func createSubstitutionPreview(
    projectId: UUID,
    specification: C14_5Specification,
    line: C14_5SpecificationLine,
    replacement: C14_5CatalogAsset
  ) async throws -> C14_5SubstitutionPreview {
    guard specification.projectId == projectId,
          specification.currentRevision.lines.contains(where: { $0.lineId == line.lineId }),
          replacement.rights.review.state == "approved",
          replacement.kind == line.kind,
          replacement.versionId != line.assetVersionId
    else { throw C14_5DesignStudioError.rejected }
    let mutationFingerprint = fingerprint([
      id(projectId), id(specification.id), String(specification.currentRevision.revision),
      String(specification.currentRevision.branchRevision), id(line.lineId), id(line.elementId),
      id(replacement.versionId), replacement.versionSha256,
    ])
    let key = mutationKeys.key(
      operation: "substitution.preview",
      fingerprint: mutationFingerprint
    )
    let preview: C14_5SubstitutionPreview = try await post(
      "/v1/projects/\(id(projectId))/specifications/\(id(specification.id))/substitutions",
      body: SubstitutionCreate(
        elementId: line.elementId,
        expectedBranchRevision: specification.currentRevision.branchRevision,
        expectedSpecificationRevision: specification.currentRevision.revision,
        replacementAssetVersionId: replacement.versionId
      ),
      idempotencyKey: key
    )
    guard preview.specificationId == specification.id,
          preview.specificationRevision == specification.currentRevision.revision,
          preview.elementId == line.elementId,
          preview.replacementAssetVersionId == replacement.versionId,
          preview.schemaVersion == "c13-substitution-preview-v1",
          C14_5ContractValidator.sha256(preview.candidateSnapshotSha256)
    else { throw C14_5DesignStudioError.invalidResponse }
    mutationKeys.complete(operation: "substitution.preview", fingerprint: mutationFingerprint)
    return preview
  }

  func confirmSubstitution(
    projectId: UUID,
    specification: C14_5Specification,
    preview: C14_5SubstitutionPreview
  ) async throws {
    guard specification.projectId == projectId,
          preview.specificationId == specification.id,
          preview.specificationRevision == specification.currentRevision.revision
    else { throw C14_5DesignStudioError.rejected }
    let mutationFingerprint = fingerprint([
      id(projectId), id(specification.id), String(specification.currentRevision.revision),
      id(preview.id), preview.candidateSnapshotSha256,
    ])
    let key = mutationKeys.key(
      operation: "substitution.confirm",
      fingerprint: mutationFingerprint
    )
    let confirmation: C14_5SubstitutionConfirmation = try await post(
      "/v1/projects/\(id(projectId))/specifications/\(id(specification.id))/substitutions/\(id(preview.id))/confirm",
      body: SubstitutionConfirm(
        expectedCandidateSnapshotSha256: preview.candidateSnapshotSha256,
        expectedSpecificationRevision: specification.currentRevision.revision,
        previewId: preview.id
      ),
      idempotencyKey: key
    )
    guard confirmation.specificationId == specification.id,
          confirmation.specificationRevision == specification.currentRevision.revision + 1,
          confirmation.schemaVersion == "c13-substitution-confirmation-v1",
          C14_5ContractValidator.sha256(confirmation.resultSnapshotSha256)
    else { throw C14_5DesignStudioError.invalidResponse }
    mutationKeys.complete(operation: "substitution.confirm", fingerprint: mutationFingerprint)
  }

  func createRender(
    projectId: UUID,
    source: RenderEligibleSource,
    camera: RenderEligibleCamera,
    profileId: String
  ) async throws {
    guard source.source.projectId == projectId,
          source.cameras.contains(camera), Self.renderProfiles.contains(profileId)
    else { throw C14_5DesignStudioError.rejected }
    let specification = source.source.specification.map {
      RenderSpecification(
        specificationId: $0.specificationId,
        specificationRevision: $0.specificationRevision
      )
    }
    let mutationFingerprint = fingerprint([
      id(projectId), id(source.source.sceneJobId), source.source.sceneManifestSha256,
      source.source.sourceSnapshotSha256, id(camera.cameraId), profileId,
      specification.map { id($0.specificationId) } ?? "none",
      specification.map { String($0.specificationRevision) } ?? "none",
    ])
    let key = mutationKeys.key(
      operation: "render.create",
      fingerprint: mutationFingerprint
    )
    let job: C14_5RenderJob = try await post(
      "/v1/projects/\(id(projectId))/render-jobs",
      body: RenderCreate(
        cameraId: camera.cameraId,
        enhancement: "disabled",
        label: "Native homeowner geometry-safe still",
        lightingPresetId: "canonical-lights-neutral-world-v1",
        profileId: profileId,
        sourceSceneJobId: source.source.sceneJobId,
        specification: specification
      ),
      idempotencyKey: key
    )
    guard job.projectId == projectId,
          job.request.cameraId == camera.cameraId,
          job.request.sourceSceneJobId == source.source.sceneJobId,
          job.request.profileId == profileId,
          job.request.enhancement == "disabled"
    else { throw C14_5DesignStudioError.invalidResponse }
    mutationKeys.complete(operation: "render.create", fingerprint: mutationFingerprint)
  }

  func verifiedArtifact(
    projectId: UUID,
    jobId: UUID,
    artifact: C14_5RenderArtifact,
    manifestSha256: String
  ) async throws -> C14_5VerifiedArtifact {
    guard artifact.role == "geometry-safe-png" || artifact.role == "illustrative-enhancement-png",
          artifact.mediaType == "image/png", artifact.byteLength > 0,
          artifact.byteLength <= C14_5ArtifactVerifier.maximumViewableArtifactBytes,
          C14_5ContractValidator.sha256(artifact.sha256),
          C14_5ContractValidator.sha256(manifestSha256)
    else { throw C14_5DesignStudioError.rejected }
    let access: C14_5ArtifactAccess = try await post(
      "/v1/projects/\(id(projectId))/render-jobs/\(id(jobId))/artifacts/\(id(artifact.id))/access",
      body: Empty(),
      idempotencyKey: nil
    )
    guard access.artifactId == artifact.id,
          access.byteLength == artifact.byteLength,
          access.mediaType == artifact.mediaType,
          access.role == artifact.role,
          access.sha256 == artifact.sha256,
          access.manifestSha256 == manifestSha256,
          access.byteLength <= C14_5ArtifactVerifier.maximumViewableArtifactBytes,
          C14_5ContractValidator.timestamp(access.expiresAt).map({ $0 > Date() }) == true,
          Self.allowedAccessURL(access.url)
    else { throw C14_5DesignStudioError.invalidResponse }
    do {
      var request = URLRequest(
        url: access.url,
        cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
        timeoutInterval: 30
      )
      request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
      let (stream, response) = try await session.bytes(for: request)
      guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw C14_5DesignStudioError.invalidResponse
      }
      guard let finalURL = http.url, Self.allowedAccessURL(finalURL),
            http.expectedContentLength == -1
              || http.expectedContentLength == Int64(access.byteLength)
      else { throw C14_5DesignStudioError.invalidResponse }
      var bytes = Data(capacity: access.byteLength)
      for try await byte in stream {
        guard bytes.count < access.byteLength,
              bytes.count < C14_5ArtifactVerifier.maximumViewableArtifactBytes
        else { throw C14_5DesignStudioError.invalidResponse }
        bytes.append(byte)
      }
      try C14_5ArtifactVerifier.verify(
        bytes: bytes,
        responseMediaType: http.mimeType,
        access: access,
        expected: artifact,
        expectedManifestSha256: manifestSha256
      )
      return C14_5VerifiedArtifact(access: access, bytes: bytes)
    } catch let error as C14_5DesignStudioError {
      throw error
    } catch let error as URLError where error.code == .notConnectedToInternet {
      throw C14_5DesignStudioError.offline
    } catch {
      throw C14_5DesignStudioError.unavailable
    }
  }

  private func loadBrief(projectId: UUID) async throws -> C14_5BriefRecord? {
    guard let response = try await optionalRawGet(
      "/v1/projects/\(id(projectId))/design-brief"
    ) else { return nil }
    let brief: C14_5Brief = try decode(response.data)
    try validateBrief(brief, projectId: projectId, expectedMinimumRevision: 1)
    let hash = try briefHash(response.response)
    return C14_5BriefRecord(brief: brief, contentSha256: hash)
  }

  private func getConfirmation(
    projectId: UUID,
    jobId: UUID,
    optionId: UUID
  ) async throws -> OptionConfirmation {
    for attempt in 0...1 {
      let client = CrossDeviceContinuityClient(
        baseURL: baseURL,
        session: session,
        bearerToken: { [tokenProvider] in try await tokenProvider.accessToken() }
      )
      do {
        return try await client.getOptionConfirmation(
          projectId: projectId,
          jobId: jobId,
          optionId: optionId
        )
      } catch ContinuityClientError.requestFailed(status: 401) where attempt == 0 {
        await tokenProvider.invalidate()
      } catch ContinuityClientError.requestFailed(let status) {
        throw statusError(status)
      } catch is ContinuityClientError {
        throw C14_5DesignStudioError.invalidResponse
      } catch let error as URLError where error.code == .notConnectedToInternet {
        throw C14_5DesignStudioError.offline
      } catch {
        throw C14_5DesignStudioError.unavailable
      }
    }
    throw C14_5DesignStudioError.expired
  }

  private func listEligibleSources(projectId: UUID) async throws -> RenderEligibleSourcesResponse {
    for attempt in 0...1 {
      let client = CrossDeviceContinuityClient(
        baseURL: baseURL,
        session: session,
        bearerToken: { [tokenProvider] in try await tokenProvider.accessToken() }
      )
      do {
        return try await client.listRenderEligibleSources(projectId: projectId)
      } catch ContinuityClientError.requestFailed(status: 401) where attempt == 0 {
        await tokenProvider.invalidate()
      } catch ContinuityClientError.requestFailed(let status) {
        throw statusError(status)
      } catch is ContinuityClientError {
        throw C14_5DesignStudioError.invalidResponse
      } catch let error as URLError where error.code == .notConnectedToInternet {
        throw C14_5DesignStudioError.offline
      } catch {
        throw C14_5DesignStudioError.unavailable
      }
    }
    throw C14_5DesignStudioError.expired
  }

  private func get<Response: Decodable & Sendable>(_ path: String) async throws -> Response {
    try decode(try await sendRaw(path: path, method: "GET").data)
  }

  private func optionalGet<Response: Decodable & Sendable>(
    _ path: String
  ) async throws -> Response? {
    guard let response = try await optionalRawGet(path) else { return nil }
    return try decode(response.data)
  }

  private func post<Body: Encodable & Sendable, Response: Decodable & Sendable>(
    _ path: String,
    body: Body,
    idempotencyKey: UUID?
  ) async throws -> Response {
    try decode(
      try await sendRaw(
        path: path,
        method: "POST",
        body: body,
        idempotencyKey: idempotencyKey
      ).data
    )
  }

  private func optionalRawGet(
    _ path: String
  ) async throws -> (data: Data, response: HTTPURLResponse)? {
    do {
      return try await sendRaw(path: path, method: "GET")
    } catch C14_5DesignStudioError.notFound {
      return nil
    }
  }

  private func sendRaw(
    path: String,
    method: String
  ) async throws -> (data: Data, response: HTTPURLResponse) {
    try await sendRaw(path: path, method: method, bodyData: nil, idempotencyKey: nil)
  }

  private func sendRaw<Body: Encodable & Sendable>(
    path: String,
    method: String,
    body: Body,
    idempotencyKey: UUID?
  ) async throws -> (data: Data, response: HTTPURLResponse) {
    try await sendRaw(
      path: path,
      method: method,
      bodyData: try encoder.encode(body),
      idempotencyKey: idempotencyKey
    )
  }

  private func sendRaw(
    path: String,
    method: String,
    bodyData: Data?,
    idempotencyKey: UUID?
  ) async throws -> (data: Data, response: HTTPURLResponse) {
    guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
          url.scheme == "https"
            || (url.scheme == "http" && ["127.0.0.1", "::1", "localhost"].contains(url.host ?? ""))
    else { throw C14_5DesignStudioError.invalidResponse }
    for attempt in 0...1 {
      let token: String
      do {
        token = try await tokenProvider.accessToken()
      } catch {
        throw C14_5DesignStudioError.expired
      }
      guard token.count >= 32, !token.contains("\n"), !token.contains("\r") else {
        throw C14_5DesignStudioError.invalidResponse
      }
      var request = URLRequest(
        url: url,
        cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
        timeoutInterval: 30
      )
      request.httpMethod = method
      request.setValue("application/json, application/problem+json", forHTTPHeaderField: "Accept")
      request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      if let bodyData {
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      }
      if let idempotencyKey {
        request.setValue(id(idempotencyKey), forHTTPHeaderField: "Idempotency-Key")
      }
      do {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
          throw C14_5DesignStudioError.invalidResponse
        }
        if http.statusCode == 401, attempt == 0 {
          await tokenProvider.invalidate()
          continue
        }
        guard (200..<300).contains(http.statusCode) else {
          throw statusError(http.statusCode)
        }
        guard data.count <= 4_000_000 else {
          throw C14_5DesignStudioError.invalidResponse
        }
        return (data, http)
      } catch let error as C14_5DesignStudioError {
        throw error
      } catch let error as URLError where error.code == .notConnectedToInternet {
        throw C14_5DesignStudioError.offline
      } catch {
        throw C14_5DesignStudioError.unavailable
      }
    }
    throw C14_5DesignStudioError.expired
  }

  private func decode<Response: Decodable & Sendable>(_ data: Data) throws -> Response {
    do { return try decoder.decode(Response.self, from: data) }
    catch { throw C14_5DesignStudioError.invalidResponse }
  }

  private func validateBrief(
    _ brief: C14_5Brief,
    projectId: UUID,
    expectedMinimumRevision: Int
  ) throws {
    let entriesValid = brief.entries.allSatisfy {
      Self.briefCategories.contains($0.category)
        && Self.briefClassifications.contains($0.classification)
        && (1...5).contains($0.priority)
        && C14_5ContractValidator.bounded($0.statement, maximum: 500)
    }
    guard brief.projectId == projectId,
          brief.schemaVersion == "c11-design-brief-v1",
          brief.revision >= expectedMinimumRevision,
          brief.entries.count <= 500,
          entriesValid
    else { throw C14_5DesignStudioError.invalidResponse }
  }

  private func validateBriefHash(_ response: HTTPURLResponse) throws {
    _ = try briefHash(response)
  }

  private func briefHash(_ response: HTTPURLResponse) throws -> String {
    guard let hash = response.value(forHTTPHeaderField: "x-interior-design-brief-content-sha256"),
          C14_5ContractValidator.sha256(hash)
    else { throw C14_5DesignStudioError.invalidResponse }
    return hash
  }

  private nonisolated func statusError(_ status: Int) -> C14_5DesignStudioError {
    switch status {
    case 401: .expired
    case 403: .forbidden
    case 404: .notFound
    case 409: .stale
    case 410: .gone
    case 422: .rejected
    case 429: .throttled
    case 500..<600: .unavailable
    default: .invalidResponse
    }
  }

  private nonisolated func id(_ value: UUID) -> String {
    value.uuidString.lowercased()
  }

  private nonisolated func fingerprint(_ components: [String]) -> String {
    components.map { "\($0.utf8.count):\($0)" }.joined(separator: "|")
  }

  private nonisolated static func allowedAccessURL(_ url: URL) -> Bool {
    guard url.user == nil, url.password == nil, url.fragment == nil,
          let host = url.host, !host.isEmpty
    else { return false }
    return url.scheme == "https"
      || (url.scheme == "http" && ["127.0.0.1", "::1", "localhost"].contains(host))
  }

  private nonisolated static let briefCategories: Set<String> = [
    "accessibility", "adjacency", "cooking-dining", "daylight-view", "decision-criterion",
    "disruption-timing", "entertaining", "garden-outdoor", "household-change",
    "material-colour", "minimum-dimension", "other", "privacy", "professional-review",
    "reference", "retained-item", "spatial-need", "storage", "style-aesthetic",
    "sustainability", "work-study", "acoustics", "budget-category",
  ]
  private nonisolated static let briefClassifications: Set<String> = [
    "hard-constraint", "household-assertion", "preference", "unknown",
  ]
  private nonisolated static let renderProfiles: Set<String> = [
    "eevee-local-preview-v1", "cycles-cpu-geometry-safe-v1",
    "cycles-metal-geometry-safe-v1", "cycles-cuda-high-resolution-v1",
    "cycles-optix-high-resolution-v1",
  ]
}

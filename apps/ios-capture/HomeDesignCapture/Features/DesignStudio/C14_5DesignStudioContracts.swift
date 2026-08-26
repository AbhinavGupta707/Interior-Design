import CrossDeviceContinuityClient
import Foundation

enum C14_5MemberRole: String, Codable, Sendable {
  case owner
  case editor
  case viewer

  var canMutate: Bool { self != .viewer }
}

struct C14_5Actor: Codable, Equatable, Sendable {
  let displayName: String
  let role: C14_5MemberRole
  let subject: String
  let tenantId: UUID
  let userId: UUID
}

struct C14_5Session: Codable, Equatable, Sendable {
  let actor: C14_5Actor
  let authMode: String
  let expiresAt: String
}

struct C14_5Snapshot: Codable, Equatable, Sendable {
  let id: UUID
  let modelId: UUID
  let profile: String
  let projectId: UUID
  let schemaVersion: String
  let snapshotSha256: String
  let version: Int
}

struct C14_5Branch: Codable, Equatable, Identifiable, Sendable {
  let headSnapshotId: UUID
  let headSnapshotSha256: String
  let id: UUID
  let modelId: UUID
  let profile: String
  let projectId: UUID
  let revision: Int
  let sourceSnapshotId: UUID
}

struct C14_5BranchesResponse: Codable, Equatable, Sendable {
  let branches: [C14_5Branch]
}

struct C14_5SnapshotReference: Codable, Equatable, Sendable {
  let modelId: UUID
  let profile: String
  let projectId: UUID
  let schemaVersion: String
  let snapshotId: UUID
  let snapshotSha256: String
}

struct C14_5SceneJobRequest: Codable, Equatable, Sendable {
  let label: String
  let sourceSnapshot: C14_5SnapshotReference
}

struct C14_5SceneJob: Codable, Equatable, Identifiable, Sendable {
  let id: UUID
  let projectId: UUID
  let request: C14_5SceneJobRequest
  let safeCode: String?
  let sceneId: UUID?
  let state: String
  let version: Int
}

struct C14_5SceneJobsResponse: Codable, Equatable, Sendable {
  let jobs: [C14_5SceneJob]
}

struct C14_5PointMm: Codable, Equatable, Sendable {
  let xMm: Int
  let yMm: Int
  let zMm: Int
}

struct C14_5SceneBounds: Codable, Equatable, Sendable {
  let maximum: C14_5PointMm
  let minimum: C14_5PointMm
}

struct C14_5SceneCounts: Codable, Equatable, Sendable {
  let materials: Int
  let meshes: Int
  let nodes: Int
  let triangles: Int
  let vertices: Int
}

struct C14_5SceneMapping: Codable, Equatable, Identifiable, Sendable {
  let elementId: UUID
  let elementType: String
  let status: String

  var id: UUID { elementId }
}

struct C14_5SceneFinding: Codable, Equatable, Identifiable, Sendable {
  let code: String
  let detail: String
  let severity: String

  var id: String { code }
}

struct C14_5SceneManifest: Codable, Equatable, Sendable {
  let authority: String
  let boundsMm: C14_5SceneBounds
  let counts: C14_5SceneCounts
  let elementMappings: [C14_5SceneMapping]
  let findings: [C14_5SceneFinding]
  let schemaVersion: String
  let sourceSnapshot: C14_5SnapshotReference
}

struct C14_5SceneArtifact: Codable, Equatable, Sendable {
  let byteSize: Int
  let glbSha256: String
  let id: UUID
  let manifestSha256: String
  let mimeType: String
  let schemaVersion: String
}

struct C14_5Scene: Codable, Equatable, Identifiable, Sendable {
  let artifact: C14_5SceneArtifact
  let id: UUID
  let manifest: C14_5SceneManifest
  let projectId: UUID
}

struct C14_5BriefProvenance: Codable, Equatable, Sendable {
  let capturedAt: String
  let method: String
  let statedByUserId: UUID?
}

struct C14_5BriefEntry: Codable, Equatable, Identifiable, Sendable {
  let category: String
  let classification: String
  let id: UUID
  let priority: Int
  let provenance: C14_5BriefProvenance
  let roomOrLevelElementIds: [UUID]
  let statement: String
  let status: String
}

struct C14_5Brief: Codable, Equatable, Identifiable, Sendable {
  let entries: [C14_5BriefEntry]
  let id: UUID
  let projectId: UUID
  let revision: Int
  let schemaVersion: String
  let status: String
}

struct C14_5BriefRecord: Equatable, Sendable {
  let brief: C14_5Brief
  let contentSha256: String
}

struct C14_5AcceptedBrief: Codable, Equatable, Sendable {
  let briefId: UUID
  let contentSha256: String
  let revision: Int
}

struct C14_5OptionSource: Codable, Equatable, Sendable {
  let modelId: UUID
  let profile: String
  let snapshotId: UUID
  let snapshotSha256: String
  let snapshotVersion: Int
}

struct C14_5OptionJob: Codable, Equatable, Identifiable, Sendable {
  let baseBrief: C14_5AcceptedBrief
  let id: UUID
  let optionCount: Int
  let projectId: UUID
  let requestedDirections: [String]
  let requestedOptionCount: Int
  let safeCode: String?
  let sourceModel: C14_5OptionSource
  let state: String
  let version: Int
}

struct C14_5OptionJobsResponse: Codable, Equatable, Sendable {
  let jobs: [C14_5OptionJob]
  let projectId: UUID
}

struct C14_5OptionSet: Codable, Equatable, Sendable {
  let jobId: UUID
  let optionIds: [UUID]
  let projectId: UUID
  let schemaVersion: String
  let setSha256: String
}

struct C14_5DesignOption: Codable, Equatable, Identifiable, Sendable {
  let assumptions: [String]
  let baseBrief: C14_5AcceptedBrief
  let direction: String
  let id: UUID
  let jobId: UUID
  let projectId: UUID
  let schemaVersion: String
  let status: String
  let summary: String
  let title: String
  let tradeoffs: [String]
  let unknowns: [String]
}

struct C14_5OptionsResponse: Codable, Equatable, Sendable {
  let jobId: UUID
  let optionSet: C14_5OptionSet?
  let options: [C14_5DesignOption]
  let projectId: UUID
}

struct C14_5CatalogRelease: Codable, Equatable, Identifiable, Sendable {
  let manifestSha256: String
  let releaseId: UUID
  let schemaVersion: String
  let status: String
  let version: String

  var id: UUID { releaseId }
}

struct C14_5CatalogReleasesResponse: Codable, Equatable, Sendable {
  let releases: [C14_5CatalogRelease]
}

struct C14_5CatalogRightsReview: Codable, Equatable, Sendable {
  let state: String
}

struct C14_5CatalogRights: Codable, Equatable, Sendable {
  let review: C14_5CatalogRightsReview
  let sourceKind: String
}

struct C14_5CatalogAsset: Codable, Equatable, Identifiable, Sendable {
  let category: String
  let displayName: String
  let kind: String
  let rights: C14_5CatalogRights
  let versionId: UUID
  let versionSha256: String

  var id: UUID { versionId }
}

struct C14_5CatalogAssetsResponse: Codable, Equatable, Sendable {
  let assets: [C14_5CatalogAsset]
  let releaseId: UUID
  let total: Int
}

struct C14_5SpecificationLine: Codable, Equatable, Identifiable, Sendable {
  let assetVersionId: UUID
  let assetVersionSha256: String
  let decisionStatus: String
  let elementId: UUID
  let kind: String
  let lineId: UUID
  let notes: String

  var id: UUID { lineId }
}

struct C14_5SpecificationRevision: Codable, Equatable, Sendable {
  let branchId: UUID
  let branchRevision: Int
  let catalogReleaseId: UUID
  let catalogReleaseSha256: String
  let lines: [C14_5SpecificationLine]
  let modelSnapshotId: UUID
  let modelSnapshotSha256: String
  let revision: Int
  let revisionSha256: String
  let sourceConfirmation: C14_5ConfirmationSource
}

struct C14_5ConfirmationSource: Codable, Equatable, Sendable {
  let confirmationId: UUID
  let jobId: UUID
  let jobVersion: Int
  let optionId: UUID
  let profile: String
  let resultSnapshotId: UUID
  let resultSnapshotSha256: String
  let resultSnapshotVersion: Int
}

struct C14_5SelectionBoard: Codable, Equatable, Sendable {
  let revision: Int
}

struct C14_5Specification: Codable, Equatable, Identifiable, Sendable {
  let currentRevision: C14_5SpecificationRevision
  let projectId: UUID
  let schemaVersion: String
  let selectionBoard: C14_5SelectionBoard
  let specificationId: UUID
  let status: String

  var id: UUID { specificationId }
}

struct C14_5SpecificationsResponse: Codable, Equatable, Sendable {
  let projectId: UUID
  let specifications: [C14_5Specification]
}

struct C14_5SubstitutionPreview: Codable, Equatable, Identifiable, Sendable {
  let candidateSnapshotSha256: String
  let elementId: UUID
  let expiresAt: String
  let findings: [String]
  let previewId: UUID
  let replacementAssetVersionId: UUID
  let replacementAssetVersionSha256: String
  let schemaVersion: String
  let specificationId: UUID
  let specificationRevision: Int

  var id: UUID { previewId }
}

struct C14_5SubstitutionConfirmation: Codable, Equatable, Sendable {
  let confirmationId: UUID
  let resultSnapshotId: UUID
  let resultSnapshotSha256: String
  let sceneJobId: UUID
  let schemaVersion: String
  let specificationId: UUID
  let specificationRevision: Int
}

struct C14_5RenderProfileCapability: Codable, Equatable, Identifiable, Sendable {
  let available: Bool
  let capability: String
  let profileId: String
  let reason: String?

  var id: String { profileId }
}

struct C14_5RenderCapabilities: Codable, Equatable, Sendable {
  let acceptingNewJobs: Bool
  let enhancementProvider: String
  let hardwareEvidence: String
  let profiles: [C14_5RenderProfileCapability]
}

struct C14_5RenderRequest: Codable, Equatable, Sendable {
  let cameraId: UUID
  let enhancement: String
  let label: String
  let lightingPresetId: String
  let profileId: String
  let sourceSceneJobId: UUID
}

struct C14_5RenderJob: Codable, Equatable, Identifiable, Sendable {
  let id: UUID
  let projectId: UUID
  let request: C14_5RenderRequest
  let resultId: UUID?
  let safeCode: String?
  let state: String
  let version: Int
}

struct C14_5RenderJobsResponse: Codable, Equatable, Sendable {
  let jobs: [C14_5RenderJob]
}

struct C14_5RenderArtifact: Codable, Equatable, Identifiable, Sendable {
  let byteLength: Int
  let heightPx: Int?
  let id: UUID
  let mediaType: String
  let role: String
  let schemaVersion: String
  let sha256: String
  let widthPx: Int?
}

struct C14_5RenderManifest: Codable, Equatable, Sendable {
  let artifacts: [C14_5RenderArtifact]
  let authority: String
  let resultId: UUID
  let schemaVersion: String
}

struct C14_5RenderResult: Codable, Equatable, Identifiable, Sendable {
  let id: UUID
  let jobId: UUID
  let manifest: C14_5RenderManifest
  let manifestSha256: String
  let projectId: UUID
}

struct C14_5ArtifactAccess: Codable, Equatable, Sendable {
  let artifactId: UUID
  let byteLength: Int
  let expiresAt: String
  let manifestSha256: String
  let mediaType: String
  let role: String
  let sha256: String
  let url: URL
}

struct C14_5VerifiedArtifact: Equatable, Sendable {
  let access: C14_5ArtifactAccess
  let bytes: Data
}

struct C14_5Workspace: Equatable, Sendable {
  let session: C14_5Session
  let snapshot: C14_5Snapshot?
  let branches: [C14_5Branch]
  let sceneJobs: [C14_5SceneJob]
  let scene: C14_5Scene?
  let brief: C14_5BriefRecord?
  let optionJobs: [C14_5OptionJob]
  let options: C14_5OptionsResponse?
  let recoveredConfirmation: OptionConfirmation?
  let catalogReleases: [C14_5CatalogRelease]
  let catalogAssets: [C14_5CatalogAsset]
  let specifications: [C14_5Specification]
  let eligibleSources: RenderEligibleSourcesResponse?
  let renderCapabilities: C14_5RenderCapabilities?
  let renderJobs: [C14_5RenderJob]
  let renderResult: C14_5RenderResult?

  var currentSpecification: C14_5Specification? {
    guard let recoveredConfirmation,
          let options,
          let optionJob = optionJobs.first(where: { $0.id == options.jobId })
    else { return nil }
    return specifications.first {
      let source = $0.currentRevision.sourceConfirmation
      return source.confirmationId == recoveredConfirmation.id
        && source.jobId == optionJob.id
        && source.jobVersion == optionJob.version
        && source.optionId == recoveredConfirmation.optionId
        && source.resultSnapshotSha256 == recoveredConfirmation.resultSnapshotSha256
        && $0.currentRevision.branchId == recoveredConfirmation.branchId
        && $0.currentRevision.branchRevision >= recoveredConfirmation.branchRevision
    }
  }

  var latestRenderJob: C14_5RenderJob? { renderJobs.first }

  var confirmedBranch: C14_5Branch? {
    guard let snapshot else { return nil }
    return branches.first {
      $0.projectId == snapshot.projectId
        && $0.modelId == snapshot.modelId
        && $0.profile == "existing"
        && $0.revision > 0
        && $0.headSnapshotId == snapshot.id
        && $0.headSnapshotSha256 == snapshot.snapshotSha256
        && $0.headSnapshotId != $0.sourceSnapshotId
    }
  }

  var exactSceneJob: C14_5SceneJob? {
    guard confirmedBranch != nil, let snapshot else { return nil }
    return sceneJobs.first {
      $0.state == "succeeded"
        && $0.projectId == snapshot.projectId
        && $0.sceneId != nil
        && $0.request.sourceSnapshot.projectId == snapshot.projectId
        && $0.request.sourceSnapshot.modelId == snapshot.modelId
        && $0.request.sourceSnapshot.profile == "existing"
        && $0.request.sourceSnapshot.schemaVersion == snapshot.schemaVersion
        && $0.request.sourceSnapshot.snapshotId == snapshot.id
        && $0.request.sourceSnapshot.snapshotSha256 == snapshot.snapshotSha256
    }
  }

  var designEligible: Bool {
    guard confirmedBranch != nil, let exactSceneJob, let scene else { return false }
    return exactSceneJob.sceneId == scene.id
      && scene.manifest.sourceSnapshot == exactSceneJob.request.sourceSnapshot
  }
}

enum C14_5ContractValidator {
  static func sha256(_ value: String) -> Bool {
    value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
  }

  static func bounded(_ value: String, maximum: Int) -> Bool {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return !trimmed.isEmpty && trimmed.count <= maximum
  }

  static func validate(_ workspace: C14_5Workspace, projectId: UUID) throws {
    guard bounded(workspace.session.actor.displayName, maximum: 160),
          bounded(workspace.session.actor.subject, maximum: 512),
          bounded(workspace.session.authMode, maximum: 80),
          timestamp(workspace.session.expiresAt) != nil
    else { throw C14_5DesignStudioError.invalidResponse }
    if let snapshot = workspace.snapshot {
      guard snapshot.projectId == projectId,
            snapshot.profile == "existing",
            snapshot.schemaVersion == "c4-canonical-home-v1",
            snapshot.version > 0,
            sha256(snapshot.snapshotSha256)
      else { throw C14_5DesignStudioError.invalidResponse }
    }
    guard workspace.branches.count <= 100,
          workspace.sceneJobs.count <= 100,
          workspace.optionJobs.count <= 100,
          workspace.specifications.count <= 100,
          workspace.renderJobs.count <= 100
    else { throw C14_5DesignStudioError.invalidResponse }
    let branchesValid = workspace.branches.allSatisfy { branch in
      branch.projectId == projectId && branch.profile == "existing" && branch.revision >= 0
        && sha256(branch.headSnapshotSha256)
        && (workspace.snapshot.map { branch.modelId == $0.modelId } ?? true)
    }
    let scenesValid = workspace.sceneJobs.allSatisfy {
      $0.projectId == projectId && $0.request.sourceSnapshot.projectId == projectId && $0.version > 0
        && $0.request.sourceSnapshot.profile == "existing"
        && $0.request.sourceSnapshot.schemaVersion == "c4-canonical-home-v1"
        && sha256($0.request.sourceSnapshot.snapshotSha256)
    }
    let optionJobsValid = workspace.optionJobs.allSatisfy {
      $0.projectId == projectId && $0.version > 0 && $0.requestedOptionCount >= 2
        && sha256($0.baseBrief.contentSha256) && sha256($0.sourceModel.snapshotSha256)
    }
    let specificationsValid = workspace.specifications.allSatisfy {
      $0.projectId == projectId && $0.schemaVersion == "c13-specification-v1"
        && $0.status == "working" && $0.selectionBoard.revision > 0
        && $0.currentRevision.revision > 0 && $0.currentRevision.branchRevision > 0
        && $0.currentRevision.sourceConfirmation.profile == "proposed"
        && sha256($0.currentRevision.revisionSha256)
        && sha256($0.currentRevision.catalogReleaseSha256)
        && sha256($0.currentRevision.modelSnapshotSha256)
        && sha256($0.currentRevision.sourceConfirmation.resultSnapshotSha256)
        && $0.currentRevision.lines.count <= 1_024
        && $0.currentRevision.lines.allSatisfy {
          ["selected", "shortlisted", "rejected", "needs-review"].contains($0.decisionStatus)
            && ["furnishing", "finish", "light"].contains($0.kind)
            && $0.notes.count <= 2_000
            && sha256($0.assetVersionSha256)
        }
    }
    let renderJobsValid = workspace.renderJobs.allSatisfy {
      $0.projectId == projectId && $0.version > 0
    }
    guard branchesValid, scenesValid, optionJobsValid, specificationsValid, renderJobsValid
    else { throw C14_5DesignStudioError.invalidResponse }

    if let scene = workspace.scene {
      guard let snapshot = workspace.snapshot,
            let exactSceneJob = workspace.exactSceneJob,
            exactSceneJob.sceneId == scene.id,
            scene.projectId == projectId,
            scene.manifest.sourceSnapshot == exactSceneJob.request.sourceSnapshot,
            scene.manifest.sourceSnapshot.modelId == snapshot.modelId,
            scene.manifest.sourceSnapshot.snapshotId == snapshot.id,
            scene.manifest.sourceSnapshot.snapshotSha256 == snapshot.snapshotSha256,
            scene.manifest.authority == "derived-visualisation-only",
            scene.manifest.schemaVersion == "c10-scene-manifest-v1",
            scene.artifact.schemaVersion == "c10-scene-artifact-v1",
            scene.artifact.mimeType == "model/gltf-binary",
            sha256(scene.artifact.glbSha256), sha256(scene.artifact.manifestSha256),
            scene.manifest.counts.nodes >= 0, scene.manifest.counts.nodes <= 100_000,
            scene.manifest.counts.triangles >= 0, scene.manifest.counts.triangles <= 2_000_000,
            scene.manifest.boundsMm.minimum.xMm <= scene.manifest.boundsMm.maximum.xMm,
            scene.manifest.boundsMm.minimum.yMm <= scene.manifest.boundsMm.maximum.yMm,
            scene.manifest.boundsMm.minimum.zMm <= scene.manifest.boundsMm.maximum.zMm
      else { throw C14_5DesignStudioError.invalidResponse }
    }

    if let brief = workspace.brief {
      let entriesValid = brief.brief.entries.allSatisfy {
        bounded($0.statement, maximum: 500)
      }
      guard brief.brief.projectId == projectId,
            brief.brief.schemaVersion == "c11-design-brief-v1",
            brief.brief.revision > 0,
            sha256(brief.contentSha256),
            brief.brief.entries.count <= 500,
            entriesValid
      else { throw C14_5DesignStudioError.invalidResponse }
    }

    if let options = workspace.options {
      guard let brief = workspace.brief,
            brief.brief.status == "accepted",
            let snapshot = workspace.snapshot,
            let exactJob = workspace.optionJobs.first(where: { $0.id == options.jobId }),
            exactJob.state == "succeeded",
            exactJob.baseBrief.briefId == brief.brief.id,
            exactJob.baseBrief.revision == brief.brief.revision,
            exactJob.baseBrief.contentSha256 == brief.contentSha256,
            exactJob.sourceModel.modelId == snapshot.modelId,
            exactJob.sourceModel.profile == snapshot.profile,
            exactJob.sourceModel.snapshotId == snapshot.id,
            exactJob.sourceModel.snapshotSha256 == snapshot.snapshotSha256,
            exactJob.sourceModel.snapshotVersion == snapshot.version,
            let optionSet = options.optionSet
      else { throw C14_5DesignStudioError.invalidResponse }
      let optionRecordsValid = options.options.allSatisfy {
        $0.projectId == projectId && $0.jobId == options.jobId
          && $0.schemaVersion == "c12-design-option-v1"
          && $0.baseBrief == exactJob.baseBrief
          && ["pending", "confirmed", "rejected"].contains($0.status)
          && bounded($0.title, maximum: 160) && bounded($0.summary, maximum: 1_000)
      }
      let optionIds = options.options.map(\.id)
      let optionSetValid = optionSet.projectId == projectId && optionSet.jobId == options.jobId
        && optionSet.schemaVersion == "c12-design-option-set-v1"
        && Set(optionSet.optionIds) == Set(optionIds)
        && optionSet.optionIds.count == optionIds.count
        && sha256(optionSet.setSha256)
      guard options.projectId == projectId, (2...8).contains(options.options.count),
            Set(optionIds).count == optionIds.count,
            options.options.filter({ $0.status == "confirmed" }).count <= 1,
            optionRecordsValid, optionSetValid
      else { throw C14_5DesignStudioError.invalidResponse }
    }
    if let confirmation = workspace.recoveredConfirmation {
      guard let confirmedOption = workspace.options?.options.first(where: {
        $0.id == confirmation.optionId && $0.status == "confirmed"
      }),
            confirmedOption.projectId == projectId,
            confirmation.projectId == projectId,
            confirmation.schemaVersion == "c12-option-confirmation-v1",
            sha256(confirmation.resultSnapshotSha256)
      else { throw C14_5DesignStudioError.invalidResponse }
      if !workspace.specifications.isEmpty, workspace.currentSpecification == nil {
        throw C14_5DesignStudioError.invalidResponse
      }
    }

    if let eligibleSources = workspace.eligibleSources {
      guard eligibleSources.projectId == projectId else {
        throw C14_5DesignStudioError.invalidResponse
      }
    }
    if let capabilities = workspace.renderCapabilities {
      let profileIds = capabilities.profiles.map(\.profileId)
      let profilesValid = capabilities.profiles.allSatisfy {
        [
          "eevee-local-preview-v1", "cycles-cpu-geometry-safe-v1",
          "cycles-metal-geometry-safe-v1", "cycles-cuda-high-resolution-v1",
          "cycles-optix-high-resolution-v1",
        ].contains($0.profileId)
          && bounded($0.capability, maximum: 120)
          && ($0.reason.map { bounded($0, maximum: 240) } ?? true)
      }
      guard ["disabled", "enabled"].contains(capabilities.enhancementProvider),
            ["deferred", "verified-authorised-host"].contains(capabilities.hardwareEvidence),
            capabilities.profiles.count <= 5,
            Set(profileIds).count == profileIds.count,
            profilesValid
      else { throw C14_5DesignStudioError.invalidResponse }
    }
    if let result = workspace.renderResult {
      let artifactsValid = result.manifest.artifacts.allSatisfy {
        $0.byteLength > 0 && $0.byteLength <= 2 * 1_024 * 1_024 * 1_024
          && $0.schemaVersion == "c14-render-artifact-v1"
          && sha256($0.sha256)
          && ($0.widthPx.map { (64...4_096).contains($0) } ?? false)
          && ($0.heightPx.map { (64...4_096).contains($0) } ?? false)
          && (($0.role.hasSuffix("-png") && $0.mediaType == "image/png")
            || (!$0.role.hasSuffix("-png") && $0.mediaType == "image/x-exr"))
          && (($0.widthPx ?? 0) * ($0.heightPx ?? 0) <= 16_777_216)
      }
      guard let job = workspace.renderJobs.first(where: {
        $0.id == result.jobId && $0.state == "succeeded" && $0.resultId == result.id
      }),
            job.projectId == projectId,
            result.projectId == projectId,
            result.id == result.manifest.resultId,
            result.manifest.authority == "derived-visualisation-only",
            result.manifest.schemaVersion == "c14-render-output-manifest-v1",
            sha256(result.manifestSha256),
            (1...32).contains(result.manifest.artifacts.count),
            Set(result.manifest.artifacts.map(\.id)).count == result.manifest.artifacts.count,
            artifactsValid,
            result.manifest.artifacts.contains(where: { $0.role == "geometry-safe-png" })
      else { throw C14_5DesignStudioError.invalidResponse }
    }
  }

  static func timestamp(_ value: String) -> Date? {
    if let date = ISO8601DateFormatter().date(from: value) { return date }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value)
  }
}

import CryptoKit
import Foundation

protocol C14_7TwinIntegrationServing: Sendable {
  func resetPendingMutationKeys() async
  func loadWorkspace(projectId: UUID) async throws -> C14_7Workspace
  func initializeWorkspace(projectId: UUID) async throws
  func createPlanJob(projectId: UUID, asset: EvidenceAsset) async throws
  func planProposal(projectId: UUID, jobId: UUID) async throws -> C14_7PlanProposal
  func calibratePlan(
    projectId: UUID,
    jobId: UUID,
    knownLengthMillimetres: Int,
    sourceStart: C14_7SourcePoint,
    sourceEnd: C14_7SourcePoint
  ) async throws -> C14_7PlanCalibration
  func createPlanDraft(
    projectId: UUID,
    jobId: UUID,
    proposal: C14_7PlanProposal,
    calibration: C14_7PlanCalibration,
    actorUserId: UUID,
    branch: C14_5Branch,
    reviewDurationMilliseconds: Int,
    reviews: [UUID: C14_7CandidateReview]
  ) async throws -> C14_7PlanDraft
  func createReconstruction(
    projectId: UUID,
    assets: [EvidenceAsset],
    includeAppearance: Bool
  ) async throws
  func reconstructionResult(
    projectId: UUID,
    jobId: UUID
  ) async throws -> C14_7ReconstructionResult
  func createFusion(
    projectId: UUID,
    snapshot: C14_5Snapshot,
    sources: [C14_7FusionSource],
    anchors: [UUID: [C14_7FusionAnchor]]
  ) async throws
  func fusionProposal(projectId: UUID, jobId: UUID) async throws -> C14_7FusionProposal
  func reviewFusion(
    projectId: UUID,
    jobId: UUID,
    proposal: C14_7FusionProposal,
    choices: [UUID: C14_7FusionDecisionChoice]
  ) async throws -> C14_7FusionReviewResponse
  func createFusionDraft(
    projectId: UUID,
    jobId: UUID,
    proposal: C14_7FusionProposal,
    branch: C14_5Branch,
    decisionIds: [UUID]
  ) async throws -> C14_7FusionDraft
  func preview(
    projectId: UUID,
    branch: C14_5Branch,
    operations: [C14_7JSONValue]
  ) async throws -> C14_7OperationsPreview
  func commit(
    projectId: UUID,
    branch: C14_5Branch,
    preview: C14_7OperationsPreview
  ) async throws -> C14_7CommitResponse
  func createScene(projectId: UUID, snapshot: C14_5Snapshot) async throws
}

actor C14_7TwinIntegrationAPIClient: C14_7TwinIntegrationServing {
  private struct Acknowledgement: Codable, Sendable { let confirmUnmeasuredInterior: Bool }
  private struct PlanJobCreate: Codable, Sendable {
    let assetId: UUID
    let pageIndex: Int
    let parserPreference: String
  }
  private struct PlanDraftTarget: Codable, Sendable {
    let branchId: UUID
    let expectedHeadSnapshotSha256: String
    let expectedRevision: Int
    let profile: String
  }
  private struct PlanDraftCreate: Codable, Sendable {
    let acknowledgedFindingCodes: [String]
    let calibrationId: UUID
    let decisions: [C14_7PlanCandidateDecisionBody]
    let operations: [C14_7JSONValue]
    let reviewDurationMilliseconds: Int
    let target: PlanDraftTarget
  }
  private struct ReconstructionSource: Codable, Sendable {
    let assetId: UUID
    let byteSize: Int64
    let detectedMimeType: String
    let kind: String
    let sha256: String
  }
  private struct ReconstructionRights: Codable, Sendable {
    let basis: EvidenceRightsBasis
    let serviceProcessingConsent: Bool
    let trainingUseConsent: TrainingUseConsent
  }
  private struct ReconstructionCreate: Codable, Sendable {
    let appearanceMode: String
    let label: String
    let mode: String
    let registrationAnchors: [C14_7JSONValue]
    let rights: ReconstructionRights
    let sources: [ReconstructionSource]
  }
  private struct FusionAnchorBody: Codable, Sendable {
    let anchorId: UUID
    let confidenceBasisPoints: Int
    let method: String
    let projectPoint: C14_7FusionPoint
    let sourcePoint: C14_7FusionPoint
  }
  private struct FusionAnchorGroup: Codable, Sendable {
    let anchors: [FusionAnchorBody]
    let sourceId: UUID
  }
  private struct FusionBase: Codable, Sendable {
    let modelId: UUID
    let profile: String
    let snapshotId: UUID
    let snapshotSha256: String
  }
  private struct FusionCreate: Codable, Sendable {
    let anchorGroups: [FusionAnchorGroup]
    let baseSnapshot: FusionBase
    let inferencePolicy: String
    let label: String
    let sources: [C14_7FusionSource]
  }
  private struct FusionDecisionBody: Codable, Sendable {
    let choice: C14_7FusionDecisionChoice
    let correctedOperations: [C14_7JSONValue]
    let discrepancyId: UUID
    let reason: String
  }
  private struct FusionReviewBody: Codable, Sendable {
    let decisions: [FusionDecisionBody]
    let expectedProposalVersion: Int
  }
  private struct FusionDraftBody: Codable, Sendable {
    let branchId: UUID
    let decisionIds: [UUID]
    let expectedBranchRevision: Int
    let expectedHeadSnapshotSha256: String
    let expectedProposalVersion: Int
  }
  private struct PreviewBody: Codable, Sendable {
    let expectedHeadSnapshotSha256: String
    let expectedRevision: Int
    let operations: [C14_7JSONValue]
  }
  private struct CommitBody: Codable, Sendable {
    let commitMessage: String
    let expectedHeadSnapshotSha256: String
    let expectedRevision: Int
    let previewId: UUID
  }
  private struct SceneConfiguration: Encodable, Sendable {
    let coordinateMapping = "c4-z-up-to-gltf-y-up-v1"
    let geometryMode = "parametric-v1"
    let materialMode = "status-aware-neutral-v1"
    let purpose = "interactive-browser"
    let unknownGeometryPolicy = "omit-and-report"
  }
  private struct SceneCreate: Encodable, Sendable {
    let configuration = SceneConfiguration()
    let label: String
    let sourceSnapshot: C14_5SnapshotReference
  }

  private let baseURL: URL
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()
  private let evidence: any EvidenceServing
  private let session: URLSession
  private let tokenProvider: any C7CaptureTokenProviding
  private var mutationKeys = C14_5PendingMutationKeys()

  init(
    baseURL: URL,
    tokenProvider: any C7CaptureTokenProviding,
    evidence: any EvidenceServing,
    session: URLSession = C14_5DesignStudioAPIClient.ephemeralSession()
  ) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.evidence = evidence
    self.session = session
  }

  func resetPendingMutationKeys() {
    mutationKeys.reset()
  }

  func loadWorkspace(projectId: UUID) async throws -> C14_7Workspace {
    let project = id(projectId)
    async let sessionValue: C14_5Session = get("/v1/session")
    async let snapshotValue: C14_5Snapshot? = optionalGet(
      "/v1/projects/\(project)/models/existing"
    )
    async let branchesValue: C14_5BranchesResponse = get(
      "/v1/projects/\(project)/models/existing/branches"
    )
    async let planValue: C14_7PlanJobsResponse = get(
      "/v1/projects/\(project)/plan-processing-jobs"
    )
    async let reconstructionValue: C14_7ReconstructionJobsResponse = get(
      "/v1/projects/\(project)/reconstruction-jobs"
    )
    async let sourceValue: C14_7FusionSourcesResponse = get(
      "/v1/projects/\(project)/fusion-sources"
    )
    async let fusionValue: C14_7FusionJobsResponse = get(
      "/v1/projects/\(project)/fusion-jobs"
    )
    async let sceneValue: C14_5SceneJobsResponse = get(
      "/v1/projects/\(project)/scene-jobs"
    )
    async let assetValue = evidence.list(projectId: project)
    let workspace = try await C14_7Workspace(
      assets: assetValue,
      branches: branchesValue.branches,
      fusionJobs: fusionValue.jobs,
      fusionSources: sourceValue.sources,
      planJobs: planValue.jobs,
      reconstructionJobs: reconstructionValue.jobs,
      sceneJobs: sceneValue.jobs,
      session: sessionValue,
      snapshot: snapshotValue
    )
    try C14_7ContractValidator.validate(workspace, projectId: projectId)
    return workspace
  }

  func initializeWorkspace(projectId: UUID) async throws {
    let operation = "initialize-home-workspace"
    let fingerprint = id(projectId)
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let _: C14_5Snapshot = try await post(
      "/v1/projects/\(id(projectId))/models/existing/home-workspace",
      body: Acknowledgement(confirmUnmeasuredInterior: true),
      idempotencyKey: key
    )
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
  }

  func createPlanJob(projectId: UUID, asset: EvidenceAsset) async throws {
    guard asset.projectId == id(projectId), asset.kind == .plan, asset.status == .ready,
          asset.rights.serviceProcessingConsent,
          asset.rights.trainingUseConsent == .denied,
          asset.detectedMimeType.map({ EvidenceKind.plan.allowedMIMETypes.contains($0) }) == true,
          UUID(uuidString: asset.id) != nil
    else { throw C14_5DesignStudioError.rejected }
    let operation = "create-plan-job"
    let fingerprint = fingerprint([id(projectId), asset.id, asset.source.sha256])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let _: C14_7PlanJob = try await post(
      "/v1/projects/\(id(projectId))/plan-processing-jobs",
      body: PlanJobCreate(assetId: UUID(uuidString: asset.id)!, pageIndex: 0, parserPreference: "auto"),
      idempotencyKey: key
    )
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
  }

  func planProposal(projectId: UUID, jobId: UUID) async throws -> C14_7PlanProposal {
    let proposal: C14_7PlanProposal = try await get(
      "/v1/projects/\(id(projectId))/plan-processing-jobs/\(id(jobId))/proposal"
    )
    guard proposal.projectId == projectId, proposal.jobId == jobId, proposal.isValid else {
      throw C14_5DesignStudioError.invalidResponse
    }
    return proposal
  }

  func calibratePlan(
    projectId: UUID,
    jobId: UUID,
    knownLengthMillimetres: Int,
    sourceStart: C14_7SourcePoint,
    sourceEnd: C14_7SourcePoint
  ) async throws -> C14_7PlanCalibration {
    let body = try C14_7PlanOperationBuilder.calibrationBody(
      knownLengthMillimetres: knownLengthMillimetres,
      sourceStart: sourceStart,
      sourceEnd: sourceEnd
    )
    let fingerprint = fingerprint([
      id(projectId), id(jobId), String(knownLengthMillimetres),
      String(sourceStart.x), String(sourceStart.y), String(sourceEnd.x), String(sourceEnd.y),
    ])
    let operation = "calibrate-plan"
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let value: C14_7PlanCalibration = try await post(
      "/v1/projects/\(id(projectId))/plan-processing-jobs/\(id(jobId))/proposal/calibrations",
      body: body,
      idempotencyKey: key
    )
    guard value.projectId == projectId, value.jobId == jobId, value.isValid else {
      throw C14_5DesignStudioError.invalidResponse
    }
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
    return value
  }

  func createPlanDraft(
    projectId: UUID,
    jobId: UUID,
    proposal: C14_7PlanProposal,
    calibration: C14_7PlanCalibration,
    actorUserId: UUID,
    branch: C14_5Branch,
    reviewDurationMilliseconds: Int,
    reviews: [UUID: C14_7CandidateReview]
  ) async throws -> C14_7PlanDraft {
    guard proposal.projectId == projectId, calibration.projectId == projectId,
          proposal.proposalId == calibration.proposalId, branch.projectId == projectId,
          reviewDurationMilliseconds > 0, reviewDurationMilliseconds <= 86_400_000 else {
      throw C14_5DesignStudioError.stale
    }
    let built = try C14_7PlanOperationBuilder.build(
      proposal: proposal,
      calibration: calibration,
      actorUserId: actorUserId,
      reviews: reviews
    )
    let body = PlanDraftCreate(
      acknowledgedFindingCodes: Array(Set(proposal.findings.map(\.code))).sorted(),
      calibrationId: calibration.id,
      decisions: built.decisions,
      operations: built.operations,
      reviewDurationMilliseconds: reviewDurationMilliseconds,
      target: .init(
        branchId: branch.id,
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedRevision: branch.revision,
        profile: "existing"
      )
    )
    let operation = "create-plan-draft"
    let fingerprint = fingerprint([
      id(projectId), id(jobId), id(calibration.id), id(branch.id), String(branch.revision),
      branch.headSnapshotSha256, try contentSha256(built.operations),
    ])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let draft: C14_7PlanDraft = try await post(
      "/v1/projects/\(id(projectId))/plan-processing-jobs/\(id(jobId))/proposal/operation-drafts",
      body: body,
      idempotencyKey: key
    )
    guard draft.projectId == projectId, draft.jobId == jobId,
          draft.proposalId == proposal.proposalId, draft.calibrationId == calibration.id,
          draft.schemaVersion == "c6-plan-operation-draft-v1",
          draft.target.branchId == branch.id,
          draft.target.profile == "existing",
          draft.target.expectedRevision == branch.revision,
          draft.target.expectedHeadSnapshotSha256 == branch.headSnapshotSha256,
          !draft.operations.isEmpty, draft.operations == built.operations else {
      throw C14_5DesignStudioError.invalidResponse
    }
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
    return draft
  }

  func createReconstruction(
    projectId: UUID,
    assets: [EvidenceAsset],
    includeAppearance: Bool
  ) async throws {
    guard !assets.isEmpty, assets.count <= 512,
          Set(assets.map(\.rights.basis)).count == 1 else {
      throw C14_5DesignStudioError.rejected
    }
    let sources = try assets.map { asset -> ReconstructionSource in
      guard asset.projectId == id(projectId), asset.status == .ready,
            asset.rights.serviceProcessingConsent,
            asset.rights.trainingUseConsent == .denied,
            let assetId = UUID(uuidString: asset.id),
            let mime = asset.detectedMimeType,
            let kind = reconstructionKind(asset.kind, mime: mime),
            C14_5ContractValidator.sha256(asset.source.sha256)
      else { throw C14_5DesignStudioError.rejected }
      return ReconstructionSource(
        assetId: assetId,
        byteSize: asset.source.byteSize,
        detectedMimeType: mime,
        kind: kind,
        sha256: asset.source.sha256
      )
    }
    let operation = "create-reconstruction"
    let fingerprint = fingerprint(
      [id(projectId), String(includeAppearance)]
        + sources.map { id($0.assetId) + $0.sha256 }
    )
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let _: C14_7ReconstructionJob = try await post(
      "/v1/projects/\(id(projectId))/reconstruction-jobs",
      body: ReconstructionCreate(
        appearanceMode: includeAppearance ? "optional" : "disabled",
        label: "Native homeowner reconstruction proposal",
        mode: "rgb-sfm",
        registrationAnchors: [],
        rights: .init(
          basis: assets[0].rights.basis,
          serviceProcessingConsent: true,
          trainingUseConsent: .denied
        ),
        sources: sources
      ),
      idempotencyKey: key
    )
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
  }

  func reconstructionResult(
    projectId: UUID,
    jobId: UUID
  ) async throws -> C14_7ReconstructionResult {
    let value: C14_7ReconstructionResult = try await get(
      "/v1/projects/\(id(projectId))/reconstruction-jobs/\(id(jobId))/result"
    )
    guard value.projectId == projectId, value.jobId == jobId,
          ["completed", "abstained"].contains(value.status),
          value.status == "completed" ? value.geometry != nil : value.safeCode != nil,
          value.geometry.map({
            $0.unit == "mm" && ["metric-validated", "metric-estimated", "unknown"].contains($0.scaleStatus)
              && $0.inputFrameCount > 0 && $0.registeredFrameCount > 0
              && $0.registeredFrameCount <= $0.inputFrameCount && $0.componentCount > 0
          }) ?? true,
          value.appearance.map({ C14_5ContractValidator.sha256($0.geometryManifestSha256) }) ?? true
    else { throw C14_5DesignStudioError.invalidResponse }
    return value
  }

  func createFusion(
    projectId: UUID,
    snapshot: C14_5Snapshot,
    sources: [C14_7FusionSource],
    anchors: [UUID: [C14_7FusionAnchor]]
  ) async throws {
    guard snapshot.projectId == projectId, sources.count >= 2, sources.count <= 32,
          Set(sources.map(\.kind)).count >= 2, Set(sources.map(\.id)).count == sources.count,
          sources.allSatisfy({ $0.isValid }) else { throw C14_5DesignStudioError.rejected }
    let sourceIds = Set(sources.map(\.id))
    let groups = try sources.compactMap { source -> FusionAnchorGroup? in
      guard source.coordinateFrame != "project-local" else { return nil }
      let values = anchors[source.id] ?? []
      guard values.count >= 3, values.count <= 256,
            nonCollinear(values.map(\.sourcePoint)), nonCollinear(values.map(\.projectPoint))
      else { throw C14_5DesignStudioError.rejected }
      return FusionAnchorGroup(
        anchors: values.map {
          .init(
            anchorId: $0.anchorId,
            confidenceBasisPoints: 10_000,
            method: "user-correspondence",
            projectPoint: $0.projectPoint,
            sourcePoint: $0.sourcePoint
          )
        },
        sourceId: source.id
      )
    }
    guard Set(groups.map(\.sourceId)).isSubset(of: sourceIds) else {
      throw C14_5DesignStudioError.rejected
    }
    let operation = "create-fusion"
    let fingerprint = fingerprint([
      id(projectId), snapshot.snapshotSha256,
      sources.map { id($0.id) + $0.sha256 }.sorted().joined(),
      try contentSha256(groups),
    ])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let _: C14_7FusionJob = try await post(
      "/v1/projects/\(id(projectId))/fusion-jobs",
      body: FusionCreate(
        anchorGroups: groups,
        baseSnapshot: .init(
          modelId: snapshot.modelId,
          profile: "existing",
          snapshotId: snapshot.id,
          snapshotSha256: snapshot.snapshotSha256
        ),
        inferencePolicy: "label-and-expose",
        label: "Native homeowner multi-source reconciliation",
        sources: sources
      ),
      idempotencyKey: key
    )
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
  }

  func fusionProposal(projectId: UUID, jobId: UUID) async throws -> C14_7FusionProposal {
    let value: C14_7FusionProposal = try await get(
      "/v1/projects/\(id(projectId))/fusion-jobs/\(id(jobId))/proposal"
    )
    guard value.projectId == projectId, value.isValid else {
      throw C14_5DesignStudioError.invalidResponse
    }
    return value
  }

  func reviewFusion(
    projectId: UUID,
    jobId: UUID,
    proposal: C14_7FusionProposal,
    choices: [UUID: C14_7FusionDecisionChoice]
  ) async throws -> C14_7FusionReviewResponse {
    guard proposal.projectId == projectId, !proposal.discrepancies.isEmpty,
          proposal.discrepancies.allSatisfy({ choices[$0.id] != nil }) else {
      throw C14_5DesignStudioError.rejected
    }
    let decisions = proposal.discrepancies.map { discrepancy in
      FusionDecisionBody(
        choice: choices[discrepancy.id]!,
        correctedOperations: [],
        discrepancyId: discrepancy.id,
        reason: "Explicit native homeowner review of \(discrepancy.code)."
      )
    }
    let operation = "review-fusion"
    let fingerprint = fingerprint([
      id(projectId), id(jobId), id(proposal.id), String(proposal.version),
      decisions.map { id($0.discrepancyId) + $0.choice.rawValue }.joined(),
    ])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let value: C14_7FusionReviewResponse = try await post(
      "/v1/projects/\(id(projectId))/fusion-jobs/\(id(jobId))/proposal/discrepancy-decisions",
      body: FusionReviewBody(decisions: decisions, expectedProposalVersion: proposal.version),
      idempotencyKey: key
    )
    guard value.proposal.projectId == projectId,
          value.proposal.id == proposal.id,
          value.proposal.version > proposal.version,
          value.decisions.count == proposal.discrepancies.count,
          Set(value.decisions.map(\.discrepancyId)) == Set(proposal.discrepancies.map(\.id)) else {
      throw C14_5DesignStudioError.invalidResponse
    }
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
    return value
  }

  func createFusionDraft(
    projectId: UUID,
    jobId: UUID,
    proposal: C14_7FusionProposal,
    branch: C14_5Branch,
    decisionIds: [UUID]
  ) async throws -> C14_7FusionDraft {
    guard proposal.projectId == projectId, branch.projectId == projectId,
          !decisionIds.isEmpty, Set(decisionIds).count == decisionIds.count else {
      throw C14_5DesignStudioError.rejected
    }
    let operation = "create-fusion-draft"
    let fingerprint = fingerprint([
      id(projectId), id(jobId), id(branch.id), String(branch.revision),
      branch.headSnapshotSha256, decisionIds.map(id).sorted().joined(),
    ])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let value: C14_7FusionDraft = try await post(
      "/v1/projects/\(id(projectId))/fusion-jobs/\(id(jobId))/proposal/operation-drafts",
      body: FusionDraftBody(
        branchId: branch.id,
        decisionIds: decisionIds,
        expectedBranchRevision: branch.revision,
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedProposalVersion: proposal.version
      ),
      idempotencyKey: key
    )
    guard value.projectId == projectId, value.proposalId == proposal.id,
          value.schemaVersion == "c9-operation-draft-v1",
          value.branchId == branch.id,
          value.expectedBranchRevision == branch.revision,
          value.expectedHeadSnapshotSha256 == branch.headSnapshotSha256,
          value.baseSnapshot.modelId == proposal.baseSnapshot.modelId,
          value.baseSnapshot.snapshotId == proposal.baseSnapshot.snapshotId,
          value.baseSnapshot.snapshotSha256 == proposal.baseSnapshot.snapshotSha256,
          Set(value.decisionIds) == Set(decisionIds),
          !value.operations.isEmpty else { throw C14_5DesignStudioError.invalidResponse }
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
    return value
  }

  func preview(
    projectId: UUID,
    branch: C14_5Branch,
    operations: [C14_7JSONValue]
  ) async throws -> C14_7OperationsPreview {
    guard branch.projectId == projectId, !operations.isEmpty, operations.count <= 50 else {
      throw C14_5DesignStudioError.rejected
    }
    let operation = "preview-operations"
    let fingerprint = fingerprint([
      id(projectId), id(branch.id), String(branch.revision), branch.headSnapshotSha256,
      try contentSha256(operations),
    ])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let value: C14_7OperationsPreview = try await post(
      "/v1/projects/\(id(projectId))/models/existing/branches/\(id(branch.id))/previews",
      body: PreviewBody(
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedRevision: branch.revision,
        operations: operations
      ),
      idempotencyKey: key
    )
    guard value.projectId == projectId, value.branchId == branch.id,
          value.baseRevision == branch.revision,
          value.baseHeadSnapshotSha256 == branch.headSnapshotSha256,
          value.operations == operations,
          C14_5ContractValidator.sha256(value.resultSnapshotSha256),
          (C14_6ContractValidation.date(value.expiresAt)?.timeIntervalSinceNow ?? -1) > 0 else {
      throw C14_5DesignStudioError.invalidResponse
    }
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
    return value
  }

  func commit(
    projectId: UUID,
    branch: C14_5Branch,
    preview: C14_7OperationsPreview
  ) async throws -> C14_7CommitResponse {
    guard preview.projectId == projectId, preview.branchId == branch.id,
          preview.baseRevision == branch.revision,
          preview.baseHeadSnapshotSha256 == branch.headSnapshotSha256,
          !preview.hasBlockingFindings,
          (C14_6ContractValidation.date(preview.expiresAt)?.timeIntervalSinceNow ?? -1) > 0 else {
      throw C14_5DesignStudioError.stale
    }
    let operation = "commit-operations"
    let fingerprint = fingerprint([
      id(projectId), id(branch.id), id(preview.id), String(branch.revision),
      branch.headSnapshotSha256,
    ])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let value: C14_7CommitResponse = try await post(
      "/v1/projects/\(id(projectId))/models/existing/branches/\(id(branch.id))/commits",
      body: CommitBody(
        commitMessage: "Explicit native homeowner confirmation after exact geometry preview",
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedRevision: branch.revision,
        previewId: preview.id
      ),
      idempotencyKey: key
    )
    guard value.branch.projectId == projectId, value.branch.id == branch.id,
          value.branch.revision == branch.revision + 1,
          value.commit.snapshotId == value.branch.headSnapshotId,
          value.commit.snapshotSha256 == value.branch.headSnapshotSha256,
          value.commit.snapshotSha256 == preview.resultSnapshotSha256 else {
      throw C14_5DesignStudioError.invalidResponse
    }
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
    return value
  }

  func createScene(projectId: UUID, snapshot: C14_5Snapshot) async throws {
    guard snapshot.projectId == projectId, snapshot.profile == "existing",
          C14_5ContractValidator.sha256(snapshot.snapshotSha256) else {
      throw C14_5DesignStudioError.rejected
    }
    let operation = "create-confirmed-twin-scene"
    let fingerprint = fingerprint([id(projectId), id(snapshot.id), snapshot.snapshotSha256])
    let key = mutationKeys.key(operation: operation, fingerprint: fingerprint)
    let job: C14_5SceneJob = try await post(
      "/v1/projects/\(id(projectId))/scene-jobs",
      body: SceneCreate(
        label: "Native confirmed existing-home twin",
        sourceSnapshot: .init(
          modelId: snapshot.modelId,
          profile: "existing",
          projectId: projectId,
          schemaVersion: snapshot.schemaVersion,
          snapshotId: snapshot.id,
          snapshotSha256: snapshot.snapshotSha256
        )
      ),
      idempotencyKey: key
    )
    guard job.projectId == projectId,
          job.request.sourceSnapshot.snapshotId == snapshot.id,
          job.request.sourceSnapshot.snapshotSha256 == snapshot.snapshotSha256 else {
      throw C14_5DesignStudioError.invalidResponse
    }
    mutationKeys.complete(operation: operation, fingerprint: fingerprint)
  }

  private func reconstructionKind(_ kind: EvidenceKind, mime: String) -> String? {
    switch kind {
    case .photograph where ["image/heic", "image/jpeg", "image/png"].contains(mime): "rgb-image"
    case .video where ["video/mp4", "video/quicktime"].contains(mime): "rgb-video"
    default: nil
    }
  }

  private func nonCollinear(_ points: [C14_7FusionPoint]) -> Bool {
    guard points.count >= 3, points.allSatisfy(\.isValid) else { return false }
    for first in 0..<(points.count - 2) {
      for second in (first + 1)..<(points.count - 1) {
        for third in (second + 1)..<points.count {
          let a = points[first], b = points[second], c = points[third]
          let ab = (b.xMm - a.xMm, b.yMm - a.yMm, b.zMm - a.zMm)
          let ac = (c.xMm - a.xMm, c.yMm - a.yMm, c.zMm - a.zMm)
          let cross = (
            ab.1 * ac.2 - ab.2 * ac.1,
            ab.2 * ac.0 - ab.0 * ac.2,
            ab.0 * ac.1 - ab.1 * ac.0
          )
          if cross != (0, 0, 0) { return true }
        }
      }
    }
    return false
  }

  private func get<Response: Decodable & Sendable>(_ path: String) async throws -> Response {
    try decode(try await sendRaw(path: path, method: "GET", bodyData: nil, idempotencyKey: nil))
  }

  private func optionalGet<Response: Decodable & Sendable>(
    _ path: String
  ) async throws -> Response? {
    do { return try await get(path) }
    catch C14_5DesignStudioError.notFound { return nil }
  }

  private func post<Body: Encodable & Sendable, Response: Decodable & Sendable>(
    _ path: String,
    body: Body,
    idempotencyKey: UUID
  ) async throws -> Response {
    try decode(
      try await sendRaw(
        path: path,
        method: "POST",
        bodyData: try encoder.encode(body),
        idempotencyKey: idempotencyKey
      )
    )
  }

  private func sendRaw(
    path: String,
    method: String,
    bodyData: Data?,
    idempotencyKey: UUID?
  ) async throws -> Data {
    guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
          url.scheme == "https"
            || (url.scheme == "http" && ["127.0.0.1", "::1", "localhost"].contains(url.host ?? ""))
    else { throw C14_5DesignStudioError.invalidResponse }
    for attempt in 0...1 {
      let token: String
      do { token = try await tokenProvider.accessToken() }
      catch { throw C14_5DesignStudioError.expired }
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
        guard bodyData.count <= 10_486_784 else { throw C14_5DesignStudioError.rejected }
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
        guard (200..<300).contains(http.statusCode) else { throw statusError(http.statusCode) }
        guard data.count <= 10_486_784 else { throw C14_5DesignStudioError.invalidResponse }
        return data
      } catch let error as C14_5DesignStudioError { throw error }
      catch let error as URLError where error.code == .notConnectedToInternet {
        throw C14_5DesignStudioError.offline
      } catch { throw C14_5DesignStudioError.unavailable }
    }
    throw C14_5DesignStudioError.expired
  }

  private func decode<Response: Decodable & Sendable>(_ data: Data) throws -> Response {
    do { return try decoder.decode(Response.self, from: data) }
    catch { throw C14_5DesignStudioError.invalidResponse }
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

  private nonisolated func id(_ value: UUID) -> String { value.uuidString.lowercased() }

  private nonisolated func fingerprint(_ components: [String]) -> String {
    components.map { "\($0.utf8.count):\($0)" }.joined(separator: "|")
  }

  private func contentSha256<Value: Encodable>(_ value: Value) throws -> String {
    let data = try encoder.encode(value)
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}

import CrossDeviceContinuityClient
import CryptoKit
import Foundation
import XCTest
@testable import HomeDesignCapture

@MainActor
final class C14_5DesignStudioTests: XCTestCase {
  func testExactConfirmedTwinGateRequiresChangedBranchAndSucceededMatchingScene() throws {
    let eligible = C14_5FixtureFactory.workspace()
    try C14_5ContractValidator.validate(eligible, projectId: C14_5FixtureFactory.projectId)
    XCTAssertTrue(eligible.designEligible)
    XCTAssertNotNil(eligible.confirmedBranch)
    XCTAssertNotNil(eligible.exactSceneJob)

    let initializationOnly = C14_5FixtureFactory.workspace(changedBranch: false)
    try C14_5ContractValidator.validate(
      initializationOnly,
      projectId: C14_5FixtureFactory.projectId
    )
    XCTAssertFalse(initializationOnly.designEligible)
    XCTAssertNil(initializationOnly.confirmedBranch)

    let mismatchedScene = C14_5FixtureFactory.workspace(sceneMatchesJob: false)
    XCTAssertFalse(mismatchedScene.designEligible)
    XCTAssertThrowsError(
      try C14_5ContractValidator.validate(
        mismatchedScene,
        projectId: C14_5FixtureFactory.projectId
      )
    )
  }

  func testViewerLoadsExactStateWithoutMutationAuthority() async {
    let service = C14_5FixtureDesignService(
      workspace: C14_5FixtureFactory.workspace(role: .viewer)
    )
    let model = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )

    await model.activate(projectId: C14_5FixtureFactory.projectId.uuidString)

    XCTAssertEqual(model.state, .ready)
    XCTAssertTrue(model.designEligible)
    XCTAssertEqual(model.role, .viewer)
    XCTAssertFalse(model.canMutate)
  }

  func testColdLaunchRecoversConfirmationFromServerNotLocalCache() async {
    let service = C14_5FixtureDesignService(workspace: C14_5FixtureFactory.workspace())
    let first = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )
    let second = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )

    await first.activate(projectId: C14_5FixtureFactory.projectId.uuidString)
    await second.activate(projectId: C14_5FixtureFactory.projectId.uuidString)

    XCTAssertNotNil(first.workspace?.recoveredConfirmation)
    XCTAssertEqual(
      first.workspace?.recoveredConfirmation,
      second.workspace?.recoveredConfirmation
    )
  }

  func testOfflineRecoveryIsStaleDisplayOnlyAndCannotEnableDesign() async {
    let summary = C14_5FixtureFactory.recoverySummary()
    let model = C14_5DesignStudioModel(
      service: C14_5OfflineFixtureDesignService(),
      recovery: C14_5FixtureRecoveryStore(summary: summary)
    )

    await model.activate(projectId: C14_5FixtureFactory.projectId.uuidString)

    guard case .stale(let recovered, _) = model.state else {
      return XCTFail("Expected a stale display-only state")
    }
    XCTAssertEqual(recovered, summary)
    XCTAssertNil(model.workspace)
    XCTAssertFalse(model.designEligible)
    XCTAssertFalse(model.canMutate)
  }

  func testReloadFailurePreservesLastVerifiedWorkspaceReadOnly() async {
    let service = C14_5FixtureDesignService(
      workspace: C14_5FixtureFactory.workspace(),
      offlineAfterLoads: 1
    )
    let model = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )

    await model.activate(projectId: C14_5FixtureFactory.projectId.uuidString)
    XCTAssertEqual(model.state, .ready)
    XCTAssertTrue(model.canMutate)

    await model.activate(
      projectId: C14_5FixtureFactory.projectId.uuidString,
      force: true
    )

    guard case .stale = model.state else {
      return XCTFail("Expected retained last-verified state")
    }
    XCTAssertNotNil(model.workspace)
    XCTAssertFalse(model.designEligible)
    XCTAssertFalse(model.canMutate)
  }

  func testProjectSwitchCannotExposeThePreviousProjectsVerifiedWorkspace() async {
    let service = C14_5FixtureDesignService(
      workspace: C14_5FixtureFactory.workspace(),
      offlineForOtherProjects: true
    )
    let model = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )

    await model.activate(projectId: C14_5FixtureFactory.projectId.uuidString)
    XCTAssertNotNil(model.workspace)

    let otherProjectId = UUID(uuidString: "24000000-0000-4000-8000-000000000001")!
    await model.activate(projectId: otherProjectId.uuidString)

    XCTAssertNil(model.workspace)
    XCTAssertNil(model.role)
    XCTAssertFalse(model.designEligible)
    XCTAssertFalse(model.canMutate)
  }

  func testCancelledProjectFailureCannotOverwriteTheNewProjectsReadyState() async {
    let service = C14_5FixtureDesignService(
      workspace: C14_5FixtureFactory.workspace(),
      offlineForOtherProjects: true,
      otherProjectFailureDelayNanoseconds: 100_000_000
    )
    let model = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )
    let originalProjectId = C14_5FixtureFactory.projectId.uuidString
    let otherProjectId = UUID(uuidString: "24000000-0000-4000-8000-000000000002")!

    await model.activate(projectId: originalProjectId)
    let staleActivation = Task {
      await model.activate(projectId: otherProjectId.uuidString)
    }
    while await service.observedLoadCount() < 2 { await Task.yield() }
    await model.activate(projectId: originalProjectId)
    await staleActivation.value

    XCTAssertEqual(model.state, .ready)
    XCTAssertEqual(model.workspace?.snapshot?.projectId, C14_5FixtureFactory.projectId)
    XCTAssertTrue(model.designEligible)
  }

  func testPendingMutationIdentityIsReusedUntilTheExactOperationCompletes() {
    var keys = C14_5PendingMutationKeys()
    let first = keys.token(operation: "brief.update", fingerprint: "exact-request-a")
    let retry = keys.token(operation: "brief.update", fingerprint: "exact-request-a")

    XCTAssertEqual(first, retry)

    let changed = keys.token(operation: "brief.update", fingerprint: "exact-request-b")
    XCTAssertNotEqual(changed, first)
    XCTAssertEqual(
      keys.token(operation: "brief.update", fingerprint: "exact-request-a"),
      first
    )

    keys.complete(operation: "brief.update", fingerprint: "exact-request-b")
    let intentionalNewRequest = keys.token(
      operation: "brief.update",
      fingerprint: "exact-request-b"
    )
    XCTAssertNotEqual(intentionalNewRequest, changed)
  }

  func testOptionStateMustRemainPinnedToTheCurrentBriefAndSnapshot() throws {
    let workspace = C14_5FixtureFactory.workspace()
    let job = try XCTUnwrap(workspace.optionJobs.first)
    let staleJob = C14_5OptionJob(
      baseBrief: job.baseBrief,
      id: job.id,
      optionCount: job.optionCount,
      projectId: job.projectId,
      requestedDirections: job.requestedDirections,
      requestedOptionCount: job.requestedOptionCount,
      safeCode: job.safeCode,
      sourceModel: C14_5OptionSource(
        modelId: job.sourceModel.modelId,
        profile: job.sourceModel.profile,
        snapshotId: job.sourceModel.snapshotId,
        snapshotSha256: String(repeating: "e", count: 64),
        snapshotVersion: job.sourceModel.snapshotVersion
      ),
      state: job.state,
      version: job.version
    )
    let staleWorkspace = replacing(workspace, optionJobs: [staleJob])

    XCTAssertThrowsError(
      try C14_5ContractValidator.validate(
        staleWorkspace,
        projectId: C14_5FixtureFactory.projectId
      )
    )
  }

  func testCurrentSpecificationAndLatestRenderFollowAuthoritativeListSemantics() throws {
    let workspace = C14_5FixtureFactory.workspace()
    let exactSpecification = try XCTUnwrap(workspace.currentSpecification)
    let latestRender = try XCTUnwrap(workspace.latestRenderJob)
    let unrelatedSource = C14_5ConfirmationSource(
      confirmationId: exactSpecification.currentRevision.sourceConfirmation.confirmationId,
      jobId: exactSpecification.currentRevision.sourceConfirmation.jobId,
      jobVersion: exactSpecification.currentRevision.sourceConfirmation.jobVersion,
      optionId: exactSpecification.currentRevision.sourceConfirmation.optionId,
      profile: exactSpecification.currentRevision.sourceConfirmation.profile,
      resultSnapshotId: exactSpecification.currentRevision.sourceConfirmation.resultSnapshotId,
      resultSnapshotSha256: String(repeating: "e", count: 64),
      resultSnapshotVersion: exactSpecification.currentRevision.sourceConfirmation.resultSnapshotVersion
    )
    let unrelatedRevision = C14_5SpecificationRevision(
      branchId: exactSpecification.currentRevision.branchId,
      branchRevision: exactSpecification.currentRevision.branchRevision,
      catalogReleaseId: exactSpecification.currentRevision.catalogReleaseId,
      catalogReleaseSha256: exactSpecification.currentRevision.catalogReleaseSha256,
      lines: exactSpecification.currentRevision.lines,
      modelSnapshotId: exactSpecification.currentRevision.modelSnapshotId,
      modelSnapshotSha256: exactSpecification.currentRevision.modelSnapshotSha256,
      revision: exactSpecification.currentRevision.revision,
      revisionSha256: exactSpecification.currentRevision.revisionSha256,
      sourceConfirmation: unrelatedSource
    )
    let unrelatedSpecification = C14_5Specification(
      currentRevision: unrelatedRevision,
      projectId: exactSpecification.projectId,
      schemaVersion: exactSpecification.schemaVersion,
      selectionBoard: exactSpecification.selectionBoard,
      specificationId: UUID(),
      status: exactSpecification.status
    )
    let newerRender = C14_5RenderJob(
      id: UUID(),
      projectId: latestRender.projectId,
      request: latestRender.request,
      resultId: nil,
      safeCode: nil,
      state: "queued",
      version: 1
    )
    let reordered = replacing(
      workspace,
      specifications: [unrelatedSpecification, exactSpecification],
      renderJobs: [newerRender, latestRender]
    )

    XCTAssertEqual(reordered.currentSpecification?.id, exactSpecification.id)
    XCTAssertEqual(reordered.latestRenderJob?.id, newerRender.id)
  }

  func testRecoveryEnvelopeContainsNoCredentialURLOrCustomerProse() throws {
    let data = try JSONEncoder().encode(C14_5FixtureFactory.recoverySummary())
    let value = try XCTUnwrap(String(data: data, encoding: .utf8))

    XCTAssertLessThanOrEqual(data.count, 4_096)
    XCTAssertFalse(value.localizedCaseInsensitiveContains("token"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("authorization"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("url"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("statement"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("address"))
  }

  func testArtifactVerifierRejectsTamperedBytes() throws {
    let bytes = C14_5FixtureFactory.geometryPNG
    let digest = Data(SHA256.hash(data: bytes)).map { String(format: "%02x", $0) }.joined()
    let artifact = C14_5RenderArtifact(
      byteLength: bytes.count,
      heightPx: 64,
      id: UUID(),
      mediaType: "image/png",
      role: "geometry-safe-png",
      schemaVersion: "c14-render-artifact-v1",
      sha256: digest,
      widthPx: 64
    )
    let manifestHash = String(repeating: "f", count: 64)
    let access = C14_5ArtifactAccess(
      artifactId: artifact.id,
      byteLength: bytes.count,
      expiresAt: "2026-08-26T14:00:00Z",
      manifestSha256: manifestHash,
      mediaType: artifact.mediaType,
      role: artifact.role,
      sha256: digest,
      url: URL(string: "https://fixture.invalid/result.png")!
    )

    XCTAssertNoThrow(
      try C14_5ArtifactVerifier.verify(
        bytes: bytes,
        responseMediaType: "image/png",
        access: access,
        expected: artifact,
        expectedManifestSha256: manifestHash
      )
    )
    XCTAssertThrowsError(
      try C14_5ArtifactVerifier.verify(
        bytes: Data("tampered".utf8),
        responseMediaType: "image/png",
        access: access,
        expected: artifact,
        expectedManifestSha256: manifestHash
      )
    )

    let oversized = C14_5RenderArtifact(
      byteLength: C14_5ArtifactVerifier.maximumViewableArtifactBytes + 1,
      heightPx: 64,
      id: artifact.id,
      mediaType: artifact.mediaType,
      role: artifact.role,
      schemaVersion: artifact.schemaVersion,
      sha256: artifact.sha256,
      widthPx: 64
    )
    XCTAssertThrowsError(
      try C14_5ArtifactVerifier.verify(
        bytes: bytes,
        responseMediaType: "image/png",
        access: access,
        expected: oversized,
        expectedManifestSha256: manifestHash
      )
    )
  }

  func testGeneratedContinuityContractPinsRemainFrozen() {
    XCTAssertEqual(ContinuityContract.openAPIVersion, "3.1.2")
    XCTAssertEqual(
      ContinuityContract.openAPISHA256,
      "c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508"
    )
    XCTAssertEqual(
      ContinuityContract.generatorVersion,
      "interior-design-continuity-generator-1.0.1"
    )
  }

  private func replacing(
    _ workspace: C14_5Workspace,
    optionJobs: [C14_5OptionJob]? = nil,
    specifications: [C14_5Specification]? = nil,
    renderJobs: [C14_5RenderJob]? = nil
  ) -> C14_5Workspace {
    C14_5Workspace(
      session: workspace.session,
      snapshot: workspace.snapshot,
      branches: workspace.branches,
      sceneJobs: workspace.sceneJobs,
      scene: workspace.scene,
      brief: workspace.brief,
      optionJobs: optionJobs ?? workspace.optionJobs,
      options: workspace.options,
      recoveredConfirmation: workspace.recoveredConfirmation,
      catalogReleases: workspace.catalogReleases,
      catalogAssets: workspace.catalogAssets,
      specifications: specifications ?? workspace.specifications,
      eligibleSources: workspace.eligibleSources,
      renderCapabilities: workspace.renderCapabilities,
      renderJobs: renderJobs ?? workspace.renderJobs,
      renderResult: workspace.renderResult
    )
  }
}

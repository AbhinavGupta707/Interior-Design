#if DEBUG
  import Foundation
  import SwiftUI

  enum C14_7UITestScenario: String {
    case confirmedOwner = "confirmed-owner"
    case delayedStaleResponse = "delayed-stale-response"
    case offline
    case proposalJourney = "proposal-journey"
    case roleDowngrade = "role-downgrade"
    case stale
    case viewer

    static func current(
      configuration: AppConfiguration,
      environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Self? {
      guard configuration.environment == .local,
            environment["C14_7_UI_TEST_MODE"] == "1",
            let value = environment["C14_7_UI_TEST_SCENARIO"]
      else { return nil }
      return Self(rawValue: value)
    }
  }

  struct C14_7UITestFixtureView: View {
    @State private var path: [String] = []
    @State private var twin: C14_7TwinIntegrationModel
    @State private var design: C14_5DesignStudioModel

    private let project = CaptureProject.projectService(
      id: C14_7FixtureFactory.projectId.uuidString.lowercased(),
      name: "Terminal native twin fixture",
      status: "active"
    )

    init(scenario: C14_7UITestScenario) {
      _twin = State(
        initialValue: C14_7TwinIntegrationModel(
          service: C14_7FixtureTwinService(scenario: scenario)
        )
      )
      _design = State(
        initialValue: C14_5DesignStudioModel(
          service: C14_5FixtureDesignService(workspace: C14_5FixtureFactory.workspace()),
          recovery: C14_5FixtureRecoveryStore(summary: nil)
        )
      )
    }

    var body: some View {
      NavigationStack(path: $path) {
        C14_7TwinIntegrationView(
          project: project,
          model: twin,
          onContinueToDesign: { path.append("design") },
          onBackToHub: {}
        )
        .navigationDestination(for: String.self) { route in
          if route == "design" {
            C14_5DesignStudioView(project: project, model: design, onBackToHub: { path = [] })
          }
        }
      }
    }
  }

  actor C14_7FixtureTwinService: C14_7TwinIntegrationServing {
    private enum Phase { case initial, committed, confirmed }

    private let scenario: C14_7UITestScenario
    private var loadCount = 0
    private var phase: Phase

    init(scenario: C14_7UITestScenario) {
      self.scenario = scenario
      phase = scenario == .confirmedOwner || scenario == .viewer ? .confirmed : .initial
    }

    func loadWorkspace(projectId: UUID) async throws -> C14_7Workspace {
      if projectId != C14_7FixtureFactory.projectId,
         scenario == .delayedStaleResponse {
        loadCount += 1
        try await Task.sleep(for: .milliseconds(100))
        throw C14_5DesignStudioError.offline
      }
      guard projectId == C14_7FixtureFactory.projectId else {
        throw C14_5DesignStudioError.notFound
      }
      loadCount += 1
      if scenario == .offline || (scenario == .stale && loadCount > 1) {
        throw C14_5DesignStudioError.offline
      }
      let role: C14_5MemberRole = scenario == .viewer
        || (scenario == .roleDowngrade && loadCount > 1) ? .viewer : .owner
      switch phase {
      case .initial: return C14_7FixtureFactory.initialWorkspace(role: role)
      case .committed: return C14_7FixtureFactory.committedWorkspace(role: role, confirmed: false)
      case .confirmed: return C14_7FixtureFactory.committedWorkspace(role: role, confirmed: true)
      }
    }

    func observedLoadCount() -> Int { loadCount }

    func initializeWorkspace(projectId: UUID) async throws {
      throw C14_5DesignStudioError.rejected
    }

    func createPlanJob(projectId: UUID, asset: EvidenceAsset) async throws {
      guard projectId == C14_7FixtureFactory.projectId,
            asset.id == C14_7FixtureFactory.planAssetId.uuidString.lowercased() else {
        throw C14_5DesignStudioError.rejected
      }
    }

    func planProposal(projectId: UUID, jobId: UUID) async throws -> C14_7PlanProposal {
      guard projectId == C14_7FixtureFactory.projectId,
            jobId == C14_7FixtureFactory.planJobId else {
        throw C14_5DesignStudioError.notFound
      }
      return C14_7FixtureFactory.planProposal
    }

    func calibratePlan(
      projectId: UUID,
      jobId: UUID,
      knownLengthMillimetres: Int,
      sourceStart: C14_7SourcePoint,
      sourceEnd: C14_7SourcePoint
    ) async throws -> C14_7PlanCalibration {
      guard projectId == C14_7FixtureFactory.projectId,
            jobId == C14_7FixtureFactory.planJobId,
            knownLengthMillimetres > 0, sourceStart != sourceEnd else {
        throw C14_5DesignStudioError.rejected
      }
      return C14_7FixtureFactory.calibration
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
      guard projectId == C14_7FixtureFactory.projectId,
            jobId == C14_7FixtureFactory.planJobId,
            branch.headSnapshotSha256 == C14_7FixtureFactory.initialHash,
            reviewDurationMilliseconds > 0 else {
        throw C14_5DesignStudioError.stale
      }
      let built = try C14_7PlanOperationBuilder.build(
        proposal: proposal,
        calibration: calibration,
        actorUserId: actorUserId,
        reviews: reviews
      )
      return C14_7PlanDraft(
        calibrationId: calibration.id,
        jobId: jobId,
        operations: built.operations,
        projectId: projectId,
        proposalId: proposal.proposalId,
        schemaVersion: "c6-plan-operation-draft-v1",
        target: .init(
          branchId: branch.id,
          expectedHeadSnapshotSha256: branch.headSnapshotSha256,
          expectedRevision: branch.revision,
          profile: "existing"
        )
      )
    }

    func createReconstruction(
      projectId: UUID,
      assets: [EvidenceAsset],
      includeAppearance: Bool
    ) async throws {
      throw C14_5DesignStudioError.unavailable
    }

    func reconstructionResult(
      projectId: UUID,
      jobId: UUID
    ) async throws -> C14_7ReconstructionResult {
      throw C14_5DesignStudioError.unavailable
    }

    func createFusion(
      projectId: UUID,
      snapshot: C14_5Snapshot,
      sources: [C14_7FusionSource],
      anchors: [UUID: [C14_7FusionAnchor]]
    ) async throws {
      throw C14_5DesignStudioError.unavailable
    }

    func fusionProposal(projectId: UUID, jobId: UUID) async throws -> C14_7FusionProposal {
      throw C14_5DesignStudioError.unavailable
    }

    func reviewFusion(
      projectId: UUID,
      jobId: UUID,
      proposal: C14_7FusionProposal,
      choices: [UUID: C14_7FusionDecisionChoice]
    ) async throws -> C14_7FusionReviewResponse {
      throw C14_5DesignStudioError.unavailable
    }

    func createFusionDraft(
      projectId: UUID,
      jobId: UUID,
      proposal: C14_7FusionProposal,
      branch: C14_5Branch,
      decisionIds: [UUID]
    ) async throws -> C14_7FusionDraft {
      throw C14_5DesignStudioError.unavailable
    }

    func preview(
      projectId: UUID,
      branch: C14_5Branch,
      operations: [C14_7JSONValue]
    ) async throws -> C14_7OperationsPreview {
      guard projectId == C14_7FixtureFactory.projectId,
            branch.headSnapshotSha256 == C14_7FixtureFactory.initialHash,
            !operations.isEmpty else { throw C14_5DesignStudioError.stale }
      return C14_7OperationsPreview(
        baseHeadSnapshotSha256: branch.headSnapshotSha256,
        baseRevision: branch.revision,
        branchId: branch.id,
        expiresAt: "2099-08-26T16:00:00Z",
        findings: [],
        hasBlockingFindings: false,
        id: C14_7FixtureFactory.previewId,
        operations: operations,
        projectId: projectId,
        resultSnapshotSha256: C14_5FixtureFactory.hashA
      )
    }

    func commit(
      projectId: UUID,
      branch: C14_5Branch,
      preview: C14_7OperationsPreview
    ) async throws -> C14_7CommitResponse {
      guard projectId == C14_7FixtureFactory.projectId,
            preview.id == C14_7FixtureFactory.previewId,
            branch.headSnapshotSha256 == C14_7FixtureFactory.initialHash else {
        throw C14_5DesignStudioError.stale
      }
      phase = .committed
      let next = C14_7FixtureFactory.committedWorkspace(role: .owner, confirmed: false)
      let committedBranch = try unwrapFixture(next.branch)
      let snapshot = try unwrapFixture(next.snapshot)
      return C14_7CommitResponse(
        branch: committedBranch,
        commit: C14_7ModelCommit(
          branchId: committedBranch.id,
          id: C14_7FixtureFactory.commitId,
          revision: committedBranch.revision,
          snapshotId: snapshot.id,
          snapshotSha256: snapshot.snapshotSha256
        ),
        findings: []
      )
    }

    func createScene(projectId: UUID, snapshot: C14_5Snapshot) async throws {
      guard projectId == C14_7FixtureFactory.projectId,
            snapshot.id == C14_5FixtureFactory.snapshotId,
            snapshot.snapshotSha256 == C14_5FixtureFactory.hashA else {
        throw C14_5DesignStudioError.stale
      }
      phase = .confirmed
    }
  }

  enum C14_7FixtureFactory {
    static let projectId = C14_5FixtureFactory.projectId
    static let planAssetId = id("14700000-0000-4000-8000-000000000001")
    static let planJobId = id("14700000-0000-4000-8000-000000000002")
    static let proposalId = id("14700000-0000-4000-8000-000000000003")
    static let candidateId = id("14700000-0000-4000-8000-000000000004")
    static let calibrationId = id("14700000-0000-4000-8000-000000000005")
    static let initialSnapshotId = id("14700000-0000-4000-8000-000000000006")
    static let branchId = id("14700000-0000-4000-8000-000000000007")
    static let previewId = id("14700000-0000-4000-8000-000000000008")
    static let commitId = id("14700000-0000-4000-8000-000000000009")
    static let initialHash = String(repeating: "e", count: 64)

    static let planProposal = C14_7PlanProposal(
      candidates: [
        C14_7PlanCandidate(
          boundaryWallCandidateIds: nil,
          candidateId: candidateId,
          confidence: 96,
          elevationMillimetres: 0,
          end: nil,
          headHeightMillimetres: nil,
          heightMillimetres: nil,
          hostWallCandidateId: nil,
          kind: "level",
          levelCandidateId: nil,
          openingKind: nil,
          sillHeightMillimetres: nil,
          start: nil,
          suggestedName: "Reviewed ground level",
          thicknessMillimetres: nil
        )
      ],
      code: nil,
      detail: nil,
      findings: [],
      jobId: planJobId,
      overallConfidence: 96,
      parser: C14_7PlanParser(
        adapterId: "fixture-plan-parser",
        adapterVersion: "1",
        manifestSha256: String(repeating: "c", count: 64),
        mode: "deterministic-fixture"
      ),
      projectId: projectId,
      proposalId: proposalId,
      retryable: nil,
      source: C14_7PlanSource(
        assetId: planAssetId,
        byteSize: 2_048,
        coordinateSpace: "fixture-microunits",
        detectedMimeType: "application/pdf",
        heightSourceUnits: 10_000,
        pageIndex: 0,
        projectId: projectId,
        rights: .init(
          basis: .ownedByUser,
          serviceProcessingConsent: true,
          trainingUseConsent: .denied
        ),
        sha256: String(repeating: "b", count: 64),
        widthSourceUnits: 10_000
      ),
      status: "proposal"
    )

    static let calibration = C14_7PlanCalibration(
      id: calibrationId,
      jobId: planJobId,
      projectId: projectId,
      proposalId: proposalId,
      residualMillimetres: 0,
      sourceToModel: C14_7AffineTransform(
        a: 10,
        b: 0,
        c: 0,
        d: 10,
        denominator: 1,
        rounding: "half-away-from-zero",
        translateXMillimetres: 0,
        translateYMillimetres: 0
      )
    )

    static var planAsset: EvidenceAsset {
      EvidenceAsset(
        createdAt: "2026-08-26T10:00:00Z",
        declaredMimeType: "application/pdf",
        detectedMimeType: "application/pdf",
        fileName: "rights-cleared-terminal-plan.pdf",
        id: planAssetId.uuidString.lowercased(),
        kind: .plan,
        projectId: projectId.uuidString.lowercased(),
        rejectionCode: nil,
        rights: EvidenceRightsAssertion(
          attribution: nil,
          basis: .ownedByUser,
          licenceUrl: nil,
          serviceProcessingConsent: true,
          trainingUseConsent: .denied
        ),
        source: EvidenceSourceFingerprint(
          byteSize: 2_048,
          sha256: String(repeating: "b", count: 64)
        ),
        status: .ready,
        updatedAt: "2026-08-26T10:00:00Z"
      )
    }

    static func initialWorkspace(role: C14_5MemberRole) -> C14_7Workspace {
      let base = C14_5FixtureFactory.workspace(role: role, changedBranch: false)
      let snapshot = C14_5Snapshot(
        id: initialSnapshotId,
        modelId: C14_5FixtureFactory.modelId,
        profile: "existing",
        projectId: projectId,
        schemaVersion: "c4-canonical-home-v1",
        snapshotSha256: initialHash,
        version: 1
      )
      return C14_7Workspace(
        assets: [planAsset],
        branches: [
          C14_5Branch(
            headSnapshotId: initialSnapshotId,
            headSnapshotSha256: initialHash,
            id: branchId,
            modelId: C14_5FixtureFactory.modelId,
            profile: "existing",
            projectId: projectId,
            revision: 0,
            sourceSnapshotId: initialSnapshotId
          )
        ],
        fusionJobs: [],
        fusionSources: [],
        planJobs: [planJob],
        reconstructionJobs: [],
        sceneJobs: [],
        session: base.session,
        snapshot: snapshot
      )
    }

    static func committedWorkspace(
      role: C14_5MemberRole,
      confirmed: Bool
    ) -> C14_7Workspace {
      let base = C14_5FixtureFactory.workspace(role: role)
      let branch = C14_5Branch(
        headSnapshotId: C14_5FixtureFactory.snapshotId,
        headSnapshotSha256: C14_5FixtureFactory.hashA,
        id: branchId,
        modelId: C14_5FixtureFactory.modelId,
        profile: "existing",
        projectId: projectId,
        revision: 1,
        sourceSnapshotId: initialSnapshotId
      )
      return C14_7Workspace(
        assets: [planAsset],
        branches: [branch],
        fusionJobs: [],
        fusionSources: [],
        planJobs: [planJob],
        reconstructionJobs: [],
        sceneJobs: confirmed ? base.sceneJobs : [],
        session: base.session,
        snapshot: base.snapshot
      )
    }

    static var planJob: C14_7PlanJob {
      C14_7PlanJob(
        assetId: planAssetId,
        id: planJobId,
        projectId: projectId,
        resultId: proposalId,
        retryable: false,
        safeCode: nil,
        sourceSha256: String(repeating: "b", count: 64),
        state: "proposed",
        version: 1
      )
    }

    private static func id(_ value: String) -> UUID { UUID(uuidString: value)! }
  }

  private func unwrapFixture<Value>(_ value: Value?) throws -> Value {
    guard let value else { throw C14_5DesignStudioError.invalidResponse }
    return value
  }
#endif

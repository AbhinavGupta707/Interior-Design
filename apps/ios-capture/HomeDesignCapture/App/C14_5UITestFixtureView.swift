#if DEBUG
  import CrossDeviceContinuityClient
  import Foundation
  import SwiftUI

  enum C14_5UITestScenario: String {
    case eligibleOwner = "eligible-owner"
    case offlineRecovery = "offline-recovery"

    static func current() -> Self? {
      guard let value = ProcessInfo.processInfo.environment["C14_5_UI_SCENARIO"] else { return nil }
      return Self(rawValue: value)
    }
  }

  struct C14_5UITestFixtureView: View {
    let scenario: C14_5UITestScenario
    @State private var path: [String] = []
    @State private var model: C14_5DesignStudioModel

    init(scenario: C14_5UITestScenario) {
      self.scenario = scenario
      let service: any C14_5DesignStudioServing =
        scenario == .eligibleOwner
        ? C14_5FixtureDesignService(workspace: C14_5FixtureFactory.workspace())
        : C14_5OfflineFixtureDesignService()
      let recovery: any C14_5RecoveryStoring =
        scenario == .offlineRecovery
        ? C14_5FixtureRecoveryStore(summary: C14_5FixtureFactory.recoverySummary())
        : C14_5FixtureRecoveryStore(summary: nil)
      _model = State(initialValue: C14_5DesignStudioModel(service: service, recovery: recovery))
    }

    private let project = CaptureProject.projectService(
      id: "14000000-0000-4000-8000-000000000001",
      name: "Fixture homeowner studio",
      status: "active"
    )

    var body: some View {
      NavigationStack(path: $path) {
        C14_5HomeownerHubView(
          project: project,
          designModel: model,
          onOpenDesign: { path.append("design") },
          onOpenEvidence: {},
          onOpenCapture: {},
          onOpenMedia: {},
          onChooseProject: {}
        )
        .navigationDestination(for: String.self) { route in
          if route == "design" {
            C14_5DesignStudioView(
              project: project,
              model: model,
              onBackToHub: { path = [] }
            )
          }
        }
      }
    }
  }

  actor C14_5FixtureRecoveryStore: C14_5RecoveryStoring {
    private var summary: C14_5RecoverySummary?

    init(summary: C14_5RecoverySummary?) { self.summary = summary }

    func load(projectId: UUID) -> C14_5RecoverySummary? {
      summary?.validated(for: projectId)
    }

    func save(_ summary: C14_5RecoverySummary) { self.summary = summary }
  }

  struct C14_5OfflineFixtureDesignService: C14_5DesignStudioServing {
    func loadWorkspace(projectId: UUID) async throws -> C14_5Workspace {
      throw C14_5DesignStudioError.offline
    }
    func updateBrief(projectId: UUID, actorId: UUID, expectedRevision: Int, statement: String, category: String, classification: String) async throws { throw C14_5DesignStudioError.offline }
    func acceptBrief(projectId: UUID, expectedRevision: Int) async throws { throw C14_5DesignStudioError.offline }
    func createOptions(projectId: UUID, brief: C14_5BriefRecord, snapshot: C14_5Snapshot) async throws { throw C14_5DesignStudioError.offline }
    func confirmOption(projectId: UUID, job: C14_5OptionJob, option: C14_5DesignOption, set: C14_5OptionSet, brief: C14_5BriefRecord, snapshot: C14_5Snapshot) async throws -> OptionConfirmation { throw C14_5DesignStudioError.offline }
    func createSpecification(projectId: UUID, confirmation: OptionConfirmation, release: C14_5CatalogRelease) async throws { throw C14_5DesignStudioError.offline }
    func createSubstitutionPreview(projectId: UUID, specification: C14_5Specification, line: C14_5SpecificationLine, replacement: C14_5CatalogAsset) async throws -> C14_5SubstitutionPreview { throw C14_5DesignStudioError.offline }
    func confirmSubstitution(projectId: UUID, specification: C14_5Specification, preview: C14_5SubstitutionPreview) async throws { throw C14_5DesignStudioError.offline }
    func createRender(projectId: UUID, source: RenderEligibleSource, camera: RenderEligibleCamera, profileId: String) async throws { throw C14_5DesignStudioError.offline }
    func verifiedArtifact(projectId: UUID, jobId: UUID, artifact: C14_5RenderArtifact, manifestSha256: String) async throws -> C14_5VerifiedArtifact { throw C14_5DesignStudioError.offline }
  }

  actor C14_5FixtureDesignService: C14_5DesignStudioServing {
    private var workspace: C14_5Workspace
    private let offlineAfterLoads: Int?
    private let offlineForOtherProjects: Bool
    private let otherProjectFailureDelayNanoseconds: UInt64?
    private var loadCount = 0

    init(
      workspace: C14_5Workspace,
      offlineAfterLoads: Int? = nil,
      offlineForOtherProjects: Bool = false,
      otherProjectFailureDelayNanoseconds: UInt64? = nil
    ) {
      self.workspace = workspace
      self.offlineAfterLoads = offlineAfterLoads
      self.offlineForOtherProjects = offlineForOtherProjects
      self.otherProjectFailureDelayNanoseconds = otherProjectFailureDelayNanoseconds
    }

    func loadWorkspace(projectId: UUID) async throws -> C14_5Workspace {
      loadCount += 1
      if let offlineAfterLoads, loadCount > offlineAfterLoads {
        throw C14_5DesignStudioError.offline
      }
      if offlineForOtherProjects, workspace.snapshot?.projectId != projectId {
        if let otherProjectFailureDelayNanoseconds {
          await Task.detached {
            try? await Task.sleep(nanoseconds: otherProjectFailureDelayNanoseconds)
          }.value
        }
        throw C14_5DesignStudioError.offline
      }
      guard workspace.snapshot?.projectId == projectId else { throw C14_5DesignStudioError.notFound }
      return workspace
    }
    func observedLoadCount() -> Int { loadCount }
    func updateBrief(projectId: UUID, actorId: UUID, expectedRevision: Int, statement: String, category: String, classification: String) {}
    func acceptBrief(projectId: UUID, expectedRevision: Int) {}
    func createOptions(projectId: UUID, brief: C14_5BriefRecord, snapshot: C14_5Snapshot) {}
    func confirmOption(projectId: UUID, job: C14_5OptionJob, option: C14_5DesignOption, set: C14_5OptionSet, brief: C14_5BriefRecord, snapshot: C14_5Snapshot) throws -> OptionConfirmation {
      guard let confirmation = workspace.recoveredConfirmation else { throw C14_5DesignStudioError.notFound }
      return confirmation
    }
    func createSpecification(projectId: UUID, confirmation: OptionConfirmation, release: C14_5CatalogRelease) {}
    func createSubstitutionPreview(projectId: UUID, specification: C14_5Specification, line: C14_5SpecificationLine, replacement: C14_5CatalogAsset) -> C14_5SubstitutionPreview {
      C14_5FixtureFactory.preview()
    }
    func confirmSubstitution(projectId: UUID, specification: C14_5Specification, preview: C14_5SubstitutionPreview) {}
    func createRender(projectId: UUID, source: RenderEligibleSource, camera: RenderEligibleCamera, profileId: String) {}
    func verifiedArtifact(projectId: UUID, jobId: UUID, artifact: C14_5RenderArtifact, manifestSha256: String) throws -> C14_5VerifiedArtifact {
      let bytes = C14_5FixtureFactory.geometryPNG
      return C14_5VerifiedArtifact(
        access: C14_5ArtifactAccess(
          artifactId: artifact.id,
          byteLength: bytes.count,
          expiresAt: "2026-08-26T12:05:00Z",
          manifestSha256: manifestSha256,
          mediaType: "image/png",
          role: artifact.role,
          sha256: artifact.sha256,
          url: URL(string: "https://fixture.invalid/render.png")!
        ),
        bytes: bytes
      )
    }
  }

  enum C14_5FixtureFactory {
    static let projectId = uuid("14000000-0000-4000-8000-000000000001")
    static let snapshotId = uuid("14000000-0000-4000-8000-000000000002")
    static let modelId = uuid("14000000-0000-4000-8000-000000000003")
    static let jobId = uuid("14000000-0000-4000-8000-000000000004")
    static let sceneId = uuid("14000000-0000-4000-8000-000000000005")
    static let sceneArtifactId = uuid("14000000-0000-4000-8000-000000000006")
    static let hashA = String(repeating: "a", count: 64)
    static let hashB = String(repeating: "b", count: 64)
    static let hashC = String(repeating: "c", count: 64)
    static let hashD = String(repeating: "d", count: 64)
    static let geometryPNG = Data(
      base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAZUlEQVR4nO3PQQ3AIADAQEjwrwcLSMDNRPC4LOkpaOc9e/zZ0gGvGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtA+mfQDWF3JjLwAAAAASUVORK5CYII="
    )!
    static let geometryPNGSha256 = "014bc9a3ffa59c4f3ba191c9178080787e67b2088540d3ef301e6be55d2ba4ff"

    static func workspace(
      role: C14_5MemberRole = .owner,
      changedBranch: Bool = true,
      sceneMatchesJob: Bool = true
    ) -> C14_5Workspace {
      let source = C14_5SnapshotReference(
        modelId: modelId,
        profile: "existing",
        projectId: projectId,
        schemaVersion: "c4-canonical-home-v1",
        snapshotId: snapshotId,
        snapshotSha256: hashA
      )
      let briefId = uuid("14000000-0000-4000-8000-000000000020")
      let optionJobId = uuid("14000000-0000-4000-8000-000000000021")
      let optionOneId = uuid("14000000-0000-4000-8000-000000000022")
      let optionTwoId = uuid("14000000-0000-4000-8000-000000000023")
      let specId = uuid("14000000-0000-4000-8000-000000000030")
      let line = C14_5SpecificationLine(
        assetVersionId: uuid("14000000-0000-4000-8000-000000000031"),
        assetVersionSha256: hashB,
        decisionStatus: "selected",
        elementId: uuid("14000000-0000-4000-8000-000000000032"),
        kind: "finish",
        lineId: uuid("14000000-0000-4000-8000-000000000033"),
        notes: "Homeowner-confirmed fixture finish"
      )
      let specification = C14_5Specification(
        currentRevision: C14_5SpecificationRevision(
          branchId: uuid("14000000-0000-4000-8000-000000000034"),
          branchRevision: 1,
          catalogReleaseId: uuid("14000000-0000-4000-8000-000000000035"),
          catalogReleaseSha256: hashC,
          lines: [line],
          modelSnapshotId: uuid("14000000-0000-4000-8000-000000000036"),
          modelSnapshotSha256: hashD,
          revision: 1,
          revisionSha256: hashA,
          sourceConfirmation: C14_5ConfirmationSource(
            confirmationId: uuid("14000000-0000-4000-8000-000000000037"),
            jobId: optionJobId,
            jobVersion: 1,
            optionId: optionOneId,
            profile: "proposed",
            resultSnapshotId: uuid("14000000-0000-4000-8000-000000000038"),
            resultSnapshotSha256: hashD,
            resultSnapshotVersion: 1
          )
        ),
        projectId: projectId,
        schemaVersion: "c13-specification-v1",
        selectionBoard: C14_5SelectionBoard(revision: 1),
        specificationId: specId,
        status: "working"
      )
      let eligibility = decodedEligibility(specification: specification)
      let renderJobId = uuid("14000000-0000-4000-8000-000000000050")
      let resultId = uuid("14000000-0000-4000-8000-000000000051")
      let artifacts = [
        artifact("14000000-0000-4000-8000-000000000052", "geometry-safe-png", "image/png"),
        artifact("14000000-0000-4000-8000-000000000053", "multilayer-exr", "image/x-exr"),
        artifact("14000000-0000-4000-8000-000000000054", "depth-exr", "image/x-exr"),
        artifact("14000000-0000-4000-8000-000000000055", "normal-exr", "image/x-exr"),
        artifact("14000000-0000-4000-8000-000000000056", "segmentation-png", "image/png"),
      ]
      return C14_5Workspace(
        session: C14_5Session(
          actor: C14_5Actor(
            displayName: "Fixture homeowner",
            role: role,
            subject: "fixture:homeowner",
            tenantId: uuid("14000000-0000-4000-8000-000000000060"),
            userId: uuid("14000000-0000-4000-8000-000000000061")
          ),
          authMode: "local-fixture",
          expiresAt: "2026-08-26T13:00:00Z"
        ),
        snapshot: C14_5Snapshot(
          id: snapshotId,
          modelId: modelId,
          profile: "existing",
          projectId: projectId,
          schemaVersion: "c4-canonical-home-v1",
          snapshotSha256: hashA,
          version: 2
        ),
        branches: [
          C14_5Branch(
            headSnapshotId: snapshotId,
            headSnapshotSha256: hashA,
            id: uuid("14000000-0000-4000-8000-000000000007"),
            modelId: modelId,
            profile: "existing",
            projectId: projectId,
            revision: 1,
            sourceSnapshotId: changedBranch
              ? uuid("14000000-0000-4000-8000-000000000008") : snapshotId
          )
        ],
        sceneJobs: [
          C14_5SceneJob(
            id: jobId,
            projectId: projectId,
            request: C14_5SceneJobRequest(label: "Confirmed twin", sourceSnapshot: source),
            safeCode: nil,
            sceneId: sceneMatchesJob
              ? sceneId : uuid("14000000-0000-4000-8000-000000000074"),
            state: "succeeded",
            version: 1
          )
        ],
        scene: changedBranch ? C14_5Scene(
          artifact: C14_5SceneArtifact(
            byteSize: 1_024,
            glbSha256: hashB,
            id: sceneArtifactId,
            manifestSha256: hashC,
            mimeType: "model/gltf-binary",
            schemaVersion: "c10-scene-artifact-v1"
          ),
          id: sceneId,
          manifest: C14_5SceneManifest(
            authority: "derived-visualisation-only",
            boundsMm: C14_5SceneBounds(
              maximum: C14_5PointMm(xMm: 8_000, yMm: 6_000, zMm: 3_000),
              minimum: C14_5PointMm(xMm: 0, yMm: 0, zMm: 0)
            ),
            counts: C14_5SceneCounts(materials: 4, meshes: 12, nodes: 24, triangles: 4_800, vertices: 2_900),
            elementMappings: [
              C14_5SceneMapping(elementId: uuid("14000000-0000-4000-8000-000000000009"), elementType: "space", status: "mapped")
            ],
            findings: [
              C14_5SceneFinding(code: "UNKNOWN_OPENING_HEIGHT", detail: "One opening height remains explicitly unknown.", severity: "information")
            ],
            schemaVersion: "c10-scene-manifest-v1",
            sourceSnapshot: source
          ),
          projectId: projectId
        ) : nil,
        brief: C14_5BriefRecord(
          brief: C14_5Brief(
            entries: [
              C14_5BriefEntry(
                category: "spatial-need",
                classification: "preference",
                id: uuid("14000000-0000-4000-8000-000000000024"),
                priority: 3,
                provenance: C14_5BriefProvenance(capturedAt: "2026-08-26T10:00:00Z", method: "user-stated", statedByUserId: uuid("14000000-0000-4000-8000-000000000061")),
                roomOrLevelElementIds: [],
                statement: "Create a calm conversation area with clearer circulation.",
                status: "active"
              )
            ],
            id: briefId,
            projectId: projectId,
            revision: 2,
            schemaVersion: "c11-design-brief-v1",
            status: "accepted"
          ),
          contentSha256: hashB
        ),
        optionJobs: [
          C14_5OptionJob(
            baseBrief: C14_5AcceptedBrief(briefId: briefId, contentSha256: hashB, revision: 2),
            id: optionJobId,
            optionCount: 2,
            projectId: projectId,
            requestedDirections: ["circulation-first", "storage-first"],
            requestedOptionCount: 2,
            safeCode: nil,
            sourceModel: C14_5OptionSource(modelId: modelId, profile: "existing", snapshotId: snapshotId, snapshotSha256: hashA, snapshotVersion: 2),
            state: "succeeded",
            version: 1
          )
        ],
        options: C14_5OptionsResponse(
          jobId: optionJobId,
          optionSet: C14_5OptionSet(jobId: optionJobId, optionIds: [optionOneId, optionTwoId], projectId: projectId, schemaVersion: "c12-design-option-set-v1", setSha256: hashC),
          options: [
            option(optionOneId, optionJobId, briefId, "Clear circulation", "circulation-first", "confirmed"),
            option(optionTwoId, optionJobId, briefId, "Layered storage", "storage-first", "rejected"),
          ],
          projectId: projectId
        ),
        recoveredConfirmation: decodedConfirmation(optionId: optionOneId),
        catalogReleases: [
          C14_5CatalogRelease(manifestSha256: hashC, releaseId: specification.currentRevision.catalogReleaseId, schemaVersion: "c13-catalog-release-v1", status: "published", version: "1.0.0")
        ],
        catalogAssets: [
          C14_5CatalogAsset(category: "floor-finish", displayName: "Warm limestone", kind: "finish", rights: C14_5CatalogRights(review: C14_5CatalogRightsReview(state: "approved"), sourceKind: "creator-owned-synthetic"), versionId: line.assetVersionId, versionSha256: hashB),
          C14_5CatalogAsset(category: "floor-finish", displayName: "Pale oak", kind: "finish", rights: C14_5CatalogRights(review: C14_5CatalogRightsReview(state: "approved"), sourceKind: "creator-owned-synthetic"), versionId: uuid("14000000-0000-4000-8000-000000000039"), versionSha256: hashC),
        ],
        specifications: [specification],
        eligibleSources: eligibility,
        renderCapabilities: C14_5RenderCapabilities(
          acceptingNewJobs: true,
          enhancementProvider: "disabled",
          hardwareEvidence: "deferred",
          profiles: [C14_5RenderProfileCapability(available: true, capability: "fixture.cpu", profileId: "cycles-cpu-geometry-safe-v1", reason: nil)]
        ),
        renderJobs: [
          C14_5RenderJob(
            id: renderJobId,
            projectId: projectId,
            request: C14_5RenderRequest(cameraId: uuid("14000000-0000-4000-8000-000000000040"), enhancement: "disabled", label: "Geometry safe", lightingPresetId: "canonical-lights-neutral-world-v1", profileId: "cycles-cpu-geometry-safe-v1", sourceSceneJobId: jobId),
            resultId: resultId,
            safeCode: nil,
            state: "succeeded",
            version: 1
          )
        ],
        renderResult: C14_5RenderResult(
          id: resultId,
          jobId: renderJobId,
          manifest: C14_5RenderManifest(artifacts: artifacts, authority: "derived-visualisation-only", resultId: resultId, schemaVersion: "c14-render-output-manifest-v1"),
          manifestSha256: hashD,
          projectId: projectId
        )
      )
    }

    static func recoverySummary() -> C14_5RecoverySummary {
      C14_5RecoverySummary(
        confirmedBranchId: uuid("14000000-0000-4000-8000-000000000007"),
        designEligible: true,
        latestRenderJobId: uuid("14000000-0000-4000-8000-000000000050"),
        latestRenderState: "succeeded",
        optionJobId: uuid("14000000-0000-4000-8000-000000000021"),
        projectId: projectId,
        sceneJobId: jobId,
        snapshotId: snapshotId,
        snapshotSha256: hashA,
        verifiedAt: Date()
      )
    }

    static func preview() -> C14_5SubstitutionPreview {
      C14_5SubstitutionPreview(
        candidateSnapshotSha256: hashD,
        elementId: uuid("14000000-0000-4000-8000-000000000032"),
        expiresAt: "2026-08-26T14:00:00Z",
        findings: ["Placement remains within the exact bounded preview."],
        previewId: uuid("14000000-0000-4000-8000-000000000070"),
        replacementAssetVersionId: uuid("14000000-0000-4000-8000-000000000039"),
        replacementAssetVersionSha256: hashC,
        schemaVersion: "c13-substitution-preview-v1",
        specificationId: uuid("14000000-0000-4000-8000-000000000030"),
        specificationRevision: 1
      )
    }

    private static func option(_ id: UUID, _ jobId: UUID, _ briefId: UUID, _ title: String, _ direction: String, _ status: String) -> C14_5DesignOption {
      C14_5DesignOption(
        assumptions: ["Existing dimensional pins remain authoritative."],
        baseBrief: C14_5AcceptedBrief(briefId: briefId, contentSha256: hashB, revision: 2),
        direction: direction,
        id: id,
        jobId: jobId,
        projectId: projectId,
        schemaVersion: "c12-design-option-v1",
        status: status,
        summary: "A distinct fixture direction for comparison.",
        title: title,
        tradeoffs: ["Balances circulation against storage capacity."],
        unknowns: ["Live product availability remains unknown."]
      )
    }

    private static func artifact(_ id: String, _ role: String, _ mediaType: String) -> C14_5RenderArtifact {
      let geometrySafe = role == "geometry-safe-png"
      return C14_5RenderArtifact(
        byteLength: geometrySafe ? geometryPNG.count : 68,
        heightPx: 64,
        id: uuid(id),
        mediaType: mediaType,
        role: role,
        schemaVersion: "c14-render-artifact-v1",
        sha256: geometrySafe ? geometryPNGSha256 : hashA,
        widthPx: 64
      )
    }

    private static func decodedConfirmation(optionId: UUID) -> OptionConfirmation {
      let json = """
        {"branchId":"14000000-0000-4000-8000-000000000034","branchRevision":1,"commitId":"14000000-0000-4000-8000-000000000071","confirmedAt":"2026-08-26T11:00:00Z","confirmedBy":"14000000-0000-4000-8000-000000000061","id":"14000000-0000-4000-8000-000000000037","idempotencyKey":"14000000-0000-4000-8000-000000000072","optionId":"\(optionId.uuidString.lowercased())","previewId":"14000000-0000-4000-8000-000000000073","projectId":"\(projectId.uuidString.lowercased())","resultSnapshotSha256":"\(hashD)","schemaVersion":"c12-option-confirmation-v1"}
        """
      return try! JSONDecoder().decode(OptionConfirmation.self, from: Data(json.utf8))
    }

    private static func decodedEligibility(specification: C14_5Specification) -> RenderEligibleSourcesResponse {
      let json = """
        {"projectId":"\(projectId.uuidString.lowercased())","schemaVersion":"c14-render-eligible-sources-v1","sources":[{"cameras":[{"cameraId":"14000000-0000-4000-8000-000000000040","label":"Living room overview"}],"label":"Confirmed proposed scene","source":{"projectId":"\(projectId.uuidString.lowercased())","sceneArtifactId":"\(sceneArtifactId.uuidString.lowercased())","sceneGlbSha256":"\(hashB)","sceneId":"\(sceneId.uuidString.lowercased())","sceneJobId":"\(jobId.uuidString.lowercased())","sceneManifestSha256":"\(hashC)","sourceSnapshotSha256":"\(hashD)","specification":{"catalogReleaseId":"\(specification.currentRevision.catalogReleaseId.uuidString.lowercased())","catalogReleaseSha256":"\(specification.currentRevision.catalogReleaseSha256)","specificationId":"\(specification.id.uuidString.lowercased())","specificationRevision":1,"specificationRevisionSha256":"\(specification.currentRevision.revisionSha256)"}}}]}
        """
      return try! JSONDecoder().decode(RenderEligibleSourcesResponse.self, from: Data(json.utf8))
    }

    private static func uuid(_ value: String) -> UUID { UUID(uuidString: value)! }
  }
#endif

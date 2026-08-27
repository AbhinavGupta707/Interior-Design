#if DEBUG
  import Foundation
  import SwiftUI

  enum C14_6UITestScenario: String {
    case coldLaunch = "cold-launch"
    case offline = "offline"
    case recoveredLaunch = "recovered-launch"

    static func current(
      configuration: AppConfiguration,
      environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Self? {
      guard configuration.environment == .local,
            environment["C14_6_UI_TEST_MODE"] == "1",
            let value = environment["C14_6_UI_TEST_SCENARIO"]
      else { return nil }
      return Self(rawValue: value)
    }
  }

  struct C14_6UITestFixtureView: View {
    let scenario: C14_6UITestScenario
    @State private var signedIn: Bool
    @State private var flow = CaptureFlowModel(capabilityChecker: C14_6FixtureCapabilityChecker())
    @State private var projects: ProjectRepository
    @State private var evidence: EvidenceRepository
    @State private var setup: C14_6HomeSetupModel
    @State private var design: C14_5DesignStudioModel

    private let actor = C14_6Actor(
      displayName: "Fixture homeowner",
      role: "owner",
      subject: "fixture-homeowner",
      tenantId: "14600000-0000-4000-8000-000000000001",
      userId: "14600000-0000-4000-8000-000000000002"
    )

    init(scenario: C14_6UITestScenario) {
      self.scenario = scenario
      _signedIn = State(initialValue: scenario == .recoveredLaunch)
      let evidence = C14_6FixtureEvidenceService(scenario: scenario)
      let resetRecovery = ProcessInfo.processInfo.environment["C14_6_UI_CLEAR_RECOVERY"] == "1"
      _projects = State(
        initialValue: ProjectRepository(
          service: C14_6FixtureProjectService(),
          recovery: C14_6UITestRecoveryStore(reset: resetRecovery)
        )
      )
      _evidence = State(initialValue: EvidenceRepository(service: evidence))
      _setup = State(
        initialValue: C14_6HomeSetupModel(
          service: C14_6FixtureHomeSetupService(),
          evidenceService: evidence
        )
      )
      _design = State(
        initialValue: C14_5DesignStudioModel(
          service: C14_5OfflineFixtureDesignService(),
          recovery: C14_5FixtureRecoveryStore(summary: nil)
        )
      )
    }

    var body: some View {
      if signedIn {
        navigation
      } else {
        coldLaunch
      }
    }

    private var coldLaunch: some View {
      NavigationStack {
        VStack(alignment: .leading, spacing: 20) {
          Image(systemName: "house.and.flag.fill")
            .font(.system(size: 52))
            .foregroundStyle(.tint)
          Text("Your home design workspace").font(.largeTitle.bold())
          Text("Sign in before any project, address context or evidence is loaded. The server session and tenant membership remain authoritative after every launch.")
            .foregroundStyle(.secondary)
          Button("Continue as local homeowner") { signedIn = true }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("c14_6.sign-in")
          Spacer()
          Text("Local UI acceptance fixture · no production identity or provider claim")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: 620, maxHeight: .infinity, alignment: .leading)
        .padding(28)
        .navigationTitle("Home Design Studio")
      }
    }

    private var navigation: some View {
      @Bindable var flow = flow
      return NavigationStack(path: $flow.path) {
        ProjectSelectionView(
          repository: projects,
          actor: actor,
          allowsFixtureFallback: false,
          environmentLabel: "Local acceptance",
          onSelect: { project in
            Task {
              if await projects.remember(project) {
                evidence.reset()
                setup.reset()
                design.reset()
                flow.reset()
                flow.selectProject(project)
              }
            }
          },
          onSignOut: {
            Task {
              await projects.clearRecovery()
              projects.reset()
              evidence.reset()
              setup.reset()
              design.reset()
              flow.reset()
              signedIn = false
            }
          }
        )
        .navigationDestination(for: CaptureRoute.self) { route in
          destination(route)
        }
      }
    }

    @ViewBuilder
    private func destination(_ route: CaptureRoute) -> some View {
      if let project = flow.selectedProject {
        switch route {
        case .projectHome:
          C14_5HomeownerHubView(
            project: project,
            designModel: design,
            readiness: setup.readiness,
            onOpenSetup: flow.openHomeSetup,
            onOpenDesign: {},
            onOpenEvidence: flow.openEvidenceWorkspace,
            onOpenCapture: {},
            onOpenMedia: {},
            onChooseProject: resetProjectState
          )
          .task { await setup.activate(projectId: project.id, role: actor.role) }
        case .homeSetup:
          C14_6HomeSetupView(
            project: project,
            role: actor.role,
            model: setup,
            onOpenCapture: {},
            onOpenEvidence: flow.openEvidenceWorkspace,
            onOpenMedia: {},
            onBackToHub: flow.openProjectHome
          )
        case .evidenceWorkspace:
          EvidenceWorkspaceView(
            repository: evidence,
            project: project,
            onCheckCapture: {},
            onDone: flow.finishBranch
          )
        default:
          ContentUnavailableView("Fixture boundary", systemImage: "testtube.2")
        }
      }
    }

    private func resetProjectState() {
      evidence.reset()
      setup.reset()
      design.reset()
      flow.reset()
    }
  }

  private struct C14_6FixtureCapabilityChecker: CaptureCapabilityChecking {
    func currentEligibility() -> CaptureEligibility {
      .unavailable(.simulatorUnsupported)
    }
  }

  private struct C14_6FixtureProjectService: ProjectServing {
    func authenticateAndListProjects() async throws -> [CaptureProject] {
      [C14_6FixtureFactory.project]
    }

    func createProject(name: String, idempotencyKey: String) async throws -> CaptureProject {
      C14_6FixtureFactory.project
    }
  }

  private actor C14_6UITestRecoveryStore: C14_6LastProjectStoring {
    private static let key = "c14_6-ui-last-project"

    init(reset: Bool) {
      if reset { UserDefaults.standard.removeObject(forKey: Self.key) }
    }

    func clear() { UserDefaults.standard.removeObject(forKey: Self.key) }
    func load() -> String? { UserDefaults.standard.string(forKey: Self.key) }
    func save(projectId: String) { UserDefaults.standard.set(projectId, forKey: Self.key) }
  }

  private actor C14_6FixtureHomeSetupService: C14_6HomeSetupServing {
    private var savedIntake = C14_6FixtureFactory.intake
    private var savedDossier: C14_6PropertyDossier? = C14_6FixtureFactory.dossier

    func intake(projectId: String) async throws -> C14_6ProjectIntake? { savedIntake }
    func dossier(projectId: String) async throws -> C14_6PropertyDossier? { savedDossier }

    func saveIntake(
      projectId: String,
      intake: C14_6HomeIntake,
      expectedVersion: Int,
      idempotencyKey: String
    ) async throws -> C14_6ProjectIntake {
      savedIntake = C14_6ProjectIntake(
        intake: intake,
        projectId: projectId,
        updatedAt: "2026-08-26T10:00:00Z",
        updatedBy: "14600000-0000-4000-8000-000000000002",
        version: expectedVersion + 1
      )
      return savedIntake
    }

    func resolve(
      projectId: String,
      query: String,
      idempotencyKey: String
    ) async throws -> C14_6PropertyResolution {
      C14_6FixtureFactory.resolution
    }

    func selectCandidate(
      projectId: String,
      candidateId: String,
      resolutionId: String,
      expectedVersion: Int,
      idempotencyKey: String
    ) async throws -> C14_6ProjectProperty {
      savedDossier = C14_6FixtureFactory.dossier(for: C14_6FixtureFactory.property)
      return C14_6FixtureFactory.property
    }

    func selectManual(
      projectId: String,
      address: C14_6PropertyAddress,
      expectedVersion: Int,
      idempotencyKey: String
    ) async throws -> C14_6ProjectProperty {
      let property = C14_6ProjectProperty(
        address: address,
        displayAddress: address.displayValue,
        identifiers: [],
        interiorKnowledgeStatus: "unknown-without-evidence",
        jurisdiction: "england",
        location: nil,
        mode: "manual",
        projectId: projectId,
        propertyId: "14600000-0000-4000-8000-000000000021",
        selectedAt: "2026-08-26T10:02:00Z",
        source: C14_6FixtureFactory.manualSource,
        updatedAt: "2026-08-26T10:02:00Z",
        version: expectedVersion + 1
      )
      savedDossier = C14_6FixtureFactory.dossier(for: property)
      return property
    }
  }

  private struct C14_6FixtureEvidenceService: EvidenceServing {
    let scenario: C14_6UITestScenario

    func list(projectId: String) async throws -> [EvidenceAsset] {
      if scenario == .offline { throw EvidenceServiceError.offline }
      return [C14_6FixtureFactory.plan]
    }
    func abort(projectId: String, sessionId: String, idempotencyKey: String) async throws {}
    func access(projectId: String, assetId: String, representation: String) async throws -> EvidenceAccess { throw EvidenceServiceError.unavailable }
    func complete(projectId: String, sessionId: String, sha256: String, parts: [CompletedEvidencePart], idempotencyKey: String) async throws -> EvidenceAsset { throw EvidenceServiceError.unavailable }
    func createSession(projectId: String, selection: EvidenceSelection, sha256: String, rights: EvidenceRightsAssertion, idempotencyKey: String) async throws -> EvidenceUploadSession { throw EvidenceServiceError.unavailable }
    func session(projectId: String, sessionId: String) async throws -> EvidenceUploadSession { throw EvidenceServiceError.unavailable }
    func signPart(projectId: String, sessionId: String, partNumber: Int, byteSize: Int, checksumSha256: String, idempotencyKey: String) async throws -> SignedEvidencePart { throw EvidenceServiceError.unavailable }
    func uploadPart(
      projectId: String,
      sessionId: String,
      fileURL: URL,
      signedPart: SignedEvidencePart
    ) async throws -> String { throw EvidenceServiceError.unavailable }
  }

  enum C14_6FixtureFactory {
    static let project = CaptureProject.projectService(
      id: "14600000-0000-4000-8000-000000000010",
      name: "Riverside terrace",
      status: "active"
    )

    static let intake = C14_6ProjectIntake(
      intake: C14_6HomeIntake(
        accessibilityNeeds: ["Step-free kitchen route"],
        addressSummary: "12 Example Mews, London",
        bathrooms: 1,
        bedrooms: 3,
        dwellingType: .terracedHouse,
        evidenceAvailable: C14_6EvidenceAvailable(
          photographs: true,
          plans: true,
          roomCapture: false,
          video: true
        ),
        goals: ["Improve kitchen storage", "Create a calmer family room"],
        household: C14_6Household(adults: 2, children: 1, pets: 1),
        levels: 2,
        mustChange: ["Poor kitchen circulation"],
        mustKeep: ["Original fireplace"],
        notes: "User-stated intent only.",
        styleWords: ["Warm", "Quiet", "Natural"]
      ),
      projectId: project.id,
      updatedAt: "2026-08-26T10:00:00Z",
      updatedBy: "14600000-0000-4000-8000-000000000002",
      version: 2
    )

    static let source = C14_6PropertySource(
      coverage: "fixture-complete",
      dataset: "Deterministic England address fixture",
      datasetVersion: "2026-08-26",
      licence: C14_6PropertyLicence(
        id: "fixture-licence",
        title: "Repository acceptance fixture",
        url: nil
      ),
      modelTrainingAllowed: false,
      participantSharingAllowed: false,
      providerId: "fixture-address",
      retrievedAt: "2026-08-26T10:00:00Z",
      serviceProcessingAllowed: true
    )

    static let manualSource = C14_6PropertySource(
      coverage: "unknown",
      dataset: "User-provided property identity",
      datasetVersion: "c3-manual-v1",
      licence: C14_6PropertyLicence(
        id: "user-provided",
        title: "User-provided project data",
        url: nil
      ),
      modelTrainingAllowed: false,
      participantSharingAllowed: true,
      providerId: "manual-entry",
      retrievedAt: "2026-08-26T10:02:00Z",
      serviceProcessingAllowed: true
    )

    static let address = C14_6PropertyAddress(
      line1: "12 Example Mews",
      line2: nil,
      locality: "London",
      postcode: "SW1A 1AA"
    )

    static let property = C14_6ProjectProperty(
      address: address,
      displayAddress: address.displayValue,
      identifiers: [C14_6PropertyIdentifier(scheme: "UPRN", value: "100023456789")],
      interiorKnowledgeStatus: "unknown-without-evidence",
      jurisdiction: "england",
      location: C14_6PropertyLocation(coordinates: [-0.14, 51.5], crs: "EPSG:4326"),
      mode: "candidate",
      projectId: project.id,
      propertyId: "14600000-0000-4000-8000-000000000020",
      selectedAt: "2026-08-26T10:00:00Z",
      source: source,
      updatedAt: "2026-08-26T10:00:00Z",
      version: 1
    )

    static let sourceRecord = C14_6PropertySourceRecord(
      fields: ["address", "uprn"],
      id: "14600000-0000-4000-8000-000000000030",
      normalizedPayloadSha256: String(repeating: "a", count: 64),
      projectId: project.id,
      propertyId: property.propertyId,
      source: source
    )

    static let dossier = C14_6PropertyDossier(
      coverageWarnings: ["Address context does not establish the exact interior."],
      generatedAt: "2026-08-26T10:00:00Z",
      interiorKnowledgeStatus: "unknown-without-evidence",
      items: [
        C14_6DossierItem(
          classification: "source-observation",
          confidencePercent: nil,
          interiorClaim: "none",
          key: "property-address",
          label: "Selected address",
          note: "Identity context only.",
          sourceRecordIds: [sourceRecord.id],
          value: .text(address.displayValue)
        )
      ],
      planningStatus: "not-reviewed",
      property: property,
      sources: [sourceRecord],
      version: 1
    )

    static func dossier(for property: C14_6ProjectProperty) -> C14_6PropertyDossier {
      let record = C14_6PropertySourceRecord(
        fields: property.mode == "manual" ? ["user-entered-address"] : ["address", "uprn"],
        id: property.mode == "manual"
          ? "14600000-0000-4000-8000-000000000031"
          : sourceRecord.id,
        normalizedPayloadSha256: property.mode == "manual"
          ? String(repeating: "c", count: 64)
          : sourceRecord.normalizedPayloadSha256,
        projectId: property.projectId,
        propertyId: property.propertyId,
        source: property.source
      )
      return C14_6PropertyDossier(
        coverageWarnings: ["Address context does not establish the exact interior."],
        generatedAt: "2026-08-26T10:02:00Z",
        interiorKnowledgeStatus: "unknown-without-evidence",
        items: [
          C14_6DossierItem(
            classification: property.mode == "manual" ? "user-stated" : "source-observation",
            confidencePercent: nil,
            interiorClaim: "none",
            key: "property-address",
            label: "Selected address",
            note: "Identity context only.",
            sourceRecordIds: [record.id],
            value: .text(property.displayAddress)
          )
        ],
        planningStatus: "not-reviewed",
        property: property,
        sources: [record],
        version: property.version
      )
    }

    static let resolution = C14_6PropertyResolution(
      candidates: [
        C14_6PropertyCandidate(
          address: address,
          candidateId: "14600000-0000-4000-8000-000000000040",
          displayAddress: address.displayValue,
          identifiers: [C14_6PropertyIdentifier(scheme: "UPRN", value: "100023456789")],
          jurisdiction: "england",
          location: C14_6PropertyLocation(coordinates: [-0.14, 51.5], crs: "EPSG:4326"),
          source: source
        )
      ],
      expiresAt: "2099-08-26T10:00:00Z",
      manualEntryAllowed: true,
      providerState: "fixture",
      resolutionId: "14600000-0000-4000-8000-000000000050",
      status: "matched"
    )

    static let plan = EvidenceAsset(
      createdAt: "2026-08-26T10:00:00Z",
      declaredMimeType: "application/pdf",
      detectedMimeType: "application/pdf",
      fileName: "rights-cleared-plan.pdf",
      id: "14600000-0000-4000-8000-000000000060",
      kind: .plan,
      projectId: project.id,
      rejectionCode: nil,
      rights: EvidenceRightsAssertion(
        attribution: nil,
        basis: .ownedByUser,
        licenceUrl: nil,
        serviceProcessingConsent: true,
        trainingUseConsent: .denied
      ),
      source: EvidenceSourceFingerprint(byteSize: 1_024, sha256: String(repeating: "b", count: 64)),
      status: .ready,
      updatedAt: "2026-08-26T10:00:00Z"
    )
  }
#endif

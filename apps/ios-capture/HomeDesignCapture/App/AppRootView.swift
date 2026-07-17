import SwiftUI

struct AppRootView: View {
  let configuration: AppConfiguration

  @State private var flow: CaptureFlowModel
  @State private var projectRepository: ProjectRepository
  @State private var evidenceRepository: EvidenceRepository
  @State private var captureWorkspaceModel: C7CaptureWorkspaceModel

  @MainActor
  init(
    configuration: AppConfiguration,
    capabilityChecker: any CaptureCapabilityChecking = SystemCaptureCapabilityChecker(),
    projectService: (any ProjectServing)? = nil,
    captureTokenProvider: (any C7CaptureTokenProviding)? = nil,
    captureLauncher: any C7CaptureLaunching = C7UnavailableCaptureLauncher(),
    captureRole: C7WorkspaceRole = .owner
  ) {
    self.configuration = configuration
    _flow = State(initialValue: CaptureFlowModel(capabilityChecker: capabilityChecker))
    let service =
      projectService
      ?? C1ProjectAPIClient(
        baseURL: configuration.apiBaseURL,
        transport: URLSessionTransport()
      )
    let refresher: any C7CaptureTokenRefreshing
    if configuration.environment == .local {
      refresher = C7LocalSessionTokenRefresher(baseURL: configuration.apiBaseURL)
    } else {
      refresher = C7UnavailableTokenRefresher()
    }
    let tokenProvider: any C7CaptureTokenProviding =
      captureTokenProvider
      ?? C7KeychainBackedTokenProvider(
        store: C7KeychainTokenStore(),
        refresher: refresher
      )
    _projectRepository = State(initialValue: ProjectRepository(service: service))
    _evidenceRepository = State(
      initialValue: EvidenceRepository(
        service: C2EvidenceAPIClient(
          baseURL: configuration.apiBaseURL,
          tokenProvider: tokenProvider
        )
      )
    )
    let captureService = C7CaptureAPIClient(
      baseURL: configuration.apiBaseURL,
      tokenProvider: tokenProvider
    )
    let captureJournal = C7ProtectedCaptureJournal()
    let captureSync = C7CaptureSyncEngine(
      service: captureService,
      journal: captureJournal
    )
    _captureWorkspaceModel = State(
      initialValue: C7CaptureWorkspaceModel(
        role: captureRole,
        service: captureService,
        journal: captureJournal,
        syncEngine: captureSync,
        captureLauncher: captureLauncher
      )
    )
  }

  var body: some View {
    @Bindable var flow = flow

    NavigationStack(path: $flow.path) {
      ProjectSelectionView(
        repository: projectRepository,
        environmentLabel: configuration.environment.displayName,
        onSelect: flow.selectProject
      )
      .navigationDestination(for: CaptureRoute.self) { route in
        destination(for: route)
      }
    }
  }

  @ViewBuilder
  private func destination(for route: CaptureRoute) -> some View {
    if let project = flow.selectedProject, let eligibility = flow.eligibility {
      switch route {
      case .evidenceWorkspace:
        EvidenceWorkspaceView(
          repository: evidenceRepository,
          project: project,
          onCheckCapture: flow.continueFromEligibility,
          onDone: flow.reset
        )
      case .eligibility:
        CaptureEligibilityView(
          project: project,
          eligibility: eligibility,
          onContinue: flow.continueFromEligibility,
          onChooseAnotherProject: flow.reset
        )
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("Evidence") { flow.openEvidenceWorkspace() }
          }
        }
      case .capturePreparation:
        C7CaptureWorkspaceView(
          model: captureWorkspaceModel,
          project: project,
          onUseManualEvidence: flow.useManualEvidence,
          onChooseAnotherProject: flow.reset
        )
      case .unsupportedCapture:
        UnsupportedCaptureView(
          project: project,
          eligibility: eligibility,
          onUseManualEvidence: flow.useManualEvidence,
          onChooseAnotherProject: flow.reset
        )
      case .manualEvidence:
        ManualEvidenceView(project: project, onDone: flow.reset)
      }
    } else {
      ContentUnavailableView(
        "Project unavailable",
        systemImage: "folder.badge.questionmark",
        description: Text("Choose a project before checking capture eligibility.")
      )
    }
  }
}

import SwiftUI

struct AppRootView: View {
  let configuration: AppConfiguration

  @State private var flow: CaptureFlowModel
  @State private var projectRepository: ProjectRepository
  @State private var evidenceRepository: EvidenceRepository

  @MainActor
  init(
    configuration: AppConfiguration,
    capabilityChecker: any CaptureCapabilityChecking = SystemCaptureCapabilityChecker(),
    projectService: (any ProjectServing)? = nil
  ) {
    self.configuration = configuration
    _flow = State(initialValue: CaptureFlowModel(capabilityChecker: capabilityChecker))
    let service = projectService ?? C1ProjectAPIClient(
      baseURL: configuration.apiBaseURL,
      transport: URLSessionTransport()
    )
    _projectRepository = State(initialValue: ProjectRepository(service: service))
    _evidenceRepository = State(
      initialValue: EvidenceRepository(
        service: C2EvidenceAPIClient(baseURL: configuration.apiBaseURL)
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
        CapturePreparationView(
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

import SwiftUI

struct AppRootView: View {
  let configuration: AppConfiguration

  @State private var flow: CaptureFlowModel

  @MainActor
  init(
    configuration: AppConfiguration,
    capabilityChecker: any CaptureCapabilityChecking = SystemCaptureCapabilityChecker()
  ) {
    self.configuration = configuration
    _flow = State(initialValue: CaptureFlowModel(capabilityChecker: capabilityChecker))
  }

  var body: some View {
    @Bindable var flow = flow

    NavigationStack(path: $flow.path) {
      ProjectSelectionView(
        projects: CaptureProject.localFixtures,
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
      case .eligibility:
        CaptureEligibilityView(
          project: project,
          eligibility: eligibility,
          onContinue: flow.continueFromEligibility,
          onChooseAnotherProject: flow.reset
        )
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

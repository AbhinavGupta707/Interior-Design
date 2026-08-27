import SwiftUI

struct AppRootView: View {
  let configuration: AppConfiguration

  @State private var authenticationModel: C14_6AuthenticationModel
  @State private var flow: CaptureFlowModel
  @State private var projectRepository: ProjectRepository
  @State private var evidenceRepository: EvidenceRepository
  @State private var captureWorkspaceModel: C7CaptureWorkspaceModel
  @State private var mediaCaptureModel: C8MediaCaptureWorkspaceModel
  @State private var guidedCaptureModel: C14_8GuidedCaptureModel
  @State private var designStudioModel: C14_5DesignStudioModel
  @State private var homeSetupModel: C14_6HomeSetupModel
  @State private var twinIntegrationModel: C14_7TwinIntegrationModel

  @MainActor
  init(
    configuration: AppConfiguration,
    capabilityChecker: any CaptureCapabilityChecking = SystemCaptureCapabilityChecker(),
    projectService: (any ProjectServing)? = nil,
    captureTokenProvider: (any C7CaptureTokenProviding)? = nil,
    captureLauncher: any C7CaptureLaunching = C7UnavailableCaptureLauncher(),
    captureRole: C7WorkspaceRole = .owner,
    mediaCamera: (any C8CameraCaptureServing)? = nil,
    mediaCapabilityProvider: any C8CameraCapabilityProviding = C8SystemCameraCapabilityProvider(),
    mediaPermissionProvider: any C8CameraPermissionProviding = C8SystemCameraPermissionProvider(),
    homeSetupService: (any C14_6HomeSetupServing)? = nil,
    twinIntegrationService: (any C14_7TwinIntegrationServing)? = nil,
    designService: (any C14_5DesignStudioServing)? = nil,
    designRecovery: (any C14_5RecoveryStoring)? = nil
  ) {
    self.configuration = configuration
    _flow = State(initialValue: CaptureFlowModel(capabilityChecker: capabilityChecker))
    let sessionTokenProvider = C14_6SessionTokenProvider(
      identity: configuration.identity,
      baseURL: configuration.apiBaseURL
    )
    _authenticationModel = State(
      initialValue: C14_6AuthenticationModel(
        identity: configuration.identity,
        tokenProvider: sessionTokenProvider,
        sessionClient: C14_6SessionAPIClient(
          baseURL: configuration.apiBaseURL,
          tokenProvider: sessionTokenProvider
        )
      )
    )
    let tokenProvider: any C7CaptureTokenProviding =
      captureTokenProvider
      ?? sessionTokenProvider
    let service =
      projectService
      ?? C1ProjectAPIClient(
        baseURL: configuration.apiBaseURL,
        transport: URLSessionTransport(),
        tokenProvider: tokenProvider
      )
    _projectRepository = State(initialValue: ProjectRepository(service: service))
    let evidenceService = C2EvidenceAPIClient(
      baseURL: configuration.apiBaseURL,
      tokenProvider: tokenProvider
    )
    _evidenceRepository = State(initialValue: EvidenceRepository(service: evidenceService))
    _homeSetupModel = State(
      initialValue: C14_6HomeSetupModel(
        service: homeSetupService
          ?? C14_6HomeSetupAPIClient(
            baseURL: configuration.apiBaseURL,
            tokenProvider: tokenProvider
          ),
        evidenceService: evidenceService
      )
    )
    _twinIntegrationModel = State(
      initialValue: C14_7TwinIntegrationModel(
        service: twinIntegrationService
          ?? C14_7TwinIntegrationAPIClient(
            baseURL: configuration.apiBaseURL,
            tokenProvider: tokenProvider,
            evidence: evidenceService
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
    let resolvedMediaCamera: any C8CameraCaptureServing
    if let mediaCamera {
      resolvedMediaCamera = mediaCamera
    } else {
      #if targetEnvironment(simulator)
        resolvedMediaCamera = C8SyntheticCameraEngine()
      #else
        resolvedMediaCamera = C8AVFoundationCameraEngine()
      #endif
    }
    _mediaCaptureModel = State(
      initialValue: C8MediaCaptureWorkspaceModel(
        camera: resolvedMediaCamera,
        capabilityProvider: mediaCapabilityProvider,
        permissionProvider: mediaPermissionProvider,
        uploader: C8ImmutableEvidenceUploader(service: evidenceService)
      )
    )
    let guidedCapabilityProvider = C14_8SystemCapabilityProvider()
    let guidedEngine: any C14_8GuidedCaptureServing
    #if DEBUG && targetEnvironment(simulator)
      guidedEngine = C14_8FixtureGuidedCaptureEngine()
    #else
      guidedEngine = C14_8ARKitGuidedCaptureEngine(
        capability: guidedCapabilityProvider.current()
      )
    #endif
    _guidedCaptureModel = State(
      initialValue: C14_8GuidedCaptureModel(
        capabilityProvider: guidedCapabilityProvider,
        permissionProvider: mediaPermissionProvider,
        engine: guidedEngine,
        captureService: captureService,
        envelopeService: C14_8CaptureEnvelopeAPIClient(
          baseURL: configuration.apiBaseURL,
          tokenProvider: tokenProvider
        ),
        evidenceService: evidenceService,
        mediaUploader: C8ImmutableEvidenceUploader(service: evidenceService),
        depthUploader: C14_8DepthUploader(service: captureService)
      )
    )
    let resolvedDesignService =
      designService
      ?? C14_5DesignStudioAPIClient(
        baseURL: configuration.apiBaseURL,
        tokenProvider: tokenProvider
      )
    _designStudioModel = State(
      initialValue: C14_5DesignStudioModel(
        service: resolvedDesignService,
        recovery: designRecovery ?? C14_5ProtectedRecoveryStore()
      )
    )
  }

  var body: some View {
    Group {
      if let session = authenticationModel.session {
        authenticatedRoot(session: session)
      } else {
        C14_6AuthenticationView(
          model: authenticationModel,
          environmentLabel: configuration.environment.displayName
        )
      }
    }
    .task {
      if authenticationModel.state == .restoring {
        await authenticationModel.restore()
      }
    }
  }

  private func authenticatedRoot(session: C14_6Session) -> some View {
    @Bindable var flow = flow

    return NavigationStack(path: $flow.path) {
      ProjectSelectionView(
        repository: projectRepository,
        actor: session.actor,
        allowsFixtureFallback: configuration.environment == .local,
        environmentLabel: configuration.environment.displayName,
        onSelect: selectProject,
        onSignOut: { Task { await signOut() } }
      )
      .navigationDestination(for: CaptureRoute.self) { route in
        destination(for: route, session: session)
      }
    }
  }

  @ViewBuilder
  private func destination(for route: CaptureRoute, session: C14_6Session) -> some View {
    if let project = flow.selectedProject, let eligibility = flow.eligibility {
      switch route {
      case .projectHome:
        C14_5HomeownerHubView(
          project: project,
          designModel: designStudioModel,
          twinModel: twinIntegrationModel,
          readiness: homeSetupModel.readiness,
          onOpenSetup: flow.openHomeSetup,
          onOpenDesign: flow.openDesignStudio,
          onOpenTwin: flow.openTwinIntegration,
          onOpenEvidence: flow.openEvidenceWorkspace,
          onOpenGuided: flow.openGuidedCapture,
          onOpenCapture: flow.openCaptureEligibility,
          onOpenMedia: flow.openMediaCapture,
          onChooseProject: chooseProject
        )
        .task {
          await homeSetupModel.activate(projectId: project.id, role: session.actor.role)
        }
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("Sign out") { Task { await signOut() } }
          }
        }
      case .homeSetup:
        C14_6HomeSetupView(
          project: project,
          role: session.actor.role,
          model: homeSetupModel,
          onOpenCapture: flow.openCaptureEligibility,
          onOpenEvidence: flow.openEvidenceWorkspace,
          onOpenMedia: flow.openMediaCapture,
          onBackToHub: flow.openProjectHome
        )
      case .twinIntegration:
        C14_7TwinIntegrationView(
          project: project,
          model: twinIntegrationModel,
          onContinueToDesign: {
            Task {
              await designStudioModel.activate(projectId: project.id, force: true)
              if designStudioModel.designEligible { flow.openDesignStudio() }
            }
          },
          onBackToHub: flow.openProjectHome
        )
      case .designStudio:
        C14_5DesignStudioView(
          project: project,
          model: designStudioModel,
          onBackToHub: flow.openProjectHome
        )
      case .evidenceWorkspace:
        EvidenceWorkspaceView(
          repository: evidenceRepository,
          project: project,
          onCheckCapture: flow.continueFromEligibility,
          onDone: finishBranch
        )
      case .guidedCapture:
        C14_8GuidedCaptureView(
          model: guidedCaptureModel,
          project: project,
          actor: session.actor,
          onOpenEvidence: flow.openEvidenceWorkspace,
          onOpenRoomPlan: flow.openCaptureEligibility,
          onDone: finishBranch
        )
      case .eligibility:
        CaptureEligibilityView(
          project: project,
          eligibility: eligibility,
          onContinue: flow.continueFromEligibility,
          onChooseAnotherProject: chooseProject
        )
        .toolbar {
          ToolbarItemGroup(placement: .topBarTrailing) {
            Button("Photo/video") { flow.openMediaCapture() }
            Button("Evidence") { flow.openEvidenceWorkspace() }
          }
        }
      case .mediaCapture:
        C8MediaCaptureWorkspaceView(
          model: mediaCaptureModel,
          project: project,
          onOpenEvidence: flow.openEvidenceWorkspace,
          onDone: finishBranch
        )
      case .capturePreparation:
        C7CaptureWorkspaceView(
          model: captureWorkspaceModel,
          project: project,
          onUseManualEvidence: flow.useManualEvidence,
          onChooseAnotherProject: chooseProject
        )
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("Photo/video") { flow.openMediaCapture() }
          }
        }
      case .unsupportedCapture:
        UnsupportedCaptureView(
          project: project,
          eligibility: eligibility,
          onUseManualEvidence: flow.useManualEvidence,
          onChooseAnotherProject: chooseProject
        )
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button("Photo/video") { flow.openMediaCapture() }
          }
        }
      case .manualEvidence:
        ManualEvidenceView(
          project: project,
          onOpenEvidence: flow.openEvidenceWorkspace,
          onDone: finishBranch
        )
      }
    } else {
      ContentUnavailableView(
        "Project unavailable",
        systemImage: "folder.badge.questionmark",
        description: Text("Choose a project before checking capture eligibility.")
      )
    }
  }

  private func selectProject(_ project: CaptureProject) {
    resetProjectState()
    flow.selectProject(project)
  }

  private func finishBranch() {
    flow.finishBranch()
    guard let project = flow.selectedProject, let session = authenticationModel.session else { return }
    Task {
      await homeSetupModel.activate(
        projectId: project.id,
        role: session.actor.role,
        force: true
      )
    }
  }

  private func chooseProject() {
    Task {
      await projectRepository.clearRecovery()
      resetProjectState()
    }
  }

  private func signOut() async {
    await projectRepository.clearRecovery()
    projectRepository.reset()
    resetProjectState()
    await authenticationModel.signOut()
  }

  private func resetProjectState() {
    homeSetupModel.reset()
    twinIntegrationModel.reset()
    designStudioModel.reset()
    evidenceRepository.reset()
    captureWorkspaceModel.reset()
    mediaCaptureModel.reset()
    guidedCaptureModel.reset()
    flow.reset()
  }
}

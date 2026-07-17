#if DEBUG
  import SwiftUI

  /// A deterministic, local-only presentation fixture for integrated XCUITests.
  ///
  /// The entire protocol is compiled out of Release builds. It deliberately does
  /// not initialise RoomPlan, networking, credentials, or capture persistence and
  /// visibly identifies its output as synthetic evidence.
  enum C7UITestFixtureScenario: Equatable {
    private enum Key {
      static let mode = "C7_UI_TEST_MODE"
      static let scenario = "C7_UI_TEST_SCENARIO"
    }

    case named(String)

    static func current(
      configuration: AppConfiguration,
      environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> C7UITestFixtureScenario? {
      guard
        configuration.environment == .local,
        environment[Key.mode] == "1",
        let rawScenario = environment[Key.scenario]?.trimmingCharacters(
          in: .whitespacesAndNewlines
        ),
        !rawScenario.isEmpty
      else { return nil }

      return .named(rawScenario)
    }

    var name: String {
      switch self {
      case .named(let name): name
      }
    }
  }

  struct C7UITestFixtureView: View {
    @Environment(\.scenePhase) private var scenePhase

    let scenario: C7UITestFixtureScenario

    @State private var screen: Screen
    @State private var serverReconciled = false
    @State private var resumedWithoutSensor = false
    @State private var movedToBackground = false

    init(scenario: C7UITestFixtureScenario) {
      self.scenario = scenario
      _screen = State(initialValue: Self.initialScreen(for: scenario.name))
    }

    var body: some View {
      ZStack {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            Text("C7 integrated acceptance fixture")
              .font(.title2.bold())

            Text("Synthetic fixture — not physical RoomPlan evidence")
              .font(.callout)
              .foregroundStyle(.secondary)
              .accessibilityIdentifier("c7.copy.synthetic-fixture")

            Text("The simulator does not prove RoomPlan or LiDAR behaviour.")
              .font(.callout)
              .foregroundStyle(.secondary)
              .accessibilityIdentifier("c7.copy.simulator-not-roomplan")

            screenContent
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding()
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier(screen.identifier)
      .onChange(of: scenePhase) { _, phase in
        handleScenePhase(phase)
      }
    }

    @ViewBuilder
    private var screenContent: some View {
      switch screen {
      case .scenario(let name):
        Text(Self.scenarioTitle(name))
          .font(.headline)
          .accessibilityIdentifier("c7.scenario.\(name)")

      case .state(let state):
        Text(Self.stateTitle(state))
          .font(.headline)

        stateDetails(state)
        stateActions(state)
      }
    }

    @ViewBuilder
    private func stateDetails(_ state: StateName) -> some View {
      switch state {
      case .scanning where scenario.name == "state-scanning-guidance":
        ForEach(Self.captureInstructions, id: \.self) { instruction in
          Text(Self.instructionCopy(instruction))
            .accessibilityIdentifier("c7.instruction.\(instruction)")
        }
        Text("Capture quality signals guide rescanning; they are not metric-accuracy claims.")
          .accessibilityIdentifier("c7.copy.quality-not-metric-accuracy")
        Text("Reference measurement: user asserted")
          .accessibilityIdentifier("c7.reference.user-asserted")

      case .roomReview:
        Text("Room 1 · source SHA-256 verified")
          .accessibilityIdentifier("c7.review.source-hash")
        Text("Room 1")
          .accessibilityIdentifier("c7.review.room-row")

      case .structureReview:
        Text("Room 1")
          .accessibilityIdentifier("c7.review.room-row")
        Text("Room 2")
          .accessibilityIdentifier("c7.review.room-row")
        Text("Both rooms share the captured structure world origin.")
          .accessibilityIdentifier("c7.review.shared-world-origin")

      case .abstained where scenario.name == "structure-incompatible-world-space":
        Text("INCOMPATIBLE_WORLD_SPACE")
          .accessibilityIdentifier("c7.safe-code.INCOMPATIBLE_WORLD_SPACE")

      case .offlineUpload:
        Text("2 persisted parts with local checksums")
          .accessibilityIdentifier("c7.upload.persisted-checksum-count")

      case .uploading:
        if serverReconciled {
          Text("Server part list reconciled against persisted checksums")
            .accessibilityIdentifier("c7.upload.server-reconciled")
        }
        if resumedWithoutSensor {
          Text("Resumed persisted upload only; live sensors were not restarted")
            .accessibilityIdentifier("c7.upload.no-live-sensor-resume")
        }

      case .safeFailure where scenario.name == "interruption-restart-required":
        Text("RELOCALISATION_FAILED")
          .accessibilityIdentifier("c7.safe-code.RELOCALISATION_FAILED")

      default:
        EmptyView()
      }
    }

    @ViewBuilder
    private func stateActions(_ state: StateName) -> some View {
      if state == .unsupported || state == .permissionDenied {
        Button("Use manual evidence") {
          screen = .state(.manualFallback)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c7.action.manual-fallback")
      }

      if state == .scanning, scenario.name == "state-scanning-guidance" {
        Button("Add reference measurement") {}
          .buttonStyle(.bordered)
          .accessibilityIdentifier("c7.action.add-reference-measurement")
      }

      if state == .interrupted, scenario.name == "interruption-relocalises" {
        Button("Attempt relocalisation") {
          screen = .state(.relocalising)
          Task { @MainActor in
            // Keep the explicit relocalising state observable to assistive
            // technology and XCUITest before the deterministic recovery fires.
            try? await Task.sleep(for: .seconds(2))
            guard screen == .state(.relocalising) else { return }
            screen = .state(.scanning)
          }
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c7.action.attempt-relocalisation")
      }

      if state == .safeFailure, scenario.name == "interruption-restart-required" {
        Button("Restart safely") {
          screen = .state(.ready)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c7.action.safe-restart")
      }

      if state == .roomReview {
        Button("Accept room") {}
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("c7.action.accept-room")
      }

      if state == .structureReview {
        Button("Accept structure") {
          screen = .state(.packaging)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c7.action.accept-structure")
      }

      if state == .offlineUpload {
        Button("Restore network") {
          serverReconciled = true
          screen = .state(.uploading)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c7.action.restore-network")
      }

      if state == .pausedUpload {
        Button("Resume upload") {
          resumedWithoutSensor = true
          screen = .state(.uploading)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c7.action.resume-upload")
      }

      if state == .uploading, scenario.name == "upload-cancellable" {
        Button("Cancel upload") {
          screen = .state(.cancelled)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("c7.action.cancel")
      }

      if state == .safeFailure, scenario.name == "processing-retryable-failure" {
        Button("Retry processing") {
          screen = .state(.processing)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c7.action.retry")
      }
    }

    private func handleScenePhase(_ phase: ScenePhase) {
      if phase != .active, screen == .state(.uploading), serverReconciled {
        movedToBackground = true
      }
      if phase == .active, movedToBackground {
        screen = .state(.pausedUpload)
        movedToBackground = false
      }
    }

    private static func initialScreen(for scenario: String) -> Screen {
      if scenario.hasPrefix("state-") {
        let suffix = String(scenario.dropFirst("state-".count))
        if suffix == "scanning-guidance" { return .state(.scanning) }
        return .state(StateName(rawValue: suffix) ?? .safeFailure)
      }

      switch scenario {
      case "project-loading", "project-empty", "project-offline", "brief-loading",
        "brief-expired", "brief-forbidden":
        return .scenario(scenario)
      case "capability-unsupported":
        return .state(.unsupported)
      case "permission-not-determined":
        return .state(.permissionNotDetermined)
      case "permission-denied":
        return .state(.permissionDenied)
      case "permission-restricted":
        return .state(.permissionRestricted)
      case "permission-authorised":
        return .state(.ready)
      case "interruption-relocalises":
        return .state(.interrupted)
      case "interruption-restart-required", "processing-retryable-failure",
        "processing-terminal-failure":
        return .state(.safeFailure)
      case "structure-incompatible-world-space":
        return .state(.abstained)
      case "offline-upload-with-persisted-parts":
        return .state(.offlineUpload)
      case "upload-cancellable":
        return .state(.uploading)
      default:
        if scenario.hasPrefix("server-") {
          return .state(serverState(String(scenario.dropFirst("server-".count))))
        }
        return .state(.safeFailure)
      }
    }

    private static func serverState(_ value: String) -> StateName {
      switch value {
      case "created": .ready
      case "uploading": .uploading
      case "uploaded", "processing": .processing
      case "proposed": .proposed
      case "abstained": .abstained
      case "cancel-requested", "cancelled": .cancelled
      default: .safeFailure
      }
    }

    private static func scenarioTitle(_ scenario: String) -> String {
      switch scenario {
      case "project-loading": "Loading projects"
      case "project-empty": "No projects available"
      case "project-offline": "Projects unavailable offline"
      case "brief-loading": "Loading capture brief"
      case "brief-expired": "Capture brief expired"
      case "brief-forbidden": "Capture brief access forbidden"
      default: "Fixture scenario"
      }
    }

    private static func stateTitle(_ state: StateName) -> String {
      state.rawValue.replacingOccurrences(of: "-", with: " ").capitalized
    }

    private static let captureInstructions = [
      "normal", "move-close-to-wall", "move-away-from-wall", "turn-on-light", "slow-down",
      "low-texture",
    ]

    private static func instructionCopy(_ instruction: String) -> String {
      switch instruction {
      case "normal": "Continue scanning"
      case "move-close-to-wall": "Move closer to the wall"
      case "move-away-from-wall": "Move away from the wall"
      case "turn-on-light": "Turn on more light"
      case "slow-down": "Slow down"
      default: "Low-texture surface — change angle"
      }
    }
  }

  private extension C7UITestFixtureView {
    enum Screen: Equatable {
      case scenario(String)
      case state(StateName)

      var identifier: String {
        switch self {
        case .scenario(let name): "c7.scenario.\(name)"
        case .state(let state): "c7.state.\(state.rawValue)"
        }
      }
    }

    enum StateName: String, Equatable {
      case capabilityChecking = "capability-checking"
      case unsupported
      case permissionNotDetermined = "permission-not-determined"
      case permissionDenied = "permission-denied"
      case permissionRestricted = "permission-restricted"
      case ready
      case scanning
      case interrupted
      case relocalising
      case roomReview = "room-review"
      case structureReview = "structure-review"
      case packaging
      case offlineUpload = "offline-upload"
      case pausedUpload = "paused-upload"
      case uploading
      case processing
      case proposed
      case abstained
      case cancelled
      case safeFailure = "safe-failure"
      case manualFallback = "manual-fallback"
    }
  }
#endif

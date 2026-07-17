#if DEBUG
  import SwiftUI

  /// Deterministic presentation-only C8 states for integrated Simulator acceptance.
  ///
  /// This entire surface is compiled out of Release builds. It never initialises a
  /// camera, storage, networking, reconstruction tool, provider, or credential and
  /// visibly labels every state as synthetic rather than physical/runtime evidence.
  enum C8UITestFixtureScenario: String, CaseIterable, Equatable {
    private enum Key {
      static let mode = "C8_UI_TEST_MODE"
      static let scenario = "C8_UI_TEST_SCENARIO"
    }

    case permissionDenied = "permission-denied"
    case interrupted
    case depthUnavailable = "depth-unavailable"
    case appearanceToolUnavailable = "appearance-tool-unavailable"
    case partial
    case disconnected
    case unknownScale = "unknown-scale"
    case completed
    case safeError = "safe-error"

    static func current(
      configuration: AppConfiguration,
      environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> C8UITestFixtureScenario? {
      guard
        configuration.environment == .local,
        environment[Key.mode] == "1",
        let rawScenario = environment[Key.scenario]?.trimmingCharacters(
          in: .whitespacesAndNewlines
        )
      else { return nil }

      return Self(rawValue: rawScenario)
    }
  }

  struct C8UITestFixtureView: View {
    let scenario: C8UITestFixtureScenario

    @State private var screen: Screen

    init(scenario: C8UITestFixtureScenario) {
      self.scenario = scenario
      _screen = State(initialValue: Self.initialScreen(for: scenario))
    }

    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          Text("C8 integrated reconstruction acceptance")
            .font(.title2.bold())

          Text("Visibly synthetic fixture — not camera, depth, provider, GPU, or algorithm evidence")
            .font(.callout)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("c8.copy.synthetic-fixture")

          Text("Service processing is allowed for this fixture. Training use is denied.")
            .accessibilityIdentifier("c8.copy.training-denied")

          Text("Geometry remains a proposal only and cannot mutate the canonical home.")
            .accessibilityIdentifier("c8.copy.geometry-proposal-only")

          screenContent
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier(screen.identifier)
    }

    @ViewBuilder
    private var screenContent: some View {
      Text(screen.title)
        .font(.headline)

      switch screen {
      case .permissionDenied:
        Text("Camera access is denied. Existing rights-cleared evidence remains available.")
        Button("Open camera settings") {}
          .buttonStyle(.bordered)
          .accessibilityIdentifier("c8.action.open-settings")
        Button("Use rights-cleared import") {
          screen = .importFallback
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c8.action.use-rights-cleared-import")

      case .importFallback:
        Text("Select an immutable C2 photo or video. No camera permission is required.")

      case .interrupted:
        Text("Attempt one ended without publication. A late worker remains fenced.")
          .accessibilityIdentifier("c8.copy.attempt-one-terminal")
        Button("Start replacement attempt") {
          screen = .ready
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("c8.action.start-replacement-attempt")

      case .ready:
        Text("Attempt two owns the current durable fence; attempt one cannot publish.")
          .accessibilityIdentifier("c8.copy.replacement-fenced")

      case .depthUnavailable:
        Text("Depth is unavailable in this exact runtime. RGB reconstruction can continue honestly.")
        Text("Scale remains unknown until independent validation.")
          .accessibilityIdentifier("c8.copy.scale-unknown-until-validated")
        Button("Continue RGB only") {}
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("c8.action.continue-rgb-only")

      case .appearanceUnavailable:
        Text("APPEARANCE_TOOL_UNAVAILABLE")
          .accessibilityIdentifier("c8.safe-code.APPEARANCE_TOOL_UNAVAILABLE")
        Text("The proposal geometry and its diagnostics remain available.")
          .accessibilityIdentifier("c8.copy.geometry-proposal-preserved")

      case .partial:
        Text("Registered 7 of 12 prepared frames.")
          .accessibilityIdentifier("c8.diagnostic.registered-frames")

      case .disconnected:
        Text("Two disconnected reconstruction components require review.")
          .accessibilityIdentifier("c8.diagnostic.component-count")

      case .unknownScale:
        Text("Coordinates remain in arbitrary units until a valid alignment establishes scale.")
          .accessibilityIdentifier("c8.diagnostic.arbitrary-units")

      case .completed:
        Text("Optional appearance is non-dimensional and remains separate from geometry.")
          .accessibilityIdentifier("c8.diagnostic.non-dimensional-appearance")

      case .safeError:
        Text("RECONSTRUCTION_UNAVAILABLE")
          .accessibilityIdentifier("c8.safe-code.RECONSTRUCTION_UNAVAILABLE")
        Button("Retry reconstruction") {}
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("c8.action.retry")
      }
    }

    private static func initialScreen(for scenario: C8UITestFixtureScenario) -> Screen {
      switch scenario {
      case .permissionDenied: .permissionDenied
      case .interrupted: .interrupted
      case .depthUnavailable: .depthUnavailable
      case .appearanceToolUnavailable: .appearanceUnavailable
      case .partial: .partial
      case .disconnected: .disconnected
      case .unknownScale: .unknownScale
      case .completed: .completed
      case .safeError: .safeError
      }
    }
  }

  private extension C8UITestFixtureView {
    enum Screen: String {
      case permissionDenied = "permission-denied"
      case importFallback = "import-fallback"
      case interrupted
      case ready
      case depthUnavailable = "depth-unavailable"
      case appearanceUnavailable = "appearance-unavailable"
      case partial
      case disconnected
      case unknownScale = "unknown-scale"
      case completed
      case safeError = "safe-error"

      var identifier: String { "c8.state.\(rawValue)" }

      var title: String {
        rawValue.replacingOccurrences(of: "-", with: " ").capitalized
      }
    }
  }
#endif

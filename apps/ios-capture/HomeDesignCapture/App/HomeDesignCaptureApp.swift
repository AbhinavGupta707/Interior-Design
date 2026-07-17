import SwiftUI

@main
struct HomeDesignCaptureApp: App {
  private let bootstrap: ConfigurationBootstrap

  init() {
    do {
      bootstrap = .ready(try AppConfigurationLoader.live.load())
    } catch {
      bootstrap = .failed(error.localizedDescription)
    }
  }

  var body: some Scene {
    WindowGroup {
      switch bootstrap {
      case .ready(let configuration):
        #if DEBUG
          if let scenario = C7UITestFixtureScenario.current(configuration: configuration) {
            C7UITestFixtureView(scenario: scenario)
          } else {
            AppRootView(configuration: configuration)
          }
        #else
          AppRootView(configuration: configuration)
        #endif
      case .failed(let message):
        ConfigurationFailureView(message: message)
      }
    }
  }
}

private enum ConfigurationBootstrap {
  case ready(AppConfiguration)
  case failed(String)
}

private struct ConfigurationFailureView: View {
  let message: String

  var body: some View {
    ContentUnavailableView {
      Label("Configuration unavailable", systemImage: "exclamationmark.triangle")
    } description: {
      Text(message)
    } actions: {
      Text("Check the runtime configuration instructions in the iOS README.")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }
}

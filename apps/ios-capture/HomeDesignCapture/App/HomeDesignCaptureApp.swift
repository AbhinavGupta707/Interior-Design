import SwiftUI

@main
struct HomeDesignCaptureApp: App {
  @UIApplicationDelegateAdaptor(HomeDesignCaptureAppDelegate.self)
  private var applicationDelegate

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
          if let scenario = C14_8UITestScenario.current(configuration: configuration) {
            C14_8UITestFixtureView(scenario: scenario, configuration: configuration)
          } else if let scenario = C14_7UITestScenario.current(configuration: configuration) {
            C14_7UITestFixtureView(scenario: scenario)
          } else if let scenario = C14_6UITestScenario.current(configuration: configuration) {
            C14_6UITestFixtureView(scenario: scenario)
          } else if let scenario = C14_5UITestScenario.current() {
            C14_5UITestFixtureView(scenario: scenario)
          } else if let scenario = C8UITestFixtureScenario.current(configuration: configuration) {
            C8UITestFixtureView(scenario: scenario)
          } else if let scenario = C7UITestFixtureScenario.current(configuration: configuration) {
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

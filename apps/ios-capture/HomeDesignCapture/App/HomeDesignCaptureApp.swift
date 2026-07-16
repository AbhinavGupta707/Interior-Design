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
        AppRootView(configuration: configuration)
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

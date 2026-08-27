import UIKit

final class HomeDesignCaptureAppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    BackgroundFileUploadCoordinator.shared.handleEvents(
      for: identifier,
      completionHandler: completionHandler
    )
  }
}

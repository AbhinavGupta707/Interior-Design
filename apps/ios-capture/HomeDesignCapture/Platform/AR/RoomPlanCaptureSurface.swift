import RoomPlan
import SwiftUI
import UIKit

/// SwiftUI bridge for the real RoomPlan camera surface. The adapter is created
/// only after capability and camera permission succeed on physical hardware.
@MainActor
struct RoomPlanCaptureSurface: UIViewRepresentable {
  let engine: RoomPlanCaptureEngineAdapter

  func makeUIView(context: Context) -> RoomPlanCaptureContainerView {
    let container = RoomPlanCaptureContainerView()
    container.install(engine.captureView)
    return container
  }

  func updateUIView(_ container: RoomPlanCaptureContainerView, context: Context) {
    container.install(engine.captureView)
  }
}

@MainActor
final class RoomPlanCaptureContainerView: UIView {
  private weak var installedCaptureView: RoomCaptureView?

  func install(_ captureView: RoomCaptureView) {
    guard installedCaptureView !== captureView else { return }
    installedCaptureView?.removeFromSuperview()
    installedCaptureView = captureView
    captureView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(captureView)
    NSLayoutConstraint.activate([
      captureView.leadingAnchor.constraint(equalTo: leadingAnchor),
      captureView.trailingAnchor.constraint(equalTo: trailingAnchor),
      captureView.topAnchor.constraint(equalTo: topAnchor),
      captureView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }
}

import SwiftUI

struct CapturePreparationView: View {
  let project: CaptureProject
  let onUseManualEvidence: () -> Void
  let onChooseAnotherProject: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label("Device eligible", systemImage: "viewfinder.circle")
    } description: {
      Text("\(project.name) can use a future native RoomPlan flow. C0 intentionally does not start camera or AR capture; C7 adds the resumable session and physical-device evidence.")
    } actions: {
      VStack(spacing: 12) {
        Button("Use manual evidence instead", action: onUseManualEvidence)
          .buttonStyle(.borderedProminent)
        Button("Choose another project", action: onChooseAnotherProject)
          .buttonStyle(.bordered)
      }
    }
    .navigationTitle("Capture status")
    .navigationBarTitleDisplayMode(.inline)
  }
}

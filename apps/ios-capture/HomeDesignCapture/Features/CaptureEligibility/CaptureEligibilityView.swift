import SwiftUI

struct CaptureEligibilityView: View {
  let project: CaptureProject
  let eligibility: CaptureEligibility
  let onContinue: () -> Void
  let onChooseAnotherProject: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        VStack(alignment: .leading, spacing: 12) {
          Image(systemName: presentation.icon)
            .font(.system(size: 42))
            .foregroundStyle(presentation.tint)
            .accessibilityHidden(true)
          Text(presentation.title)
            .font(.largeTitle.bold())
          Text(presentation.message)
            .font(.body)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)

        GroupBox("Selected project") {
          LabeledContent("Project", value: project.name)
          LabeledContent("Source", value: project.isFixture ? "Local fixture" : "Project service")
        }

        GroupBox("C0 boundary") {
          Text("This build checks availability but does not request camera access or create a RoomPlan/ARKit session. Native capture lifecycle is implemented and field-tested in C7.")
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        Button(presentation.actionTitle, action: onContinue)
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .frame(maxWidth: .infinity)
      }
      .padding()
      .frame(maxWidth: 640)
      .frame(maxWidth: .infinity)
    }
    .navigationTitle("Capture eligibility")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Change project", action: onChooseAnotherProject)
      }
    }
  }

  private var presentation: EligibilityPresentation {
    switch eligibility {
    case .eligible:
      EligibilityPresentation(
        title: "Room capture is supported",
        message: "RoomPlan reports that this physical device is eligible. This C0 shell still stops before starting a capture session.",
        icon: "checkmark.circle.fill",
        tint: .green,
        actionTitle: "Review capture status"
      )
    case .unavailable(.simulatorUnsupported):
      EligibilityPresentation(
        title: "Room capture is unavailable in Simulator",
        message: "Simulator can test navigation and application states, but it has no camera, LiDAR scan, AR tracking, or RoomPlan capture.",
        icon: "iphone.slash",
        tint: .orange,
        actionTitle: "View manual evidence route"
      )
    case .unavailable(.roomPlanUnsupported):
      EligibilityPresentation(
        title: "Room capture is unavailable on this device",
        message: "RoomPlan does not report capture support for this physical device. You can still provide plans, photos, and measurements.",
        icon: "sensor.tag.radiowaves.forward.slash",
        tint: .orange,
        actionTitle: "View manual evidence route"
      )
    }
  }
}

private struct EligibilityPresentation {
  let title: String
  let message: String
  let icon: String
  let tint: Color
  let actionTitle: String
}

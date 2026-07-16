import SwiftUI

struct UnsupportedCaptureView: View {
  let project: CaptureProject
  let eligibility: CaptureEligibility
  let onUseManualEvidence: () -> Void
  let onChooseAnotherProject: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Label("Use manual evidence", systemImage: "doc.viewfinder")
          .font(.largeTitle.bold())
          .foregroundStyle(.primary)

        Text(reasonText)
          .foregroundStyle(.secondary)

        VStack(alignment: .leading, spacing: 14) {
          fallbackRow(icon: "doc", title: "Add an existing floor plan")
          fallbackRow(icon: "camera", title: "Take clear room photographs")
          fallbackRow(icon: "ruler", title: "Record reference measurements")
        }
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))

        Text("These sources remain evidence. They do not become verified dimensions or structural truth without review and an authorised canonical-model operation.")
          .font(.footnote)
          .foregroundStyle(.secondary)

        Button("Continue with manual evidence", action: onUseManualEvidence)
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .frame(maxWidth: .infinity)

        Button("Choose another project", action: onChooseAnotherProject)
          .buttonStyle(.bordered)
          .frame(maxWidth: .infinity)
      }
      .padding()
      .frame(maxWidth: 640)
      .frame(maxWidth: .infinity)
    }
    .navigationTitle(project.name)
    .navigationBarTitleDisplayMode(.inline)
  }

  private var reasonText: String {
    switch eligibility {
    case .unavailable(.simulatorUnsupported):
      "This Simulator run proves the fallback navigation state only. It cannot produce capture evidence."
    case .unavailable(.roomPlanUnsupported):
      "This device cannot offer the RoomPlan route, so use plans, photos, and measurements instead."
    case .eligible:
      "Manual evidence remains available when native capture is supported but not appropriate."
    }
  }

  private func fallbackRow(icon: String, title: String) -> some View {
    Label(title, systemImage: icon)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .combine)
  }
}

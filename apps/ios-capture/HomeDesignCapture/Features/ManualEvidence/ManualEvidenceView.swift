import SwiftUI

struct ManualEvidenceView: View {
  let project: CaptureProject
  let onOpenEvidence: () -> Void
  let onDone: () -> Void

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Text("Manual evidence route")
            .font(.title2.bold())
          Text(
            "Prepare these sources for \(project.name), then continue to the secure evidence workspace."
          )
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
      }

      Section("Checklist") {
        EvidenceChecklistRow(
          icon: "doc",
          title: "Floor plan",
          detail: "Use the clearest rights-cleared plan available; missing dimensions remain unknown."
        )
        EvidenceChecklistRow(
          icon: "camera",
          title: "Room photographs",
          detail: "Capture each wall, doorway, window, and important fixed object without hiding uncertainty."
        )
        EvidenceChecklistRow(
          icon: "ruler",
          title: "Reference measurements",
          detail: "Record units and what each measurement spans; measurements require later validation."
        )
      }

      Section {
        Text(
          "Nothing is selected or uploaded until you choose a file, confirm its rights basis, and allow service processing on the next screen."
        )
          .foregroundStyle(.secondary)
        Button("Continue to secure evidence upload", action: onOpenEvidence)
          .buttonStyle(.borderedProminent)
          .frame(maxWidth: .infinity)
        Button("Not now", action: onDone)
          .frame(maxWidth: .infinity)
      }
    }
    .navigationTitle("Manual evidence")
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct EvidenceChecklistRow: View {
  let icon: String
  let title: String
  let detail: String

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: icon)
        .font(.title3)
        .foregroundStyle(.tint)
        .frame(width: 28)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.headline)
        Text(detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

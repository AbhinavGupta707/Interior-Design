import SwiftUI

struct ManualEvidenceView: View {
  let project: CaptureProject
  let onDone: () -> Void

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Text("Manual evidence route")
            .font(.title2.bold())
          Text("Prepare these sources for \(project.name). Upload and secure evidence handling arrive in C2.")
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
        Text("No files are selected, recorded, or uploaded by this C0 screen.")
          .foregroundStyle(.secondary)
        Button("Done", action: onDone)
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

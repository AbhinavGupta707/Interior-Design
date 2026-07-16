import SwiftUI

struct ProjectSelectionView: View {
  let projects: [CaptureProject]
  let environmentLabel: String
  let onSelect: (CaptureProject) -> Void

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: "house.and.flag")
            .font(.system(size: 36))
            .foregroundStyle(.tint)
            .accessibilityHidden(true)
          Text("Prepare evidence for your home")
            .font(.title2.bold())
          Text("Choose a project, then this app will check whether native room capture is available on this device.")
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
      }

      Section {
        ForEach(projects) { project in
          Button {
            onSelect(project)
          } label: {
            HStack(spacing: 12) {
              Image(systemName: "house")
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 30)

              VStack(alignment: .leading, spacing: 3) {
                Text(project.name)
                  .font(.headline)
                  .foregroundStyle(.primary)
                Text(project.locationSummary)
                  .font(.subheadline)
                  .foregroundStyle(.secondary)
                if project.isFixture {
                  Text("Local fixture — not a real property")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }

              Spacer()

              Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 4)
          }
          .buttonStyle(.plain)
          .accessibilityHint("Checks capture eligibility for this project")
        }
      } header: {
        Text("Projects")
      } footer: {
        Text("\(environmentLabel) configuration. Project data is deterministic fixture content in C0.")
      }
    }
    .navigationTitle("Home Design Studio")
  }
}

import SwiftUI

struct C7CaptureQualityView: View {
  let assessment: C7CaptureQualityAssessment
  let manifest: C7CaptureQualityManifest

  var body: some View {
    Section("Capture conditions") {
      Label(assessment.attention.title, systemImage: icon)
        .font(.headline)
        .foregroundStyle(colour)
        .accessibilityAddTraits(.isHeader)

      ForEach(assessment.findings) { finding in
        Label(finding.message, systemImage: "exclamationmark.bubble")
          .font(.callout)
      }

      if assessment.findings.isEmpty {
        Text("The versioned heuristic did not emit a warning for the recorded counters.")
          .foregroundStyle(.secondary)
      }

      LabeledContent("Mapping at finish", value: mappingLabel)
      LabeledContent("Recorded interruptions", value: "\(manifest.interruptionCount)")
      LabeledContent(
        "Low-confidence classifications",
        value: "\(manifest.lowConfidenceSurfaceCount + manifest.lowConfidenceObjectCount)"
      )

      Text(assessment.limitationText)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .accessibilityLabel("Important limitation. \(assessment.limitationText)")
    }
  }

  private var icon: String {
    switch assessment.attention {
    case .limitedEvidence: "exclamationmark.triangle.fill"
    case .reviewRecommended: "eye.fill"
    case .noHeuristicWarning: "info.circle.fill"
    }
  }

  private var colour: Color {
    switch assessment.attention {
    case .limitedEvidence: .orange
    case .reviewRecommended: .yellow
    case .noHeuristicWarning: .secondary
    }
  }

  private var mappingLabel: String {
    switch manifest.worldMappingStatusAtFinish {
    case .notAvailable: "Not available"
    case .limited: "Limited"
    case .extending: "Extending"
    case .mapped: "Mapped"
    }
  }
}

struct C7ReferenceMeasurementView: View {
  @Bindable var model: C7ReferenceMeasurementModel
  let sourceOptions: [(id: UUID, label: String)]
  let readOnly: Bool

  var body: some View {
    Section {
      if model.measurements.isEmpty {
        Text("No user-asserted reference measurements")
          .foregroundStyle(.secondary)
      } else {
        ForEach(model.measurements) { measurement in
          VStack(alignment: .leading, spacing: 4) {
            Text("\(measurement.distanceMillimetres.formatted()) mm")
              .font(.headline)
            Text(
              "\(label(for: measurement.fromSourceEntityId)) to \(label(for: measurement.toSourceEntityId)) · \(methodLabel(measurement.method))"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
          }
          .accessibilityElement(children: .combine)
          if !readOnly {
            Button("Remove measurement", role: .destructive) {
              model.remove(id: measurement.id)
            }
            .accessibilityLabel(
              "Remove \(measurement.distanceMillimetres) millimetre reference measurement")
          }
        }
      }

      if !readOnly {
        Picker("From source entity", selection: $model.draft.fromSourceEntityId) {
          Text("Choose source").tag(UUID?.none)
          ForEach(sourceOptions, id: \.id) { source in
            Text(source.label).tag(UUID?.some(source.id))
          }
        }
        Picker("To source entity", selection: $model.draft.toSourceEntityId) {
          Text("Choose source").tag(UUID?.none)
          ForEach(sourceOptions, id: \.id) { source in
            Text(source.label).tag(UUID?.some(source.id))
          }
        }
        TextField("Distance in millimetres", text: $model.draft.distanceText)
          .keyboardType(.numberPad)
          .textContentType(.none)
          .accessibilityHint(
            "Enter an independently measured distance from 1 to 100,000 millimetres")
        Picker("Measurement method", selection: $model.draft.method) {
          Text("Tape").tag(C7ReferenceMeasurementMethod.tape)
          Text("Laser").tag(C7ReferenceMeasurementMethod.laser)
          Text("User entered").tag(C7ReferenceMeasurementMethod.userEntered)
        }
        Button("Add reference measurement") { model.add() }
      }

      if let message = model.validationMessage {
        Label(message, systemImage: "exclamationmark.circle")
          .foregroundStyle(.red)
          .accessibilityLabel("Measurement error. \(message)")
      }

      Text(
        "Reference measurements are user assertions. They do not change RoomPlan observations into surveyed truth."
      )
      .font(.footnote)
      .foregroundStyle(.secondary)
    } header: {
      Text("Reference measurements")
    }
  }

  private func label(for id: UUID) -> String {
    sourceOptions.first(where: { $0.id == id })?.label ?? "Source \(id.uuidString.prefix(8))"
  }

  private func methodLabel(_ method: C7ReferenceMeasurementMethod) -> String {
    switch method {
    case .laser: "laser"
    case .tape: "tape"
    case .userEntered: "user entered"
    }
  }
}

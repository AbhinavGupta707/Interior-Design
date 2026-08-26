import SwiftUI

struct C14_6HomeSetupView: View {
  let project: CaptureProject
  let role: String
  @Bindable var model: C14_6HomeSetupModel
  let onOpenCapture: () -> Void
  let onOpenEvidence: () -> Void
  let onOpenMedia: () -> Void
  let onBackToHub: () -> Void

  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        introduction
        stateBanner
        if let message = model.mutationMessage {
          C14_6StatusBanner(title: "Setup update", detail: message, symbol: "info.circle")
            .accessibilityIdentifier("c14_6.mutation-message")
        }
        if horizontalSizeClass == .regular {
          HStack(alignment: .top, spacing: 18) {
            intakeCard
              .frame(maxWidth: .infinity, alignment: .top)
            VStack(alignment: .leading, spacing: 18) {
              propertyCard
              evidenceCard
              readinessCard
            }
            .frame(maxWidth: .infinity, alignment: .top)
          }
        } else {
          intakeCard
          propertyCard
          evidenceCard
          readinessCard
        }
      }
      .padding()
      .frame(maxWidth: 1_180)
      .frame(maxWidth: .infinity)
    }
    .navigationTitle("Home setup")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Home", action: onBackToHub)
      }
    }
    .task { await model.activate(projectId: project.id, role: role) }
    .refreshable { await model.activate(projectId: project.id, role: role, force: true) }
  }

  private var introduction: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Prepare \(project.name)", systemImage: "house.and.flag.fill")
        .font(.title2.bold())
      Text("Record renovation intent, select honest England property context, and add rights-cleared evidence before checking capture or later proposal processing readiness.")
        .foregroundStyle(.secondary)
      Text("An address, postcode, UPRN or provider point identifies context only. It is never an interior dimension, room layout, legal boundary or survey.")
        .font(.callout.weight(.semibold))
        .foregroundStyle(.orange)
    }
    .padding(.vertical, 6)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder
  private var stateBanner: some View {
    switch model.state {
    case .idle, .loading:
      C14_6StatusBanner(
        title: "Loading authorised setup…",
        detail: "Intake, property dossier and evidence are checked directly with their shared server authorities.",
        symbol: "arrow.triangle.2.circlepath"
      )
      .accessibilityIdentifier("c14_6.setup-loading")
    case .ready:
      EmptyView()
    case .stale(let message):
      C14_6StatusBanner(title: "Display-only recovery", detail: message, symbol: "wifi.slash")
    case .expired:
      C14_6StatusBanner(
        title: "Session expired",
        detail: "Return to sign-in. No setup mutation was accepted without current server authority.",
        symbol: "person.crop.circle.badge.exclamationmark"
      )
    case .forbidden:
      C14_6StatusBanner(
        title: "Project unavailable",
        detail: "The current membership cannot read this project. Other tenant data is not disclosed.",
        symbol: "lock.shield"
      )
    case .failure(let message):
      C14_6StatusBanner(title: "Setup unavailable", detail: message, symbol: "exclamationmark.triangle")
    }
  }

  private var intakeCard: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 14) {
        Picker("Dwelling type", selection: $model.dwellingType) {
          ForEach(C14_6DwellingType.allCases) { value in
            Text(value.title).tag(value)
          }
        }
        .pickerStyle(.menu)

        C14_6MultilineField(
          title: "Renovation goals · one per line",
          text: $model.goalsText,
          identifier: "c14_6.intake-goals"
        )
        C14_6MultilineField(title: "Must change", text: $model.mustChangeText)
        C14_6MultilineField(title: "Must keep", text: $model.mustKeepText)
        C14_6MultilineField(title: "Style words", text: $model.styleWordsText)
        C14_6MultilineField(
          title: "Accessibility needs",
          text: $model.accessibilityNeedsText
        )

        TextField("Self-reported address summary (optional)", text: $model.addressSummary)
          .textContentType(.fullStreetAddress)
        TextField("Additional notes (optional)", text: $model.notes, axis: .vertical)
          .lineLimit(3...8)

        householdCounts
        knownCounts

        VStack(alignment: .leading, spacing: 8) {
          Text("Evidence you expect to provide").font(.headline)
          Toggle("Plans", isOn: $model.hasPlans)
          Toggle("Photographs", isOn: $model.hasPhotographs)
          Toggle("Video", isOn: $model.hasVideo)
          Toggle("Room capture", isOn: $model.hasRoomCapture)
          Text("These are intent fields, not proof that an asset exists. Fresh C2 inventory remains authoritative.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }

        Button {
          Task { await model.saveIntake() }
        } label: {
          if model.isMutating {
            HStack { ProgressView(); Text("Saving intake…") }
          } else {
            Label("Save renovation intake", systemImage: "checkmark.circle")
          }
        }
        .buttonStyle(.borderedProminent)
        .disabled(!model.canMutate || model.isMutating)
        .accessibilityIdentifier("c14_6.save-intake")

        if !model.canEdit {
          Text("Viewer membership is read-only. Saved intake remains visible.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        if let intake = model.intake {
          Text("Server intake v\(intake.version) · updated \(formatted(intake.updatedAt))")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
    } label: {
      Label("Renovation intake", systemImage: "list.clipboard")
        .font(.headline)
    }
  }

  private var householdCounts: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Household").font(.headline)
      Stepper("Adults: \(model.householdAdults)", value: $model.householdAdults, in: 0...30)
      Stepper("Children: \(model.householdChildren)", value: $model.householdChildren, in: 0...30)
      Stepper("Pets: \(model.householdPets)", value: $model.householdPets, in: 0...30)
    }
  }

  private var knownCounts: some View {
    VStack(alignment: .leading, spacing: 8) {
      Toggle("Bedrooms known", isOn: $model.bedroomsKnown)
      if model.bedroomsKnown {
        Stepper("Bedrooms: \(model.bedrooms)", value: $model.bedrooms, in: 0...30)
      }
      Toggle("Bathrooms known", isOn: $model.bathroomsKnown)
      if model.bathroomsKnown {
        Stepper("Bathrooms: \(model.bathrooms)", value: $model.bathrooms, in: 0...20)
      }
      Toggle("Levels known", isOn: $model.levelsKnown)
      if model.levelsKnown {
        Stepper("Levels: \(model.levels)", value: $model.levels, in: 1...10)
      }
    }
  }

  private var propertyCard: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 14) {
        if let property = model.dossier?.property {
          Label(property.displayAddress, systemImage: "mappin.and.ellipse")
            .font(.headline)
          LabeledContent("Mode", value: property.mode == "manual" ? "Manual fallback" : "Selected candidate")
          LabeledContent("Interior knowledge", value: "Unknown without evidence")
          if let uprn = property.identifiers.first?.value {
            LabeledContent("UPRN", value: uprn)
          } else {
            LabeledContent("UPRN", value: "Not supplied")
          }
          Text("Source: \(property.source.dataset) · \(property.source.datasetVersion) · \(property.source.licence.title)")
            .font(.footnote)
            .foregroundStyle(.secondary)
        } else {
          Text("No property context is selected.")
            .foregroundStyle(.secondary)
        }

        Divider()
        TextField("England address or postcode", text: $model.propertyQuery)
          .textContentType(.fullStreetAddress)
          .textInputAutocapitalization(.characters)
          .accessibilityIdentifier("c14_6.property-query")
        Button("Search address source") { Task { await model.resolveProperty() } }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canMutate || model.isMutating || model.propertyQuery.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
          .accessibilityIdentifier("c14_6.resolve-property")

        resolutionResults

        Divider()
        Text("Honest manual fallback").font(.headline)
        TextField("Address line 1", text: $model.manualLine1)
          .textContentType(.streetAddressLine1)
          .accessibilityIdentifier("c14_6.manual-line1")
        TextField("Address line 2 (optional)", text: $model.manualLine2)
          .textContentType(.streetAddressLine2)
        TextField("Town or locality (optional)", text: $model.manualLocality)
          .textContentType(.addressCity)
        TextField("England postcode", text: $model.manualPostcode)
          .textContentType(.postalCode)
          .textInputAutocapitalization(.characters)
          .accessibilityIdentifier("c14_6.manual-postcode")
        Button("Save manual address") { Task { await model.selectManual() } }
          .buttonStyle(.bordered)
          .disabled(!model.canMutate || model.isMutating)
          .accessibilityIdentifier("c14_6.save-manual-property")
        Text("Manual entry saves only your typed address with an explicit manual source. It creates no UPRN, point, provider observation, planning fact or interior geometry.")
          .font(.footnote)
          .foregroundStyle(.secondary)

        dossierDetails
      }
    } label: {
      Label("England property context", systemImage: "map")
        .font(.headline)
    }
  }

  @ViewBuilder
  private var resolutionResults: some View {
    if let resolution = model.resolution {
      switch resolution.status {
      case "matched", "ambiguous":
        VStack(alignment: .leading, spacing: 10) {
          Text(resolution.status == "ambiguous" ? "Choose one identity" : "Review the matched identity")
            .font(.headline)
          ForEach(resolution.candidates) { candidate in
            VStack(alignment: .leading, spacing: 4) {
              Text(candidate.displayAddress).font(.headline)
              Text("\(candidate.source.dataset) · \(candidate.source.datasetVersion)")
                .font(.footnote)
                .foregroundStyle(.secondary)
              if let point = candidate.location {
                Text("Identity point: \(point.crs) \(point.coordinates.map { $0.formatted() }.joined(separator: ", ")) · not a boundary or interior")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
              Button("Use this property") { Task { await model.selectCandidate(candidate) } }
                .buttonStyle(.bordered)
                .disabled(model.isMutating || candidate.jurisdiction != "england")
                .accessibilityIdentifier("c14_6.select-candidate")
              if candidate.jurisdiction != "england" {
                Text("This checkpoint accepts England property context only.")
                  .font(.caption)
                  .foregroundStyle(.orange)
              }
            }
            .padding()
            .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
          }
        }
      case "no-match":
        C14_6StatusBanner(
          title: "No match",
          detail: "Nothing was selected. Try another query or use manual entry.",
          symbol: "questionmark.circle"
        )
      default:
        C14_6StatusBanner(
          title: resolution.providerState == "disabled" ? "Lookup disabled" : "Lookup unavailable",
          detail: "No address result was substituted. Manual entry remains available.",
          symbol: "network.slash"
        )
      }
    }
  }

  @ViewBuilder
  private var dossierDetails: some View {
    if let dossier = model.dossier {
      Divider()
      Text("Attributed property dossier").font(.headline)
      Text("Planning: not reviewed · Interior: unknown without evidence")
        .font(.footnote)
        .foregroundStyle(.secondary)
      ForEach(dossier.coverageWarnings, id: \.self) { warning in
        Label(warning, systemImage: "exclamationmark.circle")
          .font(.footnote)
      }
      ForEach(dossier.items.prefix(8)) { item in
        VStack(alignment: .leading, spacing: 2) {
          Text(item.label).font(.subheadline.weight(.semibold))
          Text("\(item.value.displayValue) · \(item.classification.replacingOccurrences(of: "-", with: " "))")
            .font(.footnote)
            .foregroundStyle(.secondary)
          if let note = item.note { Text(note).font(.caption).foregroundStyle(.secondary) }
        }
        .accessibilityElement(children: .combine)
      }
    }
  }

  private var evidenceCard: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 12) {
        Text("Upload plans, documents, photographs or video through the existing immutable C2 workflow.")
          .foregroundStyle(.secondary)
        Label("Service-processing consent is required for each upload.", systemImage: "hand.raised.fill")
        Label("Training permission is separate and defaults to denied.", systemImage: "brain.head.profile")
        Label("Every accepted asset remains hash-bound to its declared rights and provenance.", systemImage: "number.square")
        HStack {
          Button("Open evidence upload", action: onOpenEvidence)
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("c14_6.open-evidence")
          Button("Photo/video", action: onOpenMedia)
            .buttonStyle(.bordered)
        }
        LabeledContent("Ready evidence", value: "\(model.readiness.readyEvidenceCount)")
        LabeledContent("Ready plans", value: "\(model.readiness.readyPlanCount)")
        Text("Pending, processing, quarantined, rejected or stale assets never satisfy readiness.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    } label: {
      Label("Rights, consent and evidence", systemImage: "lock.doc")
        .font(.headline)
    }
  }

  private var readinessCard: some View {
    GroupBox {
      VStack(alignment: .leading, spacing: 12) {
        readinessRow("Renovation intent saved", complete: model.readiness.intakeComplete)
        readinessRow("Property context selected", complete: model.readiness.propertyContextSelected)
        readinessRow("At least one fresh ready plan", complete: model.readiness.readyPlanCount > 0)

        if model.readiness.laterPlanProcessingEligible {
          C14_6StatusBanner(
            title: "Ready for a later plan-processing request",
            detail: "This checkpoint verifies prerequisites only. It has not started, calibrated or reviewed C6 and has not produced a proposal or confirmed twin.",
            symbol: "checkmark.seal",
            identifier: "c14_6.proposal-ready"
          )
        } else {
          Text("Complete the missing prerequisites above. Readiness never infers dimensions from the address or from intake text.")
            .foregroundStyle(.secondary)
        }

        Button("Check device and capture routes", action: onOpenCapture)
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("c14_6.open-capture")
        Text("RoomPlan/LiDAR support is checked on the current device. Unsupported devices retain manual and photo/video evidence routes.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    } label: {
      Label("Capture and proposal readiness", systemImage: "checklist")
        .font(.headline)
    }
  }

  private func readinessRow(_ title: String, complete: Bool) -> some View {
    Label(title, systemImage: complete ? "checkmark.circle.fill" : "circle.dashed")
      .foregroundStyle(complete ? .green : .secondary)
      .accessibilityLabel("\(title), \(complete ? "complete" : "not complete")")
  }

  private func formatted(_ value: String) -> String {
    guard let date = C14_6ContractValidation.date(value) else { return "unknown time" }
    return date.formatted(date: .abbreviated, time: .shortened)
  }
}

private struct C14_6MultilineField: View {
  let title: String
  @Binding var text: String
  var identifier = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(title).font(.subheadline.weight(.semibold))
      TextEditor(text: $text)
        .frame(minHeight: 68)
        .padding(4)
        .background(.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier(identifier)
    }
  }
}

struct C14_6StatusBanner: View {
  let title: String
  let detail: String
  let symbol: String
  var identifier: String? = nil

  @ViewBuilder
  var body: some View {
    if let identifier {
      banner.accessibilityIdentifier(identifier)
    } else {
      banner
    }
  }

  private var banner: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: symbol).foregroundStyle(.tint)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.headline)
        Text(detail).font(.subheadline).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding()
    .background(.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
    .accessibilityElement(children: .combine)
  }
}

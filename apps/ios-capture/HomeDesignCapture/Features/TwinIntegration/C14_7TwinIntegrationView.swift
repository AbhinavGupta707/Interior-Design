import SwiftUI

struct C14_7TwinIntegrationView: View {
  let project: CaptureProject
  @Bindable var model: C14_7TwinIntegrationModel
  let onContinueToDesign: () -> Void
  let onBackToHub: () -> Void

  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  var body: some View {
    Group {
      switch model.state {
      case .idle where model.workspace == nil,
           .loading where model.workspace == nil:
        ProgressView("Loading exact server state…")
          .accessibilityIdentifier("c14_7.loading")
      case .expired:
        unavailable("Session expired", "Sign in again before reading or changing twin state.")
      case .forbidden:
        unavailable("Project unavailable", "Membership or role no longer permits this project.")
      case .failure(let message) where model.workspace == nil:
        unavailable("Twin workspace unavailable", message)
      default:
        workspace
      }
    }
    .navigationTitle("Confirm home twin")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        if model.isMutating { ProgressView().accessibilityLabel("Saving exact server state") }
        Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.reload() } }
      }
    }
    .task { await model.activate(projectId: project.id) }
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder
  private var workspace: some View {
    if horizontalSizeClass == .regular {
      HStack(spacing: 0) {
        stageSidebar.frame(width: 250)
        Divider()
        stageDetail
      }
    } else {
      VStack(spacing: 0) {
        Picker("Twin stage", selection: $model.selectedStage) {
          ForEach(C14_7TwinStage.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.menu)
        .padding(.horizontal)
        .accessibilityIdentifier("c14_7.stage-picker")
        stageDetail
      }
    }
  }

  private var stageSidebar: some View {
    List {
      ForEach(C14_7TwinStage.allCases) { stage in
        Button {
          model.selectedStage = stage
        } label: {
          Label(stage.title, systemImage: stage.symbol)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(model.selectedStage == stage ? Color.accentColor.opacity(0.15) : nil)
      }
    }
    .listStyle(.sidebar)
    .accessibilityIdentifier("c14_7.stage-sidebar")
  }

  private var stageDetail: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        statusBanner
        switch model.selectedStage {
        case .overview: overview
        case .plan: planStage
        case .reconstruction: reconstructionStage
        case .reconciliation: fusionStage
        case .confirmation: confirmationStage
        }
      }
      .frame(maxWidth: 860, alignment: .leading)
      .padding()
    }
    .refreshable { await model.reload() }
  }

  @ViewBuilder
  private var statusBanner: some View {
    switch model.state {
    case .stale(let message):
      banner("Offline · read-only", message, "wifi.slash", .orange)
    case .failure(let message):
      banner("Action unavailable", message, "exclamationmark.triangle", .orange)
    default:
      if model.workspace?.session.actor.role == .viewer {
        banner(
          "Viewer access",
          "Fresh state is visible, but initialization, proposals, review, confirmation and compilation are read-only.",
          "eye",
          .blue
        )
      }
    }
    if !model.announcement.isEmpty {
      Text(model.announcement)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("c14_7.announcement")
    }
  }

  private var overview: some View {
    Group {
      header(
        "From evidence to confirmed twin",
        "Nothing is selected or accepted automatically. Every mutation uses fresh server membership, exact persisted pins and a separate human confirmation."
      )
      card {
        prerequisite(
          "Existing-model workspace",
          complete: model.workspace?.snapshot != nil,
          detail: model.workspace?.snapshot.map {
            "snapshot \($0.id.uuidString.prefix(8)) · \($0.snapshotSha256.prefix(12))…"
          } ?? "No C4 existing snapshot is persisted."
        )
        if model.workspace?.snapshot == nil {
          Text("This acknowledgement creates one unmeasured placeholder level with unknown dimensions. The server binds the selected property; address data proves no interior.")
            .font(.footnote).foregroundStyle(.secondary)
          Button("Acknowledge unmeasured interior") { model.initializeWorkspace() }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canMutate)
            .accessibilityIdentifier("c14_7.initialize")
        }
      }
      card {
        prerequisite(
          "Reviewed canonical branch",
          complete: model.workspace?.branch.map {
            $0.revision > 0 && $0.headSnapshotId != $0.sourceSnapshotId
          } ?? false,
          detail: model.workspace?.branch.map {
            "revision \($0.revision) · exact head \($0.headSnapshotSha256.prefix(12))…"
          } ?? "Initialize the workspace, then review a C6 or C9 operation draft."
        )
        prerequisite(
          "Exact C10 confirmed twin",
          complete: model.confirmedTwin,
          detail: model.workspace?.exactSucceededScene.map {
            "succeeded job \($0.id.uuidString.prefix(8)) · exact snapshot match"
          } ?? "No succeeded C10 job matches the exact changed C5 head."
        )
      }
      if model.confirmedTwin {
        Button("Continue to native design studio", action: onContinueToDesign)
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .accessibilityIdentifier("c14_7.continue-design")
      }
      Button("Back to homeowner hub", action: onBackToHub)
    }
  }

  private var planStage: some View {
    Group {
      header(
        "C6 plan proposal",
        "Choose one exact ready plan. Parser output remains a proposal until calibration, per-candidate review, C5 preview and explicit commit."
      )
      card {
        Picker("Ready plan", selection: $model.selectedPlanAssetId) {
          Text("Choose a plan").tag(String?.none)
          ForEach(model.planAssets) { asset in
            Text("\(asset.fileName) · \(asset.source.sha256.prefix(10))…").tag(Optional(asset.id))
          }
        }
        .accessibilityIdentifier("c14_7.plan-asset-picker")
        Button("Start plan processing") { model.startPlanJob() }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canMutate || model.selectedPlanAssetId == nil)
          .accessibilityIdentifier("c14_7.start-plan")
      }
      card {
        Picker("Plan job", selection: $model.selectedPlanJobId) {
          Text("Choose a job").tag(UUID?.none)
          ForEach(model.workspace?.planJobs ?? []) { job in
            Text("\(job.state) · \(job.id.uuidString.prefix(8))").tag(Optional(job.id))
          }
        }
        .accessibilityIdentifier("c14_7.plan-job-picker")
        Button("Load proposal") { model.loadSelectedPlanProposal() }
          .disabled(model.selectedPlanJobId == nil || model.isMutating)
          .accessibilityIdentifier("c14_7.load-plan-proposal")
        if let proposal = model.planProposal {
          Label(
            proposal.status == "proposal"
              ? "Proposal only · confidence \(proposal.overallConfidence ?? 0)%"
              : "Abstained · \(proposal.code ?? "unknown")",
            systemImage: proposal.status == "proposal" ? "doc.text.magnifyingglass" : "hand.raised"
          )
          if let detail = proposal.detail { Text(detail).foregroundStyle(.secondary) }
        }
      }
      if model.planProposal?.status == "proposal" {
        planCalibrationCard
        ForEach(model.planProposal?.candidates ?? []) { candidate in
          candidateCard(candidate)
        }
        Button("Create exact reviewed operation draft") { model.createPlanDraft() }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canMutate || model.planCalibration == nil || !model.allPlanCandidatesReviewed)
          .accessibilityIdentifier("c14_7.create-plan-draft")
      }
    }
  }

  private var planCalibrationCard: some View {
    card {
      Text("Exact calibration").font(.headline)
      Text("Enter a known real length and the two corresponding source coordinates. The app submits a bounded rational transform; it never guesses scale.")
        .font(.footnote).foregroundStyle(.secondary)
      LabeledContent("Known length (mm)") {
        TextField("1000", value: $model.calibrationKnownLengthMillimetres, format: .number)
          .textFieldStyle(.roundedBorder).frame(maxWidth: 180)
      }
      sourcePointFields("Source start", point: $model.calibrationStart)
      sourcePointFields("Source end", point: $model.calibrationEnd)
      Button("Save calibration") { model.calibratePlan() }
        .disabled(!model.canMutate || model.calibrationKnownLengthMillimetres <= 0
          || model.calibrationStart == model.calibrationEnd)
        .accessibilityIdentifier("c14_7.save-calibration")
      if let calibration = model.planCalibration {
        Text("Saved · residual \(calibration.residualMillimetres) mm · denominator \(calibration.sourceToModel.denominator)")
          .font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  private func candidateCard(_ candidate: C14_7PlanCandidate) -> some View {
    let review = reviewBinding(candidate.id)
    return card {
      HStack {
        Label(candidate.kind.capitalized, systemImage: "square.dashed.inset.filled")
          .font(.headline)
        Spacer()
        Text("\(candidate.confidence)%").foregroundStyle(.secondary)
      }
      Text(candidate.id.uuidString).font(.caption.monospaced()).foregroundStyle(.secondary)
      Picker("Decision", selection: review.decision) {
        ForEach(C14_7CandidateDecision.allCases, id: \.self) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.menu)
      .accessibilityIdentifier("c14_7.candidate-decision.\(candidate.id.uuidString)")
      if review.wrappedValue.decision == .corrected {
        Text("Corrected values become user-asserted and remain not reviewed.")
          .font(.footnote).foregroundStyle(.secondary)
        switch candidate.kind {
        case "level", "space":
          TextField("Corrected name", text: review.name).textFieldStyle(.roundedBorder)
          if candidate.kind == "level" {
            LabeledContent("Elevation (mm)") {
              TextField("0", value: review.elevationMillimetres, format: .number)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 180)
            }
          }
        case "wall":
          sourcePointFields("Corrected start", point: review.start)
          sourcePointFields("Corrected end", point: review.end)
          optionalInteger("Height (mm)", value: review.heightMillimetres)
          optionalInteger("Thickness (mm)", value: review.thicknessMillimetres)
        case "opening":
          Picker("Opening kind", selection: review.openingKind) {
            Text("Opening / unknown").tag("unknown")
            Text("Door").tag("door")
            Text("Window").tag("window")
          }
          optionalInteger("Height (mm)", value: review.heightMillimetres)
          optionalInteger("Sill (mm)", value: review.sillHeightMillimetres)
          LabeledContent("Width (mm)") {
            TextField("1", value: review.widthMillimetres, format: .number)
              .textFieldStyle(.roundedBorder).frame(maxWidth: 180)
          }
        default: EmptyView()
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("c14_7.candidate.\(candidate.id.uuidString)")
  }

  private var reconstructionStage: some View {
    Group {
      header(
        "C8 reconstruction proposal",
        "Choose exact ready media records. Byte count, detected MIME and SHA-256 come from persisted C2 state. Appearance is optional and always non-dimensional."
      )
      card {
        if model.reconstructionAssets.isEmpty {
          ContentUnavailableView(
            "No eligible media",
            systemImage: "photo.badge.exclamationmark",
            description: Text("Upload rights-cleared ready photos or video in the evidence branch.")
          )
        }
        ForEach(model.reconstructionAssets) { asset in
          Toggle(isOn: selectedAsset(asset.id)) {
            VStack(alignment: .leading) {
              Text(asset.fileName).font(.headline)
              Text("\(asset.detectedMimeType ?? "unverified") · \(asset.source.sha256.prefix(12))…")
                .font(.caption).foregroundStyle(.secondary)
            }
          }
        }
        Toggle("Request optional appearance output", isOn: $model.includeAppearance)
        Text("Appearance outputs, splats and viewer media never establish dimensions or canonical geometry.")
          .font(.footnote).foregroundStyle(.secondary)
        Button("Start reconstruction") { model.startReconstruction() }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canMutate || model.selectedReconstructionAssetIds.isEmpty)
          .accessibilityIdentifier("c14_7.start-reconstruction")
      }
      card {
        Picker("Reconstruction job", selection: $model.selectedReconstructionJobId) {
          Text("Choose a job").tag(UUID?.none)
          ForEach(model.workspace?.reconstructionJobs ?? []) { job in
            Text("\(job.state) · \(job.id.uuidString.prefix(8))").tag(Optional(job.id))
          }
        }
        .accessibilityIdentifier("c14_7.reconstruction-job-picker")
        Button("Inspect persisted result") { model.loadSelectedReconstructionResult() }
          .disabled(model.selectedReconstructionJobId == nil || model.isMutating)
        if let result = model.reconstructionResult {
          if let geometry = result.geometry {
            Label("Geometry proposal · \(geometry.scaleStatus)", systemImage: "pointcloud")
            Text("\(geometry.registeredFrameCount)/\(geometry.inputFrameCount) frames · \(geometry.componentCount) components · \(geometry.unit)")
              .font(.footnote).foregroundStyle(.secondary)
          } else {
            Label("Abstained · \(result.safeCode ?? "unknown")", systemImage: "hand.raised")
          }
          if let appearance = result.appearance {
            Text("Appearance: \(appearance.method) · non-dimensional")
              .font(.footnote).foregroundStyle(.secondary)
          }
        }
      }
    }
  }

  private var fusionStage: some View {
    Group {
      header(
        "C9 multi-source reconciliation",
        "The platform lists rights-active exact source descriptors. Select at least two distinct kinds and provide non-collinear correspondences for each non-project-local source."
      )
      card {
        if (model.workspace?.fusionSources ?? []).isEmpty {
          ContentUnavailableView(
            "No eligible source set",
            systemImage: "point.3.filled.connected.trianglepath.dotted",
            description: Text("C9 needs at least two distinct persisted proposal/result kinds.")
          )
        }
        ForEach(model.workspace?.fusionSources ?? []) { source in
          Toggle(isOn: Binding(
            get: { model.selectedFusionSourceIds.contains(source.id) },
            set: { _ in model.toggleFusionSource(source) }
          )) {
            VStack(alignment: .leading) {
              Text(source.kind).font(.headline)
              Text("\(source.coordinateFrame) · \(source.scaleStatus) · \(source.sha256.prefix(12))…")
                .font(.caption).foregroundStyle(.secondary)
            }
          }
          if model.selectedFusionSourceIds.contains(source.id),
             source.coordinateFrame != "project-local" {
            Text("Three non-collinear source → project correspondences")
              .font(.subheadline.bold())
            ForEach(Array((model.fusionAnchors[source.id] ?? []).indices), id: \.self) { index in
              anchorFields(sourceId: source.id, index: index)
            }
          }
        }
        Text("Selected kinds: \(Set(model.selectedFusionSources.map(\.kind)).count). No proposal source is selected automatically.")
          .font(.footnote).foregroundStyle(.secondary)
        Button("Start reconciliation") { model.startFusion() }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canMutate || !model.fusionSelectionValid)
          .accessibilityIdentifier("c14_7.start-fusion")
      }
      card {
        Picker("Fusion job", selection: $model.selectedFusionJobId) {
          Text("Choose a job").tag(UUID?.none)
          ForEach(model.workspace?.fusionJobs ?? []) { job in
            Text("\(job.state) · \(job.id.uuidString.prefix(8))").tag(Optional(job.id))
          }
        }
        Button("Load discrepancy proposal") { model.loadSelectedFusionProposal() }
          .disabled(model.selectedFusionJobId == nil || model.isMutating)
      }
      if let proposal = model.fusionProposal {
        if proposal.status == "abstained" {
          card {
            Label("Fusion abstained · \(proposal.safeCode ?? "unknown")", systemImage: "hand.raised")
          }
        } else {
          ForEach(proposal.discrepancies) { discrepancy in
            card {
              Text(discrepancy.kind).font(.headline)
              Text(discrepancy.message)
              Text("\(discrepancy.sourceClaims.count) source claims · \(discrepancy.suggestedOperations.count) suggested operations")
                .font(.caption).foregroundStyle(.secondary)
              Picker("Human decision", selection: fusionChoice(discrepancy.id)) {
                Text("Choose explicitly").tag(C14_7FusionDecisionChoice?.none)
                ForEach(C14_7FusionDecisionChoice.allCases, id: \.self) {
                  Text($0.rawValue).tag(Optional($0))
                }
              }
            }
          }
          if model.fusionDecisionIds.isEmpty {
            Button("Persist all discrepancy decisions") { model.reviewFusion() }
              .buttonStyle(.borderedProminent)
              .disabled(!model.canMutate || !model.allFusionDiscrepanciesReviewed)
          } else {
            Button("Create exact reviewed fusion draft") { model.createFusionDraft() }
              .buttonStyle(.borderedProminent)
              .disabled(!model.canMutate)
          }
        }
      }
    }
  }

  private var confirmationStage: some View {
    Group {
      header(
        "C5 explicit confirmation and C10 handoff",
        "Draft, preview, commit and compile are separate persisted operations. The current exact branch pins must remain unchanged at every step."
      )
      card {
        if model.activeOperations.isEmpty {
          Text("No reviewed draft is selected. Complete C6 plan review or C9 discrepancy review first.")
            .foregroundStyle(.secondary)
        } else {
          Label(model.activeDraftLabel ?? "Reviewed operation draft", systemImage: "doc.badge.gearshape")
            .font(.headline)
          Text("\(model.activeOperations.count) exact typed C5 operations · not committed")
          Button("Create separate geometry preview") { model.createPreview() }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canMutate)
            .accessibilityIdentifier("c14_7.create-preview")
        }
      }
      if let preview = model.preview {
        card {
          Label("Preview only", systemImage: "eye.trianglebadge.exclamationmark")
            .font(.headline)
          Text("base revision \(preview.baseRevision) · result \(preview.resultSnapshotSha256.prefix(16))…")
            .font(.caption.monospaced())
          Text("Expires \(formatted(preview.expiresAt))")
          ForEach(preview.findings) { finding in
            Label("\(finding.code): \(finding.message)", systemImage: finding.severity == "error" ? "xmark.octagon" : "exclamationmark.triangle")
              .font(.footnote)
          }
          if preview.hasBlockingFindings {
            Text("Blocking geometry findings prevent confirmation.")
              .foregroundStyle(.red).font(.headline)
          } else {
            Button("Confirm and commit this exact preview") { model.confirmPreview() }
              .buttonStyle(.borderedProminent)
              .tint(.green)
              .disabled(!model.canMutate)
              .accessibilityHint("This is the explicit canonical confirmation action.")
              .accessibilityIdentifier("c14_7.confirm-preview")
          }
        }
      }
      card {
        let branch = model.workspace?.branch
        prerequisite(
          "Changed exact C5 head",
          complete: branch.map { $0.revision > 0 && $0.headSnapshotId != $0.sourceSnapshotId } ?? false,
          detail: branch.map { "revision \($0.revision) · \($0.headSnapshotSha256.prefix(12))…" }
            ?? "No exact current branch"
        )
        Button("Compile exact confirmed twin") { model.compileConfirmedTwin() }
          .buttonStyle(.borderedProminent)
          .disabled(!model.canMutate || branch.map {
            $0.revision <= 0 || $0.headSnapshotId == $0.sourceSnapshotId
          } ?? true)
          .accessibilityIdentifier("c14_7.compile-twin")
        prerequisite(
          "Succeeded exact C10 twin",
          complete: model.confirmedTwin,
          detail: model.workspace?.exactSucceededScene.map {
            "job \($0.id.uuidString.prefix(8)) · scene \($0.sceneId?.uuidString.prefix(8) ?? "missing")"
          } ?? "Queued/processing/failed jobs do not satisfy the gate."
        )
      }
      if model.confirmedTwin {
        Button("Continue to C11–C14 design studio", action: onContinueToDesign)
          .buttonStyle(.borderedProminent)
          .controlSize(.large)
          .accessibilityIdentifier("c14_7.continue-design")
      }
    }
  }

  private func header(_ title: String, _ detail: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.title2.bold())
      Text(detail).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }

  private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12, content: content)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding()
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
  }

  private func prerequisite(_ title: String, complete: Bool, detail: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: complete ? "checkmark.seal.fill" : "circle.dashed")
        .foregroundStyle(complete ? .green : .secondary)
        .accessibilityHidden(true)
      VStack(alignment: .leading) {
        Text(title).font(.headline)
        Text(detail).font(.subheadline).foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(title), \(complete ? "complete" : "not complete"). \(detail)")
  }

  private func banner(_ title: String, _ detail: String, _ symbol: String, _ colour: Color) -> some View {
    Label {
      VStack(alignment: .leading) {
        Text(title).font(.headline)
        Text(detail).font(.subheadline)
      }
    } icon: {
      Image(systemName: symbol)
    }
    .foregroundStyle(colour)
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(colour.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
  }

  private func unavailable(_ title: String, _ detail: String) -> some View {
    ContentUnavailableView {
      Label(title, systemImage: "exclamationmark.triangle")
    } description: { Text(detail) } actions: {
      Button("Retry") { Task { await model.reload() } }
      Button("Back to hub", action: onBackToHub)
    }
  }

  private func sourcePointFields(_ label: String, point: Binding<C14_7SourcePoint>) -> some View {
    HStack {
      Text(label).frame(minWidth: 110, alignment: .leading)
      TextField("x", value: point.x, format: .number).textFieldStyle(.roundedBorder)
      TextField("y", value: point.y, format: .number).textFieldStyle(.roundedBorder)
    }
  }

  private func optionalInteger(_ label: String, value: Binding<Int?>) -> some View {
    LabeledContent(label) {
      TextField("Unknown", value: value, format: .number)
        .textFieldStyle(.roundedBorder).frame(maxWidth: 180)
    }
  }

  private func reviewBinding(_ id: UUID) -> Binding<C14_7CandidateReview> {
    Binding(
      get: { model.planReviews[id] ?? .init() },
      set: { model.planReviews[id] = $0 }
    )
  }

  private func selectedAsset(_ id: String) -> Binding<Bool> {
    Binding(
      get: { model.selectedReconstructionAssetIds.contains(id) },
      set: { selected in
        if selected { model.selectedReconstructionAssetIds.insert(id) }
        else { model.selectedReconstructionAssetIds.remove(id) }
      }
    )
  }

  private func fusionChoice(_ id: UUID) -> Binding<C14_7FusionDecisionChoice?> {
    Binding(get: { model.fusionChoices[id] }, set: { model.fusionChoices[id] = $0 })
  }

  private func anchorFields(sourceId: UUID, index: Int) -> some View {
    let anchor = Binding<C14_7FusionAnchor>(
      get: { model.fusionAnchors[sourceId]?[safe: index] ?? .init() },
      set: { value in
        guard var values = model.fusionAnchors[sourceId], values.indices.contains(index) else { return }
        values[index] = value
        model.fusionAnchors[sourceId] = values
      }
    )
    return VStack(alignment: .leading, spacing: 6) {
      Text("Correspondence \(index + 1)").font(.caption.bold())
      point3Fields("Source", point: anchor.sourcePoint)
      point3Fields("Project", point: anchor.projectPoint)
    }
    .padding(.leading)
  }

  private func point3Fields(_ label: String, point: Binding<C14_7FusionPoint>) -> some View {
    HStack {
      Text(label).frame(minWidth: 60, alignment: .leading)
      TextField("x", value: point.xMm, format: .number).textFieldStyle(.roundedBorder)
      TextField("y", value: point.yMm, format: .number).textFieldStyle(.roundedBorder)
      TextField("z", value: point.zMm, format: .number).textFieldStyle(.roundedBorder)
    }
  }

  private func formatted(_ timestamp: String) -> String {
    C14_6ContractValidation.date(timestamp)?.formatted(date: .abbreviated, time: .shortened)
      ?? "invalid time"
  }
}

private extension Collection {
  subscript(safe index: Index) -> Element? { indices.contains(index) ? self[index] : nil }
}

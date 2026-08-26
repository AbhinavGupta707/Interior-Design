import CrossDeviceContinuityClient
import SwiftUI
import UIKit

struct C14_5DesignStudioView: View {
  let project: CaptureProject
  @Bindable var model: C14_5DesignStudioModel
  let onBackToHub: () -> Void

  @Environment(\.horizontalSizeClass) private var horizontalSizeClass

  var body: some View {
    Group {
      switch model.state {
      case .ready where model.designEligible:
        studio
      case .loading, .idle:
        ContentUnavailableView {
          ProgressView()
          Text("Loading native design studio")
        } description: {
          Text("Every stage is re-read from server authority.")
        }
      case .stale(_, let message):
        unavailable(title: "Offline state is read-only", detail: message)
      case .expired:
        unavailable(title: "Session expired", detail: "Sign in again. No local state can authorise design actions.")
      case .forbidden:
        unavailable(title: "Design unavailable", detail: "This project or role cannot read the required design state.")
      case .failure(let message):
        unavailable(title: "Design state unavailable", detail: message)
      case .ready:
        unavailable(title: "Confirmed twin required", detail: "Return to the hub to review the exact server prerequisites.")
      }
    }
    .navigationTitle("Native design studio")
    .navigationBarTitleDisplayMode(.inline)
    .task { await model.activate(projectId: project.id) }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Refresh") { Task { await model.reload() } }
      }
    }
  }

  private var studio: some View {
    Group {
      if horizontalSizeClass == .regular {
        HStack(spacing: 0) {
          stageSidebar
            .frame(minWidth: 220, idealWidth: 250, maxWidth: 280)
          Divider()
          ScrollView { stageContent.padding(24).frame(maxWidth: 900, alignment: .leading) }
            .frame(maxWidth: .infinity)
        }
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            Picker("Design stage", selection: $model.selectedStage) {
              ForEach(C14_5DesignStage.allCases) { stage in
                Text(stage.title).tag(stage)
              }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("c14_5.stage-picker")
            stageContent
          }
          .padding()
        }
      }
    }
    .safeAreaInset(edge: .bottom) {
      if !model.announcement.isEmpty {
        Text(model.announcement)
          .font(.footnote.weight(.semibold))
          .frame(maxWidth: .infinity)
          .padding(12)
          .background(.regularMaterial)
          .accessibilityIdentifier("c14_5.announcement")
          .accessibilityAddTraits(.updatesFrequently)
      }
    }
  }

  private var stageSidebar: some View {
    List {
      ForEach(C14_5DesignStage.allCases) { stage in
        Button {
          model.selectedStage = stage
        } label: {
          HStack {
            Label(stage.title, systemImage: stage.symbol)
            Spacer()
            if model.selectedStage == stage {
              Image(systemName: "checkmark").accessibilityHidden(true)
            }
          }
          .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.selectedStage == stage ? .isSelected : [])
      }
    }
    .listStyle(.sidebar)
    .navigationTitle(project.name)
  }

  @ViewBuilder
  private var stageContent: some View {
    switch model.selectedStage {
    case .explore: exploreStage
    case .brief: briefStage
    case .options: optionsStage
    case .specification: specificationStage
    case .render: renderStage
    }
  }

  private var exploreStage: some View {
    stageCard(
      eyebrow: "C10 · Derived exploration",
      title: "Explore the exact committed twin",
      detail: "This geometry summary is pinned to the current confirmed existing snapshot. It is not a survey, structural model or native interactive renderer."
    ) {
      if let workspace = model.workspace, let snapshot = workspace.snapshot,
         let job = workspace.exactSceneJob, let scene = workspace.scene {
        exactPin("Snapshot", snapshot.id.uuidString, hash: snapshot.snapshotSha256)
        exactPin("Scene job", job.id.uuidString, hash: scene.artifact.manifestSha256)
        metricGrid(scene.manifest.counts)
        LabeledContent("Mapped elements", value: "\(scene.manifest.elementMappings.filter { $0.status == "mapped" }.count)")
        LabeledContent("Omitted elements", value: "\(scene.manifest.elementMappings.filter { $0.status == "omitted" }.count)")
        LabeledContent("Findings", value: "\(scene.manifest.findings.count)")
        if !scene.manifest.findings.isEmpty {
          Divider()
          ForEach(scene.manifest.findings.prefix(6)) { finding in
            Label {
              VStack(alignment: .leading) {
                Text(finding.code).font(.subheadline.weight(.semibold))
                Text(finding.detail).font(.footnote).foregroundStyle(.secondary)
              }
            } icon: {
              Image(systemName: finding.severity == "error" ? "xmark.octagon" : "info.circle")
            }
          }
        }
      }
    }
  }

  private var briefStage: some View {
    stageCard(
      eyebrow: "C11 · Intent, not geometry",
      title: "Shape and accept the design brief",
      detail: "Every statement is attributable to the signed-in user. Preferences and constraints do not mutate the confirmed twin."
    ) {
      if let brief = model.workspace?.brief {
        LabeledContent("Status", value: brief.brief.status.capitalized)
        exactPin("Brief revision \(brief.brief.revision)", brief.brief.id.uuidString, hash: brief.contentSha256)
        ForEach(brief.brief.entries) { entry in
          VStack(alignment: .leading, spacing: 4) {
            Text(entry.statement).font(.headline)
            Text("\(entry.classification) · \(entry.category) · priority \(entry.priority)")
              .font(.caption).foregroundStyle(.secondary)
          }
          .padding(.vertical, 3)
        }
      } else {
        Text("No persisted brief exists. The first entry creates revision 1.")
          .foregroundStyle(.secondary)
      }

      if model.role?.canMutate == true, model.workspace?.brief?.brief.status != "accepted" {
        Divider()
        TextField("What should this design achieve?", text: $model.briefStatement, axis: .vertical)
          .lineLimit(2...5)
          .accessibilityIdentifier("c14_5.brief-statement")
        Picker("Category", selection: $model.briefCategory) {
          Text("Spatial need").tag("spatial-need")
          Text("Storage").tag("storage")
          Text("Material and colour").tag("material-colour")
          Text("Accessibility").tag("accessibility")
          Text("Other").tag("other")
        }
        Picker("Classification", selection: $model.briefClassification) {
          Text("Preference").tag("preference")
          Text("Hard constraint").tag("hard-constraint")
          Text("Household assertion").tag("household-assertion")
          Text("Unknown").tag("unknown")
        }
        Button("Add attributable brief entry", action: model.addBriefEntry)
          .buttonStyle(.borderedProminent)
          .disabled(model.briefStatement.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isMutating)
          .accessibilityIdentifier("c14_5.add-brief")
        if let brief = model.workspace?.brief, !brief.brief.entries.isEmpty {
          Button("Accept exact revision \(brief.brief.revision)", action: model.acceptBrief)
            .buttonStyle(.bordered)
            .disabled(model.isMutating)
            .accessibilityIdentifier("c14_5.accept-brief")
        }
      } else if model.role == .viewer {
        readOnlyNote
      }
    }
  }

  private var optionsStage: some View {
    stageCard(
      eyebrow: "C12 · Proposed state only",
      title: "Generate, compare and confirm",
      detail: "At least two persisted alternatives must share the exact accepted brief and existing-model pins. Confirmation changes proposed state only."
    ) {
      let options = model.workspace?.options?.options ?? []
      if options.isEmpty {
        if model.workspace?.brief?.brief.status == "accepted" {
          Button("Generate circulation and storage options", action: model.generateOptions)
            .buttonStyle(.borderedProminent)
            .disabled(!model.canMutate || model.isMutating)
            .accessibilityIdentifier("c14_5.generate-options")
          Text("After submission, refresh while the exact-source server job runs.")
            .font(.footnote).foregroundStyle(.secondary)
        } else {
          Label("Accept the exact brief before generating options.", systemImage: "lock")
        }
      } else {
        ForEach(options) { option in
          Button {
            model.selectedOptionId = option.id
          } label: {
            VStack(alignment: .leading, spacing: 7) {
              HStack {
                Text(option.title).font(.headline)
                Spacer()
                if model.selectedOptionId == option.id {
                  Image(systemName: "checkmark.circle.fill").foregroundStyle(.tint)
                }
              }
              Text(option.summary).foregroundStyle(.secondary)
              Text(option.direction.replacingOccurrences(of: "-", with: " ").capitalized)
                .font(.caption.weight(.semibold))
              if let first = option.tradeoffs.first { Label(first, systemImage: "arrow.left.arrow.right") }
              if let first = option.unknowns.first { Label(first, systemImage: "questionmark.circle") }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 14))
          }
          .buttonStyle(.plain)
          .accessibilityLabel("\(option.title), \(option.status), \(option.summary)")
        }
        if options.contains(where: { $0.status == "confirmed" }) {
          Label("Server-confirmed proposed option recovered across devices", systemImage: "checkmark.seal.fill")
            .foregroundStyle(.green)
        } else {
          Button("Confirm selected option", action: model.confirmSelectedOption)
            .buttonStyle(.borderedProminent)
            .disabled(model.selectedOptionId == nil || !model.canMutate || model.isMutating)
            .accessibilityIdentifier("c14_5.confirm-option")
        }
      }
    }
  }

  private var specificationStage: some View {
    stageCard(
      eyebrow: "C13 · Exact catalog and model pins",
      title: "Decide materials and products",
      detail: "Catalog rights, model revision and specification hashes remain visible. Price, availability and professional approval are not provided."
    ) {
      if let specification = model.workspace?.specifications.last {
        exactPin(
          "Specification revision \(specification.currentRevision.revision)",
          specification.id.uuidString,
          hash: specification.currentRevision.revisionSha256
        )
        ForEach(specification.currentRevision.lines) { line in
          VStack(alignment: .leading, spacing: 4) {
            Text(line.kind.capitalized).font(.headline)
            Text("\(line.decisionStatus) · element \(line.elementId.uuidString.prefix(8))")
              .font(.caption).foregroundStyle(.secondary)
          }
        }
        if let line = specification.currentRevision.lines.first {
          let replacements = model.workspace?.catalogAssets.filter {
            $0.kind == line.kind && $0.versionId != line.assetVersionId
          } ?? []
          if !replacements.isEmpty {
            Picker("Replacement", selection: $model.selectedReplacementId) {
              ForEach(replacements) { asset in
                Text("\(asset.displayName) · rights \(asset.rights.review.state)")
                  .tag(Optional(asset.id))
              }
            }
            Button("Preview material substitution", action: model.previewSubstitution)
              .buttonStyle(.bordered)
              .disabled(!model.canMutate || model.selectedReplacementId == nil || model.isMutating)
              .accessibilityIdentifier("c14_5.preview-substitution")
          }
        }
        if let preview = model.substitutionPreview {
          Divider()
          Label("Bounded preview only", systemImage: "eye.trianglebadge.exclamationmark")
            .font(.headline)
          Text("Candidate \(preview.candidateSnapshotSha256.prefix(12))…")
            .font(.caption.monospaced())
          ForEach(preview.findings, id: \.self) { Text($0).font(.footnote) }
          Button("Confirm exact substitution", action: model.confirmSubstitution)
            .buttonStyle(.borderedProminent)
            .disabled(!model.canMutate || model.isMutating)
            .accessibilityIdentifier("c14_5.confirm-substitution")
        }
      } else if model.workspace?.recoveredConfirmation != nil {
        Button("Create specification from recovered confirmation", action: model.createSpecification)
          .buttonStyle(.borderedProminent)
          .disabled(!model.canMutate || model.isMutating)
          .accessibilityIdentifier("c14_5.create-specification")
      } else {
        Label("Confirm one C12 option before creating a specification.", systemImage: "lock")
      }
      Text("Catalog entries provide no live price, stock, supplier or delivery promise.")
        .font(.footnote).foregroundStyle(.secondary)
    }
  }

  private var renderStage: some View {
    stageCard(
      eyebrow: "C14 · Geometry-safe visual media",
      title: "Submit and view an authoritative still",
      detail: "Eligibility is a current server snapshot, not a lease. Job creation revalidates exact C10/C13 pins, camera, rights and frozen profile."
    ) {
      if let capabilities = model.workspace?.renderCapabilities {
        LabeledContent("Admission", value: capabilities.acceptingNewJobs ? "Accepting jobs" : "Paused")
        Text("Hardware evidence: \(capabilities.hardwareEvidence.replacingOccurrences(of: "-", with: " "))")
          .accessibilityIdentifier("c14_5.hardware-evidence")
        LabeledContent("Enhancement", value: capabilities.enhancementProvider.capitalized)
        let sources = model.workspace?.eligibleSources?.sources ?? []
        if sources.isEmpty {
          Label("No current render-eligible source", systemImage: "exclamationmark.triangle")
        } else {
          Picker("Exact source", selection: $model.selectedSourceJobId) {
            ForEach(sources, id: \.source.sceneJobId) { source in
              Text(source.label).tag(Optional(source.source.sceneJobId))
            }
          }
          .onChange(of: model.selectedSourceJobId) { _, id in
            if let source = sources.first(where: { $0.source.sceneJobId == id }) {
              model.selectSource(source)
            }
          }
          if let source = sources.first(where: { $0.source.sceneJobId == model.selectedSourceJobId }) {
            Picker("Mapped camera", selection: $model.selectedCameraId) {
              ForEach(source.cameras, id: \.cameraId) { camera in
                Text(camera.label).tag(Optional(camera.cameraId))
              }
            }
            exactPin("Scene", source.source.sceneJobId.uuidString, hash: source.source.sceneManifestSha256)
            if let specification = source.source.specification {
              exactPin("Specification r\(specification.specificationRevision)", specification.specificationId.uuidString, hash: specification.specificationRevisionSha256)
            }
          }
          Picker("Frozen render profile", selection: $model.selectedProfileId) {
            ForEach(capabilities.profiles.filter(\.available)) { profile in
              Text(profile.profileId).tag(profile.profileId)
            }
          }
          Button("Submit geometry-safe render", action: model.submitRender)
            .buttonStyle(.borderedProminent)
            .disabled(!model.canMutate || !capabilities.acceptingNewJobs || model.selectedCameraId == nil || model.isMutating)
            .accessibilityIdentifier("c14_5.submit-render")
        }
      }

      if let job = model.workspace?.renderJobs.last {
        Divider()
        LabeledContent("Latest render", value: job.state.replacingOccurrences(of: "-", with: " ").capitalized)
        Text("Job \(job.id.uuidString) · version \(job.version)")
          .font(.caption.monospaced()).textSelection(.enabled)
        if let safeCode = job.safeCode { Text(safeCode).font(.caption.monospaced()) }
      }

      if let result = model.workspace?.renderResult,
         let artifact = result.manifest.artifacts.first(where: { $0.role == "geometry-safe-png" }) {
        exactPin("Geometry-safe PNG", artifact.id.uuidString, hash: artifact.sha256)
        if let verified = model.verifiedArtifact,
           let image = UIImage(data: verified.bytes) {
          Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .accessibilityLabel("Verified geometry-safe render result")
        } else {
          Button("Verify and view result", action: model.loadGeometrySafeArtifact)
            .buttonStyle(.bordered)
            .disabled(model.isMutating)
            .accessibilityIdentifier("c14_5.view-result")
        }
        Text("Derived visualisation only. This image cannot change dimensions or establish survey, structural, regulatory, cost or availability truth.")
          .font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  private var readOnlyNote: some View {
    Label("Viewer access is read-only. Server state remains visible; mutation controls are disabled.", systemImage: "eye")
      .font(.footnote)
      .foregroundStyle(.secondary)
  }

  private func stageCard<Content: View>(
    eyebrow: String,
    title: String,
    detail: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(eyebrow.uppercased())
        .font(.caption.weight(.bold))
        .foregroundStyle(.tint)
      Text(title).font(.largeTitle.bold())
      Text(detail).font(.body).foregroundStyle(.secondary)
      Divider()
      content()
      if model.role == .viewer { readOnlyNote }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityIdentifier("c14_5.stage-\(model.selectedStage.rawValue)")
  }

  private func exactPin(_ label: String, _ id: String, hash: String) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(label).font(.caption.weight(.bold)).foregroundStyle(.secondary)
      Text(id).font(.caption.monospaced()).textSelection(.enabled)
      Text(hash).font(.caption2.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
    }
    .accessibilityElement(children: .combine)
  }

  private func metricGrid(_ counts: C14_5SceneCounts) -> some View {
    Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 8) {
      GridRow { metric("Nodes", counts.nodes); metric("Meshes", counts.meshes) }
      GridRow { metric("Vertices", counts.vertices); metric("Triangles", counts.triangles) }
      GridRow { metric("Materials", counts.materials); Color.clear.frame(height: 1) }
    }
    .padding(14)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 14))
  }

  private func metric(_ label: String, _ value: Int) -> some View {
    VStack(alignment: .leading) {
      Text(value.formatted()).font(.title3.bold()).monospacedDigit()
      Text(label).font(.caption).foregroundStyle(.secondary)
    }
  }

  private func unavailable(title: String, detail: String) -> some View {
    ContentUnavailableView {
      Label(title, systemImage: "exclamationmark.triangle")
    } description: {
      Text(detail)
    } actions: {
      Button("Return to homeowner hub", action: onBackToHub)
      Button("Retry") { Task { await model.reload() } }
    }
  }
}

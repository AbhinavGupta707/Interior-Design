import SwiftUI

struct C14_5HomeownerHubView: View {
  let project: CaptureProject
  @Bindable var designModel: C14_5DesignStudioModel
  let twinModel: C14_7TwinIntegrationModel?
  let readiness: C14_6ReadinessSummary?
  let onOpenSetup: () -> Void
  let onOpenDesign: () -> Void
  let onOpenTwin: () -> Void
  let onOpenEvidence: () -> Void
  let onOpenGuided: () -> Void
  let onOpenCapture: () -> Void
  let onOpenMedia: () -> Void
  let onChooseProject: () -> Void

  init(
    project: CaptureProject,
    designModel: C14_5DesignStudioModel,
    twinModel: C14_7TwinIntegrationModel? = nil,
    readiness: C14_6ReadinessSummary? = nil,
    onOpenSetup: @escaping () -> Void = {},
    onOpenDesign: @escaping () -> Void,
    onOpenTwin: @escaping () -> Void = {},
    onOpenEvidence: @escaping () -> Void,
    onOpenGuided: @escaping () -> Void = {},
    onOpenCapture: @escaping () -> Void,
    onOpenMedia: @escaping () -> Void,
    onChooseProject: @escaping () -> Void
  ) {
    self.project = project
    self.designModel = designModel
    self.twinModel = twinModel
    self.readiness = readiness
    self.onOpenSetup = onOpenSetup
    self.onOpenDesign = onOpenDesign
    self.onOpenTwin = onOpenTwin
    self.onOpenEvidence = onOpenEvidence
    self.onOpenGuided = onOpenGuided
    self.onOpenCapture = onOpenCapture
    self.onOpenMedia = onOpenMedia
    self.onChooseProject = onChooseProject
  }

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Label("Homeowner hub", systemImage: "house.lodge")
            .font(.title2.bold())
          Text(project.name)
            .font(.headline)
          Text("Continue the part of your home journey that is ready. Capture is optional; design is unlocked only by exact server-confirmed state.")
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
      }

      if project.isFixture {
        Section {
          Label("Synthetic local project", systemImage: "testtube.2")
            .font(.headline)
          Text("This fixture can exercise capture navigation. It cannot unlock server-authoritative design or stand in for a real project.")
            .foregroundStyle(.secondary)
        }
      }

      Section("Continue your home") {
        branchButton(
          title: "Home setup and readiness",
          detail: setupDetail,
          symbol: "checklist",
          action: onOpenSetup
        )
        .disabled(project.isFixture)
        .accessibilityIdentifier("c14_6.open-home-setup")
        branchButton(
          title: "Evidence and documents",
          detail: "Upload or resume rights-cleared plans, photographs, video and documents.",
          symbol: "doc.badge.plus",
          action: onOpenEvidence
        )
        branchButton(
          title: "Guided camera capture",
          detail: "Capture rooms with RGB keyframes, ARKit poses, live coverage and optional depth. Works without LiDAR.",
          symbol: "viewfinder",
          action: onOpenGuided
        )
        .accessibilityIdentifier("c14_8.open-guided-capture")
        branchButton(
          title: "LiDAR / RoomPlan scan",
          detail: "Add RoomPlan evidence on a compatible device. This is optional and never the camera prerequisite.",
          symbol: "sensor.tag.radiowaves.forward",
          action: onOpenCapture
        )
        branchButton(
          title: "Additional photo and video evidence",
          detail: "Capture protected standalone media and upload it as immutable C2 evidence.",
          symbol: "camera",
          action: onOpenMedia
        )
      }

      designBranch

      Section {
        branchButton(
          title: twinModel?.confirmedTwin == true ? "Review confirmed home twin" : "Build and confirm home twin",
          detail: twinDetail,
          symbol: twinModel?.confirmedTwin == true ? "checkmark.seal.fill" : "point.3.connected.trianglepath.dotted",
          action: onOpenTwin
        )
        .disabled(project.isFixture)
        .accessibilityIdentifier("c14_7.open-twin")
        Button("Choose another project", action: onChooseProject)
      } header: {
        Text("Proposal to confirmed twin")
      } footer: {
        Text("Native uses server-authored C4-C10 contracts. Proposals, appearance outputs and recovery state cannot become canonical without exact preview and explicit confirmation.")
      }
    }
    .navigationTitle(project.name)
    .navigationBarTitleDisplayMode(.inline)
    .task {
      async let design: Void = designModel.activate(projectId: project.id)
      if let twinModel {
        async let twin: Void = twinModel.activate(projectId: project.id)
        _ = await (design, twin)
      } else {
        _ = await design
      }
    }
    .refreshable {
      async let design: Void = designModel.activate(projectId: project.id, force: true)
      if let twinModel {
        async let twin: Void = twinModel.activate(projectId: project.id, force: true)
        _ = await (design, twin)
      } else {
        _ = await design
      }
    }
  }

  private var setupDetail: String {
    guard let readiness else {
      return "Record renovation intent and property context, then verify fresh evidence prerequisites."
    }
    if readiness.laterPlanProcessingEligible {
      return "Prerequisites verified for a later plan-processing request; no proposal has been started."
    }
    let complete = [
      readiness.intakeComplete,
      readiness.propertyContextSelected,
      readiness.readyPlanCount > 0,
    ].filter { $0 }.count
    return "\(complete) of 3 setup prerequisites verified. Continue without using the website."
  }

  private var twinDetail: String {
    guard let twinModel else {
      return "Review explicit proposal and confirmation state in the native journey."
    }
    if twinModel.confirmedTwin {
      return "Fresh exact C4/C5/C10 state confirms this twin; continue into the native design loop."
    }
    switch twinModel.state {
    case .loading, .idle:
      return "Checking proposal, branch and compilation state…"
    case .stale:
      return "Offline state is read-only. Reconnect before any proposal or confirmation action."
    case .forbidden:
      return "The current membership cannot access this project state."
    default:
      return "Review C6 plan or C8/C9 multi-source proposals, preview exact C5 operations, confirm, then compile C10."
    }
  }

  @ViewBuilder
  private var designBranch: some View {
    Section {
      switch designModel.state {
      case .idle, .loading:
        HStack(spacing: 12) {
          ProgressView()
          Text("Checking exact server prerequisites…")
        }
        .accessibilityIdentifier("c14_5.hub-loading")
      case .ready:
        prerequisiteRows
        Button(action: onOpenDesign) {
          Label("Open native design studio", systemImage: "paintpalette.fill")
        }
        .disabled(!designModel.designEligible || project.isFixture)
        .accessibilityIdentifier("c14_5.open-design")
        if !designModel.designEligible {
          Text("Design is locked. Use Build and confirm home twin, then return after exact C5 confirmation and matching C10 compilation.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      case .stale(let summary, let message):
        Label("Last verified \(summary.verifiedAt.formatted(date: .abbreviated, time: .shortened))", systemImage: "wifi.slash")
          .font(.headline)
        Text(message).foregroundStyle(.secondary)
        Text("Cached eligibility: \(summary.designEligible ? "previously eligible" : "not eligible"). It cannot enable design while offline.")
          .font(.footnote)
          .foregroundStyle(.secondary)
        Button("Retry server check") { Task { await designModel.reload() } }
      case .expired:
        recovery(title: "Session expired", detail: "Sign in again before project state can be read.")
      case .forbidden:
        recovery(title: "Project unavailable", detail: "This project or its state is not readable by the current role.")
      case .failure(let message):
        recovery(title: "Design state unavailable", detail: message)
      }
    } header: {
      Text("Design from confirmed twin")
    } footer: {
      Text("The server, exact C4/C5 pins and a succeeded matching C10 job are authoritative. Local recovery is display-only.")
    }
  }

  @ViewBuilder
  private var prerequisiteRows: some View {
    let workspace = designModel.workspace
    prerequisiteRow(
      title: "Current existing snapshot",
      complete: workspace?.snapshot != nil,
      detail: workspace?.snapshot.map { "v\($0.version) · \($0.snapshotSha256.prefix(10))…" }
        ?? "No current existing snapshot"
    )
    prerequisiteRow(
      title: "Explicit C5 confirmation",
      complete: workspace?.confirmedBranch != nil,
      detail: workspace?.confirmedBranch.map { "revision \($0.revision) · head differs from source" }
        ?? "No changed branch matches the exact current head"
    )
    prerequisiteRow(
      title: "Exact C10 twin",
      complete: workspace?.exactSceneJob != nil && workspace?.scene != nil,
      detail: workspace?.exactSceneJob.map { "succeeded · job \($0.id.uuidString.prefix(8))" }
        ?? "No succeeded scene matches the current snapshot ID and hash"
    )
  }

  private func prerequisiteRow(title: String, complete: Bool, detail: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: complete ? "checkmark.seal.fill" : "circle.dashed")
        .foregroundStyle(complete ? .green : .secondary)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.headline)
        Text(detail).font(.subheadline).foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(title), \(complete ? "complete" : "not complete"). \(detail)")
  }

  private func branchButton(
    title: String,
    detail: String,
    symbol: String,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: symbol)
          .font(.title2)
          .frame(width: 32)
        VStack(alignment: .leading, spacing: 3) {
          Text(title).font(.headline)
          Text(detail).font(.subheadline).foregroundStyle(.secondary)
        }
        Spacer()
        Image(systemName: "chevron.right").accessibilityHidden(true)
      }
      .contentShape(Rectangle())
      .padding(.vertical, 4)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
    .accessibilityHint(detail)
  }

  private func recovery(title: String, detail: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Label(title, systemImage: "exclamationmark.triangle")
        .font(.headline)
      Text(detail).foregroundStyle(.secondary)
      Button("Retry server check") { Task { await designModel.reload() } }
    }
  }
}

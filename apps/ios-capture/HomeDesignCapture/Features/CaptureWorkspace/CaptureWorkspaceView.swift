import SwiftUI

struct C7CaptureWorkspaceView: View {
  @Bindable var model: C7CaptureWorkspaceModel
  let project: CaptureProject
  let onUseManualEvidence: () -> Void
  let onChooseAnotherProject: () -> Void

  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Label("Native capture", systemImage: "viewfinder")
            .font(.title2.bold())
          Text(project.name)
            .font(.headline)
          Text(
            "RoomPlan evidence can support a proposal. It is not a measured survey, structural conclusion, or canonical model update."
          )
          .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
      }

      if model.isReadOnly {
        Section {
          Label("Viewer access is read-only", systemImage: "eye")
          Text(
            model.readOnlyNotice
              ?? "You can inspect capture and proposal status. Upload, retry, cancel, rights, and reference controls are disabled."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
        }
      }

      stateContent
    }
    .navigationTitle("Capture workspace")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: project.id) { await model.activate(projectId: project.id) }
    .onChange(of: scenePhase) { _, newPhase in
      if newPhase == .active { model.refresh() }
    }
  }

  @ViewBuilder
  private var stateContent: some View {
    switch model.state {
    case .loading:
      statusSection(
        title: "Loading capture state",
        message: "Checking the protected local journal and server state.",
        icon: "arrow.triangle.2.circlepath"
      ) { ProgressView() }

    case .sessionSetup:
      sessionSetup

    case .creatingSession:
      statusSection(
        title: "Creating capture brief",
        message: "The protected idempotent request can be replayed safely after interruption.",
        icon: "doc.badge.clock"
      ) { ProgressView() }

    case .ready:
      statusSection(
        title: "Ready to capture",
        message:
          "The server brief pins this project, mode, expiry, instructions, and service-processing rights.",
        icon: "camera.viewfinder"
      ) {
        if !model.isReadOnly {
          Button("Start RoomPlan capture") { model.startCapture() }
            .buttonStyle(.borderedProminent)
        }
        fallbackButtons
      }

    case .permissionRequired:
      statusSection(
        title: "Camera permission required",
        message:
          "Allow camera access in Settings to use RoomPlan, or continue with plan, photo, or manual evidence. Permission does not grant model-training use.",
        icon: "camera.badge.ellipsis"
      ) {
        if !model.isReadOnly {
          Button("Check permission again", action: model.startCapture)
            .buttonStyle(.borderedProminent)
        }
        fallbackButtons
      }

    case .scanning:
      sensorStatus(
        title: "Scanning",
        message:
          "Keep the app active and follow RoomPlan guidance. Camera frames are not retained by C7.",
        icon: "viewfinder.circle"
      )

    case .interrupted:
      sensorStatus(
        title: "Capture interrupted",
        message:
          "The app is attempting a bounded return to the original coordinate space. Recovery is not guaranteed.",
        icon: "pause.circle"
      )

    case .relocalising:
      sensorStatus(
        title: "Return to the origin",
        message:
          "Move back to a previously observed area. If relocalisation cannot be confirmed, restart rather than joining incompatible spaces.",
        icon: "location.magnifyingglass"
      )

    case .sensorRestartRequired:
      statusSection(
        title: "Restart sensor capture",
        message:
          "The live sensor session ended or its origin was not confirmed. Protected uploads can resume, but an authoritative sensor session cannot resume after termination.",
        icon: "arrow.counterclockwise.circle"
      ) {
        if !model.isReadOnly {
          Button("Restart capture", action: model.startCapture)
            .buttonStyle(.borderedProminent)
        }
        fallbackButtons
      }

    case .roomReview, .structureReview:
      reviewContent

    case .packaging:
      statusSection(
        title: "Protecting capture package",
        message:
          "Artifacts are copied under opaque names, checksummed without loading whole source files, and protected by iOS data protection.",
        icon: "lock.doc"
      ) { ProgressView() }

    case .paused:
      statusSection(
        title: "Upload paused",
        message:
          "Resume reconciles server-recorded part numbers and local checksums before transferring anything else.",
        icon: "pause.circle"
      ) {
        if !model.isReadOnly {
          Button("Resume secure upload", action: model.resumeUpload)
            .buttonStyle(.borderedProminent)
          destructiveControls
        }
      }

    case .offlinePaused:
      statusSection(
        title: "Offline — capture protected",
        message:
          "Reconnect and resume. Signed URLs and tokens are not stored in the local journal.",
        icon: "wifi.slash"
      ) {
        Button("Try again", action: model.retryCurrentAction)
          .buttonStyle(.borderedProminent)
        fallbackButtons
      }

    case .uploading(let progress):
      Section("Secure background upload") {
        ProgressView(value: progress) {
          Text("Uploading checksum-bound parts")
        } currentValueLabel: {
          Text(progress, format: .percent.precision(.fractionLength(0)))
        }
        .accessibilityValue(Text(progress, format: .percent.precision(.fractionLength(0))))
        Text(
          "Each artifact uploads independently in bounded 8 MiB parts. Relaunch reconciles the protected journal with server-recorded parts."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        if !model.isReadOnly {
          Button("Pause upload", action: model.pauseUpload)
          destructiveControls
        }
      }

    case .processing:
      statusSection(
        title: "Processing evidence",
        message:
          "The server is validating exact source and manifest hashes. The result will be a proposal or an explicit abstention; it cannot mutate the canonical model.",
        icon: "gearshape.2"
      ) {
        ProgressView()
        Button("Refresh status", action: model.refresh)
        if !model.isReadOnly { destructiveControls }
      }

    case .proposed(let proposal):
      proposalContent(proposal)

    case .abstained(let abstention):
      abstentionContent(abstention)

    case .cancelPending:
      statusSection(
        title: "Cancellation pending",
        message: "Upload and publication remain blocked while the server fences active work.",
        icon: "hourglass.circle"
      ) { Button("Refresh status", action: model.refresh) }

    case .cancelled:
      statusSection(
        title: "Capture cancelled",
        message: "The server session is terminal. Start a new brief to capture again.",
        icon: "xmark.circle"
      ) { fallbackButtons }

    case .expired:
      statusSection(
        title: "Capture brief expired",
        message:
          "The pinned server brief can no longer authorise upload. Start a new capture session; no expired signed URL will be reused.",
        icon: "clock.badge.exclamationmark"
      ) { fallbackButtons }

    case .forbidden:
      statusSection(
        title: "Capture unavailable",
        message:
          "This project or capture is not available for the current role. The app does not disclose whether another tenant owns it.",
        icon: "lock.slash"
      ) { Button("Choose another project", action: onChooseAnotherProject) }

    case .safeFailure(let message, let retryable):
      statusSection(
        title: "Capture stopped safely",
        message: message,
        icon: "exclamationmark.shield"
      ) {
        if retryable && !model.isReadOnly {
          Button("Retry safely", action: model.retryCurrentAction)
            .buttonStyle(.borderedProminent)
        }
        fallbackButtons
      }
    }
  }

  private var sessionSetup: some View {
    Group {
      Section("Capture brief") {
        TextField("Capture label", text: $model.captureLabel)
          .textInputAutocapitalization(.sentences)
          .accessibilityHint("A short label up to 120 characters")
        Picker("Capture mode", selection: $model.mode) {
          Text("Single room").tag(C7CaptureMode.singleRoom)
          Text("Connected structure").tag(C7CaptureMode.structure)
        }
        if model.mode == .structure {
          TextField("Expected room count (optional)", text: $model.expectedRoomCountText)
            .keyboardType(.numberPad)
        }
      }

      Section("Rights and processing") {
        Picker("Rights basis", selection: $model.rightsBasis) {
          Text("I own the capture").tag(C7RightsBasis.ownedByUser)
          Text("Permission granted").tag(C7RightsBasis.permissionGranted)
          Text("Licensed").tag(C7RightsBasis.licensed)
          Text("Public domain").tag(C7RightsBasis.publicDomain)
        }
        Toggle("Allow service processing", isOn: $model.serviceProcessingConsent)
        LabeledContent("Model training", value: "Denied")
        Text("Service processing is separate from model training. C7 always denies training use.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }

      Section {
        if !model.isReadOnly {
          Button("Create capture brief", action: model.beginSession)
            .buttonStyle(.borderedProminent)
        }
        fallbackButtons
      }
    }
  }

  private var reviewContent: some View {
    Group {
      Section(model.state == .structureReview ? "Structure review" : "Room review") {
        Text(
          model.state == .structureReview
            ? "Review the ordered rooms and shared-origin result. A failed or restarted origin cannot be called one structure."
            : "Review the captured room before packaging. RoomPlan classifications remain source observations."
        )
        .foregroundStyle(.secondary)
        ForEach(model.rooms) { room in
          VStack(alignment: .leading, spacing: 6) {
            Text("Room \(room.sequence)")
              .font(.headline)
            Text("Storey \(room.story)")
              .font(.caption)
              .foregroundStyle(.secondary)
            if model.isReadOnly {
              Text(room.userLabel ?? "Unlabelled room")
            } else {
              TextField(
                "Optional room label",
                text: Binding(
                  get: { roomLabel(room.id) },
                  set: { model.updateRoomLabel(roomId: room.id, label: $0) }
                )
              )
            }
          }
          .accessibilityElement(children: .contain)
        }
      }

      if let assessment = model.qualityAssessment, let manifest = model.qualityManifest {
        C7CaptureQualityView(assessment: assessment, manifest: manifest)
      }
      C7ReferenceMeasurementView(
        model: model.referenceMeasurements,
        sourceOptions: model.sourceOptions,
        readOnly: model.isReadOnly
      )
      if !model.isReadOnly {
        Section {
          Button("Protect package and upload", action: model.prepareAndUpload)
            .buttonStyle(.borderedProminent)
          destructiveControls
        }
      }
    }
  }

  private func proposalContent(_ proposal: C7CaptureModelProposalSummary) -> some View {
    Group {
      Section {
        Label("Existing-state proposal", systemImage: "cube.transparent")
          .font(.headline)
          .foregroundStyle(.blue)
        LabeledContent("Overall converter confidence", value: "\(proposal.overallConfidence)%")
        LabeledContent(
          "Unresolved source entities", value: "\(proposal.unresolvedSourceEntityIds.count)")
        Text(
          "This immutable result is a review proposal. It has not changed the canonical home model and is not professional verification."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
      } header: {
        Text("Proposal ready")
      }
      findings(proposal.findings)
      Section { fallbackButtons }
    }
  }

  private func abstentionContent(_ abstention: C7CaptureAbstentionSummary) -> some View {
    Group {
      Section {
        Label("No model proposal was published", systemImage: "hand.raised.fill")
          .font(.headline)
          .foregroundStyle(.orange)
        Text(abstention.detail)
        LabeledContent("Safe code", value: abstention.code.rawValue)
        Text(
          "Abstention preserves uncertainty and source evidence. It is not a failed canonical mutation."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
      } header: {
        Text("Explicit abstention")
      }
      findings(abstention.findings)
      Section("Next actions") {
        ForEach(abstention.nextActions, id: \.rawValue) { action in
          Label(action.title, systemImage: "arrow.right.circle")
        }
        if abstention.retryable && !model.isReadOnly {
          Button("Retry conversion", action: model.retryProcessing)
            .buttonStyle(.borderedProminent)
        }
        fallbackButtons
      }
    }
  }

  @ViewBuilder
  private func findings(_ findings: [C7ProposalFinding]) -> some View {
    Section("Findings") {
      if findings.isEmpty {
        Text("No converter finding was reported.")
          .foregroundStyle(.secondary)
      } else {
        ForEach(findings) { finding in
          VStack(alignment: .leading, spacing: 4) {
            Text(finding.message)
            Text("\(finding.severity.rawValue.capitalized) · \(finding.code)")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          .accessibilityElement(children: .combine)
        }
      }
    }
  }

  private func sensorStatus(title: String, message: String, icon: String) -> some View {
    statusSection(title: title, message: message, icon: icon) {
      ProgressView()
      if !model.isReadOnly {
        Button("Cancel capture", role: .destructive, action: model.cancelSession)
      }
    }
  }

  private func statusSection<Actions: View>(
    title: String,
    message: String,
    icon: String,
    @ViewBuilder actions: () -> Actions
  ) -> some View {
    Section {
      Label(title, systemImage: icon)
        .font(.headline)
        .accessibilityAddTraits(.isHeader)
      Text(message)
        .foregroundStyle(.secondary)
      actions()
    }
  }

  private var fallbackButtons: some View {
    VStack(alignment: .leading, spacing: 10) {
      Button("Use plan, photo, or manual evidence", action: onUseManualEvidence)
      Button("Choose another project", action: onChooseAnotherProject)
    }
  }

  private var destructiveControls: some View {
    VStack(alignment: .leading, spacing: 10) {
      Button("Cancel capture", role: .destructive, action: model.cancelSession)
      Button("Withdraw processing rights", role: .destructive, action: model.withdrawRights)
        .accessibilityHint(
          "Immediately blocks upload and publication and requests server cancellation")
    }
  }

  private func roomLabel(_ id: UUID) -> String {
    model.rooms.first(where: { $0.id == id })?.userLabel ?? ""
  }
}

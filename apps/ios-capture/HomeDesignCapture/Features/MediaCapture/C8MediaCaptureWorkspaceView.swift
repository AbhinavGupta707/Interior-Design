import SwiftUI

struct C8MediaCaptureWorkspaceView: View {
  @Bindable var model: C8MediaCaptureWorkspaceModel
  let project: CaptureProject
  let onOpenEvidence: () -> Void
  let onDone: () -> Void

  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    List {
      Section {
        Label("Guided reconstruction media", systemImage: "camera.viewfinder")
          .font(.title2.bold())
        Text(project.name).font(.headline)
        Text(
          "Photos and video remain source evidence. Reconstruction can only publish a proposal after bounded preparation and privacy review; it cannot change canonical geometry."
        )
        .foregroundStyle(.secondary)
      }

      if model.isSyntheticFixture {
        Section {
          Label("Synthetic Simulator fixture", systemImage: "testtube.2")
            .font(.headline)
          Text(
            "Visibly synthetic and rights-cleared. This journey proves app state only — never camera, depth, focus, thermal, pressure, or physical-device behavior."
          )
          .font(.subheadline)
        }
        .listRowBackground(Color.indigo.opacity(0.12))
        .accessibilityElement(children: .combine)
      }

      stateContent

      Section("Other evidence routes") {
        Button("Open immutable evidence workspace", action: onOpenEvidence)
        Button("Choose another project", action: onDone)
      }
    }
    .navigationTitle("Photo and video")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: project.id) { await model.activate(projectId: project.id) }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active { model.handleBackgrounding() }
    }
  }

  @ViewBuilder
  private var stateContent: some View {
    switch model.state {
    case .loading:
      status(
        "Checking capture capability", "Camera discovery happens before any permission request.",
        "camera.badge.clock"
      ) {
        ProgressView()
      }
    case .permissionRequired:
      status(
        "Camera permission is optional",
        "Allow camera access for guided media, or use existing immutable evidence. Training remains denied either way.",
        "camera.badge.ellipsis"
      ) {
        Button("Continue to permission", action: model.requestCameraPermission)
          .buttonStyle(.borderedProminent)
        Button("Use existing evidence", action: onOpenEvidence)
      }
    case .cameraDenied:
      status(
        "Camera access denied",
        "Enable camera access in Settings, or continue with uploaded photos, video, plans, and manual evidence.",
        "camera.fill.badge.xmark"
      ) {
        Button("Check permission again", action: model.requestCameraPermission)
        Button("Use existing evidence", action: onOpenEvidence)
      }
    case .cameraRestricted:
      status(
        "Camera access restricted",
        "A device policy prevents camera capture. Existing evidence remains available.",
        "lock.slash"
      ) { Button("Use existing evidence", action: onOpenEvidence) }
    case .unavailable:
      status(
        "Camera unavailable",
        "No eligible camera or synthetic fixture is present in this runtime.",
        "camera.fill.badge.xmark"
      ) { Button("Use existing evidence", action: onOpenEvidence) }
    case .ready(let capabilities):
      cameraControls(capabilities: capabilities)
    case .capturingPhoto:
      sensorStatus(
        "Capturing protected photo",
        "Hold still. The original is stored under an opaque protected identifier before hashing.",
        "camera.shutter.button"
      )
    case .recordingVideo:
      sensorStatus(
        "Recording video",
        "Move slowly around the room, keep surfaces in frame, revisit earlier features, and stop within 90 seconds.",
        "record.circle"
      )
      Section {
        Button("Stop and protect video", action: model.stopVideo)
          .buttonStyle(.borderedProminent)
          .accessibilityHint("Stops recording and begins local quality inspection")
      }
    case .review:
      review
    case .uploading(let progress):
      Section("Immutable C2 handoff") {
        ProgressView(value: progress) {
          Text("Uploading checksum-bound source parts")
        } currentValueLabel: {
          Text(progress, format: .percent.precision(.fractionLength(0)))
        }
        .accessibilityValue(Text(progress, format: .percent.precision(.fractionLength(0))))
        Text(
          "Upload recovery stays protected on this device. Signed URLs, credentials, object keys, and raw media never enter the safe receipt or visible status."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        Button("Pause upload", action: model.cancelUpload)
      }
    case .uploaded:
      status(
        "Immutable evidence handed off",
        "The C2 asset IDs and exact source hashes are recorded. Processing and privacy acceptance are still required before reconstruction.",
        "checkmark.shield"
      ) {
        LabeledContent("Immutable assets", value: String(model.immutableReceiptCount))
        Button("Open evidence status", action: onOpenEvidence)
      }
    case .interrupted:
      status(
        "Capture interrupted",
        "No live camera session is resumed silently. Restart after returning to the app; protected completed media remains available.",
        "pause.circle"
      ) { Button("Restart camera", action: model.recover).buttonStyle(.borderedProminent) }
    case .recovering:
      status(
        "Restarting camera", "A fresh AVFoundation session is being configured.",
        "arrow.clockwise.circle"
      ) {
        ProgressView()
      }
    case .resourcePressure:
      status(
        "Camera stopped for system pressure",
        "Let the device cool and close other camera-heavy apps before creating a fresh session.",
        "gauge.with.dots.needle.67percent"
      ) { Button("Try a fresh session", action: model.recover) }
    case .thermalPressure:
      status(
        "Camera stopped for thermal pressure",
        "Move the device out of heat and wait. Existing protected media is unchanged.",
        "thermometer.high"
      ) { Button("Check again", action: model.recover) }
    case .failed(let message, let retryable):
      status("Capture stopped safely", message, "exclamationmark.shield") {
        if retryable { Button("Retry safely", action: model.retryAfterFailure) }
        Button("Use existing evidence", action: onOpenEvidence)
      }
    }
  }

  private func cameraControls(capabilities: C8CameraCapabilities) -> some View {
    Group {
      Section {
        Picker("Capture format", selection: $model.captureKind) {
          ForEach(C8MediaCaptureKind.allCases) { kind in Text(kind.title).tag(kind) }
        }
        .pickerStyle(.segmented)
        .disabled(model.pendingMediaCount > 0 || model.immutableReceiptCount > 0)

        Toggle("Capture photo depth when truly available", isOn: $model.depthRequested)
          .disabled(
            model.captureKind == .video
              || !capabilities.depthPhotoSupported
              || capabilities.syntheticFixtureAvailable
              || model.pendingMediaCount > 0
              || model.immutableReceiptCount > 0
          )
        Text(
          capabilities.depthPhotoSupported && !capabilities.syntheticFixtureAvailable
            ? "Depth is requested only for supported still-photo formats. Server decoding must confirm it before RGB-D use."
            : "Depth is not available in this exact runtime. RGB capture remains available."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
      } header: {
        Text("Capture mode")
      }

      Section {
        if let session = model.previewSession {
          C8CameraPreview(session: session)
            .frame(minHeight: 260)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .accessibilityLabel("Live physical camera preview")
        } else {
          syntheticPreview
        }
      } header: {
        Text("Preview")
      }

      Section("Coverage guidance") {
        ProgressView(
          value: Double(model.coveredSectorCount),
          total: Double(C8CoverageSector.allCases.count)
        ) {
          Text("Room viewpoints")
        } currentValueLabel: {
          Text("\(model.coveredSectorCount) of \(C8CoverageSector.allCases.count)")
        }
        ForEach(model.latestGuidance, id: \.self) { guidance in
          Label(guidanceText(guidance), systemImage: "viewfinder.circle")
        }
        if model.captureKind == .photo {
          Button("Capture protected photo", action: model.capturePhoto)
            .buttonStyle(.borderedProminent)
        } else {
          Button("Start silent protected video", action: model.startVideo)
            .buttonStyle(.borderedProminent)
            .disabled(!capabilities.videoSupported)
        }
      }
    }
  }

  private var review: some View {
    Group {
      Section("Capture review") {
        LabeledContent("Protected sources", value: String(model.pendingMediaCount))
        LabeledContent(
          "Coverage",
          value: "\(model.coveredSectorCount) of \(C8CoverageSector.allCases.count) viewpoints"
        )
        if let quality = model.latestQuality {
          LabeledContent(
            "Sharpness guidance score",
            value: quality.blurScoreMillionths.formatted()
          )
          LabeledContent(
            "Exposure guidance score",
            value: quality.exposureScoreMillionths.formatted()
          )
        }
        ForEach(model.latestGuidance, id: \.self) { guidance in
          Text(guidanceText(guidance)).foregroundStyle(.secondary)
        }
        Button("Capture another viewpoint", action: model.captureMore)
      }

      Section("Rights and processing") {
        Picker("Rights basis", selection: $model.rightsBasis) {
          ForEach(EvidenceRightsBasis.allCases) { basis in Text(basis.title).tag(basis) }
        }
        Toggle("Allow service processing", isOn: $model.serviceProcessingConsent)
        Label("Model training: denied", systemImage: "hand.raised.fill")
          .foregroundStyle(.secondary)
        Text(
          "Service processing permits immutable storage, bounded decoding, metadata stripping, quality diagnostics, and privacy review. It does not permit training."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
      }

      Section {
        Button("Upload immutable sources", action: model.uploadPending)
          .buttonStyle(.borderedProminent)
          .disabled(!model.serviceProcessingConsent || model.pendingMediaCount == 0)
        Button("Discard local pending media", role: .destructive, action: model.discardPending)
        Text(
          "Discard removes only pending protected local files. It cannot delete an immutable server asset already handed off."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
      }
    }
  }

  private var syntheticPreview: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 16).fill(Color.indigo.gradient)
      VStack(spacing: 10) {
        Image(systemName: "testtube.2").font(.largeTitle)
        Text("SYNTHETIC SIMULATOR FIXTURE").font(.headline.monospaced())
        Text("NOT CAMERA · NOT DEPTH · RIGHTS-CLEARED").font(.caption.monospaced())
      }
      .multilineTextAlignment(.center)
      .foregroundStyle(.white)
      .padding()
    }
    .frame(minHeight: 240)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Synthetic Simulator fixture. Not camera or depth evidence.")
  }

  @ViewBuilder
  private func status<Content: View>(
    _ title: String,
    _ message: String,
    _ icon: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    Section {
      Label(title, systemImage: icon).font(.headline)
      Text(message).foregroundStyle(.secondary)
      content()
    }
  }

  private func sensorStatus(_ title: String, _ message: String, _ icon: String) -> some View {
    Section {
      Label(title, systemImage: icon).font(.headline)
      Text(message).foregroundStyle(.secondary)
      ProgressView()
    }
    .accessibilityElement(children: .combine)
  }

  private func guidanceText(_ guidance: C8CaptureGuidance) -> String {
    switch guidance {
    case .addParallax: "Step sideways between views to add parallax."
    case .completeCoverage:
      "Continue around the room; include corners, openings, floor, and ceiling."
    case .holdSteady: "Hold the device steady and repeat this view."
    case .improveLighting: "Improve even lighting; avoid blown windows and dark corners."
    case .ready: "This source meets local guidance; server diagnostics may still abstain."
    case .slowDown: "Move more slowly to preserve overlap."
    }
  }
}

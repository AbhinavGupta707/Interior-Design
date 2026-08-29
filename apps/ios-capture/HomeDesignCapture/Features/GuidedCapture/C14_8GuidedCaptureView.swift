import SwiftUI
import UIKit

struct C14_8GuidedCaptureView: View {
  @Bindable var model: C14_8GuidedCaptureModel
  let project: CaptureProject
  let actor: C14_6Actor
  let onOpenEvidence: () -> Void
  let onOpenRoomPlan: () -> Void
  let onDone: () -> Void

  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    List {
      Section {
        Label("Guided camera capture", systemImage: "camera.viewfinder")
          .font(.title2.bold())
        Text(project.name).font(.headline)
        Text(
          "Walk slowly around each room while the app retains useful connected RGB views. Keep a wall or corner visible, step sideways, visit every connected zone and finish near where you started. LiDAR is optional."
        )
        .foregroundStyle(.secondary)
      }

      capabilityCard
      stateContent

      Section("Other homeowner branches") {
        if model.capabilities.roomPlan {
          Button("Add a separate LiDAR / RoomPlan scan") { onOpenRoomPlan() }
          Text(
            "RoomPlan is additional evidence. It never replaces the camera-first journey or confirms canonical geometry by itself."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
        }
        Button("Use existing evidence") { onOpenEvidence() }
        Button("Back to homeowner hub") { onDone() }
      }
    }
    .navigationTitle("Guided capture")
    .navigationBarTitleDisplayMode(.inline)
    .task(id: "\(project.id):\(actor.userId):\(actor.role)") {
      await model.activate(projectId: project.id, actor: actor)
    }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active { model.handleBackgrounding() }
    }
  }

  private var capabilityCard: some View {
    Section("Available capture quality") {
      Label(
        model.capabilities.qualityExplanation,
        systemImage: model.capabilities.sceneDepth ? "sensor.tag.radiowaves.forward" : "camera.fill"
      )
      .font(.headline)
      LabeledContent("RGB keyframes", value: "Required")
      LabeledContent(
        "ARKit poses + intrinsics",
        value: model.capabilities.arWorldTracking ? "Available" : "Fixture only")
      LabeledContent(
        "Scene depth", value: model.capabilities.sceneDepth ? "Additional" : "Not available")
      LabeledContent(
        "RoomPlan", value: model.capabilities.roomPlan ? "Optional branch" : "Not available")
      Label("Model training: denied", systemImage: "hand.raised.fill")
        .foregroundStyle(.secondary)
      #if DEBUG
        if model.isSyntheticFixture {
          Text(
            "SYNTHETIC SIMULATOR FIXTURE · NOT PHYSICAL CAMERA, ARKIT TRACKING, DEPTH OR ROOMPLAN EVIDENCE"
          )
          .font(.caption.monospaced().bold())
          .foregroundStyle(.indigo)
          .accessibilityIdentifier("c14_8.synthetic-disclosure")
        }
      #endif
    }
  }

  @ViewBuilder
  private var stateContent: some View {
    switch model.state {
    case .checking:
      status(
        "Checking protected recovery",
        "Capability discovery occurs before permission and is scoped to this project and actor.",
        "shield.lefthalf.filled"
      ) {
        ProgressView()
      }
    case .permissionRequired:
      status(
        "Camera permission is optional",
        "Allow camera access for guided capture, or continue with existing evidence.",
        "camera.badge.ellipsis"
      ) {
        Button("Continue to camera permission") { model.requestPermission() }
          .buttonStyle(.borderedProminent)
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .cameraDenied:
      status(
        "Camera access denied",
        "Enable access in Settings or use the evidence workspace. No sensor session was created.",
        "camera.fill.badge.xmark"
      ) {
        Button("Check camera permission") { model.requestPermission() }
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .cameraRestricted:
      status(
        "Camera access restricted",
        "Device policy prevents guided capture. Existing evidence remains available.", "lock.slash"
      ) {
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .unavailable:
      status(
        "ARKit world tracking unavailable",
        "This runtime cannot provide the pose and intrinsics evidence required by guided capture.",
        "viewfinder.circle"
      ) {
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .readOnly:
      status(
        "Capture is read-only",
        "The protected draft belongs to another authenticated actor, or this role cannot mutate capture evidence.",
        "person.badge.shield.checkmark"
      ) {
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .ready:
      liveCapture
    case .capturing:
      status(
        "Retaining synchronized keyframe",
        "The RGB bytes, pose, intrinsics, tracking state and optional depth share one sample identity.",
        "camera.shutter.button"
      ) {
        ProgressView()
      }
    case .interrupted:
      status(
        "Capture interrupted safely",
        "Completed keyframes remain protected. Continue only by creating a fresh independent coordinate segment.",
        "pause.circle"
      ) {
        Button("Start a fresh segment") { model.recoverAfterInterruption() }
          .buttonStyle(.borderedProminent)
      }
    case .review:
      review(fixture: false)
    case .fixtureReview:
      #if DEBUG
        review(fixture: true)
      #else
        status(
          "Capture state unavailable",
          "A fixture-only state was rejected by this production build.", "exclamationmark.shield"
        ) {
          Button("Use existing evidence") { onOpenEvidence() }
        }
      #endif
    case .submitting(let stage, let progress):
      status(
        stage.rawValue,
        "Uploads are checksum-bound and resumable. Project or role changes discard stale results.",
        "arrow.up.circle"
      ) {
        ProgressView(value: progress)
        Button("Pause safely") { model.cancelSubmission() }
      }
    case .accepted(let sourcesReady):
      accepted(sourcesReady: sourcesReady)
    case .startingReconstruction:
      status(
        "Starting proposal-only reconstruction",
        "C8 is rechecking every ready RGB source and the exact accepted envelope hash.",
        "cube.transparent"
      ) {
        ProgressView()
      }
    case .reconstructed(let jobId):
      status(
        "Reconstruction proposal queued",
        "Job \(jobId.uuidString.lowercased()). Geometry remains a C8 proposal until the existing C9/C5 review and confirmation journey.",
        "checkmark.shield"
      ) {
        Button("Return to homeowner hub") { onDone() }
          .buttonStyle(.borderedProminent)
      }
    case .failed(let message, let retryable):
      status("Capture stopped safely", message, "exclamationmark.shield") {
        if retryable {
          if model.draft?.acceptance != nil {
            Button("Recheck immutable sources") { Task { await model.checkSourceReadiness() } }
          } else if model.draft?.keyframes.isEmpty == false {
            Button("Return to review") { model.finishRoomReview() }
          } else {
            Button("Start a fresh segment") { model.recoverAfterInterruption() }
          }
        }
        Button("Use existing evidence") { onOpenEvidence() }
      }
    }
  }

  private var liveCapture: some View {
    Group {
      Section("Live camera") {
        ZStack(alignment: .bottom) {
          if let session = model.previewSession {
            C14_8ARPreview(session: session)
              .accessibilityLabel("Live ARKit camera preview")
          } else {
            #if DEBUG
              RoundedRectangle(cornerRadius: 18).fill(Color.indigo.gradient)
              VStack(spacing: 10) {
                Image(systemName: "testtube.2").font(.largeTitle)
                Text("SYNTHETIC JOURNEY FIXTURE").font(.headline.monospaced())
                Text("NOT SENSOR EVIDENCE").font(.caption.monospaced())
              }.foregroundStyle(.white)
            #else
              ContentUnavailableView(
                "Camera preview unavailable",
                systemImage: "camera.fill.badge.xmark",
                description: Text("Capture stopped before any sensor evidence was retained.")
              )
            #endif
          }
          captureGuidanceOverlay
        }
        // Keep enough unobscured preview above the always-visible guidance so a
        // homeowner can still compose the wall, corner or opening being requested.
        .frame(minHeight: 440)
        .clipShape(RoundedRectangle(cornerRadius: 18))
      }

      Section("Live guidance") {
        LabeledContent("Room", value: model.currentRoom?.label ?? "Unknown")
        LabeledContent("Retained keyframes", value: String(model.capturedKeyframeCount))
        if let readiness = model.captureReadiness {
          LabeledContent(
            "Spatial evidence", value: readiness.isReady ? "Ready to review" : "Keep capturing")
          LabeledContent(
            "Connected views", value: "\(readiness.connectedRatioMillionths / 10_000)%")
          LabeledContent(
            "Route travelled",
            value: String(
              format: "%.1f m", Double(readiness.trajectoryTravelMicrometres) / 1_000_000))
          LabeledContent("Loop closures", value: String(readiness.loopClosureCount))
          LabeledContent("Unresolved zones", value: String(readiness.unresolvedZoneCount))
        }
        LabeledContent("Direction / height guide", value: "\(model.observedCellCount) of 24")
        if let telemetry = model.liveTelemetry {
          LabeledContent(
            "Feature observations", value: String(telemetry.spatialEvidence.featurePointCount))
          LabeledContent(
            "View overlap", value: "\(telemetry.spatialEvidence.overlapScoreMillionths / 10_000)%")
          LabeledContent(
            "Parallax signal",
            value: "\(telemetry.spatialEvidence.parallaxScoreMillionths / 10_000)%")
          LabeledContent("Tracking", value: telemetry.trackingState.rawValue)
          if let distance = telemetry.spatialEvidence.startAnchorDistanceMicrometres,
            let threshold = telemetry.spatialEvidence.loopClosureDistanceThresholdMicrometres
          {
            LabeledContent(
              "Return to start",
              value: String(
                format: "%.1f m away · %.1f m target",
                Double(distance) / 1_000_000,
                Double(threshold) / 1_000_000
              )
            )
          }
        }
        Toggle("Select useful keyframes automatically", isOn: $model.automaticCaptureEnabled)
        Text(
          "Preview starts unarmed. Aim at the intended room anchor and tap Start capture here; automatic selection then skips blurry, poorly exposed, disconnected or near-duplicate views."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        #if DEBUG
          Toggle(
            "Save private rejected-frame diagnostics",
            isOn: Binding(
              get: { model.rejectedFrameDiagnosticsEnabled },
              set: { model.setRejectedFrameDiagnosticsEnabled($0) }
            )
          )
          .accessibilityIdentifier("c14_10.rejected-frame-diagnostics")
          Text(
            "Physical diagnostics only. When enabled, the app keeps route-spread examples for each rejection reason, newest segment first, capped at \(C14_10RejectedFrameDiagnosticPolicy.maximumRetainedCount) protected 640 px snapshots on this device. Structured candidate telemetry is separately protected. Neither enters the Capture Envelope or uploads, and image capture is off again after relaunch."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
          if let record = model.latestRejectedFrameDiagnostic,
            let data = model.latestRejectedFrameThumbnailData,
            let image = UIImage(data: data)
          {
            Image(uiImage: image)
              .resizable()
              .scaledToFit()
              .frame(maxHeight: 220)
              .clipShape(RoundedRectangle(cornerRadius: 12))
              .accessibilityLabel("Latest private rejected-frame diagnostic")
            LabeledContent(
              "Latest rejected snapshot",
              value: record.outcome.reason.homeownerLabel.capitalized
            )
            Text(
              "Tracking \(record.outcome.trackingState.rawValue) · features \(record.outcome.featurePointCount) · overlap \(record.outcome.overlapScoreMillionths / 10_000)% · translation \(record.outcome.translationFromPreviousMicrometres / 1_000) mm · parallax \(record.outcome.parallaxScoreMillionths / 10_000)% · \(record.imageByteCount / 1_024) KiB · SHA-256 \(record.imageSHA256.prefix(12))…"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
          }
          if model.rejectedFrameDiagnosticCount > 0 {
            LabeledContent(
              "Private diagnostic snapshots",
              value:
                "\(model.rejectedFrameDiagnosticCount) of \(C14_10RejectedFrameDiagnosticPolicy.maximumRetainedCount)"
            )
            Button("Delete private diagnostic snapshots", role: .destructive) {
              model.clearRejectedFrameDiagnostics()
            }
          }
          if model.rejectedFrameDiagnosticsPersistenceFailed {
            Label(
              "A rejected-frame snapshot could not be protected. Do not treat this diagnostic run as complete.",
              systemImage: "exclamationmark.shield"
            )
            .foregroundStyle(.orange)
          }
        #endif
        ForEach(model.guidance, id: \.self) {
          Label($0, systemImage: "viewfinder.circle")
        }
        if model.selectionDiagnostics.totalAutomaticCandidateCount > 0 {
          LabeledContent(
            "Automatic candidate windows",
            value: String(model.selectionDiagnostics.totalAutomaticCandidateCount)
          )
          LabeledContent(
            "Retained / skipped",
            value:
              "\(model.selectionDiagnostics.retainedCandidateCount) / \(model.selectionDiagnostics.skippedCandidateCount)"
          )
          LabeledContent(
            "Protected detailed windows",
            value:
              "\(model.selectionDiagnostics.detailedOutcomes?.count ?? 0) of \(C14_10SelectionDiagnostics.maximumDetailedOutcomeCount)"
          )
          if let latest = model.selectionDiagnostics.recentOutcomes?.last {
            LabeledContent(
              "Last completed window",
              value: latest.reason.homeownerLabel.capitalized
            )
            Text(
              "Tracking \(latest.trackingState.rawValue) · features \(latest.featurePointCount) · overlap \(latest.overlapScoreMillionths / 10_000)% · translation \(latest.translationFromPreviousMicrometres / 1_000) mm · parallax \(latest.parallaxScoreMillionths / 10_000)%"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
          }
          ForEach(model.selectionDiagnostics.rankedSkippedOutcomes.prefix(4), id: \.reason) {
            outcome in
            LabeledContent(outcome.reason.homeownerLabel.capitalized, value: String(outcome.count))
          }
        }
        if model.selectionDiagnosticsPersistenceFailed {
          Label(
            "Private selection diagnostics could not be protected; this run cannot close physical acceptance.",
            systemImage: "exclamationmark.shield"
          )
          .foregroundStyle(.orange)
        }
        Button("Retain this useful view manually") { model.captureKeyframe() }
          .buttonStyle(.bordered)
          .accessibilityIdentifier("c14_8.capture-keyframe")
          .disabled(!model.captureArmed || model.currentSelectionDecision?.shouldRetain != true)
        if model.capturedKeyframeCount > 0 {
          Button("Stop capture and review") { model.finishRoomReview() }
            .disabled(!model.canStopCapture)
        }
      }

      coverageGrid
    }
  }

  private var captureGuidanceOverlay: some View {
    let readiness = model.captureReadiness
    let telemetry = model.liveTelemetry
    let instruction =
      !model.captureArmed
      ? model.guidance.first
        ?? "Lift the phone toward a well-lit corner and wait for normal tracking."
      : model.selectionInstruction
        ?? model.guidance.first
        ?? "Lift the phone toward a well-lit corner and wait for normal tracking."
    return VStack(alignment: .leading, spacing: 5) {
      Label(
        instruction,
        systemImage: readiness?.isReady == true
          ? "checkmark.circle.fill" : "figure.walk.motion"
      )
      .font(.callout.bold())
      .lineLimit(2)

      Text(
        "\(model.capturedKeyframeCount) retained · \((readiness?.connectedRatioMillionths ?? 0) / 10_000)% connected · \(String(format: "%.1f m", Double(readiness?.trajectoryTravelMicrometres ?? 0) / 1_000_000)) · \(readiness?.loopClosureCount ?? 0) loop · \(readiness?.unresolvedZoneCount ?? 1) unresolved"
      )
      .font(.caption.monospacedDigit())
      .lineLimit(2)

      Text(
        "Tracking \((telemetry?.trackingState.rawValue ?? "acquiring").replacingOccurrences(of: "-", with: " ")) · features \(telemetry?.spatialEvidence.featurePointCount ?? 0) · overlap \((telemetry?.spatialEvidence.overlapScoreMillionths ?? 0) / 10_000)% · parallax \((telemetry?.spatialEvidence.parallaxScoreMillionths ?? 0) / 10_000)%"
      )
      .font(.caption2.monospacedDigit())
      .lineLimit(2)

      if let coverageGuidance = model.coverageGuidance {
        Text(coverageGuidance)
          .font(.caption2)
          .lineLimit(2)
      }

      if let loopClosureProgress = model.loopClosureProgress {
        Text(loopClosureProgress)
          .font(.caption2.monospacedDigit())
          .lineLimit(2)
      }

      if !model.captureArmed {
        Button("Start capture here") { model.armCapture() }
          .buttonStyle(.borderedProminent)
          .tint(.white)
          .foregroundStyle(.black)
          .disabled(!model.canArmCapture)
          .accessibilityIdentifier("c14_10.arm-capture")
      }
      if model.captureArmed, model.currentSegmentKeyframeCount > 0 {
        Button(model.canStopCapture ? "Stop capture and review" : "Saving current view…") {
          model.finishRoomReview()
        }
        .buttonStyle(.borderedProminent)
        .tint(.white)
        .foregroundStyle(.black)
        .disabled(!model.canStopCapture)
        .accessibilityHint(
          model.captureReadiness?.isReady == true
            ? "Stops camera analysis and opens the connected capture review."
            : "Stops camera analysis and opens review with unresolved evidence kept explicit."
        )
        .accessibilityIdentifier("c14_10.review-live-capture")
      }
    }
    .foregroundStyle(.white)
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.black.opacity(0.78))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("c14_10.capture-guidance-overlay")
  }

  private func review(fixture: Bool) -> some View {
    Group {
      #if DEBUG
        if fixture {
          Section {
            Label("Fixture journey complete", systemImage: "testtube.2")
              .font(.headline)
            Text(
              "This proves UI, recovery, coverage and state isolation only. The server will not accept it as physical capture evidence."
            )
            .foregroundStyle(.secondary)
          }
        }
      #endif
      Section("Capture review") {
        LabeledContent("Rooms", value: String(model.totalRoomCount))
        LabeledContent("RGB keyframes", value: String(model.capturedKeyframeCount))
        LabeledContent(
          "Optional depth samples", value: String(model.draft?.depthHandles.count ?? 0))
        LabeledContent(
          "Missing areas",
          value: String(
            model.draft?.rooms.flatMap(\.coverage).filter { $0.status == .missing }.count ?? 0)
        )
        if let readiness = model.captureReadiness {
          Label(
            model.envelopeSpatiallyReady
              ? "Every room has connected spatial evidence ready for proposal review."
              : "This envelope has \(model.unresolvedRoomCount) unresolved room(s); incomplete spatial evidence will stay explicit.",
            systemImage: model.envelopeSpatiallyReady
              ? "point.3.connected.trianglepath.dotted" : "exclamationmark.triangle"
          )
          if readiness.isReady && !model.envelopeSpatiallyReady {
            Text("The current room is ready, but an earlier room still needs connected evidence.")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
          ForEach(readiness.reasons, id: \.self) {
            Text($0).font(.footnote).foregroundStyle(.secondary)
          }
        }
        Text(
          "Missing, occluded and unknown areas remain explicit. They are not inferred as walls, openings or dimensions."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        Button("Capture more in this room") { model.captureMore() }
        Button("Add another room with a fresh origin") { model.addRoom() }
          .disabled(model.totalRoomCount >= C14_8CaptureContract.maximumRooms)
      }

      roomMetadata
      coverageGrid
      semanticReview

      if model.capabilities.roomPlan {
        Section("Optional RoomPlan evidence") {
          Text(
            "Attach only a separately processed, rights-compatible C7 package. Its geometry remains proposal evidence and does not replace RGB."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
          Button("Find processed RoomPlan packages") { model.refreshRoomPlanSources() }
            .disabled(model.roomPlanDiscoveryInProgress)
          if model.roomPlanDiscoveryInProgress { ProgressView() }
          if let message = model.roomPlanDiscoveryMessage {
            Text(message).font(.footnote).foregroundStyle(.secondary)
          }
          ForEach(model.roomPlanCandidates) { candidate in
            Toggle(
              isOn: Binding(
                get: {
                  model.draft?.roomPlanSources.contains(where: {
                    $0.captureSessionId == candidate.source.captureSessionId
                      && $0.packageId == candidate.source.packageId
                  }) == true
                },
                set: { model.setRoomPlanSource(candidate, selected: $0) }
              )
            ) {
              VStack(alignment: .leading) {
                Text(candidate.captureLabel)
                Text("Package \(candidate.source.packageId.uuidString.lowercased().prefix(8))…")
                  .font(.caption.monospaced())
                  .foregroundStyle(.secondary)
              }
            }
          }
        }
      }

      if !fixture {
        Section("Rights and acceptance") {
          Picker("Rights basis", selection: $model.rightsBasis) {
            ForEach(EvidenceRightsBasis.allCases) { Text($0.title).tag($0) }
          }
          .disabled(model.rightsAreBound)
          Toggle("Allow service processing", isOn: $model.serviceProcessingConsent)
          Toggle("Request optional appearance proposal", isOn: $model.includeAppearance)
          Label("Model training remains denied", systemImage: "hand.raised.fill")
            .foregroundStyle(.secondary)
          Button("Upload and accept capture envelope") { model.submit() }
            .buttonStyle(.borderedProminent)
            .disabled(!model.serviceProcessingConsent || !model.canMutate)
            .accessibilityIdentifier("c14_8.accept-envelope")
        }
      }
    }
  }

  private var roomMetadata: some View {
    Section("Current room") {
      TextField(
        "Room label",
        text: Binding(
          get: { model.currentRoom?.label ?? "" },
          set: { model.renameCurrentRoom($0) }
        )
      )
      if let zones = model.currentRoom?.zones {
        Picker(
          "Connected room zone",
          selection: Binding(
            get: { model.activeZoneId ?? zones[0].zoneId },
            set: { model.selectZone($0) }
          )
        ) {
          ForEach(zones) { zone in
            Text("\(zone.label) · \(zone.status.rawValue)").tag(zone.zoneId)
          }
        }
      }
      Button("Add another connected zone") { model.addZone() }
        .disabled((model.currentRoom?.zones?.count ?? 0) >= 32)
      Text(
        "Use zones for L-shaped rooms, connected alcoves or open-plan areas. Walk through each zone while keeping shared walls, corners or openings visible."
      )
      .font(.footnote)
      .foregroundStyle(.secondary)
      Text(
        "Each interruption and room transition starts an independent coordinate segment unless a later reviewed registration explicitly relates them."
      )
      .font(.footnote)
      .foregroundStyle(.secondary)
    }
  }

  private var coverageGrid: some View {
    Section("Secondary direction / height guide · tap unresolved cells to mark occluded or unknown")
    {
      Text("This grid helps point the camera but cannot make the room spatially ready by itself.")
        .font(.footnote)
        .foregroundStyle(.secondary)
      LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 8) {
        ForEach(model.currentRoom?.coverage ?? []) { cell in
          Button {
            model.cycleCoverage(cell.id)
          } label: {
            VStack(spacing: 3) {
              Image(systemName: coverageSymbol(cell.status))
              Text(cell.horizontalSector.rawValue.replacingOccurrences(of: "-", with: " "))
              Text(cell.verticalBand.rawValue)
            }
            .font(.caption2)
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(
              coverageColour(cell.status).opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
          }
          .buttonStyle(.plain)
          .disabled(cell.status == .observed)
          .accessibilityLabel(
            "\(cell.horizontalSector.rawValue) \(cell.verticalBand.rawValue), \(cell.status.rawValue)"
          )
        }
      }
    }
  }

  private var semanticReview: some View {
    Section("Evidence layers") {
      ForEach(C14_8SemanticLayer.allCases) { layer in
        Picker(
          layer.title,
          selection: Binding(
            get: {
              model.currentRoom?.semanticDeclarations.first(where: { $0.layer == layer })?.status
                ?? .unknown
            },
            set: { model.updateSemantic(layer: layer, status: $0) }
          )
        ) {
          ForEach(C14_8SemanticStatus.allCases) { Text($0.title).tag($0) }
        }
      }
      Text(
        "These homeowner declarations keep structure, fixed fittings, movable furniture, appearance and temporary clutter separate. They do not establish canonical geometry."
      )
      .font(.footnote)
      .foregroundStyle(.secondary)
    }
  }

  private func accepted(sourcesReady: Bool) -> some View {
    Group {
      Section {
        Label("Capture envelope accepted", systemImage: "checkmark.shield")
          .font(.headline)
        Text(
          "The envelope and exact C2/C7 fingerprints are immutable. Acceptance does not confirm geometry or create C4/C5 operations."
        )
        .foregroundStyle(.secondary)
        if let acceptance = model.draft?.acceptance {
          LabeledContent("Envelope", value: acceptance.envelopeId.uuidString.lowercased())
          LabeledContent("SHA-256", value: "\(acceptance.envelopeSha256.prefix(16))…")
        }
      }
      Section("Proposal handoff") {
        if sourcesReady {
          Label("All RGB sources passed C2 validation", systemImage: "checkmark.circle.fill")
            .foregroundStyle(.green)
          Toggle("Request optional appearance proposal", isOn: $model.includeAppearance)
          Button("Start C8 reconstruction proposal") { model.startReconstruction() }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canMutate)
        } else {
          Label("Waiting for immutable RGB validation", systemImage: "clock.badge.checkmark")
          Text(
            "Depth and RoomPlan remain retained evidence, but this checkpoint starts production C8 only from ready RGB sources."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
          Button("Recheck source readiness") { Task { await model.checkSourceReadiness() } }
        }
      }
    }
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

  private func coverageSymbol(_ status: C14_8CoverageStatus) -> String {
    switch status {
    case .observed: "checkmark.circle.fill"
    case .missing: "circle.dashed"
    case .occluded: "eye.slash"
    case .unknown: "questionmark.circle"
    }
  }

  private func coverageColour(_ status: C14_8CoverageStatus) -> Color {
    switch status {
    case .observed: .green
    case .missing: .orange
    case .occluded: .purple
    case .unknown: .gray
    }
  }
}

import SwiftUI

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
          "Capture one room at a time with retained RGB keyframes, ARKit poses and camera intrinsics. LiDAR is optional; unknown or occluded areas remain explicit."
        )
        .foregroundStyle(.secondary)
      }

      capabilityCard
      stateContent

      Section("Other homeowner branches") {
        if model.capabilities.roomPlan {
          Button("Add a separate LiDAR / RoomPlan scan") { onOpenRoomPlan() }
          Text("RoomPlan is additional evidence. It never replaces the camera-first journey or confirms canonical geometry by itself.")
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
      LabeledContent("ARKit poses + intrinsics", value: model.capabilities.arWorldTracking ? "Available" : "Fixture only")
      LabeledContent("Scene depth", value: model.capabilities.sceneDepth ? "Additional" : "Not available")
      LabeledContent("RoomPlan", value: model.capabilities.roomPlan ? "Optional branch" : "Not available")
      Label("Model training: denied", systemImage: "hand.raised.fill")
        .foregroundStyle(.secondary)
      #if DEBUG
        if model.isSyntheticFixture {
          Text("SYNTHETIC SIMULATOR FIXTURE · NOT PHYSICAL CAMERA, ARKIT TRACKING, DEPTH OR ROOMPLAN EVIDENCE")
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
      status("Checking protected recovery", "Capability discovery occurs before permission and is scoped to this project and actor.", "shield.lefthalf.filled") {
        ProgressView()
      }
    case .permissionRequired:
      status("Camera permission is optional", "Allow camera access for guided capture, or continue with existing evidence.", "camera.badge.ellipsis") {
        Button("Continue to camera permission") { model.requestPermission() }
          .buttonStyle(.borderedProminent)
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .cameraDenied:
      status("Camera access denied", "Enable access in Settings or use the evidence workspace. No sensor session was created.", "camera.fill.badge.xmark") {
        Button("Check camera permission") { model.requestPermission() }
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .cameraRestricted:
      status("Camera access restricted", "Device policy prevents guided capture. Existing evidence remains available.", "lock.slash") {
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .unavailable:
      status("ARKit world tracking unavailable", "This runtime cannot provide the pose and intrinsics evidence required by guided capture.", "viewfinder.circle") {
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .readOnly:
      status("Capture is read-only", "The protected draft belongs to another authenticated actor, or this role cannot mutate capture evidence.", "person.badge.shield.checkmark") {
        Button("Use existing evidence") { onOpenEvidence() }
      }
    case .ready:
      liveCapture
    case .capturing:
      status("Retaining synchronized keyframe", "The RGB bytes, pose, intrinsics, tracking state and optional depth share one sample identity.", "camera.shutter.button") {
        ProgressView()
      }
    case .interrupted:
      status("Capture interrupted safely", "Completed keyframes remain protected. Continue only by creating a fresh independent coordinate segment.", "pause.circle") {
        Button("Start a fresh segment") { model.recoverAfterInterruption() }
          .buttonStyle(.borderedProminent)
      }
    case .review:
      review(fixture: false)
    case .fixtureReview:
      #if DEBUG
        review(fixture: true)
      #else
        status("Capture state unavailable", "A fixture-only state was rejected by this production build.", "exclamationmark.shield") {
          Button("Use existing evidence") { onOpenEvidence() }
        }
      #endif
    case .submitting(let stage, let progress):
      status(stage.rawValue, "Uploads are checksum-bound and resumable. Project or role changes discard stale results.", "arrow.up.circle") {
        ProgressView(value: progress)
        Button("Pause safely") { model.cancelSubmission() }
      }
    case .accepted(let sourcesReady):
      accepted(sourcesReady: sourcesReady)
    case .startingReconstruction:
      status("Starting proposal-only reconstruction", "C8 is rechecking every ready RGB source and the exact accepted envelope hash.", "cube.transparent") {
        ProgressView()
      }
    case .reconstructed(let jobId):
      status("Reconstruction proposal queued", "Job \(jobId.uuidString.lowercased()). Geometry remains a C8 proposal until the existing C9/C5 review and confirmation journey.", "checkmark.shield") {
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
        if let session = model.previewSession {
          C14_8ARPreview(session: session)
            .frame(minHeight: 320)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .accessibilityLabel("Live ARKit camera preview")
        } else {
          #if DEBUG
            ZStack {
              RoundedRectangle(cornerRadius: 18).fill(Color.indigo.gradient)
              VStack(spacing: 10) {
                Image(systemName: "testtube.2").font(.largeTitle)
                Text("SYNTHETIC JOURNEY FIXTURE").font(.headline.monospaced())
                Text("NOT SENSOR EVIDENCE").font(.caption.monospaced())
              }.foregroundStyle(.white)
            }
            .frame(minHeight: 260)
          #else
            ContentUnavailableView(
              "Camera preview unavailable",
              systemImage: "camera.fill.badge.xmark",
              description: Text("Capture stopped before any sensor evidence was retained.")
            )
          #endif
        }
      }

      Section("Live guidance") {
        LabeledContent("Room", value: model.currentRoom?.label ?? "Unknown")
        LabeledContent("Retained keyframes", value: String(model.capturedKeyframeCount))
        LabeledContent("Observed areas", value: "\(model.observedCellCount) of 24")
        if let telemetry = model.liveTelemetry {
          LabeledContent("Current area", value: telemetry.coverageCellId)
          LabeledContent("Tracking", value: telemetry.trackingState.rawValue)
        }
        ForEach(model.guidance, id: \.self) {
          Label($0, systemImage: "viewfinder.circle")
        }
        Button("Retain RGB keyframe") { model.captureKeyframe() }
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("c14_8.capture-keyframe")
          .disabled(model.liveTelemetry?.trackingState == .unavailable)
        if model.capturedKeyframeCount > 0 {
          Button("Review room and missing areas") { model.finishRoomReview() }
        }
      }

      coverageGrid
    }
  }

  private func review(fixture: Bool) -> some View {
    Group {
      #if DEBUG
        if fixture {
          Section {
            Label("Fixture journey complete", systemImage: "testtube.2")
              .font(.headline)
            Text("This proves UI, recovery, coverage and state isolation only. The server will not accept it as physical capture evidence.")
              .foregroundStyle(.secondary)
          }
        }
      #endif
      Section("Capture review") {
        LabeledContent("Rooms", value: String(model.totalRoomCount))
        LabeledContent("RGB keyframes", value: String(model.capturedKeyframeCount))
        LabeledContent("Optional depth samples", value: String(model.draft?.depthHandles.count ?? 0))
        LabeledContent(
          "Missing areas",
          value: String(model.draft?.rooms.flatMap(\.coverage).filter { $0.status == .missing }.count ?? 0)
        )
        Text("Missing, occluded and unknown areas remain explicit. They are not inferred as walls, openings or dimensions.")
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
          Text("Attach only a separately processed, rights-compatible C7 package. Its geometry remains proposal evidence and does not replace RGB.")
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
      Text("Each interruption and room transition starts an independent coordinate segment unless a later reviewed registration explicitly relates them.")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }

  private var coverageGrid: some View {
    Section("Coverage · tap non-observed cells to mark occluded or unknown") {
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
            .background(coverageColour(cell.status).opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
          }
          .buttonStyle(.plain)
          .disabled(cell.status == .observed)
          .accessibilityLabel("\(cell.horizontalSector.rawValue) \(cell.verticalBand.rawValue), \(cell.status.rawValue)")
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
      Text("These homeowner declarations keep structure, fixed fittings, movable furniture, appearance and temporary clutter separate. They do not establish canonical geometry.")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
  }

  private func accepted(sourcesReady: Bool) -> some View {
    Group {
      Section {
        Label("Capture envelope accepted", systemImage: "checkmark.shield")
          .font(.headline)
        Text("The envelope and exact C2/C7 fingerprints are immutable. Acceptance does not confirm geometry or create C4/C5 operations.")
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
          Text("Depth and RoomPlan remain retained evidence, but this checkpoint starts production C8 only from ready RGB sources.")
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

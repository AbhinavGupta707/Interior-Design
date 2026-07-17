import SwiftUI
import UniformTypeIdentifiers

struct EvidenceWorkspaceView: View {
  @Bindable var repository: EvidenceRepository
  let project: CaptureProject
  let onCheckCapture: () -> Void
  let onDone: () -> Void

  @Environment(\.openURL) private var openURL
  @State private var showsFileImporter = false

  var body: some View {
    List {
      Section {
        Label("Local fixture · Synthetic evidence only", systemImage: "lock.shield")
          .font(.subheadline.weight(.semibold))
        Text("This C2 workspace validates, hashes and transfers evidence. It does not claim antivirus coverage, 3D understanding, RoomPlan output or physical-device evidence.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }

      recoverySection

      Section("1. Source type") {
        Picker("Evidence type", selection: $repository.kind) {
          ForEach(EvidenceKind.allCases) { kind in
            Text(kind.title).tag(kind)
          }
        }
        .pickerStyle(.segmented)
        .disabled(isWorking)
      }

      Section {
        Button {
          showsFileImporter = true
        } label: {
          Label("Choose a file", systemImage: "doc.badge.plus")
        }
        .disabled(isWorking)

        if let selection = repository.selection {
          LabeledContent("Selected") {
            Text(verbatim: selection.fileName)
          }
          LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: selection.size, countStyle: .file))
          LabeledContent("Declared type", value: selection.mimeType)
        } else {
          Text("Choose a supported file no larger than 2 GiB. Type and size are checked before hashing.")
            .foregroundStyle(.secondary)
        }
      } header: {
        Text("2. File")
      } footer: {
        Text("HEIC/HEIF is allowed at the edge but may be rejected when the local decoder is unavailable. Media signatures and bounded parser limits are checked after upload.")
      }

      Section("3. Rights and processing") {
        Picker("Rights basis", selection: $repository.rightsBasis) {
          ForEach(EvidenceRightsBasis.allCases) { basis in
            Text(basis.title).tag(basis)
          }
        }

        TextField("Attribution (optional)", text: $repository.attribution)
          .textInputAutocapitalization(.sentences)
        TextField("HTTPS licence URL (optional)", text: $repository.licenceURL)
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()

        Toggle(isOn: $repository.serviceProcessingConsent) {
          VStack(alignment: .leading, spacing: 3) {
            Text("Allow service processing")
            Text("Required to store, checksum, inspect within limits and prepare safe derived previews.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }

        Toggle(
          isOn: Binding(
            get: { repository.trainingUseConsent == .granted },
            set: { repository.trainingUseConsent = $0 ? .granted : .denied }
          )
        ) {
          VStack(alignment: .leading, spacing: 3) {
            Text("Allow model training")
            Text("Separate from service processing. Denied by default.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
      }

      transferSection

      inventorySection

      Section("Other capture routes") {
        Button("Check device capture eligibility", action: onCheckCapture)
        Button("Choose another project", action: onDone)
      }

      Section {
        Text("Simulator note: navigation, hashing and deterministic service states can be tested here. Simulator runs do not prove physical camera, RoomPlan, background relaunch or real-device transfer continuity.")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
    }
    .navigationTitle("Project evidence")
    .navigationBarTitleDisplayMode(.inline)
    .fileImporter(
      isPresented: $showsFileImporter,
      allowedContentTypes: [.pdf, .jpeg, .png, .heic, .image, .movie, .svg],
      allowsMultipleSelection: false
    ) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      Task { await repository.selectFile(url) }
    }
    .task {
      await repository.activate(projectId: project.id)
    }
    .onChange(of: repository.lastAccess) { _, access in
      if let access { openURL(access.url) }
    }
  }

  @ViewBuilder
  private var recoverySection: some View {
    switch repository.transferState {
    case .paused(let recovery):
      Section {
        VStack(alignment: .leading, spacing: 5) {
          Text("Upload ready to resume")
            .font(.headline)
          Text(verbatim: "\(recovery.fileName) · the server session is reconciled before fresh signed URLs are requested.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        Button("Resume upload") { repository.resume(recovery) }
        Button("Cancel saved upload", role: .destructive) {
          Task { await repository.cancel(recovery) }
        }
      }
    case .failed(_, let recovery) where recovery != nil:
      Section {
        Button("Retry saved upload") { repository.resume(recovery!) }
        Button("Cancel saved upload", role: .destructive) {
          Task { await repository.cancel(recovery) }
        }
      }
    default:
      EmptyView()
    }
  }

  @ViewBuilder
  private var transferSection: some View {
    Section {
      switch repository.transferState {
      case .idle:
        Button("Hash and upload") { repository.startUpload() }
          .disabled(repository.selection == nil || !repository.serviceProcessingConsent)
      case .hashing(let progress):
        progressView(title: "Hashing locally", progress: progress)
        Button("Pause", action: repository.pause)
      case .uploading(let progress):
        progressView(title: "Uploading immutable source", progress: progress)
        Button("Pause", action: repository.pause)
      case .completing:
        HStack { ProgressView(); Text("Finalising once…") }
      case .completed:
        Label("Upload complete; bounded processing has started.", systemImage: "checkmark.circle")
          .foregroundStyle(.secondary)
        Button("Add another file") { repository.startUpload() }
          .disabled(repository.selection == nil)
      case .failed(let message, _):
        Label(message, systemImage: "exclamationmark.triangle")
          .foregroundStyle(.secondary)
          .accessibilityLabel("Upload needs attention. \(message)")
        if repository.selection != nil {
          Button("Try upload again") { repository.startUpload() }
        }
      case .paused:
        EmptyView()
      }
    } header: {
      Text("Transfer")
    } footer: {
      Text("Bearer credentials and short-lived signed URLs remain in memory. Recovery stores only the staged local file, session identifiers, checksums and completed part tokens.")
    }
  }

  @ViewBuilder
  private var inventorySection: some View {
    Section {
      switch repository.inventoryState {
      case .idle, .loading:
        HStack { ProgressView(); Text("Loading evidence…") }
      case .loaded(let assets) where assets.isEmpty:
        ContentUnavailableView(
          "No evidence yet",
          systemImage: "doc.badge.plus",
          description: Text("Add a small synthetic plan, photograph, video or document.")
        )
      case .loaded(let assets):
        ForEach(assets) { asset in
          VStack(alignment: .leading, spacing: 7) {
            HStack {
              Text(verbatim: asset.fileName)
                .font(.headline)
                .lineLimit(1)
              Spacer()
              Text(asset.status.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            }
            Text(statusMessage(asset))
              .font(.subheadline)
              .foregroundStyle(.secondary)
            if asset.status == .ready {
              Button("Request short-lived preview") {
                Task { await repository.requestPreview(asset: asset) }
              }
            }
          }
          .padding(.vertical, 4)
          .accessibilityElement(children: .combine)
        }
      case .offline:
        recoveryMessage("You’re offline", "Reconnect and retry. Nothing new has been submitted.")
      case .expired:
        recoveryMessage("Fixture session expired", "Sign in again. Local recovery metadata remains available.")
      case .forbidden:
        recoveryMessage("Evidence unavailable", "This project or role cannot perform that evidence action.")
      case .failure(let message):
        recoveryMessage("Evidence could not be loaded", message)
      }

      Button("Refresh inventory") { Task { await repository.loadInventory() } }
    } header: {
      Text("Evidence inventory")
    } footer: {
      Text("Statuses describe transfer and bounded processing only. They do not establish spatial understanding or professional verification.")
    }
  }

  private func progressView(title: String, progress: Double) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(title).font(.headline)
        Spacer()
        Text(progress, format: .percent.precision(.fractionLength(0)))
          .monospacedDigit()
      }
      ProgressView(value: progress)
        .accessibilityLabel(title)
        .accessibilityValue(Text(progress, format: .percent))
    }
  }

  private func recoveryMessage(_ title: String, _ message: String) -> some View {
    VStack(alignment: .leading, spacing: 5) {
      Label(title, systemImage: "exclamationmark.triangle")
        .font(.headline)
      Text(message)
        .foregroundStyle(.secondary)
    }
  }

  private func statusMessage(_ asset: EvidenceAsset) -> String {
    switch asset.status {
    case .pendingUpload: "Waiting for file parts."
    case .uploading: "The multipart transfer is still in progress."
    case .uploaded: "The immutable source is queued for processing."
    case .processing: "Checksum and bounded media safety limits are being checked."
    case .ready: "A validated representation is available on request."
    case .quarantined: "Access is restricted while a typed safety result is reviewed."
    case .rejected: rejectionMessage(asset.rejectionCode)
    case .aborted: "The incomplete transfer was stopped."
    }
  }

  private func rejectionMessage(_ code: EvidenceRejectionCode?) -> String {
    switch code {
    case .checksumMismatch: "The received bytes did not match the declared checksum."
    case .signatureMismatch: "The file signature did not match its declared type."
    case .unsupportedType: "The local decoder or media type is unavailable."
    case .resourceLimit: "The file exceeded a bounded resource limit."
    case .malformedMedia: "The file could not be parsed safely."
    case .malwareSuspected: "A scanner adapter reported suspicious content; this is not an antivirus-clean claim."
    case .processingFailed: "Processing could not finish safely."
    case nil: "The file was not accepted for safe processing."
    }
  }

  private var isWorking: Bool {
    switch repository.transferState {
    case .hashing, .uploading, .completing: true
    default: false
    }
  }
}

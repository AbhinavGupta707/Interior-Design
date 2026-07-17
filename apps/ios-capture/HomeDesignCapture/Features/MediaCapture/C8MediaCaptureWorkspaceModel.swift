@preconcurrency import AVFoundation
import Foundation
import Observation

enum C8MediaCaptureState: Equatable, Sendable {
  case cameraDenied
  case cameraRestricted
  case capturingPhoto
  case failed(message: String, retryable: Bool)
  case interrupted
  case loading
  case permissionRequired
  case ready(C8CameraCapabilities)
  case recordingVideo
  case recovering
  case resourcePressure
  case review
  case thermalPressure
  case unavailable
  case uploaded
  case uploading(progress: Double)
}

@MainActor
@Observable
final class C8MediaCaptureWorkspaceModel {
  private(set) var state: C8MediaCaptureState = .loading
  private(set) var capabilities: C8CameraCapabilities?
  private(set) var draft: C8MediaCaptureDraft?
  private(set) var latestGuidance: [C8CaptureGuidance] = [.completeCoverage]

  var captureKind: C8MediaCaptureKind = .photo
  var depthRequested = false
  var rightsBasis: EvidenceRightsBasis = .ownedByUser
  var serviceProcessingConsent = false

  @ObservationIgnored private let camera: any C8CameraCaptureServing
  @ObservationIgnored private let capabilityProvider: any C8CameraCapabilityProviding
  @ObservationIgnored private let permissionProvider: any C8CameraPermissionProviding
  @ObservationIgnored private let inspector: any C8CapturedMediaInspecting
  @ObservationIgnored private let journal: any C8CaptureJournalStoring
  @ObservationIgnored private let mediaStore: any C8ProtectedMediaStoring
  @ObservationIgnored private let uploader: any C8ImmutableEvidenceUploading
  @ObservationIgnored private var activeTask: Task<Void, Never>?
  @ObservationIgnored private var pendingVideo: (id: UUID, url: URL)?
  private var projectId: UUID?

  init(
    camera: any C8CameraCaptureServing,
    capabilityProvider: any C8CameraCapabilityProviding,
    permissionProvider: any C8CameraPermissionProviding,
    inspector: any C8CapturedMediaInspecting = C8CapturedMediaInspector(),
    journal: any C8CaptureJournalStoring = C8ProtectedCaptureJournal(),
    mediaStore: any C8ProtectedMediaStoring = C8ProtectedMediaStore(),
    uploader: any C8ImmutableEvidenceUploading
  ) {
    self.camera = camera
    self.capabilityProvider = capabilityProvider
    self.permissionProvider = permissionProvider
    self.inspector = inspector
    self.journal = journal
    self.mediaStore = mediaStore
    self.uploader = uploader
  }

  var previewSession: AVCaptureSession? { camera.previewSession }
  var isSyntheticFixture: Bool { camera.syntheticFixture }
  var pendingMediaCount: Int { draft?.handles.count ?? 0 }
  var immutableReceiptCount: Int { draft?.receipts.count ?? 0 }
  var coveredSectorCount: Int { draft?.coveredSectors.count ?? 0 }
  var latestQuality: C8CapturedMediaQuality? { draft?.mediaQuality.last }

  var qualityManifest: C8NativeCaptureQualityManifest? {
    guard let draft else { return nil }
    return C8NativeCaptureQualityManifest(
      coveredSectors: draft.coveredSectors,
      depthCaptureRequested: draft.depthRequested,
      depthDeliveredCount: draft.depthDeliveredCount,
      interruptionCount: draft.interruptionCount,
      media: draft.mediaQuality,
      origin: draft.origin,
      resourcePressureCount: draft.resourcePressureCount,
      thermalInterruptionCount: draft.thermalInterruptionCount
    )
  }

  func activate(projectId rawProjectId: String) async {
    activeTask?.cancel()
    state = .loading
    guard let projectId = UUID(uuidString: rawProjectId) else {
      state = .failed(message: "The selected project identifier is invalid.", retryable: false)
      return
    }
    self.projectId = projectId
    do {
      if let restored = try await journal.load(projectId: projectId) {
        draft = restored
        captureKind = restored.kind
        depthRequested = restored.depthRequested
        latestGuidance = C8CoverageGuidance.guidance(
          kind: restored.kind,
          covered: restored.coveredSectors,
          latestQuality: restored.mediaQuality.last
        )
        state = restored.handles.isEmpty && !restored.receipts.isEmpty ? .uploaded : .review
        return
      }
    } catch {
      state = .failed(message: "Protected capture state could not be restored.", retryable: true)
      return
    }
    await presentPreflight(requestPermission: false)
  }

  func requestCameraPermission() {
    run { [weak self] in await self?.presentPreflight(requestPermission: true) }
  }

  func prepareCamera() async {
    guard let capabilities else { return }
    if depthRequested && (!capabilities.depthPhotoSupported || captureKind == .video) {
      state = .failed(
        message: "Depth is available only for still photos on a physically capable device.",
        retryable: true
      )
      return
    }
    do {
      try camera.configure(depthRequested: depthRequested && captureKind == .photo) {
        [weak self] event in
        self?.accept(event)
      }
      try await camera.start()
      state = .ready(capabilities)
    } catch C8CameraCaptureError.depthUnavailable {
      depthRequested = false
      state = .failed(
        message:
          "This exact camera configuration did not expose depth. Continue with RGB or try a supported rear camera.",
        retryable: true
      )
    } catch {
      state = .failed(message: "The camera session could not start safely.", retryable: true)
    }
  }

  func capturePhoto() {
    guard captureKind == .photo else { return }
    state = .capturingPhoto
    run { [weak self] in
      guard let self else { return }
      do {
        let destination = try await self.mediaStore.allocateDestination()
        do {
          let artifact = try await self.camera.capturePhoto(to: destination.url)
          try Task.checkCancellation()
          let handle = try await self.mediaStore.finalize(
            id: destination.id,
            mimeType: artifact.mimeType,
            containsDepthData: artifact.containsDepthData,
            origin: artifact.origin
          )
          let quality = try await self.inspector.inspect(
            fileURL: destination.url,
            mimeType: artifact.mimeType
          )
          try Task.checkCancellation()
          await self.record(handle: handle, quality: quality)
        } catch {
          try? FileManager.default.removeItem(at: destination.url)
          throw error
        }
      } catch {
        await MainActor.run {
          self.state = .failed(
            message: "The photo was not retained. Check camera and storage availability.",
            retryable: true)
        }
      }
    }
  }

  func startVideo() {
    guard captureKind == .video else { return }
    run { [weak self] in
      guard let self else { return }
      do {
        let destination = try await self.mediaStore.allocateDestination()
        try Task.checkCancellation()
        await MainActor.run {
          self.pendingVideo = destination
          do {
            try self.camera.startVideo(to: destination.url)
            self.state = .recordingVideo
          } catch {
            self.pendingVideo = nil
            self.state = .failed(message: "Video recording could not start.", retryable: true)
          }
        }
      } catch {
        await MainActor.run {
          self.state = .failed(message: "Protected video storage is unavailable.", retryable: true)
        }
      }
    }
  }

  func stopVideo() {
    guard state == .recordingVideo, let pendingVideo else { return }
    run { [weak self] in
      guard let self else { return }
      do {
        let artifact = try await self.camera.stopVideo()
        try Task.checkCancellation()
        let handle = try await self.mediaStore.finalize(
          id: pendingVideo.id,
          mimeType: artifact.mimeType,
          containsDepthData: false,
          origin: artifact.origin
        )
        let quality = try await self.inspector.inspect(
          fileURL: pendingVideo.url,
          mimeType: artifact.mimeType
        )
        try Task.checkCancellation()
        await MainActor.run { self.pendingVideo = nil }
        await self.record(handle: handle, quality: quality)
      } catch {
        try? FileManager.default.removeItem(at: pendingVideo.url)
        await MainActor.run {
          self.pendingVideo = nil
          self.state = .failed(
            message: "The video stopped without a valid protected file.", retryable: true)
        }
      }
    }
  }

  func captureMore() {
    guard let capabilities else { return }
    state = .ready(capabilities)
  }

  func retryAfterFailure() {
    if draft?.handles.isEmpty == false {
      state = .review
    } else {
      recover()
    }
  }

  func uploadPending() {
    guard let projectId, var current = draft, !current.handles.isEmpty else { return }
    guard serviceProcessingConsent else {
      state = .failed(
        message: "Confirm service processing before immutable evidence upload.",
        retryable: true
      )
      return
    }
    let rights = C8MediaRights(
      basis: rightsBasis,
      serviceProcessingConsent: serviceProcessingConsent
    )
    state = .uploading(progress: 0)
    run { [weak self] in
      guard let self else { return }
      do {
        let handles = current.handles
        for (index, handle) in handles.enumerated() {
          try Task.checkCancellation()
          let fileURL = try await self.mediaStore.resolve(handle)
          let receipt = try await self.uploader.upload(
            C8ImmutableEvidenceUpload(
              fileURL: fileURL,
              handle: handle,
              projectId: projectId,
              rights: rights
            )
          ) { itemProgress in
            let aggregate = (Double(index) + itemProgress) / Double(handles.count)
            await MainActor.run { self.state = .uploading(progress: aggregate) }
          }
          current.receipts.append(receipt)
          current.handles.removeAll { $0.localIdentifier == handle.localIdentifier }
          current.updatedAt = Date()
          try await self.journal.save(current)
          try await self.mediaStore.delete(handle)
        }
        await MainActor.run {
          self.draft = current
          self.state = .uploaded
        }
      } catch is CancellationError {
        await MainActor.run { self.state = .review }
      } catch {
        await MainActor.run {
          self.draft = current
          self.state = .failed(
            message: "Immutable upload paused safely. Retry reconciles checksum-bound parts.",
            retryable: true
          )
        }
      }
    }
  }

  func cancelUpload() {
    activeTask?.cancel()
  }

  func discardPending() {
    guard let projectId, let existing = draft else { return }
    activeTask?.cancel()
    run { [weak self] in
      guard let self else { return }
      for handle in existing.handles { try? await self.mediaStore.delete(handle) }
      try? await self.journal.clear(projectId: projectId)
      await self.camera.stop()
      await MainActor.run {
        self.draft = nil
        self.latestGuidance = [.completeCoverage]
        self.serviceProcessingConsent = false
      }
      await self.presentPreflight(requestPermission: false)
    }
  }

  func handleBackgrounding() {
    switch state {
    case .recordingVideo, .capturingPhoto, .ready:
      break
    default:
      return
    }
    activeTask?.cancel()
    state = .interrupted
    increment(\.interruptionCount)
    let abandonedVideo = pendingVideo
    pendingVideo = nil
    Task {
      await camera.stop()
      if let abandonedVideo { try? FileManager.default.removeItem(at: abandonedVideo.url) }
    }
  }

  func recover() {
    state = .recovering
    run { [weak self] in
      guard let self else { return }
      await self.camera.stop()
      await self.prepareCamera()
    }
  }

  private func presentPreflight(requestPermission: Bool) async {
    let preflight = await C8CameraPreflightEvaluator(
      capabilities: capabilityProvider,
      permission: permissionProvider
    ).evaluate(requestPermission: requestPermission)
    switch preflight {
    case .cameraDenied: state = .cameraDenied
    case .cameraRestricted: state = .cameraRestricted
    case .permissionRequired: state = .permissionRequired
    case .unavailable: state = .unavailable
    case .ready(let capabilities):
      self.capabilities = capabilities
      await prepareCamera()
    }
  }

  private func record(
    handle: C8LocalMediaHandle,
    quality: C8CapturedMediaQuality
  ) async {
    guard let projectId else { return }
    var next =
      draft
      ?? C8MediaCaptureDraft(
        coveredSectors: [],
        depthDeliveredCount: 0,
        depthRequested: depthRequested,
        handles: [],
        interruptionCount: 0,
        kind: captureKind,
        mediaQuality: [],
        origin: handle.origin,
        projectId: projectId,
        receipts: [],
        resourcePressureCount: 0,
        thermalInterruptionCount: 0,
        updatedAt: Date()
      )
    next.depthRequested = depthRequested
    if handle.containsDepthData { next.depthDeliveredCount += 1 }
    next.handles.append(handle)
    next.kind = captureKind
    next.mediaQuality.append(quality)
    next.origin = handle.origin
    if let sector = C8CoverageGuidance.sector(after: next.coveredSectors) {
      next.coveredSectors.append(sector)
    }
    next.updatedAt = Date()
    do {
      try C8ReconstructionContractValidator.validate(
        manifest: C8NativeCaptureQualityManifest(
          coveredSectors: next.coveredSectors,
          depthCaptureRequested: next.depthRequested,
          depthDeliveredCount: next.depthDeliveredCount,
          interruptionCount: next.interruptionCount,
          media: next.mediaQuality,
          origin: next.origin,
          resourcePressureCount: next.resourcePressureCount,
          thermalInterruptionCount: next.thermalInterruptionCount
        )
      )
      try await journal.save(next)
      await MainActor.run {
        self.draft = next
        self.latestGuidance = C8CoverageGuidance.guidance(
          kind: next.kind,
          covered: next.coveredSectors,
          latestQuality: quality
        )
        self.state = .review
      }
    } catch {
      try? await mediaStore.delete(handle)
      await MainActor.run {
        self.state = .failed(message: "Capture quality state failed validation.", retryable: true)
      }
    }
  }

  private func accept(_ event: C8CameraEvent) {
    switch event {
    case .interrupted:
      increment(\.interruptionCount)
      state = .interrupted
      stopAndDiscardPendingRecording()
    case .interruptionEnded:
      state = .recovering
    case .resourcePressure:
      increment(\.resourcePressureCount)
      state = .resourcePressure
      stopAndDiscardPendingRecording()
    case .thermalPressure:
      increment(\.thermalInterruptionCount)
      state = .thermalPressure
      stopAndDiscardPendingRecording()
    case .runtimeFailure:
      state = .failed(
        message: "The camera runtime stopped. Restart creates a fresh session.", retryable: true)
      stopAndDiscardPendingRecording()
    }
  }

  private func increment(_ keyPath: WritableKeyPath<C8MediaCaptureDraft, Int>) {
    guard var draft else { return }
    draft[keyPath: keyPath] += 1
    draft.updatedAt = Date()
    self.draft = draft
    Task { try? await journal.save(draft) }
  }

  private func stopAndDiscardPendingRecording() {
    let abandonedVideo = pendingVideo
    pendingVideo = nil
    Task {
      await camera.stop()
      if let abandonedVideo { try? FileManager.default.removeItem(at: abandonedVideo.url) }
    }
  }

  private func run(_ operation: @escaping @MainActor () async -> Void) {
    activeTask?.cancel()
    activeTask = Task { await operation() }
  }
}

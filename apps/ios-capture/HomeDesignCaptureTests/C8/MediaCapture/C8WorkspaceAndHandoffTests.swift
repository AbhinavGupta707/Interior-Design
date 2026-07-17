@preconcurrency import AVFoundation
import Foundation
import Testing

@testable import HomeDesignCapture

@MainActor
private final class C8TestCamera: C8CameraCaptureServing {
  let previewSession: AVCaptureSession? = nil
  let syntheticFixture = true
  var eventHandler: (@MainActor (C8CameraEvent) -> Void)?

  func configure(
    depthRequested: Bool,
    eventHandler: @escaping @MainActor (C8CameraEvent) -> Void
  ) throws {
    if depthRequested { throw C8CameraCaptureError.depthUnavailable }
    self.eventHandler = eventHandler
  }
  func start() async throws {}
  func stop() async {}
  func startVideo(to destination: URL) throws {}
  func stopVideo() async throws -> C8CameraCaptureArtifact {
    throw C8CameraCaptureError.notRecording
  }

  func capturePhoto(to destination: URL) async throws -> C8CameraCaptureArtifact {
    try Data("SYNTHETIC SIMULATOR FIXTURE; NOT CAMERA OR DEPTH".utf8).write(to: destination)
    return C8CameraCaptureArtifact(
      containsDepthData: false,
      mimeType: .png,
      origin: .syntheticSimulatorFixture
    )
  }

  func send(_ event: C8CameraEvent) { eventHandler?(event) }
}

private actor C8MemoryJournal: C8CaptureJournalStoring {
  var value: C8MediaCaptureDraft?
  func clear(projectId: UUID) { value = nil }
  func load(projectId: UUID) -> C8MediaCaptureDraft? { value }
  func save(_ draft: C8MediaCaptureDraft) { value = draft }
}

private actor C8FixtureInspector: C8CapturedMediaInspecting {
  func inspect(fileURL: URL, mimeType: C8MediaMIMEType) -> C8CapturedMediaQuality {
    C8CapturedMediaQuality(
      blurScoreMillionths: 800_000,
      exposureScoreMillionths: 900_000,
      guidance: [.ready]
    )
  }
}

private actor C8FixtureUploader: C8ImmutableEvidenceUploading {
  var requests: [C8ImmutableEvidenceUpload] = []

  func upload(
    _ request: C8ImmutableEvidenceUpload,
    progress: @escaping @Sendable (Double) async -> Void
  ) async throws -> C8ImmutableEvidenceReceipt {
    requests.append(request)
    await progress(1)
    return C8ImmutableEvidenceReceipt(
      assetId: UUID(),
      byteSize: request.handle.byteSize,
      declaredMimeType: request.handle.mimeType,
      projectId: request.projectId,
      sha256: request.handle.sha256,
      status: .processing,
      trainingUseConsent: .denied
    )
  }

  func capturedRequests() -> [C8ImmutableEvidenceUpload] { requests }
}

@MainActor
@Suite("C8 guided workspace")
struct C8WorkspaceAndHandoffTests {
  @Test("simulator video is an encoded, labelled synthetic fixture")
  func syntheticVideoFixture() async throws {
    let destination = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-synthetic-\(UUID().uuidString).mov")
    defer { try? FileManager.default.removeItem(at: destination) }
    let camera = C8SyntheticCameraEngine()
    try camera.configure(depthRequested: false) { _ in }
    try await camera.start()
    try camera.startVideo(to: destination)

    let artifact = try await camera.stopVideo()
    let asset = AVURLAsset(url: destination)
    let duration = try await asset.load(.duration)

    #expect(artifact.origin == .syntheticSimulatorFixture)
    #expect(artifact.containsDepthData == false)
    #expect(artifact.mimeType == .quickTime)
    #expect(CMTimeGetSeconds(duration) >= 1.9)
  }

  @Test("synthetic capture remains labelled, recoverable, and rights-first")
  func syntheticJourney() async throws {
    let mediaRoot = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-workspace-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: mediaRoot) }
    let camera = C8TestCamera()
    let journal = C8MemoryJournal()
    let uploader = C8FixtureUploader()
    let model = C8MediaCaptureWorkspaceModel(
      camera: camera,
      capabilityProvider: C8TestCapabilityProvider(
        capabilities: C8CameraCapabilities(
          depthPhotoSupported: false,
          physicalCameraAvailable: false,
          syntheticFixtureAvailable: true,
          videoSupported: true
        )
      ),
      permissionProvider: C8TestPermissionProvider(),
      inspector: C8FixtureInspector(),
      journal: journal,
      mediaStore: C8ProtectedMediaStore(root: mediaRoot),
      uploader: uploader
    )
    let projectId = UUID()
    await model.activate(projectId: projectId.uuidString)
    #expect(model.isSyntheticFixture)
    #expect(model.state == .ready(model.capabilities!))

    model.capturePhoto()
    try await waitUntil { model.state == .review }
    #expect(model.pendingMediaCount == 1)
    #expect(model.draft?.origin == .syntheticSimulatorFixture)
    #expect(model.qualityManifest?.depthDeliveredCount == 0)
    #expect(model.latestGuidance.contains(.completeCoverage))

    model.rightsBasis = .ownedByUser
    model.serviceProcessingConsent = true
    model.uploadPending()
    try await waitUntil { model.state == .uploaded }
    #expect(model.pendingMediaCount == 0)
    #expect(model.immutableReceiptCount == 1)
    let requests = await uploader.capturedRequests()
    #expect(requests.count == 1)
    #expect(requests.first?.rights.trainingUseConsent == .denied)
    #expect(requests.first?.handle.origin == .syntheticSimulatorFixture)
  }

  @Test("resource pressure stops the session and requires explicit recovery")
  func pressureRecovery() async {
    let camera = C8TestCamera()
    let model = C8MediaCaptureWorkspaceModel(
      camera: camera,
      capabilityProvider: C8TestCapabilityProvider(
        capabilities: C8CameraCapabilities(
          depthPhotoSupported: false,
          physicalCameraAvailable: false,
          syntheticFixtureAvailable: true,
          videoSupported: true
        )
      ),
      permissionProvider: C8TestPermissionProvider(),
      journal: C8MemoryJournal(),
      uploader: C8FixtureUploader()
    )
    await model.activate(projectId: UUID().uuidString)
    camera.send(.resourcePressure)
    #expect(model.state == .resourcePressure)
    model.recover()
    try? await waitUntil { model.state == .ready(model.capabilities!) }
    #expect(model.state == .ready(model.capabilities!))
  }

  private func waitUntil(
    _ condition: @escaping @MainActor () -> Bool
  ) async throws {
    for _ in 0..<100 {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("Timed out waiting for asynchronous workspace state.")
  }
}

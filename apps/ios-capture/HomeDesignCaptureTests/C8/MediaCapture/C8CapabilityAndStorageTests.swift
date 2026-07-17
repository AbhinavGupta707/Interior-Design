import Foundation
import Testing

@testable import HomeDesignCapture

struct C8TestCapabilityProvider: C8CameraCapabilityProviding {
  let capabilities: C8CameraCapabilities
  func currentCapabilities() -> C8CameraCapabilities { capabilities }
}

final class C8TestPermissionProvider: C8CameraPermissionProviding, @unchecked Sendable {
  var current = C8CameraPermission.notDetermined
  var currentCalls = 0
  var requestCalls = 0

  func currentPermission() -> C8CameraPermission {
    currentCalls += 1
    return current
  }

  func requestPermission() async -> C8CameraPermission {
    requestCalls += 1
    current = .authorised
    return current
  }
}

@Suite("C8 camera discovery and protected local state")
struct C8CapabilityAndStorageTests {
  @Test("discovery precedes permission and the synthetic runtime never prompts")
  func discoveryBeforePermission() async {
    let permission = C8TestPermissionProvider()
    let unavailable = await C8CameraPreflightEvaluator(
      capabilities: C8TestCapabilityProvider(
        capabilities: C8CameraCapabilities(
          depthPhotoSupported: false,
          physicalCameraAvailable: false,
          syntheticFixtureAvailable: false,
          videoSupported: false
        )
      ),
      permission: permission
    ).evaluate(requestPermission: true)
    #expect(unavailable == .unavailable)
    #expect(permission.currentCalls == 0)
    #expect(permission.requestCalls == 0)

    let fixture = await C8CameraPreflightEvaluator(
      capabilities: C8TestCapabilityProvider(
        capabilities: C8CameraCapabilities(
          depthPhotoSupported: false,
          physicalCameraAvailable: false,
          syntheticFixtureAvailable: true,
          videoSupported: true
        )
      ),
      permission: permission
    ).evaluate(requestPermission: true)
    #expect(
      fixture
        == .ready(
          C8CameraCapabilities(
            depthPhotoSupported: false,
            physicalCameraAvailable: false,
            syntheticFixtureAvailable: true,
            videoSupported: true
          )
        )
    )
    #expect(permission.currentCalls == 0)
  }

  @Test("protected media is opaque, hashed, bounded, and deletable")
  func protectedMediaStore() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-protected-store-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = C8ProtectedMediaStore(root: root)
    let destination = try await store.allocateDestination()
    try Data("SYNTHETIC RIGHTS-CLEARED MEDIA".utf8).write(to: destination.url)
    let handle = try await store.finalize(
      id: destination.id,
      mimeType: .png,
      containsDepthData: false,
      origin: .syntheticSimulatorFixture
    )
    #expect(handle.localIdentifier == destination.id)
    #expect(handle.byteSize == 30)
    #expect(handle.sha256.count == 64)
    #expect(destination.url.lastPathComponent == destination.id.uuidString.lowercased())
    let resolved = try await store.resolve(handle)
    #expect(resolved == destination.url)
    try await store.delete(handle)
    #expect(!FileManager.default.fileExists(atPath: resolved.path))
  }

  @Test("journal persists no local URL, signed URL, token, or training grant")
  func protectedJournalContents() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("c8-protected-journal-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let projectId = UUID()
    let journal = C8ProtectedCaptureJournal(root: root)
    let draft = C8MediaCaptureDraft(
      coveredSectors: [.north],
      depthDeliveredCount: 0,
      depthRequested: false,
      handles: [
        C8LocalMediaHandle(
          byteSize: 12,
          containsDepthData: false,
          createdAt: Date(timeIntervalSince1970: 0),
          localIdentifier: UUID(),
          mimeType: .png,
          origin: .syntheticSimulatorFixture,
          sha256: String(repeating: "c", count: 64)
        )
      ],
      interruptionCount: 0,
      kind: .photo,
      mediaQuality: [],
      origin: .syntheticSimulatorFixture,
      projectId: projectId,
      receipts: [],
      resourcePressureCount: 0,
      thermalInterruptionCount: 0,
      updatedAt: Date(timeIntervalSince1970: 0)
    )
    try await journal.save(draft)
    #expect(try await journal.load(projectId: projectId) == draft)
    let data = try Data(
      contentsOf: root.appendingPathComponent("project-\(projectId.uuidString.lowercased()).json")
    )
    let text = String(decoding: data, as: UTF8.self)
    #expect(!text.contains("file://"))
    #expect(!text.localizedCaseInsensitiveContains("signed"))
    #expect(!text.localizedCaseInsensitiveContains("token"))
    #expect(!text.contains("granted"))
  }
}

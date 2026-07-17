@preconcurrency import AVFoundation
import Foundation

struct C8CameraCapabilities: Equatable, Sendable {
  let depthPhotoSupported: Bool
  let physicalCameraAvailable: Bool
  let syntheticFixtureAvailable: Bool
  let videoSupported: Bool

  var captureAvailable: Bool { physicalCameraAvailable || syntheticFixtureAvailable }
}

protocol C8CameraCapabilityProviding: Sendable {
  func currentCapabilities() -> C8CameraCapabilities
}

struct C8SystemCameraCapabilityProvider: C8CameraCapabilityProviding {
  func currentCapabilities() -> C8CameraCapabilities {
    #if targetEnvironment(simulator)
      return C8CameraCapabilities(
        depthPhotoSupported: false,
        physicalCameraAvailable: false,
        syntheticFixtureAvailable: true,
        videoSupported: true
      )
    #else
      let discovery = AVCaptureDevice.DiscoverySession(
        deviceTypes: [
          .builtInWideAngleCamera,
          .builtInDualCamera,
          .builtInDualWideCamera,
          .builtInTripleCamera,
        ],
        mediaType: .video,
        position: .back
      )
      let devices = discovery.devices
      let hasPhysicalCamera = !devices.isEmpty
      let hasDepth = devices.contains { device in
        device.formats.contains { !$0.supportedDepthDataFormats.isEmpty }
      }
      return C8CameraCapabilities(
        depthPhotoSupported: hasDepth,
        physicalCameraAvailable: hasPhysicalCamera,
        syntheticFixtureAvailable: false,
        videoSupported: hasPhysicalCamera
      )
    #endif
  }
}

enum C8CameraPermission: Equatable, Sendable {
  case authorised
  case denied
  case notDetermined
  case restricted
}

protocol C8CameraPermissionProviding: Sendable {
  func currentPermission() -> C8CameraPermission
  func requestPermission() async -> C8CameraPermission
}

struct C8SystemCameraPermissionProvider: C8CameraPermissionProviding {
  func currentPermission() -> C8CameraPermission {
    #if targetEnvironment(simulator)
      return .authorised
    #else
      return Self.map(AVCaptureDevice.authorizationStatus(for: .video))
    #endif
  }

  func requestPermission() async -> C8CameraPermission {
    #if targetEnvironment(simulator)
      return .authorised
    #else
      guard currentPermission() == .notDetermined else { return currentPermission() }
      _ = await AVCaptureDevice.requestAccess(for: .video)
      return currentPermission()
    #endif
  }

  private static func map(_ status: AVAuthorizationStatus) -> C8CameraPermission {
    switch status {
    case .authorized: .authorised
    case .denied: .denied
    case .notDetermined: .notDetermined
    case .restricted: .restricted
    @unknown default: .restricted
    }
  }
}

enum C8CameraPreflight: Equatable, Sendable {
  case cameraDenied
  case cameraRestricted
  case permissionRequired
  case ready(C8CameraCapabilities)
  case unavailable
}

struct C8CameraPreflightEvaluator: Sendable {
  private let capabilities: any C8CameraCapabilityProviding
  private let permission: any C8CameraPermissionProviding

  init(
    capabilities: any C8CameraCapabilityProviding,
    permission: any C8CameraPermissionProviding
  ) {
    self.capabilities = capabilities
    self.permission = permission
  }

  func evaluate(requestPermission: Bool) async -> C8CameraPreflight {
    let currentCapabilities = capabilities.currentCapabilities()
    guard currentCapabilities.captureAvailable else { return .unavailable }
    if currentCapabilities.syntheticFixtureAvailable {
      return .ready(currentCapabilities)
    }
    let currentPermission = permission.currentPermission()
    switch currentPermission {
    case .authorised:
      return .ready(currentCapabilities)
    case .denied:
      return .cameraDenied
    case .restricted:
      return .cameraRestricted
    case .notDetermined where !requestPermission:
      return .permissionRequired
    case .notDetermined:
      switch await permission.requestPermission() {
      case .authorised: return .ready(currentCapabilities)
      case .denied, .notDetermined: return .cameraDenied
      case .restricted: return .cameraRestricted
      }
    }
  }
}

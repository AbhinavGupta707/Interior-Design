import AVFoundation
import RoomPlan

enum CaptureUnavailableReason: Equatable, Sendable {
  case simulatorUnsupported
  case roomPlanUnsupported
}

enum CaptureEligibility: Equatable, Sendable {
  case eligible
  case unavailable(CaptureUnavailableReason)

  var isEligible: Bool {
    if case .eligible = self { return true }
    return false
  }
}

/// Reports whether RoomPlan capture may be offered. This boundary never creates
/// a capture session; session lifecycle and camera permission belong to C7.
protocol CaptureCapabilityChecking: Sendable {
  func currentEligibility() -> CaptureEligibility
}

struct SystemCaptureCapabilityChecker: CaptureCapabilityChecking {
  func currentEligibility() -> CaptureEligibility {
    #if targetEnvironment(simulator)
      .unavailable(.simulatorUnsupported)
    #else
      RoomCaptureSession.isSupported ? .eligible : .unavailable(.roomPlanUnsupported)
    #endif
  }
}

enum CameraPermissionState: Equatable, Sendable {
  case authorised
  case denied
  case notDetermined
  case restricted
}

protocol CameraPermissionAuthorising: Sendable {
  func currentPermission() -> CameraPermissionState
  func requestPermission() async -> Bool
}

struct SystemCameraPermissionAuthoriser: CameraPermissionAuthorising {
  func currentPermission() -> CameraPermissionState {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      .authorised
    case .denied:
      .denied
    case .notDetermined:
      .notDetermined
    case .restricted:
      .restricted
    @unknown default:
      .restricted
    }
  }

  func requestPermission() async -> Bool {
    await AVCaptureDevice.requestAccess(for: .video)
  }
}

enum CapturePreflightDecision: Equatable, Sendable {
  case ready
  case cameraDenied
  case cameraNotDetermined
  case cameraRestricted
  case unavailable(CaptureUnavailableReason)
}

/// Evaluates discovery before permission so unsupported hardware never receives
/// a camera prompt. Permission denial is terminal until iOS settings change.
struct CapturePreflightEvaluator: Sendable {
  private let capability: any CaptureCapabilityChecking
  private let cameraPermission: any CameraPermissionAuthorising

  init(
    capability: any CaptureCapabilityChecking,
    cameraPermission: any CameraPermissionAuthorising
  ) {
    self.capability = capability
    self.cameraPermission = cameraPermission
  }

  func evaluate(requestIfNeeded: Bool) async -> CapturePreflightDecision {
    switch capability.currentEligibility() {
    case .eligible:
      break
    case .unavailable(let reason):
      return .unavailable(reason)
    }

    switch cameraPermission.currentPermission() {
    case .authorised:
      return .ready
    case .denied:
      return .cameraDenied
    case .restricted:
      return .cameraRestricted
    case .notDetermined where !requestIfNeeded:
      return .cameraNotDetermined
    case .notDetermined:
      return await cameraPermission.requestPermission() ? .ready : .cameraDenied
    }
  }
}

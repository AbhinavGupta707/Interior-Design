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
protocol CaptureCapabilityChecking {
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

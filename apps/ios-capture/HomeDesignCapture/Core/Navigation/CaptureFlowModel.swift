import Observation

enum CaptureRoute: Hashable, Sendable {
  case eligibility
  case capturePreparation
  case unsupportedCapture
  case manualEvidence
}

@MainActor
@Observable
final class CaptureFlowModel {
  var path: [CaptureRoute] = []
  private(set) var selectedProject: CaptureProject?
  private(set) var eligibility: CaptureEligibility?

  @ObservationIgnored
  private let capabilityChecker: any CaptureCapabilityChecking

  init(capabilityChecker: any CaptureCapabilityChecking) {
    self.capabilityChecker = capabilityChecker
  }

  func selectProject(_ project: CaptureProject) {
    selectedProject = project
    eligibility = capabilityChecker.currentEligibility()
    path = [.eligibility]
  }

  func continueFromEligibility() {
    guard let eligibility else { return }
    path.append(eligibility.isEligible ? .capturePreparation : .unsupportedCapture)
  }

  func useManualEvidence() {
    guard selectedProject != nil else { return }
    path.append(.manualEvidence)
  }

  func reset() {
    path = []
    selectedProject = nil
    eligibility = nil
  }
}

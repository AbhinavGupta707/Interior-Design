import Observation

enum CaptureRoute: Hashable, Sendable {
  case projectHome
  case homeSetup
  case designStudio
  case evidenceWorkspace
  case eligibility
  case mediaCapture
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
    path = [.projectHome]
  }

  func openProjectHome() {
    guard selectedProject != nil else { return }
    path = [.projectHome]
  }

  func openDesignStudio() {
    guard selectedProject?.isFixture == false else { return }
    path.append(.designStudio)
  }

  func openHomeSetup() {
    guard selectedProject?.isFixture == false else { return }
    path.append(.homeSetup)
  }

  func openCaptureEligibility() {
    guard selectedProject != nil else { return }
    path.append(.eligibility)
  }

  func openEvidenceWorkspace() {
    guard selectedProject != nil else { return }
    path.append(.evidenceWorkspace)
  }

  func openMediaCapture() {
    guard selectedProject != nil else { return }
    path.append(.mediaCapture)
  }

  func continueFromEligibility() {
    guard let eligibility else { return }
    path.append(eligibility.isEligible ? .capturePreparation : .unsupportedCapture)
  }

  func useManualEvidence() {
    guard selectedProject != nil else { return }
    path.append(.manualEvidence)
  }

  func finishBranch() {
    guard selectedProject != nil else { return }
    path = [.projectHome]
  }

  func reset() {
    path = []
    selectedProject = nil
    eligibility = nil
  }
}

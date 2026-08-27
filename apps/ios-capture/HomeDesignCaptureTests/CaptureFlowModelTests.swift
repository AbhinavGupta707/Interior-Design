import XCTest
@testable import HomeDesignCapture

@MainActor
final class CaptureFlowModelTests: XCTestCase {
  func testSelectProjectEvaluatesCapabilityAndOpensAdaptiveHub() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(result: .eligible)
    )
    let project = CaptureProject.localFixtures[0]

    model.selectProject(project)

    XCTAssertEqual(model.selectedProject, project)
    XCTAssertEqual(model.eligibility, .eligible)
    XCTAssertEqual(model.path, [.projectHome])
  }

  func testEligibleDeviceRoutesOnlyToC0PreparationPlaceholder() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(result: .eligible)
    )
    model.selectProject(CaptureProject.localFixtures[0])
    model.openCaptureEligibility()

    model.continueFromEligibility()

    XCTAssertEqual(model.path, [.projectHome, .eligibility, .capturePreparation])
  }

  func testUnsupportedDeviceRoutesToManualFallbackBeforeEvidence() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(
        result: .unavailable(.simulatorUnsupported)
      )
    )
    model.selectProject(CaptureProject.localFixtures[0])
    model.openCaptureEligibility()

    model.continueFromEligibility()
    XCTAssertEqual(model.path, [.projectHome, .eligibility, .unsupportedCapture])

    model.useManualEvidence()
    XCTAssertEqual(
      model.path,
      [.projectHome, .eligibility, .unsupportedCapture, .manualEvidence]
    )

    model.openEvidenceWorkspace()
    XCTAssertEqual(
      model.path,
      [.projectHome, .eligibility, .unsupportedCapture, .manualEvidence, .evidenceWorkspace]
    )
  }

  func testResetClearsProjectCapabilityAndNavigation() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(result: .eligible)
    )
    model.selectProject(CaptureProject.localFixtures[0])

    model.reset()

    XCTAssertNil(model.selectedProject)
    XCTAssertNil(model.eligibility)
    XCTAssertTrue(model.path.isEmpty)
  }

  func testGuidedCaptureIsAnOptionalBranchOfTheHomeownerProduct() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(result: .eligible)
    )
    model.selectProject(CaptureProject.localFixtures[0])

    model.openGuidedCapture()

    XCTAssertEqual(model.path, [.projectHome, .guidedCapture])
    model.finishBranch()
    XCTAssertEqual(model.path, [.projectHome])
  }
}

private struct StubCapabilityChecker: CaptureCapabilityChecking {
  let result: CaptureEligibility

  func currentEligibility() -> CaptureEligibility {
    result
  }
}

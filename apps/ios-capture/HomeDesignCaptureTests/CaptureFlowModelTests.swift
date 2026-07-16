import XCTest
@testable import HomeDesignCapture

@MainActor
final class CaptureFlowModelTests: XCTestCase {
  func testSelectProjectEvaluatesCapabilityAndShowsEligibility() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(result: .eligible)
    )
    let project = CaptureProject.localFixtures[0]

    model.selectProject(project)

    XCTAssertEqual(model.selectedProject, project)
    XCTAssertEqual(model.eligibility, .eligible)
    XCTAssertEqual(model.path, [.eligibility])
  }

  func testEligibleDeviceRoutesOnlyToC0PreparationPlaceholder() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(result: .eligible)
    )
    model.selectProject(CaptureProject.localFixtures[0])

    model.continueFromEligibility()

    XCTAssertEqual(model.path, [.eligibility, .capturePreparation])
  }

  func testUnsupportedDeviceRoutesToManualFallbackBeforeEvidence() {
    let model = CaptureFlowModel(
      capabilityChecker: StubCapabilityChecker(
        result: .unavailable(.simulatorUnsupported)
      )
    )
    model.selectProject(CaptureProject.localFixtures[0])

    model.continueFromEligibility()
    XCTAssertEqual(model.path, [.eligibility, .unsupportedCapture])

    model.useManualEvidence()
    XCTAssertEqual(
      model.path,
      [.eligibility, .unsupportedCapture, .manualEvidence]
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
}

private struct StubCapabilityChecker: CaptureCapabilityChecking {
  let result: CaptureEligibility

  func currentEligibility() -> CaptureEligibility {
    result
  }
}

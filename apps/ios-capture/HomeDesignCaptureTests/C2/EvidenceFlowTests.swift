import XCTest
@testable import HomeDesignCapture

@MainActor
final class EvidenceFlowTests: XCTestCase {
  func testExistingProjectCanOpenEvidenceWithoutChangingEligibilitySemantics() {
    let model = CaptureFlowModel(
      capabilityChecker: EvidenceCapabilityStub(result: .eligible)
    )
    model.selectProject(CaptureProject.localFixtures[0])

    model.openEvidenceWorkspace()

    XCTAssertEqual(model.path, [.eligibility, .evidenceWorkspace])
  }
}

private struct EvidenceCapabilityStub: CaptureCapabilityChecking {
  let result: CaptureEligibility
  func currentEligibility() -> CaptureEligibility { result }
}

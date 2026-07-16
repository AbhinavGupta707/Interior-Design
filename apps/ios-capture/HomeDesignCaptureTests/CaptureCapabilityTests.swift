import XCTest
@testable import HomeDesignCapture

final class CaptureCapabilityTests: XCTestCase {
  func testEligibilityBooleanReflectsState() {
    XCTAssertTrue(CaptureEligibility.eligible.isEligible)
    XCTAssertFalse(
      CaptureEligibility.unavailable(.roomPlanUnsupported).isEligible
    )
  }

  #if targetEnvironment(simulator)
    func testSimulatorIsAlwaysReportedAsUnsupported() {
      let eligibility = SystemCaptureCapabilityChecker().currentEligibility()

      XCTAssertEqual(eligibility, .unavailable(.simulatorUnsupported))
    }
  #endif
}

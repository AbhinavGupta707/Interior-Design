import CrossDeviceContinuityClient
import CryptoKit
import Foundation
import XCTest
@testable import HomeDesignCapture

@MainActor
final class C14_5DesignStudioTests: XCTestCase {
  func testExactConfirmedTwinGateRequiresChangedBranchAndSucceededMatchingScene() throws {
    let eligible = C14_5FixtureFactory.workspace()
    try C14_5ContractValidator.validate(eligible, projectId: C14_5FixtureFactory.projectId)
    XCTAssertTrue(eligible.designEligible)
    XCTAssertNotNil(eligible.confirmedBranch)
    XCTAssertNotNil(eligible.exactSceneJob)

    let initializationOnly = C14_5FixtureFactory.workspace(changedBranch: false)
    try C14_5ContractValidator.validate(
      initializationOnly,
      projectId: C14_5FixtureFactory.projectId
    )
    XCTAssertFalse(initializationOnly.designEligible)
    XCTAssertNil(initializationOnly.confirmedBranch)

    let mismatchedScene = C14_5FixtureFactory.workspace(sceneMatchesJob: false)
    XCTAssertFalse(mismatchedScene.designEligible)
    XCTAssertThrowsError(
      try C14_5ContractValidator.validate(
        mismatchedScene,
        projectId: C14_5FixtureFactory.projectId
      )
    )
  }

  func testViewerLoadsExactStateWithoutMutationAuthority() async {
    let service = C14_5FixtureDesignService(
      workspace: C14_5FixtureFactory.workspace(role: .viewer)
    )
    let model = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )

    await model.activate(projectId: C14_5FixtureFactory.projectId.uuidString)

    XCTAssertEqual(model.state, .ready)
    XCTAssertTrue(model.designEligible)
    XCTAssertEqual(model.role, .viewer)
    XCTAssertFalse(model.canMutate)
  }

  func testColdLaunchRecoversConfirmationFromServerNotLocalCache() async {
    let service = C14_5FixtureDesignService(workspace: C14_5FixtureFactory.workspace())
    let first = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )
    let second = C14_5DesignStudioModel(
      service: service,
      recovery: C14_5FixtureRecoveryStore(summary: nil)
    )

    await first.activate(projectId: C14_5FixtureFactory.projectId.uuidString)
    await second.activate(projectId: C14_5FixtureFactory.projectId.uuidString)

    XCTAssertNotNil(first.workspace?.recoveredConfirmation)
    XCTAssertEqual(
      first.workspace?.recoveredConfirmation,
      second.workspace?.recoveredConfirmation
    )
  }

  func testOfflineRecoveryIsStaleDisplayOnlyAndCannotEnableDesign() async {
    let summary = C14_5FixtureFactory.recoverySummary()
    let model = C14_5DesignStudioModel(
      service: C14_5OfflineFixtureDesignService(),
      recovery: C14_5FixtureRecoveryStore(summary: summary)
    )

    await model.activate(projectId: C14_5FixtureFactory.projectId.uuidString)

    guard case .stale(let recovered, _) = model.state else {
      return XCTFail("Expected a stale display-only state")
    }
    XCTAssertEqual(recovered, summary)
    XCTAssertNil(model.workspace)
    XCTAssertFalse(model.designEligible)
    XCTAssertFalse(model.canMutate)
  }

  func testRecoveryEnvelopeContainsNoCredentialURLOrCustomerProse() throws {
    let data = try JSONEncoder().encode(C14_5FixtureFactory.recoverySummary())
    let value = try XCTUnwrap(String(data: data, encoding: .utf8))

    XCTAssertLessThanOrEqual(data.count, 4_096)
    XCTAssertFalse(value.localizedCaseInsensitiveContains("token"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("authorization"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("url"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("statement"))
    XCTAssertFalse(value.localizedCaseInsensitiveContains("address"))
  }

  func testArtifactVerifierRejectsTamperedBytes() throws {
    let bytes = C14_5FixtureFactory.geometryPNG
    let digest = Data(SHA256.hash(data: bytes)).map { String(format: "%02x", $0) }.joined()
    let artifact = C14_5RenderArtifact(
      byteLength: bytes.count,
      heightPx: 64,
      id: UUID(),
      mediaType: "image/png",
      role: "geometry-safe-png",
      schemaVersion: "c14-render-artifact-v1",
      sha256: digest,
      widthPx: 64
    )
    let manifestHash = String(repeating: "f", count: 64)
    let access = C14_5ArtifactAccess(
      artifactId: artifact.id,
      byteLength: bytes.count,
      expiresAt: "2026-08-26T14:00:00Z",
      manifestSha256: manifestHash,
      mediaType: artifact.mediaType,
      role: artifact.role,
      sha256: digest,
      url: URL(string: "https://fixture.invalid/result.png")!
    )

    XCTAssertNoThrow(
      try C14_5ArtifactVerifier.verify(
        bytes: bytes,
        responseMediaType: "image/png",
        access: access,
        expected: artifact,
        expectedManifestSha256: manifestHash
      )
    )
    XCTAssertThrowsError(
      try C14_5ArtifactVerifier.verify(
        bytes: Data("tampered".utf8),
        responseMediaType: "image/png",
        access: access,
        expected: artifact,
        expectedManifestSha256: manifestHash
      )
    )

    let oversized = C14_5RenderArtifact(
      byteLength: C14_5ArtifactVerifier.maximumViewableArtifactBytes + 1,
      heightPx: 64,
      id: artifact.id,
      mediaType: artifact.mediaType,
      role: artifact.role,
      schemaVersion: artifact.schemaVersion,
      sha256: artifact.sha256,
      widthPx: 64
    )
    XCTAssertThrowsError(
      try C14_5ArtifactVerifier.verify(
        bytes: bytes,
        responseMediaType: "image/png",
        access: access,
        expected: oversized,
        expectedManifestSha256: manifestHash
      )
    )
  }

  func testGeneratedContinuityContractPinsRemainFrozen() {
    XCTAssertEqual(ContinuityContract.openAPIVersion, "3.1.2")
    XCTAssertEqual(
      ContinuityContract.openAPISHA256,
      "c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508"
    )
    XCTAssertEqual(
      ContinuityContract.generatorVersion,
      "interior-design-continuity-generator-1.0.1"
    )
  }
}

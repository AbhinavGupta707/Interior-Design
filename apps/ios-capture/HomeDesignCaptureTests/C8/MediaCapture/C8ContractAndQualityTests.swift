import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C8 reconstruction capture contracts")
struct C8ContractAndQualityTests {
  @Test("training stays denied and synthetic fixtures cannot claim depth")
  func rightsAndDepthBoundary() throws {
    let rights = C8MediaRights(basis: .ownedByUser, serviceProcessingConsent: true)
    #expect(rights.trainingUseConsent == .denied)
    let handle = C8LocalMediaHandle(
      byteSize: 100,
      containsDepthData: true,
      createdAt: Date(timeIntervalSince1970: 0),
      localIdentifier: UUID(),
      mimeType: .png,
      origin: .syntheticSimulatorFixture,
      sha256: String(repeating: "a", count: 64)
    )
    #expect(throws: C8CaptureContractError.depthClaimFromFixture) {
      try C8ReconstructionContractValidator.validate(
        upload: C8ImmutableEvidenceUpload(
          fileURL: URL(fileURLWithPath: "/opaque-test-only"),
          handle: handle,
          projectId: UUID(),
          rights: rights
        )
      )
    }
  }

  @Test("only a decoded ready C2 asset becomes a safe C8 source reference")
  func readyEvidenceBoundary() throws {
    let assetId = UUID()
    let projectId = UUID()
    let ready = EvidenceAsset(
      createdAt: "2026-07-17T12:00:00.000Z",
      declaredMimeType: "image/png",
      detectedMimeType: "image/png",
      fileName: "opaque.png",
      id: assetId.uuidString.lowercased(),
      kind: .photograph,
      projectId: projectId.uuidString.lowercased(),
      rejectionCode: nil,
      rights: EvidenceRightsAssertion(
        attribution: nil,
        basis: .ownedByUser,
        licenceUrl: nil,
        serviceProcessingConsent: true,
        trainingUseConsent: .denied
      ),
      source: EvidenceSourceFingerprint(byteSize: 128, sha256: String(repeating: "b", count: 64)),
      status: .ready,
      updatedAt: "2026-07-17T12:00:00.000Z"
    )
    let source = try C8ReconstructionContractValidator.readySource(from: ready)
    #expect(source.assetId == assetId)
    #expect(source.kind == .rgbImage)
    #expect(source.detectedMimeType == .png)

    let processing = EvidenceAsset(
      createdAt: ready.createdAt,
      declaredMimeType: ready.declaredMimeType,
      detectedMimeType: ready.detectedMimeType,
      fileName: ready.fileName,
      id: ready.id,
      kind: ready.kind,
      projectId: ready.projectId,
      rejectionCode: nil,
      rights: ready.rights,
      source: ready.source,
      status: .processing,
      updatedAt: ready.updatedAt
    )
    #expect(throws: C8CaptureContractError.sourceNotReady) {
      try C8ReconstructionContractValidator.readySource(from: processing)
    }
  }

  @Test("quality metrics are bounded and produce actionable guidance")
  func qualityMetrics() {
    let evaluator = C8CaptureQualityEvaluator()
    let flatDark = [UInt8](repeating: 0, count: 16 * 16)
    let poor = evaluator.evaluate(luma: flatDark, width: 16, height: 16)
    #expect(poor.blurScoreMillionths == 0)
    #expect(poor.exposureScoreMillionths == 0)
    #expect(poor.guidance.contains(.holdSteady))
    #expect(poor.guidance.contains(.improveLighting))

    let checkerboard = (0..<(16 * 16)).map { index in
      UInt8(((index / 16 + index % 16) % 2 == 0) ? 32 : 220)
    }
    let good = evaluator.evaluate(luma: checkerboard, width: 16, height: 16)
    #expect((0...1_000_000).contains(good.blurScoreMillionths))
    #expect((0...1_000_000).contains(good.exposureScoreMillionths))
    #expect(good.exposureScoreMillionths == 1_000_000)
  }

  @Test("coverage guidance remains explicit until the room loop is complete")
  func coverageGuidance() {
    #expect(C8CoverageGuidance.sector(after: []) == .north)
    let guidance = C8CoverageGuidance.guidance(kind: .photo, covered: [.north], latestQuality: nil)
    #expect(guidance.contains(.completeCoverage))
    #expect(guidance.contains(.addParallax))
    let complete = C8CoverageGuidance.guidance(
      kind: .photo,
      covered: C8CoverageSector.allCases,
      latestQuality: C8CapturedMediaQuality(
        blurScoreMillionths: 900_000,
        exposureScoreMillionths: 900_000,
        guidance: [.ready]
      )
    )
    #expect(complete == [.ready])
  }
}

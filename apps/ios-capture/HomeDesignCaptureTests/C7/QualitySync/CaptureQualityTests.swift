import Foundation
import Testing

@testable import HomeDesignCapture

@Suite("C7 quality and reference measurements")
struct CaptureQualityTests {
  @Test("accumulator emits every exact instruction key and a bounded duration")
  func accumulatorManifest() throws {
    var accumulator = C7CaptureQualityAccumulator()
    try accumulator.record(instruction: .slowDown)
    try accumulator.recordInterruption()
    try accumulator.recordRelocalisation(succeeded: true)
    let manifest = try accumulator.manifest(
      startedAt: Date(timeIntervalSince1970: 0),
      endedAt: Date(timeIntervalSince1970: 1.0006),
      lowConfidenceObjectCount: 1,
      lowConfidenceSurfaceCount: 2,
      worldMappingStatusAtFinish: .extending
    )

    #expect(Set(manifest.instructionCounts.keys) == Set(C7CaptureInstruction.allCases))
    #expect(manifest.instructionCounts[.slowDown] == 1)
    #expect(manifest.scanDurationMilliseconds == 1_001)
    #expect(manifest.relocalisationAttemptCount == 1)
    #expect(manifest.relocalisationSuccessCount == 1)
  }

  @Test("duration rejects zero and more than six hours")
  func durationBounds() throws {
    let accumulator = C7CaptureQualityAccumulator()
    #expect(throws: C7CaptureQualityError.invalidDuration) {
      try accumulator.manifest(
        startedAt: .init(timeIntervalSince1970: 1),
        endedAt: .init(timeIntervalSince1970: 1),
        lowConfidenceObjectCount: 0,
        lowConfidenceSurfaceCount: 0,
        worldMappingStatusAtFinish: .mapped
      )
    }
    #expect(throws: C7CaptureQualityError.invalidDuration) {
      try accumulator.manifest(
        startedAt: .init(timeIntervalSince1970: 0),
        endedAt: .init(timeIntervalSince1970: 21_601),
        lowConfidenceObjectCount: 0,
        lowConfidenceSurfaceCount: 0,
        worldMappingStatusAtFinish: .mapped
      )
    }
  }

  @Test("no warning remains explicitly non-authoritative")
  func noWarningIsNotAccuracy() throws {
    let assessment = try C7CaptureQualityEvaluator.assess(C7SyntheticFixture.quality())
    #expect(assessment.attention == .noHeuristicWarning)
    #expect(assessment.findings.isEmpty)
    #expect(assessment.limitationText.contains("does not prove completeness"))
    #expect(assessment.limitationText.contains("measurement accuracy"))
  }

  @Test("limited mapping and unconfirmed relocalisation are deterministic limitations")
  func limitedAssessment() throws {
    let assessment = try C7CaptureQualityEvaluator.assess(
      C7SyntheticFixture.quality(
        mapping: .limited,
        lowSurfaces: 21,
        interruptions: 3,
        relocalisationAttempts: 2,
        relocalisationSuccesses: 1
      )
    )
    #expect(assessment.attention == .limitedEvidence)
    #expect(assessment.findings.map(\.code).contains(.mappingLimited))
    #expect(assessment.findings.map(\.code).contains(.relocalisationUnconfirmed))
    #expect(assessment.findings.map(\.code).contains(.lowConfidenceSurfaces))
  }

  @Test("quality wire JSON uses contract string keys instead of a Swift enum array")
  func qualityWireShape() throws {
    let data = try JSONEncoder().encode(C7QualityWireManifest(C7SyntheticFixture.quality()))
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let counts = try #require(object["instructionCounts"] as? [String: Any])
    #expect(Set(counts.keys) == Set(C7CaptureInstruction.allCases.map(\.rawValue)))
    #expect(counts["normal"] as? Int == 0)
  }

  @Test("reference measurements remain user assertions between known source entities")
  func validReferenceMeasurement() throws {
    let draft = C7ReferenceMeasurementDraft(
      distanceText: " 2450 ",
      fromSourceEntityId: C7SyntheticFixture.surfaceId,
      method: .laser,
      toSourceEntityId: C7SyntheticFixture.objectId
    )
    let measurement = try C7ReferenceMeasurementValidator.makeMeasurement(
      draft: draft,
      measurementId: UUID(),
      allowedSourceEntityIds: [C7SyntheticFixture.surfaceId, C7SyntheticFixture.objectId],
      existing: []
    )
    #expect(measurement.distanceMillimetres == 2_450)
    #expect(measurement.method == .laser)
  }

  @Test(
    "same, missing, and out-of-range reference endpoints fail closed",
    arguments: [
      C7ReferenceMeasurementDraft(
        distanceText: "10",
        fromSourceEntityId: C7SyntheticFixture.surfaceId,
        method: .tape,
        toSourceEntityId: C7SyntheticFixture.surfaceId
      ),
      C7ReferenceMeasurementDraft(
        distanceText: "0",
        fromSourceEntityId: C7SyntheticFixture.surfaceId,
        method: .tape,
        toSourceEntityId: C7SyntheticFixture.objectId
      ),
      C7ReferenceMeasurementDraft(
        distanceText: "100001",
        fromSourceEntityId: C7SyntheticFixture.surfaceId,
        method: .tape,
        toSourceEntityId: C7SyntheticFixture.objectId
      ),
    ])
  func invalidReferences(draft: C7ReferenceMeasurementDraft) {
    #expect(throws: C7CaptureQualityError.self) {
      try C7ReferenceMeasurementValidator.makeMeasurement(
        draft: draft,
        measurementId: UUID(),
        allowedSourceEntityIds: [C7SyntheticFixture.surfaceId, C7SyntheticFixture.objectId],
        existing: []
      )
    }
  }

  @Test("unknown source entity is rejected")
  func unknownSource() {
    #expect(throws: C7CaptureQualityError.unknownSourceEntity) {
      try C7ReferenceMeasurementValidator.makeMeasurement(
        draft: C7ReferenceMeasurementDraft(
          distanceText: "1200",
          fromSourceEntityId: C7SyntheticFixture.surfaceId,
          method: .userEntered,
          toSourceEntityId: UUID()
        ),
        measurementId: UUID(),
        allowedSourceEntityIds: [C7SyntheticFixture.surfaceId],
        existing: []
      )
    }
  }

  @Test("reversed duplicate source pair is rejected")
  func duplicatePair() throws {
    let existing = C7ReferenceMeasurement(
      distanceMillimetres: 1_200,
      fromSourceEntityId: C7SyntheticFixture.surfaceId,
      measurementId: UUID(),
      method: .tape,
      toSourceEntityId: C7SyntheticFixture.objectId
    )
    #expect(throws: C7CaptureQualityError.duplicateMeasurement) {
      try C7ReferenceMeasurementValidator.makeMeasurement(
        draft: C7ReferenceMeasurementDraft(
          distanceText: "1200",
          fromSourceEntityId: C7SyntheticFixture.objectId,
          method: .laser,
          toSourceEntityId: C7SyntheticFixture.surfaceId
        ),
        measurementId: UUID(),
        allowedSourceEntityIds: [C7SyntheticFixture.surfaceId, C7SyntheticFixture.objectId],
        existing: [existing]
      )
    }
  }

  @Test("measurement count is capped at one hundred")
  func measurementLimit() {
    let existing = (0..<100).map { _ in
      C7ReferenceMeasurement(
        distanceMillimetres: 100,
        fromSourceEntityId: C7SyntheticFixture.surfaceId,
        measurementId: UUID(),
        method: .tape,
        toSourceEntityId: C7SyntheticFixture.objectId
      )
    }
    #expect(throws: C7CaptureQualityError.measurementLimitReached) {
      try C7ReferenceMeasurementValidator.makeMeasurement(
        draft: C7ReferenceMeasurementDraft(
          distanceText: "100",
          fromSourceEntityId: C7SyntheticFixture.surfaceId,
          method: .tape,
          toSourceEntityId: C7SyntheticFixture.objectId
        ),
        measurementId: UUID(),
        allowedSourceEntityIds: [C7SyntheticFixture.surfaceId, C7SyntheticFixture.objectId],
        existing: existing
      )
    }
  }
}

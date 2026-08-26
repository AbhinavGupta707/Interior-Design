import Foundation
import XCTest
@testable import HomeDesignCapture

@MainActor
final class C14_6HomeSetupTests: XCTestCase {
  func testFreshAuthoritativeStateCanReportLaterProcessingReadiness() async {
    let service = C14_6HomeSetupTestService()
    let evidence = C14_6HomeSetupEvidenceService(assets: [C14_6FixtureFactory.plan])
    let model = C14_6HomeSetupModel(service: service, evidenceService: evidence)

    await model.activate(
      projectId: C14_6FixtureFactory.project.id,
      role: "owner"
    )

    XCTAssertEqual(model.state, .ready)
    XCTAssertTrue(model.readiness.serverVerified)
    XCTAssertTrue(model.readiness.intakeComplete)
    XCTAssertTrue(model.readiness.propertyContextSelected)
    XCTAssertEqual(model.readiness.readyPlanCount, 1)
    XCTAssertTrue(model.readiness.laterPlanProcessingEligible)
    XCTAssertEqual(model.dossier?.property.interiorKnowledgeStatus, "unknown-without-evidence")
  }

  func testOfflineReloadMakesPriorReadinessDisplayOnly() async {
    let service = C14_6HomeSetupTestService()
    let model = C14_6HomeSetupModel(
      service: service,
      evidenceService: C14_6HomeSetupEvidenceService(assets: [C14_6FixtureFactory.plan])
    )
    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "owner")
    await service.setFailure(.offline)

    await model.activate(
      projectId: C14_6FixtureFactory.project.id,
      role: "owner",
      force: true
    )

    guard case .stale = model.state else { return XCTFail("Expected stale state") }
    XCTAssertFalse(model.readiness.serverVerified)
    XCTAssertFalse(model.readiness.laterPlanProcessingEligible)
  }

  func testForeignEvidenceCannotSatisfyServerVerifiedReadiness() async {
    let foreign = evidenceAsset(projectId: "77777777-7777-4777-8777-777777777777")
    let model = C14_6HomeSetupModel(
      service: C14_6HomeSetupTestService(),
      evidenceService: C14_6HomeSetupEvidenceService(assets: [foreign])
    )

    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "owner")

    XCTAssertEqual(model.state, .failure(message: "The service response failed the frozen C1/C3 contract."))
    XCTAssertFalse(model.readiness.serverVerified)
    XCTAssertFalse(model.readiness.laterPlanProcessingEligible)
    XCTAssertEqual(model.evidence, [])
  }

  func testResetInvalidatesDelayedMutationAndRotatesItsIdempotencyKey() async {
    let service = C14_6DelayedSaveService()
    let model = C14_6HomeSetupModel(
      service: service,
      evidenceService: C14_6HomeSetupEvidenceService(assets: [])
    )
    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "owner")

    let firstSave = Task { await model.saveIntake() }
    await waitUntil { await service.saveCount() == 1 }
    model.reset()
    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "owner")
    await firstSave.value

    XCTAssertEqual(model.intake, C14_6FixtureFactory.intake)
    XCTAssertNil(model.mutationMessage)
    XCTAssertFalse(model.isMutating)

    await model.saveIntake()
    let keys = await service.recordedSaveKeys()
    XCTAssertEqual(keys.count, 2)
    XCTAssertNotEqual(keys.first, keys.last)
  }

  func testExactIntakeRetryReusesIdempotencyKey() async {
    let service = C14_6HomeSetupTestService(saveFailures: 1)
    let model = C14_6HomeSetupModel(
      service: service,
      evidenceService: C14_6HomeSetupEvidenceService(assets: [])
    )
    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "owner")

    await model.saveIntake()
    await model.saveIntake()

    let keys = await service.recordedSaveKeys()
    XCTAssertEqual(keys.count, 2)
    XCTAssertEqual(keys.first, keys.last)
    XCTAssertEqual(model.intake?.version, C14_6FixtureFactory.intake.version + 1)
  }

  func testViewerCannotSubmitIntakeMutation() async {
    let service = C14_6HomeSetupTestService()
    let model = C14_6HomeSetupModel(
      service: service,
      evidenceService: C14_6HomeSetupEvidenceService(assets: [])
    )
    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "viewer")

    await model.saveIntake()
    let keys = await service.recordedSaveKeys()

    XCTAssertEqual(keys, [])
    XCTAssertFalse(model.canMutate)
  }

  func testUnknownRoleCannotLoadOrMutateProjectState() async {
    let model = C14_6HomeSetupModel(
      service: C14_6HomeSetupTestService(),
      evidenceService: C14_6HomeSetupEvidenceService(assets: [])
    )

    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "administrator")

    XCTAssertEqual(model.state, .forbidden)
    XCTAssertFalse(model.canEdit)
    XCTAssertFalse(model.canMutate)
    XCTAssertNil(model.intake)
    XCTAssertNil(model.dossier)
    XCTAssertTrue(model.evidence.isEmpty)
  }

  func testSameProjectRoleDowngradeRevokesEditAuthority() async {
    let model = C14_6HomeSetupModel(
      service: C14_6HomeSetupTestService(),
      evidenceService: C14_6HomeSetupEvidenceService(assets: [])
    )

    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "owner")
    XCTAssertTrue(model.canEdit)

    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "viewer")

    XCTAssertEqual(model.state, .ready)
    XCTAssertFalse(model.canEdit)
    XCTAssertFalse(model.canMutate)
  }

  func testEnglandPostcodeNormalisationAndContractRelations() {
    XCTAssertEqual(C14_6HomeSetupModel.normalisedPostcode("sw1a1aa"), "SW1A 1AA")
    XCTAssertTrue(C14_6HomeSetupModel.validEnglandPostcode("SW1A 1AA"))
    XCTAssertFalse(C14_6HomeSetupModel.validEnglandPostcode("not a postcode"))
    XCTAssertTrue(C14_6FixtureFactory.resolution.isValid)
    XCTAssertTrue(C14_6FixtureFactory.dossier.isValid)
    XCTAssertNil(C14_6FixtureFactory.dossier.items.first?.confidencePercent)
    XCTAssertEqual(C14_6FixtureFactory.dossier.planningStatus, "not-reviewed")
  }

  func testAmbiguousEnglandResolutionRequiresExplicitCandidateSelection() async {
    let first = C14_6FixtureFactory.resolution.candidates[0]
    let second = C14_6PropertyCandidate(
      address: C14_6PropertyAddress(
        line1: "12A Example Mews",
        line2: nil,
        locality: "London",
        postcode: "SW1A 1AA"
      ),
      candidateId: "88888888-8888-4888-8888-888888888888",
      displayAddress: "12A Example Mews, London, SW1A 1AA",
      identifiers: [C14_6PropertyIdentifier(scheme: "UPRN", value: "100023456780")],
      jurisdiction: "england",
      location: nil,
      source: C14_6FixtureFactory.source
    )
    let ambiguous = C14_6PropertyResolution(
      candidates: [first, second],
      expiresAt: C14_6FixtureFactory.resolution.expiresAt,
      manualEntryAllowed: true,
      providerState: "fixture",
      resolutionId: "99999999-9999-4999-8999-999999999999",
      status: "ambiguous"
    )
    let service = C14_6HomeSetupTestService(resolution: ambiguous)
    let model = C14_6HomeSetupModel(
      service: service,
      evidenceService: C14_6HomeSetupEvidenceService(assets: [])
    )
    await model.activate(projectId: C14_6FixtureFactory.project.id, role: "owner")
    model.propertyQuery = "12 Example Mews"

    await model.resolveProperty()
    let candidateSelectionCount = await service.candidateSelectionCount()

    XCTAssertEqual(model.resolution?.status, "ambiguous")
    XCTAssertEqual(model.resolution?.candidates.count, 2)
    XCTAssertEqual(candidateSelectionCount, 0)
    XCTAssertTrue(model.mutationMessage?.contains("app will not guess") == true)
  }

  func testDossierValueAndSourceRecordValidationMatchesSharedBounds() {
    XCTAssertTrue(C14_6DossierValue.integer(12, unit: "count").isValid)
    XCTAssertFalse(C14_6DossierValue.integer(12, unit: "feet").isValid)
    XCTAssertFalse(C14_6DossierValue.text(" ").isValid)

    let invalidRecord = C14_6PropertySourceRecord(
      fields: [],
      id: "44444444-4444-4444-8444-444444444444",
      normalizedPayloadSha256: String(repeating: "a", count: 64),
      projectId: C14_6FixtureFactory.project.id,
      propertyId: C14_6FixtureFactory.property.propertyId,
      source: C14_6FixtureFactory.property.source
    )
    XCTAssertFalse(invalidRecord.isValid)
  }

  func testTransportKeepsFrozenFailureClassesDistinct() async {
    let cases: [(Int, C14_6HomeSetupError)] = [
      (401, .expired),
      (403, .forbidden),
      (409, .stale),
      (410, .expiredResolution),
      (422, .rejected),
      (429, .throttled),
      (503, .unavailable),
    ]

    for (status, expected) in cases {
      let client = C14_6HomeSetupAPIClient(
        baseURL: URL(string: "https://api.example.test")!,
        tokenProvider: C14_6HomeSetupTokenProvider(),
        transport: C14_6HomeSetupStatusTransport(status: status)
      )
      do {
        _ = try await client.intake(projectId: C14_6FixtureFactory.project.id)
        XCTFail("Expected HTTP \(status) to fail")
      } catch {
        XCTAssertEqual(error as? C14_6HomeSetupError, expected, "HTTP \(status)")
      }
    }
  }

  private func waitUntil(
    timeout: Duration = .seconds(2),
    condition: @escaping @Sendable () async -> Bool
  ) async {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if await condition() { return }
      try? await Task.sleep(for: .milliseconds(20))
    }
    XCTFail("Condition was not reached before timeout")
  }

  private func evidenceAsset(projectId: String) -> EvidenceAsset {
    let value = C14_6FixtureFactory.plan
    return EvidenceAsset(
      createdAt: value.createdAt,
      declaredMimeType: value.declaredMimeType,
      detectedMimeType: value.detectedMimeType,
      fileName: value.fileName,
      id: value.id,
      kind: value.kind,
      projectId: projectId,
      rejectionCode: value.rejectionCode,
      rights: value.rights,
      source: value.source,
      status: value.status,
      updatedAt: value.updatedAt
    )
  }
}

private actor C14_6HomeSetupTokenProvider: C7CaptureTokenProviding {
  func accessToken() -> String { String(repeating: "t", count: 48) }
  func invalidate() {}
}

private actor C14_6HomeSetupStatusTransport: C1HTTPTransport {
  let status: Int

  init(status: Int) { self.status = status }

  func data(for request: URLRequest) throws -> (Data, HTTPURLResponse) {
    (
      Data(),
      HTTPURLResponse(
        url: request.url!,
        statusCode: status,
        httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "application/problem+json"]
      )!
    )
  }
}

private actor C14_6HomeSetupTestService: C14_6HomeSetupServing {
  private var failure: C14_6HomeSetupError?
  private var intakeValue = C14_6FixtureFactory.intake
  private let resolutionValue: C14_6PropertyResolution
  private var saveFailures: Int
  private var saveKeys: [String] = []
  private var candidateSelections = 0

  init(
    saveFailures: Int = 0,
    resolution: C14_6PropertyResolution = C14_6FixtureFactory.resolution
  ) {
    self.saveFailures = saveFailures
    resolutionValue = resolution
  }

  func setFailure(_ failure: C14_6HomeSetupError?) { self.failure = failure }
  func recordedSaveKeys() -> [String] { saveKeys }
  func candidateSelectionCount() -> Int { candidateSelections }

  func intake(projectId: String) throws -> C14_6ProjectIntake? {
    if let failure { throw failure }
    return intakeValue
  }

  func dossier(projectId: String) throws -> C14_6PropertyDossier? {
    if let failure { throw failure }
    return C14_6FixtureFactory.dossier
  }

  func saveIntake(
    projectId: String,
    intake: C14_6HomeIntake,
    expectedVersion: Int,
    idempotencyKey: String
  ) throws -> C14_6ProjectIntake {
    saveKeys.append(idempotencyKey)
    if saveFailures > 0 {
      saveFailures -= 1
      throw C14_6HomeSetupError.offline
    }
    intakeValue = C14_6ProjectIntake(
      intake: intake,
      projectId: projectId,
      updatedAt: "2026-08-26T10:00:00Z",
      updatedBy: C14_6FixtureFactory.intake.updatedBy,
      version: expectedVersion + 1
    )
    return intakeValue
  }

  func resolve(projectId: String, query: String, idempotencyKey: String) throws -> C14_6PropertyResolution {
    resolutionValue
  }

  func selectCandidate(projectId: String, candidateId: String, resolutionId: String, expectedVersion: Int, idempotencyKey: String) throws -> C14_6ProjectProperty {
    candidateSelections += 1
    return C14_6FixtureFactory.property
  }

  func selectManual(projectId: String, address: C14_6PropertyAddress, expectedVersion: Int, idempotencyKey: String) throws -> C14_6ProjectProperty {
    C14_6FixtureFactory.property
  }
}

private actor C14_6DelayedSaveService: C14_6HomeSetupServing {
  private var intakeValue = C14_6FixtureFactory.intake
  private var saveKeys: [String] = []

  func saveCount() -> Int { saveKeys.count }
  func recordedSaveKeys() -> [String] { saveKeys }

  func intake(projectId: String) -> C14_6ProjectIntake? { intakeValue }
  func dossier(projectId: String) -> C14_6PropertyDossier? { C14_6FixtureFactory.dossier }

  func saveIntake(
    projectId: String,
    intake: C14_6HomeIntake,
    expectedVersion: Int,
    idempotencyKey: String
  ) async throws -> C14_6ProjectIntake {
    saveKeys.append(idempotencyKey)
    if saveKeys.count == 1 {
      try await Task.sleep(for: .milliseconds(150))
    }
    let saved = C14_6ProjectIntake(
      intake: intake,
      projectId: projectId,
      updatedAt: "2026-08-26T10:01:00Z",
      updatedBy: C14_6FixtureFactory.intake.updatedBy,
      version: expectedVersion + 1
    )
    intakeValue = saved
    return saved
  }

  func resolve(projectId: String, query: String, idempotencyKey: String) -> C14_6PropertyResolution {
    C14_6FixtureFactory.resolution
  }

  func selectCandidate(projectId: String, candidateId: String, resolutionId: String, expectedVersion: Int, idempotencyKey: String) -> C14_6ProjectProperty {
    C14_6FixtureFactory.property
  }

  func selectManual(projectId: String, address: C14_6PropertyAddress, expectedVersion: Int, idempotencyKey: String) -> C14_6ProjectProperty {
    C14_6FixtureFactory.property
  }
}

private struct C14_6HomeSetupEvidenceService: EvidenceServing {
  let assets: [EvidenceAsset]

  func list(projectId: String) async throws -> [EvidenceAsset] { assets }
  func abort(projectId: String, sessionId: String, idempotencyKey: String) async throws {}
  func access(projectId: String, assetId: String, representation: String) async throws -> EvidenceAccess { throw EvidenceServiceError.unavailable }
  func complete(projectId: String, sessionId: String, sha256: String, parts: [CompletedEvidencePart], idempotencyKey: String) async throws -> EvidenceAsset { throw EvidenceServiceError.unavailable }
  func createSession(projectId: String, selection: EvidenceSelection, sha256: String, rights: EvidenceRightsAssertion, idempotencyKey: String) async throws -> EvidenceUploadSession { throw EvidenceServiceError.unavailable }
  func session(projectId: String, sessionId: String) async throws -> EvidenceUploadSession { throw EvidenceServiceError.unavailable }
  func signPart(projectId: String, sessionId: String, partNumber: Int, byteSize: Int, checksumSha256: String, idempotencyKey: String) async throws -> SignedEvidencePart { throw EvidenceServiceError.unavailable }
  func uploadPart(fileURL: URL, signedPart: SignedEvidencePart) async throws -> String { throw EvidenceServiceError.unavailable }
}

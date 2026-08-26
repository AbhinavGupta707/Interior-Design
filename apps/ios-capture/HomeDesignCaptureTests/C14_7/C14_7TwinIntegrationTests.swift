#if DEBUG
  import Foundation
  import XCTest
  @testable import HomeDesignCapture

  @MainActor
  final class C14_7TwinIntegrationTests: XCTestCase {
    private let local = AppConfiguration(
      environment: .local,
      apiBaseURL: URL(string: "http://127.0.0.1:4100")!
    )

    func testFixtureRequiresExactLocalOptIn() {
      XCTAssertNil(C14_7UITestScenario.current(configuration: local, environment: [:]))
      XCTAssertNil(
        C14_7UITestScenario.current(
          configuration: local,
          environment: [
            "C14_7_UI_TEST_MODE": "true",
            "C14_7_UI_TEST_SCENARIO": "proposal-journey",
          ]
        )
      )
      XCTAssertEqual(
        C14_7UITestScenario.current(
          configuration: local,
          environment: [
            "C14_7_UI_TEST_MODE": "1",
            "C14_7_UI_TEST_SCENARIO": "proposal-journey",
          ]
        ),
        .proposalJourney
      )
      let production = AppConfiguration(
        environment: .production,
        apiBaseURL: URL(string: "https://api.example.test")!
      )
      XCTAssertNil(
        C14_7UITestScenario.current(
          configuration: production,
          environment: [
            "C14_7_UI_TEST_MODE": "1",
            "C14_7_UI_TEST_SCENARIO": "confirmed-owner",
          ]
        )
      )
    }

    func testPlanCandidatesStartUnresolvedAndCannotProduceImplicitOperations() throws {
      let candidate = try XCTUnwrap(C14_7FixtureFactory.planProposal.candidates?.first)
      let initial = C14_7CandidateReview.initial(candidate)
      XCTAssertEqual(initial.decision, .unresolved)
      XCTAssertThrowsError(
        try C14_7PlanOperationBuilder.build(
          proposal: C14_7FixtureFactory.planProposal,
          calibration: C14_7FixtureFactory.calibration,
          actorUserId: C14_5FixtureFactory.projectId,
          reviews: [candidate.id: initial]
        )
      ) { error in
        XCTAssertEqual(error as? C14_7PlanOperationBuilderError, .unresolvedCandidates)
      }
    }

    func testAcceptedAndCorrectedPlanOperationsKeepDistinctProvenance() throws {
      let candidate = try XCTUnwrap(C14_7FixtureFactory.planProposal.candidates?.first)
      var accepted = C14_7CandidateReview.initial(candidate)
      accepted.decision = .accepted
      let sourceDraft = try C14_7PlanOperationBuilder.build(
        proposal: C14_7FixtureFactory.planProposal,
        calibration: C14_7FixtureFactory.calibration,
        actorUserId: C14_5FixtureFactory.projectId,
        reviews: [candidate.id: accepted]
      )
      let sourceJSON = try JSONEncoder().encode(sourceDraft.operations)
      let sourceText = try XCTUnwrap(String(data: sourceJSON, encoding: .utf8))
      XCTAssertTrue(sourceText.contains("source-derived"))
      XCTAssertTrue(sourceText.contains("plan-import"))
      XCTAssertTrue(sourceText.contains(C14_7FixtureFactory.planAssetId.uuidString.lowercased()))
      XCTAssertFalse(sourceText.contains("appearance"))

      var corrected = accepted
      corrected.decision = .corrected
      corrected.name = "Homeowner corrected level"
      corrected.elevationMillimetres = 25
      let actorId = UUID(uuidString: "14700000-0000-4000-8000-000000000099")!
      let correctedDraft = try C14_7PlanOperationBuilder.build(
        proposal: C14_7FixtureFactory.planProposal,
        calibration: C14_7FixtureFactory.calibration,
        actorUserId: actorId,
        reviews: [candidate.id: corrected]
      )
      let correctedText = try XCTUnwrap(
        String(data: JSONEncoder().encode(correctedDraft.operations), encoding: .utf8)
      )
      XCTAssertTrue(correctedText.contains("user-asserted"))
      XCTAssertTrue(correctedText.contains(actorId.uuidString.lowercased()))
      XCTAssertTrue(correctedText.contains("Homeowner corrected level"))
    }

    func testExactCalibrationUsesBoundedRationalScaleAndRejectsDegenerateInput() throws {
      let value = try C14_7PlanOperationBuilder.calibrationBody(
        knownLengthMillimetres: 1_000,
        sourceStart: .init(x: 0, y: 0),
        sourceEnd: .init(x: 250, y: 0)
      )
      XCTAssertEqual(
        value.objectValue?["sourceToModel"]?.objectValue?["a"],
        .number(4)
      )
      XCTAssertEqual(
        value.objectValue?["sourceToModel"]?.objectValue?["denominator"],
        .number(1)
      )
      XCTAssertThrowsError(
        try C14_7PlanOperationBuilder.calibrationBody(
          knownLengthMillimetres: 1_000,
          sourceStart: .init(x: 1, y: 1),
          sourceEnd: .init(x: 1, y: 1)
        )
      )
    }

    func testExactConfirmedTwinRequiresChangedHeadAndMatchingSucceededScene() throws {
      let initial = C14_7FixtureFactory.initialWorkspace(role: .owner)
      try C14_7ContractValidator.validate(initial, projectId: C14_7FixtureFactory.projectId)
      XCTAssertNil(initial.exactSucceededScene)

      let committed = C14_7FixtureFactory.committedWorkspace(role: .owner, confirmed: false)
      try C14_7ContractValidator.validate(committed, projectId: C14_7FixtureFactory.projectId)
      XCTAssertNil(committed.exactSucceededScene)

      let confirmed = C14_7FixtureFactory.committedWorkspace(role: .owner, confirmed: true)
      try C14_7ContractValidator.validate(confirmed, projectId: C14_7FixtureFactory.projectId)
      XCTAssertNotNil(confirmed.exactSucceededScene)
    }

    func testViewerRoleAndOfflineRefreshRemainReadOnly() async {
      let viewer = C14_7TwinIntegrationModel(
        service: C14_7FixtureTwinService(scenario: .viewer)
      )
      await viewer.activate(projectId: C14_7FixtureFactory.projectId.uuidString)
      XCTAssertEqual(viewer.state, .ready)
      XCTAssertTrue(viewer.confirmedTwin)
      XCTAssertFalse(viewer.canMutate)

      let stale = C14_7TwinIntegrationModel(
        service: C14_7FixtureTwinService(scenario: .stale)
      )
      await stale.activate(projectId: C14_7FixtureFactory.projectId.uuidString)
      XCTAssertTrue(stale.canMutate)
      await stale.reload()
      guard case .stale = stale.state else { return XCTFail("Expected retained stale state") }
      XCTAssertNotNil(stale.workspace)
      XCTAssertFalse(stale.canMutate)

      let relaunchedOffline = C14_7TwinIntegrationModel(
        service: C14_7FixtureTwinService(scenario: .offline)
      )
      await relaunchedOffline.activate(projectId: C14_7FixtureFactory.projectId.uuidString)
      XCTAssertNil(relaunchedOffline.workspace)
      XCTAssertFalse(relaunchedOffline.canMutate)
    }

    func testProjectSwitchClearsExactStateAndC9AnchorsStartNonAuthoritative() async {
      let model = C14_7TwinIntegrationModel(
        service: C14_7FixtureTwinService(scenario: .proposalJourney)
      )
      await model.activate(projectId: C14_7FixtureFactory.projectId.uuidString)
      XCTAssertNotNil(model.workspace)

      let source = C14_7FusionSource(
        coordinateFrame: "source-local-metric",
        elementCount: 1,
        evidenceState: "source-derived",
        id: UUID(uuidString: "14700000-0000-4000-8000-000000000071")!,
        kind: "roomplan-proposal",
        referenceId: UUID(uuidString: "14700000-0000-4000-8000-000000000071")!,
        rights: .init(serviceProcessingConsent: true, trainingUseConsent: "denied"),
        scaleStatus: "metric-estimated",
        schemaVersion: "c7-capture-proposal-v1",
        sha256: String(repeating: "7", count: 64)
      )
      model.toggleFusionSource(source)
      XCTAssertEqual(model.fusionAnchors[source.id]?.count, 3)
      XCTAssertTrue(
        model.fusionAnchors[source.id]?.allSatisfy {
          $0.sourcePoint == .init(xMm: 0, yMm: 0, zMm: 0)
            && $0.projectPoint == .init(xMm: 0, yMm: 0, zMm: 0)
        } == true
      )
      XCTAssertFalse(model.fusionSelectionValid)

      let other = UUID(uuidString: "24700000-0000-4000-8000-000000000001")!
      await model.activate(projectId: other.uuidString)
      XCTAssertNil(model.workspace)
      XCTAssertTrue(model.selectedFusionSourceIds.isEmpty)
      XCTAssertTrue(model.fusionAnchors.isEmpty)
      XCTAssertFalse(model.canMutate)
    }

    func testLateProjectResponseCannotOverwriteCurrentWorkspace() async {
      let service = C14_7FixtureTwinService(scenario: .delayedStaleResponse)
      let model = C14_7TwinIntegrationModel(service: service)
      let projectId = C14_7FixtureFactory.projectId.uuidString
      await model.activate(projectId: projectId)

      let other = UUID(uuidString: "24700000-0000-4000-8000-000000000002")!
      let staleActivation = Task { await model.activate(projectId: other.uuidString) }
      while await service.observedLoadCount() < 2 { await Task.yield() }
      await model.activate(projectId: projectId)
      await staleActivation.value

      XCTAssertEqual(model.state, .ready)
      XCTAssertEqual(model.workspace?.snapshot?.projectId, C14_7FixtureFactory.projectId)
      XCTAssertTrue(model.canMutate)
    }

    func testFreshRoleDowngradeDiscardsLocalProposalIntent() async {
      let model = C14_7TwinIntegrationModel(
        service: C14_7FixtureTwinService(scenario: .roleDowngrade)
      )
      await model.activate(projectId: C14_7FixtureFactory.projectId.uuidString)
      model.loadSelectedPlanProposal()
      while model.planProposal == nil { await Task.yield() }
      XCTAssertFalse(model.planReviews.isEmpty)

      await model.reload()

      XCTAssertEqual(model.workspace?.session.actor.role, .viewer)
      XCTAssertNil(model.planProposal)
      XCTAssertTrue(model.planReviews.isEmpty)
      XCTAssertFalse(model.canMutate)
    }
  }
#endif

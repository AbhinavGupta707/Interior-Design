import Foundation
import SwiftUI

#if DEBUG
enum C14_8UITestScenario: String {
  case guidedJourney = "guided-journey"

  static func current(configuration: AppConfiguration) -> Self? {
    guard configuration.environment == .local else { return nil }
    return ProcessInfo.processInfo.environment["C14_8_UI_TEST_SCENARIO"].flatMap(Self.init)
  }
}

struct C14_8UITestFixtureView: View {
  @State private var model: C14_8GuidedCaptureModel
  private let actor: C14_6Actor
  private let project: CaptureProject

  @MainActor
  init(scenario: C14_8UITestScenario, configuration: AppConfiguration) {
    let tokenProvider = C14_6SessionTokenProvider(
      identity: configuration.identity,
      baseURL: configuration.apiBaseURL
    )
    let captureService = C7CaptureAPIClient(
      baseURL: configuration.apiBaseURL,
      tokenProvider: tokenProvider
    )
    let evidenceService = C2EvidenceAPIClient(
      baseURL: configuration.apiBaseURL,
      tokenProvider: tokenProvider
    )
    let fixtureRoot = FileManager.default.temporaryDirectory
      .appendingPathComponent("c14-8-ui-\(UUID().uuidString)", isDirectory: true)
    _model = State(
      initialValue: C14_8GuidedCaptureModel(
        capabilityProvider: C14_8SystemCapabilityProvider(),
        permissionProvider: C8SystemCameraPermissionProvider(),
        engine: C14_8FixtureGuidedCaptureEngine(),
        captureService: captureService,
        envelopeService: C14_8CaptureEnvelopeAPIClient(
          baseURL: configuration.apiBaseURL,
          tokenProvider: tokenProvider
        ),
        evidenceService: evidenceService,
        mediaUploader: C8ImmutableEvidenceUploader(service: evidenceService),
        depthUploader: C14_8DepthUploader(service: captureService),
        journal: C14_8ProtectedCaptureStore(root: fixtureRoot.appendingPathComponent("journal")),
        mediaStore: C8ProtectedMediaStore(root: fixtureRoot.appendingPathComponent("media"))
      )
    )
    actor = C14_6Actor(
      displayName: "Synthetic homeowner",
      role: "owner",
      subject: "fixture|c14-8-owner",
      tenantId: "14800000-0000-4000-8000-000000000010",
      userId: "14800000-0000-4000-8000-000000000011"
    )
    project = CaptureProject(
      id: "14800000-0000-4000-8000-000000000012",
      name: "Synthetic guided-capture home",
      locationSummary: "Synthetic local project",
      isFixture: true
    )
  }

  var body: some View {
    NavigationStack {
      C14_8GuidedCaptureView(
        model: model,
        project: project,
        actor: actor,
        onOpenEvidence: {},
        onOpenRoomPlan: {},
        onDone: {}
      )
    }
  }
}
#endif

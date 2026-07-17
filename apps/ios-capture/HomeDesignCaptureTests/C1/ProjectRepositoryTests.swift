import Foundation
import XCTest
@testable import HomeDesignCapture

@MainActor
final class ProjectRepositoryTests: XCTestCase {
  func testClientMapsFrozenProjectResponseAndKeepsAuthorityOutOfRequests() async throws {
    let transport = QueuedTransport(
      responses: [
        QueuedResponse(
          data: Data(
            #"{"accessToken":"fixture-access-token-with-more-than-thirty-two-characters","session":{}}"#.utf8
          ),
          statusCode: 201
        ),
        QueuedResponse(
          data: Data(
            #"[{"id":"33333333-3333-4333-8333-333333333333","name":"Sample terrace refresh","status":"draft","tenantId":"11111111-1111-4111-8111-111111111111","createdAt":"2026-07-17T12:00:00.000Z","updatedAt":"2026-07-17T12:00:00.000Z","version":1}]"#.utf8
          ),
          statusCode: 200
        ),
      ]
    )
    let client = C1ProjectAPIClient(
      baseURL: URL(string: "http://127.0.0.1:4100")!,
      transport: transport
    )

    let projects = try await client.authenticateAndListProjects()
    let observations = await transport.observations()

    XCTAssertEqual(
      projects,
      [
        CaptureProject.projectService(
          id: "33333333-3333-4333-8333-333333333333",
          name: "Sample terrace refresh",
          status: "draft"
        ),
      ]
    )
    XCTAssertEqual(observations.paths, ["/v1/auth/local/session", "/v1/projects"])
    XCTAssertNil(observations.authorisation[0])
    XCTAssertEqual(
      observations.authorisation[1],
      "Bearer fixture-access-token-with-more-than-thirty-two-characters"
    )
    XCTAssertFalse(observations.sentAuthorityHeaders)
  }

  func testRepositoryShowsEmptyServiceState() async {
    let repository = ProjectRepository(service: ProjectServiceStub(outcome: .projects([])))

    await repository.load()

    XCTAssertEqual(repository.state, .empty)
  }

  func testRepositoryShowsExpiredStateWithoutUsingFixtureAutomatically() async {
    let repository = ProjectRepository(service: ProjectServiceStub(outcome: .error(.expired)))

    await repository.load()

    XCTAssertEqual(repository.state, .expired)
  }

  func testOfflineRecoveryUsesDeterministicVisiblyLocalFixtureOnlyAfterUserAction() async {
    let repository = ProjectRepository(service: ProjectServiceStub(outcome: .error(.offline)))

    await repository.load()
    XCTAssertEqual(repository.state, .offline)

    repository.useLocalFixture()

    XCTAssertEqual(
      repository.state,
      .loaded(CaptureProject.localFixtures, source: .localFixture)
    )
    XCTAssertTrue(CaptureProject.localFixtures.allSatisfy(\.isFixture))
  }
}

private struct ProjectServiceStub: ProjectServing {
  enum Outcome: Sendable {
    case projects([CaptureProject])
    case error(C1ProjectServiceError)
  }

  let outcome: Outcome

  func authenticateAndListProjects() async throws -> [CaptureProject] {
    switch outcome {
    case .projects(let projects):
      projects
    case .error(let error):
      throw error
    }
  }
}

private struct QueuedResponse: Sendable {
  let data: Data
  let statusCode: Int
}

private actor QueuedTransport: C1HTTPTransport {
  struct Observations: Sendable {
    let paths: [String]
    let authorisation: [String?]
    let sentAuthorityHeaders: Bool
  }

  private var responses: [QueuedResponse]
  private var paths: [String] = []
  private var authorisation: [String?] = []
  private var sentAuthorityHeaders = false

  init(responses: [QueuedResponse]) {
    self.responses = responses
  }

  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    paths.append(request.url?.path ?? "")
    authorisation.append(request.value(forHTTPHeaderField: "Authorization"))
    sentAuthorityHeaders = sentAuthorityHeaders
      || request.value(forHTTPHeaderField: "X-Tenant-Id") != nil
      || request.value(forHTTPHeaderField: "X-User-Id") != nil
      || request.value(forHTTPHeaderField: "X-Role") != nil

    let response = responses.removeFirst()
    let httpResponse = HTTPURLResponse(
      url: request.url!,
      statusCode: response.statusCode,
      httpVersion: "HTTP/1.1",
      headerFields: ["Content-Type": "application/json"]
    )!
    return (response.data, httpResponse)
  }

  func observations() -> Observations {
    Observations(
      paths: paths,
      authorisation: authorisation,
      sentAuthorityHeaders: sentAuthorityHeaders
    )
  }
}

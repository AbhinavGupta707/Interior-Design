import Foundation
import Observation
import SwiftUI

enum ProjectListDataSource: Equatable, Sendable {
  case projectService
  case localFixture
}

enum ProjectListState: Equatable, Sendable {
  case idle
  case loading
  case loaded([CaptureProject], source: ProjectListDataSource)
  case empty
  case offline
  case expired
  case forbidden
  case failure(String)
}

enum C1ProjectServiceError: Error, Equatable, Sendable {
  case offline
  case expired
  case forbidden
  case invalidResponse
  case unavailable
}

protocol ProjectServing: Sendable {
  func authenticateAndListProjects() async throws -> [CaptureProject]
}

@MainActor
@Observable
final class ProjectRepository {
  private(set) var state: ProjectListState = .idle

  @ObservationIgnored
  private let service: any ProjectServing

  init(service: any ProjectServing) {
    self.service = service
  }

  func load() async {
    state = .loading
    do {
      let projects = try await service.authenticateAndListProjects()
      state = projects.isEmpty ? .empty : .loaded(projects, source: .projectService)
    } catch let error as C1ProjectServiceError {
      switch error {
      case .offline:
        state = .offline
      case .expired:
        state = .expired
      case .forbidden:
        state = .forbidden
      case .invalidResponse:
        state = .failure("The project service response did not match the frozen C1 contract.")
      case .unavailable:
        state = .failure("The project service is unavailable. Try again or use the local fixture.")
      }
    } catch {
      state = .failure("Projects could not be loaded. Try again or use the local fixture.")
    }
  }

  func useLocalFixture() {
    state = .loaded(CaptureProject.localFixtures, source: .localFixture)
  }
}

protocol C1HTTPTransport: Sendable {
  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTransport: C1HTTPTransport, @unchecked Sendable {
  private let session: URLSession

  init(session: URLSession = .shared) {
    self.session = session
  }

  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await session.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw C1ProjectServiceError.invalidResponse
    }
    return (data, httpResponse)
  }
}

struct C1ProjectAPIClient: ProjectServing, Sendable {
  private struct LocalSessionRequest: Encodable {
    let persona: String
  }

  private struct LocalSessionResponse: Decodable {
    let accessToken: String
  }

  private struct ProjectResponse: Decodable {
    let id: String
    let name: String
    let status: String
  }

  private let baseURL: URL
  private let transport: any C1HTTPTransport

  init(baseURL: URL, transport: any C1HTTPTransport) {
    self.baseURL = baseURL
    self.transport = transport
  }

  func authenticateAndListProjects() async throws -> [CaptureProject] {
    var sessionRequest = URLRequest(url: endpoint("/v1/auth/local/session"))
    sessionRequest.httpMethod = "POST"
    sessionRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
    sessionRequest.setValue("application/json", forHTTPHeaderField: "Accept")
    sessionRequest.httpBody = try JSONEncoder().encode(
      LocalSessionRequest(persona: "homeowner-alpha")
    )

    let (sessionData, sessionResponse) = try await perform(sessionRequest)
    try validate(sessionResponse)
    guard
      let session = try? JSONDecoder().decode(LocalSessionResponse.self, from: sessionData),
      session.accessToken.count >= 32
    else {
      throw C1ProjectServiceError.invalidResponse
    }

    var projectRequest = URLRequest(url: endpoint("/v1/projects"))
    projectRequest.setValue("application/json", forHTTPHeaderField: "Accept")
    projectRequest.setValue(
      "Bearer \(session.accessToken)",
      forHTTPHeaderField: "Authorization"
    )
    let (projectData, projectResponse) = try await perform(projectRequest)
    try validate(projectResponse)
    guard let projects = try? JSONDecoder().decode([ProjectResponse].self, from: projectData) else {
      throw C1ProjectServiceError.invalidResponse
    }

    return projects.map { project in
      CaptureProject.projectService(
        id: project.id,
        name: project.name,
        status: project.status
      )
    }
  }

  private func endpoint(_ path: String) -> URL {
    baseURL.appendingPathComponent(String(path.dropFirst()))
  }

  private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    do {
      return try await transport.data(for: request)
    } catch let error as C1ProjectServiceError {
      throw error
    } catch let error as URLError where error.code == .notConnectedToInternet {
      throw C1ProjectServiceError.offline
    } catch {
      throw C1ProjectServiceError.unavailable
    }
  }

  private func validate(_ response: HTTPURLResponse) throws {
    switch response.statusCode {
    case 200..<300:
      return
    case 401:
      throw C1ProjectServiceError.expired
    case 403, 404:
      throw C1ProjectServiceError.forbidden
    case 500..<600:
      throw C1ProjectServiceError.unavailable
    default:
      throw C1ProjectServiceError.invalidResponse
    }
  }
}

struct ProjectSelectionView: View {
  @Bindable var repository: ProjectRepository
  let environmentLabel: String
  let onSelect: (CaptureProject) -> Void

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: "house.and.flag")
            .font(.system(size: 36))
            .foregroundStyle(.tint)
            .accessibilityHidden(true)
          Text("Prepare evidence for your home")
            .font(.title2.bold())
          Text("Choose a project, then this app checks whether the existing C0 capture eligibility route is available on this device.")
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
      }

      Section {
        LabeledContent("Persona", value: "Alpha homeowner")
        LabeledContent("Session", value: "Synthetic local fixture")
      } header: {
        Text("Local development identity")
      } footer: {
        Text("No tenant, user, or role fields are sent as authority. The bearer session remains in memory only.")
      }

      projectContent
    }
    .navigationTitle("Home Design Studio")
    .task {
      if repository.state == .idle {
        await repository.load()
      }
    }
  }

  @ViewBuilder
  private var projectContent: some View {
    switch repository.state {
    case .idle, .loading:
      Section("Projects") {
        HStack(spacing: 12) {
          ProgressView()
          Text("Loading synthetic projects…")
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
      }
    case .empty:
      Section("Projects") {
        ContentUnavailableView(
          "No projects yet",
          systemImage: "folder",
          description: Text("Create a project on the web, then retry this list.")
        )
        Button("Retry project loading") {
          Task { await repository.load() }
        }
      }
    case .offline:
      recoverySection(
        title: "You’re offline",
        message: "Reconnect to load service projects. Nothing has been submitted.",
        retryTitle: "Try again",
        showsFixtureFallback: true
      )
    case .expired:
      recoverySection(
        title: "Fixture session expired",
        message: "Sign in to the local fixture again. No project data was changed.",
        retryTitle: "Sign in again",
        showsFixtureFallback: false
      )
    case .forbidden:
      recoverySection(
        title: "Projects unavailable",
        message: "This persona cannot access the requested projects. Other tenant projects are not disclosed.",
        retryTitle: "Try again",
        showsFixtureFallback: false
      )
    case .failure(let message):
      recoverySection(
        title: "Projects could not be loaded",
        message: message,
        retryTitle: "Retry project loading",
        showsFixtureFallback: true
      )
    case .loaded(let projects, let source):
      Section {
        if source == .localFixture {
          Label("Local fixture · Synthetic project data", systemImage: "lock.shield")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .accessibilityLabel("Local fixture, synthetic project data")
        }
        ForEach(projects) { project in
          Button {
            onSelect(project)
          } label: {
            HStack(spacing: 12) {
              Image(systemName: "house")
                .font(.title3)
                .foregroundStyle(.tint)
                .frame(width: 30)

              VStack(alignment: .leading, spacing: 3) {
                Text(project.name)
                  .font(.headline)
                  .foregroundStyle(.primary)
                Text(project.locationSummary)
                  .font(.subheadline)
                  .foregroundStyle(.secondary)
                if project.isFixture {
                  Text("Local fixture — not a real property")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
              }

              Spacer()

              Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 4)
          }
          .buttonStyle(.plain)
          .accessibilityHint("Checks capture eligibility for this project")
        }
      } header: {
        Text("Projects")
      } footer: {
        Text("\(environmentLabel) configuration. Native capture is not implemented in C1; selection continues to the existing eligibility flow.")
      }
    }
  }

  @ViewBuilder
  private func recoverySection(
    title: String,
    message: String,
    retryTitle: String,
    showsFixtureFallback: Bool
  ) -> some View {
    Section {
      VStack(alignment: .leading, spacing: 8) {
        Label(title, systemImage: "exclamationmark.triangle")
          .font(.headline)
        Text(message)
          .foregroundStyle(.secondary)
      }
      .padding(.vertical, 8)
      .accessibilityElement(children: .combine)

      Button(retryTitle) {
        Task { await repository.load() }
      }

      if showsFixtureFallback {
        Button("Use deterministic local fixture") {
          repository.useLocalFixture()
        }
      }
    } header: {
      Text("Projects")
    } footer: {
      if showsFixtureFallback {
        Text("The fallback is visibly synthetic and does not represent a live project service result.")
      }
    }
  }
}

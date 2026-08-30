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
  func createProject(name: String, idempotencyKey: String) async throws -> CaptureProject
}

protocol C14_6LastProjectStoring: Sendable {
  func clear() async throws
  func load() async throws -> String?
  func save(projectId: String) async throws
}

actor C14_6LastProjectStore: C14_6LastProjectStoring {
  private let store: any C14_6ProtectedStringStoring

  init(
    store: any C14_6ProtectedStringStoring = C14_6KeychainStringStore(
      service: "com.homedesignstudio.capture.recovery",
      account: "last-authorised-project"
    )
  ) {
    self.store = store
  }

  func clear() async throws { try await store.delete() }

  func load() async throws -> String? {
    guard let value = try await store.load() else { return nil }
    guard UUID(uuidString: value) != nil else {
      try? await store.delete()
      return nil
    }
    return value
  }

  func save(projectId: String) async throws {
    guard UUID(uuidString: projectId) != nil else { return }
    try await store.save(projectId)
  }
}

extension ProjectServing {
  func createProject(name: String, idempotencyKey: String) async throws -> CaptureProject {
    throw C1ProjectServiceError.unavailable
  }
}

@MainActor
@Observable
final class ProjectRepository {
  private(set) var state: ProjectListState = .idle
  private(set) var creationMessage: String?
  private(set) var isCreating = false
  private(set) var recoveredProject: CaptureProject?
  var newProjectName = ""

  @ObservationIgnored
  private let service: any ProjectServing
  @ObservationIgnored
  private let recovery: any C14_6LastProjectStoring
  @ObservationIgnored
  private var pendingCreationName: String?
  @ObservationIgnored
  private var pendingCreationKey: String?
  @ObservationIgnored
  private var loadRequestId = UUID()
  @ObservationIgnored
  private var creationRequestId = UUID()
  @ObservationIgnored
  private var selectionRequestId = UUID()

  init(
    service: any ProjectServing,
    recovery: any C14_6LastProjectStoring = C14_6LastProjectStore()
  ) {
    self.service = service
    self.recovery = recovery
  }

  func load() async {
    let requestId = UUID()
    loadRequestId = requestId
    state = .loading
    do {
      let projects = try await service.authenticateAndListProjects()
      let recoveredId = try? await recovery.load()
      guard requestId == loadRequestId, !Task.isCancelled else { return }
      state = projects.isEmpty ? .empty : .loaded(projects, source: .projectService)
      if let recoveredId,
         let project = projects.first(where: { $0.id == recoveredId }) {
        recoveredProject = project
      } else {
        recoveredProject = nil
        try? await recovery.clear()
      }
    } catch let error as C1ProjectServiceError {
      guard requestId == loadRequestId, !Task.isCancelled else { return }
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
        state = .failure("The project service is unavailable. Try again.")
      }
    } catch {
      guard requestId == loadRequestId, !Task.isCancelled else { return }
      state = .failure("Projects could not be loaded. Try again.")
    }
  }

  func useLocalFixture() {
    loadRequestId = UUID()
    selectionRequestId = UUID()
    state = .loaded(CaptureProject.localFixtures, source: .localFixture)
  }

  func remember(_ project: CaptureProject) async -> Bool {
    let requestId = UUID()
    selectionRequestId = requestId
    if !project.isFixture {
      try? await recovery.save(projectId: project.id)
    }
    guard requestId == selectionRequestId, !Task.isCancelled else {
      try? await recovery.clear()
      return false
    }
    recoveredProject = project
    return true
  }

  func clearRecovery() async {
    selectionRequestId = UUID()
    recoveredProject = nil
    try? await recovery.clear()
  }

  func reset() {
    loadRequestId = UUID()
    creationRequestId = UUID()
    selectionRequestId = UUID()
    state = .idle
    creationMessage = nil
    isCreating = false
    newProjectName = ""
    pendingCreationName = nil
    pendingCreationKey = nil
    recoveredProject = nil
  }

  func createProject() async {
    let name = newProjectName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, name.count <= 120, !isCreating else { return }
    let requestId = UUID()
    creationRequestId = requestId
    isCreating = true
    creationMessage = nil
    defer {
      if requestId == creationRequestId { isCreating = false }
    }
    if pendingCreationName != name || pendingCreationKey == nil {
      pendingCreationName = name
      pendingCreationKey = UUID().uuidString
    }
    guard let idempotencyKey = pendingCreationKey else { return }
    do {
      _ = try await service.createProject(name: name, idempotencyKey: idempotencyKey)
      guard requestId == creationRequestId, !Task.isCancelled else { return }
      pendingCreationName = nil
      pendingCreationKey = nil
      newProjectName = ""
      creationMessage = "Project created on the server. Choose it to open the homeowner hub."
      await load()
    } catch let error as C1ProjectServiceError {
      guard requestId == creationRequestId, !Task.isCancelled else { return }
      switch error {
      case .offline:
        creationMessage = "Reconnect before creating a project. Nothing was saved locally."
      case .expired:
        creationMessage = "The session expired. Sign in again before creating a project."
      case .forbidden:
        creationMessage = "This role cannot create a project."
      case .invalidResponse:
        creationMessage = "The project response failed the frozen C1 contract."
      case .unavailable:
        creationMessage = "Project creation is temporarily unavailable."
      }
    } catch {
      guard requestId == creationRequestId, !Task.isCancelled else { return }
      creationMessage = "Project creation failed safely. Nothing was inferred or saved locally."
    }
  }
}

protocol C1HTTPTransport: Sendable {
  func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTransport: C1HTTPTransport, @unchecked Sendable {
  private let session: URLSession

  init(session: URLSession? = nil) {
    if let session {
      self.session = session
    } else {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
      configuration.urlCache = nil
      self.session = URLSession(configuration: configuration)
    }
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

  private struct CreateProjectRequest: Encodable {
    let name: String
  }

  private let baseURL: URL
  private let transport: any C1HTTPTransport
  private let tokenProvider: (any C7CaptureTokenProviding)?

  init(
    baseURL: URL,
    transport: any C1HTTPTransport,
    tokenProvider: (any C7CaptureTokenProviding)? = nil
  ) {
    self.baseURL = baseURL
    self.transport = transport
    self.tokenProvider = tokenProvider
  }

  func authenticateAndListProjects() async throws -> [CaptureProject] {
    let (projectData, _) = try await authenticatedRequest(
      path: "/v1/projects",
      method: "GET",
      body: nil,
      idempotencyKey: nil
    )
    guard let projects = try? JSONDecoder().decode([ProjectResponse].self, from: projectData) else {
      throw C1ProjectServiceError.invalidResponse
    }
    guard projects.count <= 1_000 else { throw C1ProjectServiceError.invalidResponse }

    return try projects.map(Self.mapProject)
  }

  func createProject(name: String, idempotencyKey: String) async throws -> CaptureProject {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.count <= 120, UUID(uuidString: idempotencyKey) != nil else {
      throw C1ProjectServiceError.invalidResponse
    }
    let body = try JSONEncoder().encode(CreateProjectRequest(name: trimmed))
    let (data, _) = try await authenticatedRequest(
      path: "/v1/projects",
      method: "POST",
      body: body,
      idempotencyKey: idempotencyKey
    )
    guard let project = try? JSONDecoder().decode(ProjectResponse.self, from: data) else {
      throw C1ProjectServiceError.invalidResponse
    }
    return try Self.mapProject(project)
  }

  private func accessToken() async throws -> String {
    if let tokenProvider {
      do {
        let token = try await tokenProvider.accessToken()
        guard token.count >= 32, !token.contains("\n"), !token.contains("\r") else {
          throw C1ProjectServiceError.invalidResponse
        }
        return token
      } catch let error as C1ProjectServiceError {
        throw error
      } catch {
        throw C1ProjectServiceError.expired
      }
    }
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
      session.accessToken.count >= 32,
      !session.accessToken.contains("\n"),
      !session.accessToken.contains("\r")
    else {
      throw C1ProjectServiceError.invalidResponse
    }
    return session.accessToken
  }

  private static func mapProject(_ project: ProjectResponse) throws -> CaptureProject {
    guard UUID(uuidString: project.id) != nil,
          !project.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          project.name.count <= 120,
          ["draft", "active", "archived"].contains(project.status)
    else { throw C1ProjectServiceError.invalidResponse }
    return CaptureProject.projectService(id: project.id, name: project.name, status: project.status)
  }

  private func authenticatedRequest(
    path: String,
    method: String,
    body: Data?,
    idempotencyKey: String?
  ) async throws -> (Data, HTTPURLResponse) {
    for attempt in 0...1 {
      let token = try await accessToken()
      var request = URLRequest(
        url: endpoint(path),
        cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
        timeoutInterval: 30
      )
      request.httpMethod = method
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      if let body {
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      }
      if let idempotencyKey {
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
      }
      let (data, response) = try await perform(request)
      if response.statusCode == 401, attempt == 0, let tokenProvider {
        await tokenProvider.invalidate()
        continue
      }
      try validate(response)
      guard data.count <= 1_000_000 else { throw C1ProjectServiceError.invalidResponse }
      return (data, response)
    }
    throw C1ProjectServiceError.expired
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
  @State private var hasHandledInitialRecovery = false
  let actor: C14_6Actor
  let allowsFixtureFallback: Bool
  let environmentLabel: String
  let onSelect: (CaptureProject) -> Void
  let onSignOut: () -> Void

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: "house.and.flag")
            .font(.system(size: 36))
            .foregroundStyle(.tint)
            .accessibilityHidden(true)
          Text("Create or continue your home")
            .font(.title2.bold())
          Text("Choose a project to open its adaptive homeowner hub. Capture is one optional branch; design opens only from exact server-confirmed twin state.")
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
      }

      Section {
        LabeledContent("Identity", value: actor.displayName)
        LabeledContent("Role", value: actor.role.capitalized)
        LabeledContent("Session", value: "Server validated")
      } header: {
        Text(environmentLabel == "Local" ? "Local development identity" : "Authentication")
      } footer: {
        Text("Identity, tenant and role come from GET /v1/session. The client never submits them as authority.")
      }

      Section {
        TextField("Project name", text: $repository.newProjectName)
          .textInputAutocapitalization(.words)
          .accessibilityIdentifier("c14_5.project-name")
        Button {
          Task { await repository.createProject() }
        } label: {
          if repository.isCreating {
            HStack { ProgressView(); Text("Creating project…") }
          } else {
            Label("Create project", systemImage: "plus.circle.fill")
          }
        }
        .disabled(
          actor.role == "viewer"
            || repository.isCreating
            || repository.newProjectName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || repository.newProjectName.count > 120
        )
        .accessibilityIdentifier("c14_5.create-project")

        if let creationMessage = repository.creationMessage {
          Text(creationMessage)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("c14_5.project-creation-message")
        }
      } header: {
        Text("New home")
      } footer: {
        Text(
          actor.role == "viewer"
            ? "Viewer membership is read-only. Choose an existing authorised project."
            : "This creates only an authorised server project. Open it to add structured intake, property context and evidence."
        )
      }

      projectContent
    }
    .navigationTitle("Home Design Studio")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Sign out", action: onSignOut)
          .accessibilityIdentifier("c14_6.sign-out")
      }
    }
    .task {
      guard !hasHandledInitialRecovery else { return }
      hasHandledInitialRecovery = true
      if repository.state == .idle {
        await repository.load()
      }
      if let recovered = repository.recoveredProject {
        onSelect(recovered)
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
          Text("Loading authorised projects…")
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
      }
    case .empty:
      Section("Projects") {
        ContentUnavailableView(
          "No projects yet",
          systemImage: "folder",
          description: Text("Create a server project above, then continue to its homeowner hub.")
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
        showsFixtureFallback: allowsFixtureFallback
      )
    case .expired:
      recoverySection(
        title: "Session expired",
        message: "Sign in again. No project data was changed.",
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
        showsFixtureFallback: allowsFixtureFallback
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
            Task {
              if await repository.remember(project) {
                onSelect(project)
              }
            }
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
          .accessibilityHint("Opens the adaptive homeowner hub for this project")
        }
      } header: {
        Text("Projects")
      } footer: {
        Text(
          "\(environmentLabel) configuration. Selection opens native setup, capture, evidence and server-gated design branches."
        )
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

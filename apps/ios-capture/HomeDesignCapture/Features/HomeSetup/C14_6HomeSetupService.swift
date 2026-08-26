import Foundation
import Observation

enum C14_6HomeSetupError: Error, Equatable, Sendable {
  case expired
  case expiredResolution
  case forbidden
  case invalidResponse
  case offline
  case rejected
  case stale
  case throttled
  case unavailable
}

protocol C14_6HomeSetupServing: Sendable {
  func intake(projectId: String) async throws -> C14_6ProjectIntake?
  func saveIntake(
    projectId: String,
    intake: C14_6HomeIntake,
    expectedVersion: Int,
    idempotencyKey: String
  ) async throws -> C14_6ProjectIntake
  func dossier(projectId: String) async throws -> C14_6PropertyDossier?
  func resolve(
    projectId: String,
    query: String,
    idempotencyKey: String
  ) async throws -> C14_6PropertyResolution
  func selectCandidate(
    projectId: String,
    candidateId: String,
    resolutionId: String,
    expectedVersion: Int,
    idempotencyKey: String
  ) async throws -> C14_6ProjectProperty
  func selectManual(
    projectId: String,
    address: C14_6PropertyAddress,
    expectedVersion: Int,
    idempotencyKey: String
  ) async throws -> C14_6ProjectProperty
}

actor C14_6HomeSetupAPIClient: C14_6HomeSetupServing {
  private struct IntakeRequest: Encodable {
    let expectedVersion: Int
    let intake: C14_6HomeIntake
  }
  private struct ResolutionRequest: Encodable {
    let countryCode = "GB"
    let query: String
  }
  private struct CandidateRequest: Encodable {
    let candidateId: String
    let expectedVersion: Int
    let mode = "candidate"
    let resolutionId: String
  }
  private struct ManualRequest: Encodable {
    let address: C14_6PropertyAddress
    let expectedVersion: Int
    let jurisdiction = "england"
    let mode = "manual"
  }

  private let baseURL: URL
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()
  private let tokenProvider: any C7CaptureTokenProviding
  private let transport: any C1HTTPTransport

  init(
    baseURL: URL,
    tokenProvider: any C7CaptureTokenProviding,
    transport: any C1HTTPTransport = URLSessionTransport()
  ) {
    self.baseURL = baseURL
    self.tokenProvider = tokenProvider
    self.transport = transport
  }

  func intake(projectId: String) async throws -> C14_6ProjectIntake? {
    let result = try await send(
      projectId: projectId,
      path: "/v1/projects/\(projectId)/intake",
      method: "GET",
      body: nil,
      idempotencyKey: nil,
      permitsNoContent: true,
      permitsNotFound: false
    )
    guard let data = result else { return nil }
    guard let value = try? decoder.decode(C14_6ProjectIntake.self, from: data),
          value.projectId == projectId,
          value.isValid
    else { throw C14_6HomeSetupError.invalidResponse }
    return value
  }

  func saveIntake(
    projectId: String,
    intake: C14_6HomeIntake,
    expectedVersion: Int,
    idempotencyKey: String
  ) async throws -> C14_6ProjectIntake {
    guard intake.isValid, expectedVersion >= 0 else {
      throw C14_6HomeSetupError.invalidResponse
    }
    let data = try await required(
      send(
        projectId: projectId,
        path: "/v1/projects/\(projectId)/intake",
        method: "PUT",
        body: try encoder.encode(IntakeRequest(expectedVersion: expectedVersion, intake: intake)),
        idempotencyKey: idempotencyKey,
        permitsNoContent: false,
        permitsNotFound: false
      )
    )
    guard let value = try? decoder.decode(C14_6ProjectIntake.self, from: data),
          value.projectId == projectId,
          value.isValid
    else { throw C14_6HomeSetupError.invalidResponse }
    return value
  }

  func dossier(projectId: String) async throws -> C14_6PropertyDossier? {
    let result = try await send(
      projectId: projectId,
      path: "/v1/projects/\(projectId)/property/dossier",
      method: "GET",
      body: nil,
      idempotencyKey: nil,
      permitsNoContent: false,
      permitsNotFound: true
    )
    guard let data = result else { return nil }
    guard let value = try? decoder.decode(C14_6PropertyDossier.self, from: data),
          value.property.projectId == projectId,
          value.isValid
    else { throw C14_6HomeSetupError.invalidResponse }
    return value
  }

  func resolve(
    projectId: String,
    query: String,
    idempotencyKey: String
  ) async throws -> C14_6PropertyResolution {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (3...160).contains(trimmed.count) else {
      throw C14_6HomeSetupError.invalidResponse
    }
    let data = try await required(
      send(
        projectId: projectId,
        path: "/v1/projects/\(projectId)/property/resolutions",
        method: "POST",
        body: try encoder.encode(ResolutionRequest(query: trimmed)),
        idempotencyKey: idempotencyKey,
        permitsNoContent: false,
        permitsNotFound: false
      )
    )
    guard let value = try? decoder.decode(C14_6PropertyResolution.self, from: data), value.isValid
    else { throw C14_6HomeSetupError.invalidResponse }
    return value
  }

  func selectCandidate(
    projectId: String,
    candidateId: String,
    resolutionId: String,
    expectedVersion: Int,
    idempotencyKey: String
  ) async throws -> C14_6ProjectProperty {
    guard UUID(uuidString: candidateId) != nil,
          UUID(uuidString: resolutionId) != nil,
          expectedVersion >= 0
    else { throw C14_6HomeSetupError.invalidResponse }
    return try await select(
      projectId: projectId,
      body: try encoder.encode(
        CandidateRequest(
          candidateId: candidateId,
          expectedVersion: expectedVersion,
          resolutionId: resolutionId
        )
      ),
      idempotencyKey: idempotencyKey
    )
  }

  func selectManual(
    projectId: String,
    address: C14_6PropertyAddress,
    expectedVersion: Int,
    idempotencyKey: String
  ) async throws -> C14_6ProjectProperty {
    guard address.isValid, expectedVersion >= 0 else {
      throw C14_6HomeSetupError.invalidResponse
    }
    return try await select(
      projectId: projectId,
      body: try encoder.encode(ManualRequest(address: address, expectedVersion: expectedVersion)),
      idempotencyKey: idempotencyKey
    )
  }

  private func select(
    projectId: String,
    body: Data,
    idempotencyKey: String
  ) async throws -> C14_6ProjectProperty {
    let data = try await required(
      send(
        projectId: projectId,
        path: "/v1/projects/\(projectId)/property",
        method: "PUT",
        body: body,
        idempotencyKey: idempotencyKey,
        permitsNoContent: false,
        permitsNotFound: false
      )
    )
    guard let value = try? decoder.decode(C14_6ProjectProperty.self, from: data),
          value.projectId == projectId,
          value.isValid
    else { throw C14_6HomeSetupError.invalidResponse }
    return value
  }

  private func send(
    projectId: String,
    path: String,
    method: String,
    body: Data?,
    idempotencyKey: String?,
    permitsNoContent: Bool,
    permitsNotFound: Bool
  ) async throws -> Data? {
    guard UUID(uuidString: projectId) != nil,
          idempotencyKey.map({ UUID(uuidString: $0) != nil }) ?? true
    else { throw C14_6HomeSetupError.invalidResponse }
    for attempt in 0...1 {
      let token: String
      do {
        token = try await tokenProvider.accessToken()
      } catch let error as C14_6AuthenticationError {
        throw error == .offline ? C14_6HomeSetupError.offline : C14_6HomeSetupError.expired
      } catch {
        throw C14_6HomeSetupError.expired
      }
      var request = URLRequest(
        url: baseURL.appendingPathComponent(String(path.dropFirst())),
        cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
        timeoutInterval: 30
      )
      request.httpMethod = method
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
      if let body {
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      }
      if let idempotencyKey {
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
      }
      do {
        let (data, response) = try await transport.data(for: request)
        if response.statusCode == 401, attempt == 0 {
          await tokenProvider.invalidate()
          continue
        }
        if response.statusCode == 204, permitsNoContent { return nil }
        if response.statusCode == 404, permitsNotFound { return nil }
        switch response.statusCode {
        case 200..<300:
          guard data.count <= 2_000_000 else { throw C14_6HomeSetupError.invalidResponse }
          return data
        case 401: throw C14_6HomeSetupError.expired
        case 403, 404: throw C14_6HomeSetupError.forbidden
        case 409: throw C14_6HomeSetupError.stale
        case 410: throw C14_6HomeSetupError.expiredResolution
        case 422: throw C14_6HomeSetupError.rejected
        case 429: throw C14_6HomeSetupError.throttled
        case 500..<600: throw C14_6HomeSetupError.unavailable
        default: throw C14_6HomeSetupError.invalidResponse
        }
      } catch let error as C14_6HomeSetupError {
        throw error
      } catch let error as URLError where error.code == .notConnectedToInternet {
        throw C14_6HomeSetupError.offline
      } catch {
        throw C14_6HomeSetupError.unavailable
      }
    }
    throw C14_6HomeSetupError.expired
  }

  private func required(_ data: Data?) throws -> Data {
    guard let data else { throw C14_6HomeSetupError.invalidResponse }
    return data
  }
}

enum C14_6HomeSetupState: Equatable, Sendable {
  case idle
  case loading
  case ready
  case stale(message: String)
  case expired
  case forbidden
  case failure(message: String)
}

struct C14_6ReadinessSummary: Equatable, Sendable {
  let intakeComplete: Bool
  let propertyContextSelected: Bool
  let readyEvidenceCount: Int
  let readyPlanCount: Int
  let serverVerified: Bool

  var laterPlanProcessingEligible: Bool {
    serverVerified && intakeComplete && propertyContextSelected && readyPlanCount > 0
  }
}

@MainActor
@Observable
final class C14_6HomeSetupModel {
  private(set) var state: C14_6HomeSetupState = .idle
  private(set) var intake: C14_6ProjectIntake?
  private(set) var dossier: C14_6PropertyDossier?
  private(set) var resolution: C14_6PropertyResolution?
  private(set) var evidence: [EvidenceAsset] = []
  private(set) var mutationMessage: String?
  private(set) var isMutating = false

  var accessibilityNeedsText = ""
  var addressSummary = ""
  var bathrooms = 1
  var bathroomsKnown = false
  var bedrooms = 1
  var bedroomsKnown = false
  var dwellingType: C14_6DwellingType = .flat
  var hasPhotographs = false
  var hasPlans = false
  var hasRoomCapture = false
  var hasVideo = false
  var goalsText = ""
  var householdAdults = 1
  var householdChildren = 0
  var householdPets = 0
  var levels = 1
  var levelsKnown = false
  var mustChangeText = ""
  var mustKeepText = ""
  var notes = ""
  var styleWordsText = ""

  var propertyQuery = ""
  var manualLine1 = ""
  var manualLine2 = ""
  var manualLocality = ""
  var manualPostcode = ""

  @ObservationIgnored private let evidenceService: any EvidenceServing
  @ObservationIgnored private let service: any C14_6HomeSetupServing
  @ObservationIgnored private var activationId = UUID()
  @ObservationIgnored private var pendingIntakeBody: C14_6HomeIntake?
  @ObservationIgnored private var pendingIntakeKey: String?
  @ObservationIgnored private var pendingPropertyOperation: String?
  @ObservationIgnored private var pendingPropertyKey: String?
  private var projectId: String?
  private var role = "viewer"

  init(service: any C14_6HomeSetupServing, evidenceService: any EvidenceServing) {
    self.service = service
    self.evidenceService = evidenceService
  }

  var canEdit: Bool { role == "owner" || role == "editor" }
  var canMutate: Bool { canEdit && state == .ready }

  var readiness: C14_6ReadinessSummary {
    let ready = evidence.filter { $0.status == .ready && $0.rights.serviceProcessingConsent }
    return C14_6ReadinessSummary(
      intakeComplete: intake?.intake.goals.isEmpty == false,
      propertyContextSelected: dossier?.property.interiorKnowledgeStatus == "unknown-without-evidence",
      readyEvidenceCount: ready.count,
      readyPlanCount: ready.filter { $0.kind == .plan }.count,
      serverVerified: state == .ready
    )
  }

  var currentPropertyVersion: Int { dossier?.property.version ?? 0 }

  func activate(projectId: String, role: String, force: Bool = false) async {
    guard UUID(uuidString: projectId) != nil else {
      state = .failure(message: "The selected project identifier is invalid.")
      return
    }
    if self.projectId == projectId, state == .ready, !force { return }
    self.projectId = projectId
    self.role = role
    let requestId = UUID()
    activationId = requestId
    state = .loading
    mutationMessage = nil
    do {
      let loadedIntake = try await service.intake(projectId: projectId)
      let loadedDossier = try await service.dossier(projectId: projectId)
      let loadedEvidence = try await evidenceService.list(projectId: projectId)
      guard requestId == activationId, self.projectId == projectId else { return }
      intake = loadedIntake
      dossier = loadedDossier
      evidence = loadedEvidence
      populateDraft(loadedIntake?.intake ?? .empty)
      state = .ready
    } catch {
      guard requestId == activationId, self.projectId == projectId else { return }
      handle(error, retainsVerifiedState: intake != nil || dossier != nil || !evidence.isEmpty)
    }
  }

  func reset() {
    activationId = UUID()
    projectId = nil
    role = "viewer"
    intake = nil
    dossier = nil
    resolution = nil
    evidence = []
    mutationMessage = nil
    state = .idle
    populateDraft(.empty)
  }

  func saveIntake() async {
    guard let projectId, canMutate, !isMutating else { return }
    let draft = buildIntake()
    guard draft.isValid else {
      mutationMessage = "Add at least one goal and keep every list item within 120 characters before saving."
      return
    }
    if pendingIntakeBody != draft || pendingIntakeKey == nil {
      pendingIntakeBody = draft
      pendingIntakeKey = UUID().uuidString
    }
    guard let idempotencyKey = pendingIntakeKey else { return }
    isMutating = true
    mutationMessage = nil
    defer { isMutating = false }
    do {
      let saved = try await service.saveIntake(
        projectId: projectId,
        intake: draft,
        expectedVersion: intake?.version ?? 0,
        idempotencyKey: idempotencyKey
      )
      guard self.projectId == projectId else { return }
      intake = saved
      pendingIntakeBody = nil
      pendingIntakeKey = nil
      mutationMessage = "Renovation intake version \(saved.version) saved with server provenance."
      state = .ready
    } catch {
      handleMutation(error)
    }
  }

  func resolveProperty() async {
    guard let projectId, canMutate, !isMutating else { return }
    let query = propertyQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (3...160).contains(query.count) else {
      mutationMessage = "Enter at least three characters of an England address or postcode."
      return
    }
    let operation = "resolve:\(query)"
    let key = mutationKey(for: operation)
    isMutating = true
    mutationMessage = nil
    defer { isMutating = false }
    do {
      let value = try await service.resolve(
        projectId: projectId,
        query: query,
        idempotencyKey: key
      )
      guard self.projectId == projectId else { return }
      resolution = value
      pendingPropertyOperation = nil
      pendingPropertyKey = nil
      switch value.status {
      case "no-match":
        mutationMessage = "No property identity matched. Nothing was selected; manual entry remains available."
      case "unavailable":
        mutationMessage = value.providerState == "disabled"
          ? "Address lookup is disabled. No result was substituted; enter the address manually."
          : "Address lookup is unavailable. No result was substituted; retry or enter it manually."
      case "ambiguous":
        mutationMessage = "More than one identity matched. Choose one; the app will not guess."
      default:
        mutationMessage = "Review the matched identity and its source before selecting it."
      }
    } catch {
      handleMutation(error)
    }
  }

  func selectCandidate(_ candidate: C14_6PropertyCandidate) async {
    guard let projectId, let resolution, canMutate, !isMutating,
          resolution.candidates.contains(where: { $0.candidateId == candidate.candidateId }),
          candidate.jurisdiction == "england"
    else { return }
    guard (C14_6ContractValidation.date(resolution.expiresAt)?.timeIntervalSinceNow ?? 0) > 0 else {
      mutationMessage = "This address resolution expired. Search again before selecting a property."
      return
    }
    let operation = "candidate:\(resolution.resolutionId):\(candidate.candidateId):\(currentPropertyVersion)"
    let key = mutationKey(for: operation)
    isMutating = true
    mutationMessage = nil
    defer { isMutating = false }
    do {
      _ = try await service.selectCandidate(
        projectId: projectId,
        candidateId: candidate.candidateId,
        resolutionId: resolution.resolutionId,
        expectedVersion: currentPropertyVersion,
        idempotencyKey: key
      )
      pendingPropertyOperation = nil
      pendingPropertyKey = nil
      await reloadAfterPropertySelection(projectId: projectId)
    } catch {
      handleMutation(error)
    }
  }

  func selectManual() async {
    guard let projectId, canMutate, !isMutating else { return }
    let postcode = Self.normalisedPostcode(manualPostcode)
    guard !manualLine1.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          Self.validEnglandPostcode(postcode)
    else {
      mutationMessage = "Enter address line 1 and a valid England-format postcode. No UPRN or coordinate will be invented."
      return
    }
    let address = C14_6PropertyAddress(
      line1: manualLine1.trimmingCharacters(in: .whitespacesAndNewlines),
      line2: optional(manualLine2),
      locality: optional(manualLocality),
      postcode: postcode
    )
    guard address.isValid else {
      mutationMessage = "The manual address exceeds the frozen C3 field limits."
      return
    }
    let operation = "manual:\(address.displayValue):\(currentPropertyVersion)"
    let key = mutationKey(for: operation)
    isMutating = true
    mutationMessage = nil
    defer { isMutating = false }
    do {
      _ = try await service.selectManual(
        projectId: projectId,
        address: address,
        expectedVersion: currentPropertyVersion,
        idempotencyKey: key
      )
      pendingPropertyOperation = nil
      pendingPropertyKey = nil
      await reloadAfterPropertySelection(projectId: projectId)
    } catch {
      handleMutation(error)
    }
  }

  private func reloadAfterPropertySelection(projectId: String) async {
    do {
      let value = try await service.dossier(projectId: projectId)
      guard self.projectId == projectId else { return }
      dossier = value
      resolution = nil
      mutationMessage = "Property context saved. Its address and source metadata are not interior geometry, a boundary or a survey."
      state = .ready
    } catch {
      handleMutation(error)
    }
  }

  private func mutationKey(for operation: String) -> String {
    if pendingPropertyOperation != operation || pendingPropertyKey == nil {
      pendingPropertyOperation = operation
      pendingPropertyKey = UUID().uuidString
    }
    return pendingPropertyKey ?? UUID().uuidString
  }

  private func buildIntake() -> C14_6HomeIntake {
    C14_6HomeIntake(
      accessibilityNeeds: lines(accessibilityNeedsText),
      addressSummary: optional(addressSummary),
      bathrooms: bathroomsKnown ? bathrooms : nil,
      bedrooms: bedroomsKnown ? bedrooms : nil,
      dwellingType: dwellingType,
      evidenceAvailable: C14_6EvidenceAvailable(
        photographs: hasPhotographs,
        plans: hasPlans,
        roomCapture: hasRoomCapture,
        video: hasVideo
      ),
      goals: lines(goalsText),
      household: C14_6Household(
        adults: householdAdults,
        children: householdChildren,
        pets: householdPets
      ),
      levels: levelsKnown ? levels : nil,
      mustChange: lines(mustChangeText),
      mustKeep: lines(mustKeepText),
      notes: optional(notes),
      styleWords: lines(styleWordsText)
    )
  }

  private func populateDraft(_ value: C14_6HomeIntake) {
    accessibilityNeedsText = value.accessibilityNeeds.joined(separator: "\n")
    addressSummary = value.addressSummary ?? ""
    bathrooms = value.bathrooms ?? 1
    bathroomsKnown = value.bathrooms != nil
    bedrooms = value.bedrooms ?? 1
    bedroomsKnown = value.bedrooms != nil
    dwellingType = value.dwellingType
    hasPhotographs = value.evidenceAvailable.photographs
    hasPlans = value.evidenceAvailable.plans
    hasRoomCapture = value.evidenceAvailable.roomCapture
    hasVideo = value.evidenceAvailable.video
    goalsText = value.goals.joined(separator: "\n")
    householdAdults = value.household.adults
    householdChildren = value.household.children
    householdPets = value.household.pets
    levels = value.levels ?? 1
    levelsKnown = value.levels != nil
    mustChangeText = value.mustChange.joined(separator: "\n")
    mustKeepText = value.mustKeep.joined(separator: "\n")
    notes = value.notes ?? ""
    styleWordsText = value.styleWords.joined(separator: "\n")
  }

  private func lines(_ value: String) -> [String] {
    value.split(separator: "\n", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
  }

  private func optional(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func handleMutation(_ error: Error) {
    switch error as? C14_6HomeSetupError {
    case .stale:
      mutationMessage = "A newer version was saved elsewhere. Reload before retrying this exact change."
    case .expiredResolution:
      resolution = nil
      mutationMessage = "The address resolution expired. Search again; no property was selected."
    case .rejected:
      mutationMessage = "The server rejected this bounded setup value. Review it before retrying."
    case .throttled:
      mutationMessage = "Too many setup requests were received. Nothing was changed; wait and retry."
    case .offline:
      mutationMessage = "You’re offline. Nothing was submitted; retry uses the same exact-operation idempotency key."
    case .expired:
      state = .expired
    case .forbidden:
      state = .forbidden
    case .invalidResponse:
      mutationMessage = "The response failed the frozen C1/C3 contract and was not accepted."
    case .unavailable, .none:
      mutationMessage = "The service is unavailable. Nothing was inferred or committed locally."
    }
  }

  private func handle(_ error: Error, retainsVerifiedState: Bool) {
    if let evidenceError = error as? EvidenceServiceError {
      switch evidenceError {
      case .offline:
        state = retainsVerifiedState
          ? .stale(message: "Offline. Previously verified setup remains display-only and cannot unlock processing.")
          : .failure(message: "Reconnect to load evidence readiness.")
      case .expired: state = .expired
      case .forbidden: state = .forbidden
      default: state = .failure(message: "Evidence readiness could not be verified.")
      }
      return
    }
    switch error as? C14_6HomeSetupError {
    case .offline:
      state = retainsVerifiedState
        ? .stale(message: "Offline. Previously verified setup remains display-only and cannot unlock processing.")
        : .failure(message: "Reconnect to load the authorised home setup.")
    case .expired: state = .expired
    case .forbidden: state = .forbidden
    case .stale: state = .failure(message: "The setup changed elsewhere. Reload it before continuing.")
    case .expiredResolution:
      state = .failure(message: "The saved address resolution expired. Search again before selecting it.")
    case .rejected:
      state = .failure(message: "The setup request was rejected by the server contract.")
    case .throttled:
      state = .failure(message: "Setup requests are temporarily rate limited. Wait and try again.")
    case .invalidResponse: state = .failure(message: "The service response failed the frozen C1/C3 contract.")
    case .unavailable, .none: state = .failure(message: "The home setup service is unavailable. Try again.")
    }
  }

  static func normalisedPostcode(_ value: String) -> String {
    let compact = value.uppercased().filter { !$0.isWhitespace }
    guard compact.count > 3 else { return compact }
    return "\(compact.dropLast(3)) \(compact.suffix(3))"
  }

  static func validEnglandPostcode(_ value: String) -> Bool {
    value.range(
      of: "^(GIR 0AA|[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2})$",
      options: .regularExpression
    ) != nil
  }
}

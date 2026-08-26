import Foundation

enum C14_7JSONValue: Codable, Equatable, Sendable {
  case array([C14_7JSONValue])
  case bool(Bool)
  case null
  case number(Double)
  case object([String: C14_7JSONValue])
  case string(String)

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode([C14_7JSONValue].self) { self = .array(value) }
    else { self = .object(try container.decode([String: C14_7JSONValue].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .array(let value): try container.encode(value)
    case .bool(let value): try container.encode(value)
    case .null: try container.encodeNil()
    case .number(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    }
  }

  var objectValue: [String: C14_7JSONValue]? {
    guard case .object(let value) = self else { return nil }
    return value
  }
}

struct C14_7PlanJob: Codable, Equatable, Identifiable, Sendable {
  let assetId: UUID
  let id: UUID
  let projectId: UUID
  let resultId: UUID?
  let retryable: Bool
  let safeCode: String?
  let sourceSha256: String
  let state: String
  let version: Int
}

struct C14_7PlanJobsResponse: Codable, Sendable { let jobs: [C14_7PlanJob] }

struct C14_7SourcePoint: Codable, Equatable, Sendable {
  var x: Int
  var y: Int
}

struct C14_7PlanParser: Codable, Equatable, Sendable {
  let adapterId: String
  let adapterVersion: String
  let manifestSha256: String
  let mode: String
}

struct C14_7PlanSourceRights: Codable, Equatable, Sendable {
  let basis: EvidenceRightsBasis
  let serviceProcessingConsent: Bool
  let trainingUseConsent: TrainingUseConsent
}

struct C14_7PlanSource: Codable, Equatable, Sendable {
  let assetId: UUID
  let byteSize: Int64
  let coordinateSpace: String
  let detectedMimeType: String
  let heightSourceUnits: Int
  let pageIndex: Int
  let projectId: UUID
  let rights: C14_7PlanSourceRights
  let sha256: String
  let widthSourceUnits: Int

  var isValid: Bool {
    byteSize > 0 && byteSize <= EvidenceFileSupport.maximumBytes
      && ["pdf-micropoints", "svg-microunits", "pixels", "fixture-microunits"].contains(coordinateSpace)
      && EvidenceKind.plan.allowedMIMETypes.contains(detectedMimeType)
      && heightSourceUnits > 0 && widthSourceUnits > 0 && pageIndex >= 0
      && rights.serviceProcessingConsent && rights.trainingUseConsent == .denied
      && C14_5ContractValidator.sha256(sha256)
  }
}

struct C14_7PlanFinding: Codable, Equatable, Identifiable, Sendable {
  let code: String
  let message: String
  let severity: String
  var id: String { code }
}

struct C14_7PlanCandidate: Codable, Equatable, Identifiable, Sendable {
  let boundaryWallCandidateIds: [UUID]?
  let candidateId: UUID
  let confidence: Int
  let elevationMillimetres: Int?
  let end: C14_7SourcePoint?
  let headHeightMillimetres: Int?
  let heightMillimetres: Int?
  let hostWallCandidateId: UUID?
  let kind: String
  let levelCandidateId: UUID?
  let openingKind: String?
  let sillHeightMillimetres: Int?
  let start: C14_7SourcePoint?
  let suggestedName: String?
  let thicknessMillimetres: Int?

  var id: UUID { candidateId }

  func isValid() -> Bool {
    guard (0...100).contains(confidence), ["level", "wall", "opening", "space"].contains(kind)
    else { return false }
    switch kind {
    case "level": return elevationMillimetres != nil && suggestedName?.isEmpty == false
    case "wall":
      return levelCandidateId != nil && start != nil && end != nil && start != end
    case "opening":
      return levelCandidateId != nil && hostWallCandidateId != nil && start != nil && end != nil
        && start != end && ["door", "window", "unknown"].contains(openingKind ?? "")
    case "space":
      return levelCandidateId != nil && (boundaryWallCandidateIds?.count ?? 0) >= 3
        && suggestedName?.isEmpty == false
    default: return false
    }
  }
}

struct C14_7PlanProposal: Codable, Equatable, Sendable {
  let candidates: [C14_7PlanCandidate]?
  let code: String?
  let detail: String?
  let findings: [C14_7PlanFinding]
  let jobId: UUID
  let overallConfidence: Int?
  let parser: C14_7PlanParser
  let projectId: UUID
  let proposalId: UUID
  let retryable: Bool?
  let source: C14_7PlanSource
  let status: String

  var isValid: Bool {
    guard ["proposal", "abstained"].contains(status), source.projectId == projectId,
          source.isValid, C14_5ContractValidator.sha256(parser.manifestSha256),
          ["deterministic-vector", "deterministic-raster", "deterministic-fixture"].contains(parser.mode)
    else {
      return false
    }
    if status == "abstained" { return code != nil && detail?.isEmpty == false }
    let values = candidates ?? []
    return (overallConfidence ?? -1) >= 75 && !values.isEmpty && values.count <= 200
      && Set(values.map(\.candidateId)).count == values.count && values.allSatisfy { $0.isValid() }
  }
}

struct C14_7AffineTransform: Codable, Equatable, Sendable {
  let a: Int
  let b: Int
  let c: Int
  let d: Int
  let denominator: Int
  let rounding: String
  let translateXMillimetres: Int
  let translateYMillimetres: Int
}

struct C14_7PlanCalibration: Codable, Equatable, Sendable {
  let id: UUID
  let jobId: UUID
  let projectId: UUID
  let proposalId: UUID
  let residualMillimetres: Int
  let sourceToModel: C14_7AffineTransform
}

enum C14_7CandidateDecision: String, CaseIterable, Codable, Sendable {
  case accepted
  case corrected
  case excluded
  case unresolved
}

struct C14_7CandidateReview: Equatable, Sendable {
  var decision: C14_7CandidateDecision = .unresolved
  var end = C14_7SourcePoint(x: 0, y: 0)
  var elevationMillimetres = 0
  var heightMillimetres: Int?
  var name = ""
  var openingKind = "unknown"
  var sillHeightMillimetres: Int?
  var start = C14_7SourcePoint(x: 0, y: 0)
  var thicknessMillimetres: Int?
  var widthMillimetres = 1

  static func initial(_ candidate: C14_7PlanCandidate) -> Self {
    let width: Int
    if let start = candidate.start, let end = candidate.end {
      let distance = hypot(Double(end.x - start.x), Double(end.y - start.y))
      width = max(1, Int(distance.rounded()))
    } else {
      width = 1
    }
    return .init(
      decision: .unresolved,
      end: candidate.end ?? .init(x: 0, y: 0),
      elevationMillimetres: candidate.elevationMillimetres ?? 0,
      heightMillimetres: candidate.heightMillimetres,
      name: candidate.suggestedName ?? "",
      openingKind: candidate.openingKind ?? "unknown",
      sillHeightMillimetres: candidate.sillHeightMillimetres,
      start: candidate.start ?? .init(x: 0, y: 0),
      thicknessMillimetres: candidate.thicknessMillimetres,
      widthMillimetres: width
    )
  }
}

struct C14_7PlanDraftTarget: Codable, Equatable, Sendable {
  let branchId: UUID
  let expectedHeadSnapshotSha256: String
  let expectedRevision: Int
  let profile: String
}

struct C14_7PlanDraft: Codable, Equatable, Sendable {
  let calibrationId: UUID
  let jobId: UUID
  let operations: [C14_7JSONValue]
  let projectId: UUID
  let proposalId: UUID
  let schemaVersion: String
  let target: C14_7PlanDraftTarget
}

struct C14_7ReconstructionJob: Codable, Equatable, Identifiable, Sendable {
  let id: UUID
  let projectId: UUID
  let resultId: UUID?
  let retryable: Bool
  let safeCode: String?
  let state: String
  let version: Int
}

struct C14_7ReconstructionJobsResponse: Codable, Sendable {
  let jobs: [C14_7ReconstructionJob]
}

struct C14_7GeometryResult: Codable, Equatable, Sendable {
  let componentCount: Int
  let inputFrameCount: Int
  let registeredFrameCount: Int
  let scaleStatus: String
  let unit: String
}

struct C14_7AppearanceResult: Codable, Equatable, Sendable {
  let geometryManifestSha256: String
  let method: String
}

struct C14_7ReconstructionResult: Codable, Equatable, Sendable {
  let appearance: C14_7AppearanceResult?
  let findings: [String]
  let geometry: C14_7GeometryResult?
  let jobId: UUID
  let projectId: UUID
  let resultId: UUID
  let safeCode: String?
  let status: String
}

struct C14_7FusionSource: Codable, Equatable, Identifiable, Sendable {
  let coordinateFrame: String
  let elementCount: Int
  let evidenceState: String
  let id: UUID
  let kind: String
  let referenceId: UUID
  let rights: C14_7FusionRights
  let scaleStatus: String
  let schemaVersion: String
  let sha256: String

  var isValid: Bool {
    ["plan-proposal", "roomplan-proposal", "reconstruction-result"].contains(kind)
      && ["project-local", "source-local-metric", "source-local-arbitrary"].contains(coordinateFrame)
      && ["metric-validated", "metric-estimated", "unknown"].contains(scaleStatus)
      && evidenceState == "source-derived" && elementCount >= 0
      && rights.serviceProcessingConsent && rights.trainingUseConsent == "denied"
      && C14_5ContractValidator.sha256(sha256)
  }
}

struct C14_7FusionRights: Codable, Equatable, Sendable {
  let serviceProcessingConsent: Bool
  let trainingUseConsent: String
}

struct C14_7FusionSourcesResponse: Codable, Sendable { let sources: [C14_7FusionSource] }

struct C14_7FusionPoint: Codable, Equatable, Sendable {
  var xMm: Int
  var yMm: Int
  var zMm: Int
}

struct C14_7FusionAnchor: Codable, Equatable, Identifiable, Sendable {
  var anchorId = UUID()
  var projectPoint = C14_7FusionPoint(xMm: 0, yMm: 0, zMm: 0)
  var sourcePoint = C14_7FusionPoint(xMm: 0, yMm: 0, zMm: 0)
  var id: UUID { anchorId }
}

struct C14_7FusionJob: Codable, Equatable, Identifiable, Sendable {
  let id: UUID
  let projectId: UUID
  let proposalId: UUID?
  let safeCode: String?
  let state: String
  let version: Int
}

struct C14_7FusionJobsResponse: Codable, Sendable { let jobs: [C14_7FusionJob] }

struct C14_7FusionClaim: Codable, Equatable, Sendable { let sourceId: UUID }

struct C14_7FusionDiscrepancy: Codable, Equatable, Identifiable, Sendable {
  let code: String
  let id: UUID
  let kind: String
  let message: String
  let requiresHumanDecision: Bool
  let severity: String
  let sourceClaims: [C14_7FusionClaim]
  let suggestedOperations: [C14_7JSONValue]
}

struct C14_7FusionBase: Codable, Equatable, Sendable {
  let modelId: UUID
  let profile: String
  let snapshotId: UUID
  let snapshotSha256: String
}

struct C14_7FusionProposal: Codable, Equatable, Sendable {
  let authority: String
  let baseSnapshot: C14_7FusionBase
  let discrepancies: [C14_7FusionDiscrepancy]
  let id: UUID
  let projectId: UUID
  let safeCode: String?
  let status: String
  let version: Int

  var isValid: Bool {
    authority == "proposal-only"
      && ["full-house-proposal", "partial-proposal", "abstained"].contains(status)
      && baseSnapshot.profile == "existing"
      && discrepancies.count <= 10_000
      && Set(discrepancies.map(\.id)).count == discrepancies.count
      && discrepancies.allSatisfy { $0.requiresHumanDecision }
  }
}

enum C14_7FusionDecisionChoice: String, CaseIterable, Codable, Sendable {
  case acceptCandidate = "accept-candidate"
  case keepBase = "keep-base"
  case markUnknown = "mark-unknown"
  case deferred = "defer"
}

struct C14_7FusionDecisionRecord: Codable, Equatable, Identifiable, Sendable {
  let discrepancyId: UUID
  let id: UUID
}

struct C14_7FusionReviewResponse: Codable, Sendable {
  let decisions: [C14_7FusionDecisionRecord]
  let proposal: C14_7FusionProposal
}

struct C14_7FusionDraft: Codable, Equatable, Sendable {
  let baseSnapshot: C14_7FusionBase
  let branchId: UUID
  let decisionIds: [UUID]
  let expectedBranchRevision: Int
  let expectedHeadSnapshotSha256: String
  let operations: [C14_7JSONValue]
  let projectId: UUID
  let proposalId: UUID
  let schemaVersion: String
}

struct C14_7PreviewFinding: Codable, Equatable, Identifiable, Sendable {
  let code: String
  let message: String
  let severity: String
  var id: String { code + message }
}

struct C14_7OperationsPreview: Codable, Equatable, Sendable {
  let baseHeadSnapshotSha256: String
  let baseRevision: Int
  let branchId: UUID
  let expiresAt: String
  let findings: [C14_7PreviewFinding]
  let hasBlockingFindings: Bool
  let id: UUID
  let operations: [C14_7JSONValue]
  let projectId: UUID
  let resultSnapshotSha256: String
}

struct C14_7ModelCommit: Codable, Equatable, Sendable {
  let branchId: UUID
  let id: UUID
  let revision: Int
  let snapshotId: UUID
  let snapshotSha256: String
}

struct C14_7CommitResponse: Codable, Equatable, Sendable {
  let branch: C14_5Branch
  let commit: C14_7ModelCommit
  let findings: [C14_7PreviewFinding]
}

struct C14_7Workspace: Equatable, Sendable {
  let assets: [EvidenceAsset]
  let branches: [C14_5Branch]
  let fusionJobs: [C14_7FusionJob]
  let fusionSources: [C14_7FusionSource]
  let planJobs: [C14_7PlanJob]
  let reconstructionJobs: [C14_7ReconstructionJob]
  let sceneJobs: [C14_5SceneJob]
  let session: C14_5Session
  let snapshot: C14_5Snapshot?

  var branch: C14_5Branch? {
    guard let snapshot else { return nil }
    return branches.first {
      $0.projectId == snapshot.projectId && $0.modelId == snapshot.modelId
        && $0.profile == "existing" && $0.headSnapshotId == snapshot.id
        && $0.headSnapshotSha256 == snapshot.snapshotSha256
    }
  }

  var exactSucceededScene: C14_5SceneJob? {
    guard let snapshot, let branch, branch.revision > 0,
          branch.headSnapshotId != branch.sourceSnapshotId else { return nil }
    return sceneJobs.first {
      $0.state == "succeeded" && $0.sceneId != nil && $0.projectId == snapshot.projectId
        && $0.request.sourceSnapshot.snapshotId == snapshot.id
        && $0.request.sourceSnapshot.snapshotSha256 == snapshot.snapshotSha256
    }
  }
}

enum C14_7ContractValidator {
  static func validate(_ workspace: C14_7Workspace, projectId: UUID) throws {
    guard C14_6ContractValidation.date(workspace.session.expiresAt) != nil,
          workspace.branches.count <= 100,
          workspace.planJobs.count <= 100,
          workspace.reconstructionJobs.count <= 100,
          workspace.fusionJobs.count <= 100,
          workspace.fusionSources.count <= 32,
          workspace.sceneJobs.count <= 100,
          workspace.assets.count <= 10_000,
          Set(workspace.assets.map(\.id)).count == workspace.assets.count,
          Set(workspace.planJobs.map(\.id)).count == workspace.planJobs.count,
          Set(workspace.reconstructionJobs.map(\.id)).count == workspace.reconstructionJobs.count,
          Set(workspace.fusionJobs.map(\.id)).count == workspace.fusionJobs.count,
          Set(workspace.fusionSources.map(\.id)).count == workspace.fusionSources.count,
          Set(workspace.branches.map(\.id)).count == workspace.branches.count,
          Set(workspace.sceneJobs.map(\.id)).count == workspace.sceneJobs.count,
          workspace.assets.allSatisfy({ $0.isValid(for: projectId.uuidString) }),
          workspace.planJobs.allSatisfy({
            $0.projectId == projectId && $0.version > 0
              && ["queued", "processing", "proposed", "abstained", "cancel-requested", "cancelled", "failed"].contains($0.state)
              && ($0.state == "proposed" ? $0.resultId != nil : true)
              && C14_5ContractValidator.sha256($0.sourceSha256)
          }),
          workspace.reconstructionJobs.allSatisfy({
            $0.projectId == projectId && $0.version > 0
              && ["created", "preparing", "ready-for-reconstruction", "reconstructing-geometry", "reconstructing-appearance", "completed", "abstained", "cancel-requested", "cancelled", "failed"].contains($0.state)
          }),
          workspace.fusionJobs.allSatisfy({
            $0.projectId == projectId && $0.version > 0
              && ["queued", "registering", "fitting", "comparing", "proposed", "abstained", "cancel-requested", "cancelled", "failed"].contains($0.state)
          }),
          workspace.fusionSources.allSatisfy({ $0.isValid }),
          workspace.branches.allSatisfy({ $0.projectId == projectId }),
          workspace.sceneJobs.allSatisfy({ $0.projectId == projectId }),
          workspace.snapshot.map({
            $0.projectId == projectId && $0.profile == "existing"
              && C14_5ContractValidator.sha256($0.snapshotSha256)
          }) ?? true
    else { throw C14_5DesignStudioError.invalidResponse }
  }
}

import CryptoKit
import Foundation

struct C14_7PlanCandidateDecisionBody: Codable, Equatable, Sendable {
  let candidateId: UUID
  let decision: C14_7CandidateDecision
  let resultingClientOperationIds: [UUID]
}

struct C14_7PlanDraftInput: Equatable, Sendable {
  let decisions: [C14_7PlanCandidateDecisionBody]
  let operations: [C14_7JSONValue]
}

enum C14_7PlanOperationBuilderError: Error, Equatable, Sendable {
  case disconnectedBoundary
  case invalidCalibration
  case invalidCandidate
  case missingHost
  case noAcceptedOperations
  case unresolvedCandidates
}

enum C14_7PlanOperationBuilder {
  static func calibrationBody(
    knownLengthMillimetres: Int,
    sourceStart: C14_7SourcePoint,
    sourceEnd: C14_7SourcePoint
  ) throws -> C14_7JSONValue {
    guard (1...1_000_000).contains(knownLengthMillimetres),
          sourceStart.isValid, sourceEnd.isValid, sourceStart != sourceEnd else {
      throw C14_7PlanOperationBuilderError.invalidCalibration
    }
    let distance = max(1, Int(hypot(
      Double(sourceEnd.x - sourceStart.x),
      Double(sourceEnd.y - sourceStart.y)
    ).rounded()))
    let divisor = gcd(knownLengthMillimetres, distance)
    let numerator = knownLengthMillimetres / divisor
    let denominator = distance / divisor
    guard numerator <= 1_000_000, denominator <= 1_000_000 else {
      throw C14_7PlanOperationBuilderError.invalidCalibration
    }
    return .object([
      "evidence": .object([
        "knownLengthMillimetres": .number(Double(knownLengthMillimetres)),
        "method": .string("known-length"),
        "sourceEnd": point(sourceEnd),
        "sourceStart": point(sourceStart),
      ]),
      "sourceToModel": .object([
        "a": .number(Double(numerator)), "b": .number(0),
        "c": .number(0), "d": .number(Double(numerator)),
        "denominator": .number(Double(denominator)),
        "rounding": .string("half-away-from-zero"),
        "translateXMillimetres": .number(0),
        "translateYMillimetres": .number(0),
      ]),
    ])
  }

  static func build(
    proposal: C14_7PlanProposal,
    calibration: C14_7PlanCalibration,
    actorUserId: UUID,
    reviews: [UUID: C14_7CandidateReview]
  ) throws -> C14_7PlanDraftInput {
    guard proposal.status == "proposal", proposal.isValid, calibration.isValid,
          calibration.projectId == proposal.projectId,
          calibration.jobId == proposal.jobId,
          calibration.proposalId == proposal.proposalId,
          let candidates = proposal.candidates,
          candidates.allSatisfy({ reviews[$0.id]?.decision != .unresolved })
    else { throw C14_7PlanOperationBuilderError.unresolvedCandidates }
    let byId = Dictionary(uniqueKeysWithValues: candidates.map { ($0.id, $0) })
    let ordered = candidates.sorted {
      rank($0.kind) == rank($1.kind) ? $0.id.uuidString < $1.id.uuidString
        : rank($0.kind) < rank($1.kind)
    }
    var operationsByCandidate: [UUID: (UUID, C14_7JSONValue)] = [:]
    for candidate in ordered {
      guard let review = reviews[candidate.id] else {
        throw C14_7PlanOperationBuilderError.unresolvedCandidates
      }
      guard review.decision == .accepted || review.decision == .corrected else { continue }
      let operationId = deterministicUuid([
        proposal.proposalId.uuidString,
        calibration.id.uuidString,
        actorUserId.uuidString,
        candidate.id.uuidString,
        reviewFingerprint(review),
      ] + dependentReviewFingerprints(candidate: candidate, reviews: reviews))
      let attribution = attribution(
        proposal: proposal,
        actorUserId: actorUserId,
        corrected: review.decision == .corrected,
        claimId: deterministicUuid([operationId.uuidString, "known-attribution"])
      )
      let operation = try operation(
        candidate: candidate,
        review: review,
        operationId: operationId,
        attribution: attribution,
        calibration: calibration,
        candidates: byId,
        reviews: reviews
      )
      operationsByCandidate[candidate.id] = (operationId, operation)
    }
    guard !operationsByCandidate.isEmpty else {
      throw C14_7PlanOperationBuilderError.noAcceptedOperations
    }
    return C14_7PlanDraftInput(
      decisions: candidates.map { candidate in
        let decision = reviews[candidate.id]?.decision ?? .unresolved
        return .init(
          candidateId: candidate.id,
          decision: decision,
          resultingClientOperationIds: operationsByCandidate[candidate.id].map { [$0.0] } ?? []
        )
      },
      operations: ordered.compactMap { operationsByCandidate[$0.id]?.1 }
    )
  }

  private static func operation(
    candidate: C14_7PlanCandidate,
    review: C14_7CandidateReview,
    operationId: UUID,
    attribution: C14_7JSONValue,
    calibration: C14_7PlanCalibration,
    candidates: [UUID: C14_7PlanCandidate],
    reviews: [UUID: C14_7CandidateReview]
  ) throws -> C14_7JSONValue {
    let corrected = review.decision == .corrected
    let reason: C14_7JSONValue = .string(
      "\(corrected ? "Correct" : "Accept") \(candidate.kind) candidate \(candidate.id.uuidString) from the pinned C6 proposal."
    )
    let core: [String: C14_7JSONValue] = [
      "clientOperationId": .string(operationId.uuidString.lowercased()),
      "reason": reason,
      "schemaVersion": .string("c5-model-operation-v1"),
    ]
    switch candidate.kind {
    case "level":
      guard let elevation = candidate.elevationMillimetres, let name = candidate.suggestedName else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      let resolvedElevation = corrected ? review.elevationMillimetres : elevation
      let resolvedName = corrected ? review.name : name
      guard (-10_000_000...10_000_000).contains(resolvedElevation), boundedName(resolvedName) else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      return .object(core.merging([
        "type": .string("level.create.v1"),
        "level": .object([
          "elementType": .string("level"),
          "elevationMm": known(.number(Double(resolvedElevation)), attribution),
          "id": .string(candidate.id.uuidString.lowercased()),
          "name": known(.string(resolvedName), attribution),
          "origin": attribution,
          "storeyHeightMm": unknown("not-provided", operationId, "level-storey-height"),
        ]),
      ], uniquingKeysWith: { _, new in new }))
    case "wall":
      guard let levelId = candidate.levelCandidateId,
            isIncluded(levelId, reviews: reviews),
            let candidateStart = candidate.start, let candidateEnd = candidate.end else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      let start = corrected ? review.start : candidateStart
      let end = corrected ? review.end : candidateEnd
      let height = corrected ? review.heightMillimetres : candidate.heightMillimetres
      let thickness = corrected ? review.thicknessMillimetres : candidate.thicknessMillimetres
      guard start.isValid, end.isValid, start != end,
            boundedOptionalPositive(height), boundedOptionalPositive(thickness) else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      return .object(core.merging([
        "type": .string("wall.create.v1"),
        "wall": .object([
          "alignment": .string("centre"),
          "baseOffsetMm": unknown("not-provided", operationId, "wall-base-offset"),
          "elementType": .string("wall"),
          "heightMm": height.map { known(.number(Double($0)), attribution) }
            ?? unknown("not-provided", operationId, "wall-height"),
          "id": .string(candidate.id.uuidString.lowercased()),
          "levelId": .string(levelId.uuidString.lowercased()),
          "name": known(.string("Wall \(candidate.id.uuidString.prefix(8))"), attribution),
          "origin": attribution,
          "path": known(.array([
            modelPoint(start, transform: calibration.sourceToModel),
            modelPoint(end, transform: calibration.sourceToModel),
          ]), attribution),
          "thicknessMm": thickness.map { known(.number(Double($0)), attribution) }
            ?? unknown("not-provided", operationId, "wall-thickness"),
        ]),
      ], uniquingKeysWith: { _, new in new }))
    case "opening":
      guard let levelId = candidate.levelCandidateId,
            isIncluded(levelId, reviews: reviews),
            let hostId = candidate.hostWallCandidateId,
            let host = candidates[hostId], let hostStart = host.start, let hostEnd = host.end,
            let hostReview = reviews[hostId], isIncluded(hostId, reviews: reviews),
            let sourceStart = candidate.start, let sourceEnd = candidate.end else {
        throw C14_7PlanOperationBuilderError.missingHost
      }
      guard corrected || hostReview.decision != .corrected else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      let resolvedHostStart = hostReview.decision == .corrected ? hostReview.start : hostStart
      let resolvedHostEnd = hostReview.decision == .corrected ? hostReview.end : hostEnd
      guard resolvedHostStart.isValid, resolvedHostEnd.isValid,
            resolvedHostStart != resolvedHostEnd else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      let width = corrected
        ? review.widthMillimetres
        : mappedDistance(sourceStart, sourceEnd, transform: calibration.sourceToModel)
      let sourceHeight = candidate.headHeightMillimetres.flatMap { head in
        candidate.sillHeightMillimetres.map { head - $0 }
      }
      let height = corrected ? review.heightMillimetres : sourceHeight
      let sill = corrected ? review.sillHeightMillimetres : candidate.sillHeightMillimetres
      let rawKind = corrected ? review.openingKind : (candidate.openingKind ?? "unknown")
      guard (1...1_000_000).contains(width), boundedOptionalPositive(height),
            sill.map({ (0...1_000_000).contains($0) }) ?? true,
            ["door", "window", "unknown"].contains(rawKind) else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      return .object(core.merging([
        "type": .string("opening.insert.v1"),
        "opening": .object([
          "elementType": .string("opening"),
          "heightMm": height.flatMap { $0 > 0 ? $0 : nil }.map {
            known(.number(Double($0)), attribution)
          } ?? unknown("not-provided", operationId, "opening-height"),
          "hostWallId": .string(hostId.uuidString.lowercased()),
          "id": .string(candidate.id.uuidString.lowercased()),
          "kind": .string(rawKind == "unknown" ? "opening" : rawKind),
          "name": known(.string("Opening \(candidate.id.uuidString.prefix(8))"), attribution),
          "offsetAlongHostMm": known(.number(Double(max(1, openingOffset(
            hostStart: resolvedHostStart, hostEnd: resolvedHostEnd,
            openingStart: sourceStart, openingEnd: sourceEnd,
            transform: calibration.sourceToModel
          )))), attribution),
          "origin": attribution,
          "sillHeightMm": sill.map { known(.number(Double($0)), attribution) }
            ?? unknown("not-provided", operationId, "opening-sill-height"),
          "swing": unknown("not-observed", operationId, "opening-swing"),
          "widthMm": known(.number(Double(max(1, width))), attribution),
        ]),
      ], uniquingKeysWith: { _, new in new }))
    case "space":
      guard let levelId = candidate.levelCandidateId,
            isIncluded(levelId, reviews: reviews),
            let ids = candidate.boundaryWallCandidateIds,
            let suggestedName = candidate.suggestedName else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      let wallPairs = try ids.map { wallId -> (C14_7SourcePoint, C14_7SourcePoint) in
        guard isIncluded(wallId, reviews: reviews),
              let wall = candidates[wallId], let start = wall.start, let end = wall.end,
              let wallReview = reviews[wallId] else {
          throw C14_7PlanOperationBuilderError.disconnectedBoundary
        }
        guard corrected || wallReview.decision != .corrected else {
          throw C14_7PlanOperationBuilderError.invalidCandidate
        }
        let resolved = corrected && wallReview.decision == .corrected
          ? (wallReview.start, wallReview.end)
          : (start, end)
        guard resolved.0.isValid, resolved.1.isValid, resolved.0 != resolved.1 else {
          throw C14_7PlanOperationBuilderError.invalidCandidate
        }
        return resolved
      }
      let boundary = try orderedBoundary(wallPairs).map {
        modelPoint($0, transform: calibration.sourceToModel)
      }
      let name = corrected ? review.name : suggestedName
      guard boundedName(name) else { throw C14_7PlanOperationBuilderError.invalidCandidate }
      return .object(core.merging([
        "type": .string("space.create.v1"),
        "space": .object([
          "boundary": known(.array(boundary), attribution),
          "boundedByElementIds": .array(ids.map { .string($0.uuidString.lowercased()) }),
          "classification": unknown("not-provided", operationId, "space-classification"),
          "elementType": .string("space"),
          "id": .string(candidate.id.uuidString.lowercased()),
          "levelId": .string(levelId.uuidString.lowercased()),
          "name": known(.string(name), attribution),
          "origin": attribution,
        ]),
      ], uniquingKeysWith: { _, new in new }))
    default:
      throw C14_7PlanOperationBuilderError.invalidCandidate
    }
  }

  private static func attribution(
    proposal: C14_7PlanProposal,
    actorUserId: UUID,
    corrected: Bool,
    claimId: UUID
  ) -> C14_7JSONValue {
    var value: [String: C14_7JSONValue] = [
      "claimId": .string(claimId.uuidString.lowercased()),
      "evidenceIds": .array([.string(proposal.source.assetId.uuidString.lowercased())]),
      "method": .object([
        "kind": .string(corrected ? "manual" : "plan-import"),
        "name": .string(corrected ? "C6 native structured correction" : proposal.parser.adapterId),
        "version": .string(corrected ? "c14.7-v1" : proposal.parser.adapterVersion),
      ]),
      "state": .string(corrected ? "user-asserted" : "source-derived"),
      "verification": .object(["status": .string("not-reviewed")]),
    ]
    if corrected { value["actorUserId"] = .string(actorUserId.uuidString.lowercased()) }
    return .object(value)
  }

  private static func known(_ value: C14_7JSONValue, _ attribution: C14_7JSONValue) -> C14_7JSONValue {
    .object(["attribution": attribution, "knowledge": .string("known"), "value": value])
  }

  private static func unknown(
    _ reason: String,
    _ operationId: UUID,
    _ purpose: String
  ) -> C14_7JSONValue {
    .object([
      "attribution": .object([
        "claimId": .string(
          deterministicUuid([operationId.uuidString, purpose]).uuidString.lowercased()
        ),
        "evidenceIds": .array([]),
        "method": .object([
          "kind": .string("plan-import"),
          "name": .string("C6 native explicit unknown"),
          "version": .string("c14.7-v1"),
        ]),
        "reason": .string(reason),
        "state": .string("unknown"),
        "verification": .object(["status": .string("not-reviewed")]),
      ]),
      "knowledge": .string("unknown"),
    ])
  }

  private static func point(_ value: C14_7SourcePoint) -> C14_7JSONValue {
    .object(["x": .number(Double(value.x)), "y": .number(Double(value.y))])
  }

  private static func modelPoint(
    _ value: C14_7SourcePoint,
    transform: C14_7AffineTransform
  ) -> C14_7JSONValue {
    let denominator = transform.denominator
    let x = transform.a * value.x + transform.b * value.y
      + transform.translateXMillimetres * denominator
    let y = transform.c * value.x + transform.d * value.y
      + transform.translateYMillimetres * denominator
    return .object([
      "xMm": .number(Double(halfAway(x, denominator))),
      "yMm": .number(Double(halfAway(y, denominator))),
    ])
  }

  private static func mappedDistance(
    _ start: C14_7SourcePoint,
    _ end: C14_7SourcePoint,
    transform: C14_7AffineTransform
  ) -> Int {
    let first = mapped(start, transform: transform)
    let last = mapped(end, transform: transform)
    return max(1, Int(hypot(Double(last.0 - first.0), Double(last.1 - first.1)).rounded()))
  }

  private static func openingOffset(
    hostStart: C14_7SourcePoint,
    hostEnd: C14_7SourcePoint,
    openingStart: C14_7SourcePoint,
    openingEnd: C14_7SourcePoint,
    transform: C14_7AffineTransform
  ) -> Int {
    let start = mapped(hostStart, transform: transform)
    let end = mapped(hostEnd, transform: transform)
    let openStart = mapped(openingStart, transform: transform)
    let openEnd = mapped(openingEnd, transform: transform)
    let dx = Double(end.0 - start.0)
    let dy = Double(end.1 - start.1)
    let length = hypot(dx, dy)
    guard length > 0 else { return 1 }
    let midX = Double(openStart.0 + openEnd.0) / 2
    let midY = Double(openStart.1 + openEnd.1) / 2
    return max(1, Int((((midX - Double(start.0)) * dx + (midY - Double(start.1)) * dy) / length).rounded()))
  }

  private static func mapped(
    _ value: C14_7SourcePoint,
    transform: C14_7AffineTransform
  ) -> (Int, Int) {
    let denominator = transform.denominator
    return (
      halfAway(
        transform.a * value.x + transform.b * value.y
          + transform.translateXMillimetres * denominator,
        denominator
      ),
      halfAway(
        transform.c * value.x + transform.d * value.y
          + transform.translateYMillimetres * denominator,
        denominator
      )
    )
  }

  private static func halfAway(_ numerator: Int, _ denominator: Int) -> Int {
    let sign = numerator < 0 ? -1 : 1
    let absolute = Swift.abs(numerator)
    let quotient = absolute / denominator
    let remainder = absolute % denominator
    return sign * (remainder * 2 >= denominator ? quotient + 1 : quotient)
  }

  private static func orderedBoundary(
    _ walls: [(C14_7SourcePoint, C14_7SourcePoint)]
  ) throws -> [C14_7SourcePoint] {
    guard walls.count >= 3 else { throw C14_7PlanOperationBuilderError.disconnectedBoundary }
    var unused = Array(walls.dropFirst())
    var first = walls[0]
    if !unused.contains(where: { $0.0 == first.1 || $0.1 == first.1 }) {
      first = (first.1, first.0)
    }
    var boundary = [first.0]
    var cursor = first.1
    while !unused.isEmpty {
      guard let index = unused.firstIndex(where: { $0.0 == cursor || $0.1 == cursor }) else {
        throw C14_7PlanOperationBuilderError.disconnectedBoundary
      }
      let next = unused.remove(at: index)
      boundary.append(cursor)
      cursor = next.0 == cursor ? next.1 : next.0
    }
    guard cursor == boundary[0] else {
      throw C14_7PlanOperationBuilderError.disconnectedBoundary
    }
    return boundary
  }

  private static func gcd(_ left: Int, _ right: Int) -> Int {
    var a = Swift.abs(left)
    var b = Swift.abs(right)
    while b != 0 { (a, b) = (b, a % b) }
    return max(1, a)
  }

  private static func rank(_ kind: String) -> Int {
    ["level", "wall", "opening", "space"].firstIndex(of: kind) ?? Int.max
  }

  private static func boundedName(_ value: String) -> Bool {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return !trimmed.isEmpty && trimmed.count <= 160
  }

  private static func boundedOptionalPositive(_ value: Int?) -> Bool {
    value.map({ (1...1_000_000).contains($0) }) ?? true
  }

  private static func isIncluded(
    _ candidateId: UUID,
    reviews: [UUID: C14_7CandidateReview]
  ) -> Bool {
    guard let decision = reviews[candidateId]?.decision else { return false }
    return decision == .accepted || decision == .corrected
  }

  private static func reviewFingerprint(_ review: C14_7CandidateReview) -> String {
    let components: [String] = [
      review.decision.rawValue,
      String(review.start.x), String(review.start.y),
      String(review.end.x), String(review.end.y),
      String(review.elevationMillimetres),
      review.heightMillimetres.map(String.init) ?? "nil",
      review.name,
      review.openingKind,
      review.sillHeightMillimetres.map(String.init) ?? "nil",
      review.thicknessMillimetres.map(String.init) ?? "nil",
      String(review.widthMillimetres),
    ]
    return lengthPrefixed(components)
  }

  private static func dependentReviewFingerprints(
    candidate: C14_7PlanCandidate,
    reviews: [UUID: C14_7CandidateReview]
  ) -> [String] {
    let dependencyIds: [UUID]
    switch candidate.kind {
    case "opening":
      dependencyIds = candidate.hostWallCandidateId.map { [$0] } ?? []
    case "space":
      dependencyIds = candidate.boundaryWallCandidateIds ?? []
    default:
      dependencyIds = []
    }
    return dependencyIds.sorted { $0.uuidString < $1.uuidString }.map { dependencyId in
      lengthPrefixed([
        dependencyId.uuidString,
        reviews[dependencyId].map(reviewFingerprint) ?? "missing",
      ])
    }
  }

  private static func deterministicUuid(_ components: [String]) -> UUID {
    let seed = lengthPrefixed(components)
    var bytes = Array(SHA256.hash(data: Data(seed.utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x50
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    let hex = bytes.map { String(format: "%02x", $0) }.joined()
    return UUID(
      uuidString: "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20))"
    )!
  }

  private static func lengthPrefixed(_ components: [String]) -> String {
    components.map { component in
      String(component.utf8.count) + ":" + component
    }.joined(separator: "|")
  }
}

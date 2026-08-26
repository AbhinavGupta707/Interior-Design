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
    guard knownLengthMillimetres > 0, sourceStart != sourceEnd else {
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
    guard proposal.status == "proposal", proposal.isValid, let candidates = proposal.candidates,
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
      let operationId = UUID()
      let attribution = attribution(
        proposal: proposal,
        actorUserId: actorUserId,
        corrected: review.decision == .corrected
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
      return .object(core.merging([
        "type": .string("level.create.v1"),
        "level": .object([
          "elementType": .string("level"),
          "elevationMm": known(.number(Double(corrected ? review.elevationMillimetres : elevation)), attribution),
          "id": .string(candidate.id.uuidString.lowercased()),
          "name": known(.string(corrected ? review.name : name), attribution),
          "origin": attribution,
          "storeyHeightMm": unknown("not-provided"),
        ]),
      ], uniquingKeysWith: { _, new in new }))
    case "wall":
      guard let levelId = candidate.levelCandidateId,
            let candidateStart = candidate.start, let candidateEnd = candidate.end else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      let start = corrected ? review.start : candidateStart
      let end = corrected ? review.end : candidateEnd
      guard start != end else { throw C14_7PlanOperationBuilderError.invalidCandidate }
      let height = corrected ? review.heightMillimetres : candidate.heightMillimetres
      let thickness = corrected ? review.thicknessMillimetres : candidate.thicknessMillimetres
      return .object(core.merging([
        "type": .string("wall.create.v1"),
        "wall": .object([
          "alignment": .string("centre"),
          "baseOffsetMm": unknown("not-provided"),
          "elementType": .string("wall"),
          "heightMm": height.map { known(.number(Double($0)), attribution) } ?? unknown("not-provided"),
          "id": .string(candidate.id.uuidString.lowercased()),
          "levelId": .string(levelId.uuidString.lowercased()),
          "name": known(.string("Wall \(candidate.id.uuidString.prefix(8))"), attribution),
          "origin": attribution,
          "path": known(.array([
            modelPoint(start, transform: calibration.sourceToModel),
            modelPoint(end, transform: calibration.sourceToModel),
          ]), attribution),
          "thicknessMm": thickness.map { known(.number(Double($0)), attribution) } ?? unknown("not-provided"),
        ]),
      ], uniquingKeysWith: { _, new in new }))
    case "opening":
      guard let hostId = candidate.hostWallCandidateId,
            let host = candidates[hostId], let hostStart = host.start, let hostEnd = host.end,
            let sourceStart = candidate.start, let sourceEnd = candidate.end else {
        throw C14_7PlanOperationBuilderError.missingHost
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
      return .object(core.merging([
        "type": .string("opening.insert.v1"),
        "opening": .object([
          "elementType": .string("opening"),
          "heightMm": height.flatMap { $0 > 0 ? $0 : nil }.map {
            known(.number(Double($0)), attribution)
          } ?? unknown("not-provided"),
          "hostWallId": .string(hostId.uuidString.lowercased()),
          "id": .string(candidate.id.uuidString.lowercased()),
          "kind": .string(rawKind == "unknown" ? "opening" : rawKind),
          "name": known(.string("Opening \(candidate.id.uuidString.prefix(8))"), attribution),
          "offsetAlongHostMm": known(.number(Double(max(1, openingOffset(
            hostStart: hostStart, hostEnd: hostEnd,
            openingStart: sourceStart, openingEnd: sourceEnd,
            transform: calibration.sourceToModel
          )))), attribution),
          "origin": attribution,
          "sillHeightMm": sill.map { known(.number(Double($0)), attribution) } ?? unknown("not-provided"),
          "swing": unknown("not-observed"),
          "widthMm": known(.number(Double(max(1, width))), attribution),
        ]),
      ], uniquingKeysWith: { _, new in new }))
    case "space":
      guard let levelId = candidate.levelCandidateId,
            let ids = candidate.boundaryWallCandidateIds,
            let suggestedName = candidate.suggestedName else {
        throw C14_7PlanOperationBuilderError.invalidCandidate
      }
      let wallPairs = try ids.map { wallId -> (C14_7SourcePoint, C14_7SourcePoint) in
        guard let wall = candidates[wallId], let start = wall.start, let end = wall.end else {
          throw C14_7PlanOperationBuilderError.disconnectedBoundary
        }
        if corrected, let correction = reviews[wallId], correction.decision == .corrected {
          return (correction.start, correction.end)
        }
        return (start, end)
      }
      let boundary = try orderedBoundary(wallPairs).map {
        modelPoint($0, transform: calibration.sourceToModel)
      }
      return .object(core.merging([
        "type": .string("space.create.v1"),
        "space": .object([
          "boundary": known(.array(boundary), attribution),
          "boundedByElementIds": .array(ids.map { .string($0.uuidString.lowercased()) }),
          "classification": unknown("not-provided"),
          "elementType": .string("space"),
          "id": .string(candidate.id.uuidString.lowercased()),
          "levelId": .string(levelId.uuidString.lowercased()),
          "name": known(.string(corrected ? review.name : suggestedName), attribution),
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
    corrected: Bool
  ) -> C14_7JSONValue {
    var value: [String: C14_7JSONValue] = [
      "claimId": .string(UUID().uuidString.lowercased()),
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

  private static func unknown(_ reason: String) -> C14_7JSONValue {
    .object([
      "attribution": .object([
        "claimId": .string(UUID().uuidString.lowercased()),
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
}

import {
  c6PlanPolicy,
  c6PlanProposalSchemaVersion,
  planParserResultSchema,
  type PlanCandidate,
  type PlanParserResult,
  type PlanProposal,
  type PlanSourcePoint,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import type { PlanParserInput, PlanParserPort } from "./types.js";
import { PlanNormalizationError } from "./types.js";

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported canonical parser manifest value.");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function invalidOutput(): never {
  throw new PlanNormalizationError("invalid-parser-output");
}

function samePoint(left: PlanSourcePoint, right: PlanSourcePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function assertPointWithinSource(point: PlanSourcePoint, width: number, height: number): void {
  if (point.x < 0 || point.y < 0 || point.x > width || point.y > height) invalidOutput();
}

function assertRegionWithinSource(
  region: { readonly maximum: PlanSourcePoint; readonly minimum: PlanSourcePoint },
  width: number,
  height: number,
): void {
  assertPointWithinSource(region.minimum, width, height);
  assertPointWithinSource(region.maximum, width, height);
}

function pointOnSegment(
  point: PlanSourcePoint,
  start: PlanSourcePoint,
  end: PlanSourcePoint,
): boolean {
  const dx = BigInt(end.x - start.x);
  const dy = BigInt(end.y - start.y);
  const pointDx = BigInt(point.x - start.x);
  const pointDy = BigInt(point.y - start.y);
  if (dx * pointDy - dy * pointDx !== 0n) return false;
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

function boundaryVertices(
  space: Extract<PlanCandidate, { readonly kind: "space" }>,
  candidates: ReadonlyMap<string, PlanCandidate>,
): readonly PlanSourcePoint[] {
  const walls = space.boundaryWallCandidateIds.map((id) => {
    const candidate = candidates.get(id);
    if (candidate?.kind !== "wall" || candidate.levelCandidateId !== space.levelCandidateId)
      invalidOutput();
    return candidate;
  });
  const first = walls[0];
  const second = walls[1];
  if (first === undefined || second === undefined) invalidOutput();
  let start = first.start;
  let end = first.end;
  if (!samePoint(end, second.start) && !samePoint(end, second.end)) {
    if (!samePoint(start, second.start) && !samePoint(start, second.end)) invalidOutput();
    [start, end] = [end, start];
  }
  const vertices = [start];
  for (let index = 1; index < walls.length; index += 1) {
    const wall = walls[index];
    if (wall === undefined) invalidOutput();
    if (samePoint(wall.start, end)) {
      vertices.push(wall.start);
      end = wall.end;
    } else if (samePoint(wall.end, end)) {
      vertices.push(wall.end);
      end = wall.start;
    } else {
      invalidOutput();
    }
  }
  if (!samePoint(end, vertices[0] as PlanSourcePoint)) invalidOutput();
  return vertices;
}

function orientation(
  left: PlanSourcePoint,
  middle: PlanSourcePoint,
  right: PlanSourcePoint,
): bigint {
  return (
    BigInt(middle.x - left.x) * BigInt(right.y - left.y) -
    BigInt(middle.y - left.y) * BigInt(right.x - left.x)
  );
}

function segmentsIntersect(
  firstStart: PlanSourcePoint,
  firstEnd: PlanSourcePoint,
  secondStart: PlanSourcePoint,
  secondEnd: PlanSourcePoint,
): boolean {
  const firstSideStart = orientation(firstStart, firstEnd, secondStart);
  const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondSideStart = orientation(secondStart, secondEnd, firstStart);
  const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);
  if (firstSideStart === 0n && pointOnSegment(secondStart, firstStart, firstEnd)) return true;
  if (firstSideEnd === 0n && pointOnSegment(secondEnd, firstStart, firstEnd)) return true;
  if (secondSideStart === 0n && pointOnSegment(firstStart, secondStart, secondEnd)) return true;
  if (secondSideEnd === 0n && pointOnSegment(firstEnd, secondStart, secondEnd)) return true;
  return firstSideStart < 0n !== firstSideEnd < 0n && secondSideStart < 0n !== secondSideEnd < 0n;
}

function assertSimpleBoundary(vertices: readonly PlanSourcePoint[]): void {
  let doubledArea = 0n;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index] as PlanSourcePoint;
    const next = vertices[(index + 1) % vertices.length] as PlanSourcePoint;
    doubledArea += BigInt(current.x) * BigInt(next.y) - BigInt(current.y) * BigInt(next.x);
    for (let compared = index + 1; compared < vertices.length; compared += 1) {
      const adjacent = compared === index + 1 || (index === 0 && compared === vertices.length - 1);
      if (adjacent) continue;
      const comparedStart = vertices[compared] as PlanSourcePoint;
      const comparedEnd = vertices[(compared + 1) % vertices.length] as PlanSourcePoint;
      if (segmentsIntersect(current, next, comparedStart, comparedEnd)) invalidOutput();
    }
  }
  if (doubledArea === 0n) invalidOutput();
}

function assertProposalGeometry(proposal: PlanProposal): void {
  const width = proposal.source.widthSourceUnits;
  const height = proposal.source.heightSourceUnits;
  const candidates = new Map(
    proposal.candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const levels = proposal.candidates.filter(({ kind }) => kind === "level");
  if (levels.length !== 1) invalidOutput();
  const levelId = levels[0]?.candidateId;
  if (levelId === undefined) invalidOutput();
  for (const candidate of proposal.candidates) {
    assertRegionWithinSource(candidate.sourceRegion, width, height);
    if (candidate.kind === "level") continue;
    if (candidate.levelCandidateId !== levelId) invalidOutput();
    if (candidate.kind === "wall") {
      assertPointWithinSource(candidate.start, width, height);
      assertPointWithinSource(candidate.end, width, height);
      continue;
    }
    if (candidate.kind === "opening") {
      assertPointWithinSource(candidate.start, width, height);
      assertPointWithinSource(candidate.end, width, height);
      const host = candidates.get(candidate.hostWallCandidateId);
      if (
        host?.kind !== "wall" ||
        host.levelCandidateId !== candidate.levelCandidateId ||
        !pointOnSegment(candidate.start, host.start, host.end) ||
        !pointOnSegment(candidate.end, host.start, host.end)
      )
        invalidOutput();
      continue;
    }
    assertSimpleBoundary(boundaryVertices(candidate, candidates));
  }
  const candidateIds = new Set(candidates.keys());
  for (const finding of proposal.findings) {
    if (finding.severity === "error") invalidOutput();
    if (finding.affectedCandidateIds.some((candidateId) => !candidateIds.has(candidateId)))
      invalidOutput();
    if (finding.sourceRegion !== undefined)
      assertRegionWithinSource(finding.sourceRegion, width, height);
  }
  for (const unresolved of proposal.unresolvedRegions)
    assertRegionWithinSource(unresolved.sourceRegion, width, height);
  if (
    proposal.candidates.some(
      ({ confidence }) => confidence < c6PlanPolicy.minimumCandidateConfidence,
    ) &&
    proposal.unresolvedRegions.length === 0
  )
    invalidOutput();
}

/** Revalidates the untrusted parser boundary against the exact normalized input and geometry box. */
export function validatePlanParserOutput(
  input: PlanParserInput,
  output: unknown,
): PlanParserResult {
  let serialized: string;
  try {
    serialized = JSON.stringify({ output });
  } catch {
    invalidOutput();
  }
  if (Buffer.byteLength(serialized, "utf8") > c6PlanPolicy.maximumParserOutputBytes)
    invalidOutput();
  const result = planParserResultSchema.safeParse(output);
  if (!result.success) invalidOutput();
  if (
    input.request.normalizedInputSha256 !== input.sha256 ||
    result.data.jobId !== input.request.jobId ||
    result.data.projectId !== input.request.source.projectId ||
    result.data.normalizedInputSha256 !== input.sha256 ||
    result.data.parser.mode !== input.mode ||
    canonicalJson(result.data.parser.normalizers) !== canonicalJson(input.normalizers) ||
    canonicalJson(result.data.source) !== canonicalJson(input.request.source)
  )
    invalidOutput();
  if (result.data.status === "proposal") assertProposalGeometry(result.data);
  return result.data;
}

export class LocalPlanParserFake implements PlanParserPort {
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  parse(input: PlanParserInput, signal?: AbortSignal): Promise<PlanParserResult> {
    if (signal?.aborted === true) throw signal.reason;
    const parserCore = {
      adapterId: "local-plan-parser-fake",
      adapterVersion: "1.0.0",
      mode: input.mode,
      normalizers: input.normalizers,
    } as const;
    const parser = { ...parserCore, manifestSha256: sha256(parserCore) };
    const proposalId = stableUuid(`${input.request.jobId}:${input.sha256}:result`);
    const createdAt = this.#now().toISOString();
    if (input.mode !== "deterministic-fixture") {
      return Promise.resolve(
        planParserResultSchema.parse({
          code: "parser-unavailable",
          createdAt,
          detail:
            "The local fake only proves the fixture boundary; the isolated L2 parser adapter is unavailable.",
          findings: [],
          jobId: input.request.jobId,
          nextActions: ["retry", "use-manual-editor"],
          normalizedInputSha256: input.sha256,
          parser,
          projectId: input.request.source.projectId,
          proposalId,
          retryable: true,
          schemaVersion: c6PlanProposalSchemaVersion,
          source: input.request.source,
          status: "abstained",
        }),
      );
    }
    const width = input.widthSourceUnits;
    const height = input.heightSourceUnits;
    const minimum = {
      x: Math.max(1, Math.floor(width / 10)),
      y: Math.max(1, Math.floor(height / 10)),
    };
    const maximum = {
      x: Math.max(minimum.x + 1, Math.floor((width * 9) / 10)),
      y: Math.max(minimum.y + 1, Math.floor((height * 9) / 10)),
    };
    const levelId = stableUuid(`${proposalId}:level`);
    const wallIds = [0, 1, 2, 3].map((index) => stableUuid(`${proposalId}:wall:${String(index)}`));
    const corners = [
      minimum,
      { x: maximum.x, y: minimum.y },
      maximum,
      { x: minimum.x, y: maximum.y },
    ];
    const candidates = [
      {
        candidateId: levelId,
        confidence: 100,
        elevationMillimetres: 0,
        kind: "level",
        sourceRegion: { maximum, minimum },
        suggestedName: "Fixture level",
      },
      ...wallIds.map((candidateId, index) => ({
        candidateId,
        confidence: 100,
        end: corners[(index + 1) % corners.length],
        kind: "wall" as const,
        levelCandidateId: levelId,
        sourceRegion: { maximum, minimum },
        start: corners[index],
      })),
      {
        boundaryWallCandidateIds: wallIds,
        candidateId: stableUuid(`${proposalId}:space`),
        confidence: 100,
        kind: "space" as const,
        levelCandidateId: levelId,
        sourceRegion: { maximum, minimum },
        suggestedName: "Fixture room",
      },
    ];
    return Promise.resolve(
      planParserResultSchema.parse({
        candidates,
        createdAt,
        findings: [],
        jobId: input.request.jobId,
        normalizedInputSha256: input.sha256,
        overallConfidence: 100,
        parser,
        projectId: input.request.source.projectId,
        proposalId,
        schemaVersion: c6PlanProposalSchemaVersion,
        source: input.request.source,
        status: "proposal",
        unresolvedRegions: [],
      }),
    );
  }
}

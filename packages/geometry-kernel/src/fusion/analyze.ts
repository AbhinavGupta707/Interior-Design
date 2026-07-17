import {
  compareText,
  deepFreeze,
  hasOnlyKeys,
  isBoundedIdentifier,
} from "../registration/internal.js";
import type {
  FusionAnalysisComputation,
  FusionAnalysisErrorCode,
  FusionClaim,
  FusionConflict,
  FusionConflictConfig,
  FusionCoverageObservation,
  FusionCoverageRegionResult,
  FusionCoverageSummary,
  FusionDisposition,
  FusionDispositionConfig,
  FusionExpectedRegion,
  FusionProposalAnalysis,
  FusionProposalAnalysisInput,
  KnownFusionClaim,
} from "./types.js";
import { fusionAnalysisVersion } from "./types.js";

export const defaultFusionConflictConfig: FusionConflictConfig = deepFreeze({
  coordinateLimitMm: 10_000_000,
  dimensionalToleranceMm: 25,
  maximumClaims: 10_000,
  maximumClaimsPerSemanticKey: 32,
  maximumConflicts: 10_000,
  version: fusionAnalysisVersion,
});

export const defaultFusionDispositionConfig: FusionDispositionConfig = deepFreeze({
  maximumErrorConflictsBeforeAbstention: 0,
  minimumPartialCoverageBasisPoints: 2_500,
  version: fusionAnalysisVersion,
});

function failure(code: FusionAnalysisErrorCode, detail: string): FusionAnalysisComputation<never> {
  return deepFreeze({ error: { code, detail }, ok: false });
}

function success<TValue>(value: TValue): FusionAnalysisComputation<TValue> {
  return deepFreeze({ ok: true, value });
}

const conflictConfigKeys = new Set<keyof FusionConflictConfig>([
  "coordinateLimitMm",
  "dimensionalToleranceMm",
  "maximumClaims",
  "maximumClaimsPerSemanticKey",
  "maximumConflicts",
  "version",
]);

const dispositionConfigKeys = new Set<keyof FusionDispositionConfig>([
  "maximumErrorConflictsBeforeAbstention",
  "minimumPartialCoverageBasisPoints",
  "version",
]);
const knownClaimKeys = new Set([
  "claimId",
  "confidenceBasisPoints",
  "kind",
  "location",
  "numericValueMm",
  "semanticKey",
  "sourceId",
  "state",
  "valueSha256",
]);
const unknownClaimKeys = new Set([
  "claimId",
  "confidenceBasisPoints",
  "kind",
  "location",
  "semanticKey",
  "sourceId",
  "state",
]);
const locationKeys = new Set(["xMm", "yMm", "zMm"]);
const expectedRegionKeys = new Set(["levelId", "regionId"]);
const coverageObservationKeys = new Set([
  "evidenceSha256",
  "levelId",
  "regionId",
  "sourceId",
  "state",
]);

function resolveConflictConfig(
  input: Partial<FusionConflictConfig> | undefined,
): FusionAnalysisComputation<FusionConflictConfig> {
  if (input !== undefined) {
    const unknown = Object.keys(input).find(
      (key) => !conflictConfigKeys.has(key as keyof FusionConflictConfig),
    );
    if (unknown !== undefined) {
      return failure(
        "INVALID_CONFIGURATION",
        `Unknown fusion conflict configuration field: ${unknown}.`,
      );
    }
  }
  const config = { ...defaultFusionConflictConfig, ...input };
  if (
    !isFusionAnalysisVersion(config.version) ||
    !Number.isSafeInteger(config.coordinateLimitMm) ||
    config.coordinateLimitMm <= 0 ||
    !Number.isSafeInteger(config.dimensionalToleranceMm) ||
    config.dimensionalToleranceMm < 0 ||
    !Number.isSafeInteger(config.maximumClaims) ||
    config.maximumClaims < 1 ||
    config.maximumClaims > 100_000 ||
    !Number.isSafeInteger(config.maximumClaimsPerSemanticKey) ||
    config.maximumClaimsPerSemanticKey < 2 ||
    config.maximumClaimsPerSemanticKey > 1_000 ||
    !Number.isSafeInteger(config.maximumConflicts) ||
    config.maximumConflicts < 1 ||
    config.maximumConflicts > 100_000
  ) {
    return failure(
      "INVALID_CONFIGURATION",
      "Fusion conflict configuration is outside bounded limits.",
    );
  }
  return success(deepFreeze(config));
}

function resolveDispositionConfig(
  input: Partial<FusionDispositionConfig> | undefined,
): FusionAnalysisComputation<FusionDispositionConfig> {
  if (input !== undefined) {
    const unknown = Object.keys(input).find(
      (key) => !dispositionConfigKeys.has(key as keyof FusionDispositionConfig),
    );
    if (unknown !== undefined) {
      return failure(
        "INVALID_CONFIGURATION",
        `Unknown fusion disposition configuration field: ${unknown}.`,
      );
    }
  }
  const config = { ...defaultFusionDispositionConfig, ...input };
  if (
    !isFusionAnalysisVersion(config.version) ||
    !Number.isSafeInteger(config.maximumErrorConflictsBeforeAbstention) ||
    config.maximumErrorConflictsBeforeAbstention < 0 ||
    !Number.isSafeInteger(config.minimumPartialCoverageBasisPoints) ||
    config.minimumPartialCoverageBasisPoints < 0 ||
    config.minimumPartialCoverageBasisPoints > 10_000
  ) {
    return failure(
      "INVALID_CONFIGURATION",
      "Fusion disposition configuration is outside bounded limits.",
    );
  }
  return success(deepFreeze(config));
}

function isFusionAnalysisVersion(value: unknown): boolean {
  return value === fusionAnalysisVersion;
}

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validLocation(location: FusionClaim["location"], coordinateLimitMm: number): boolean {
  return (
    location === undefined ||
    [location.xMm, location.yMm, location.zMm].every(
      (coordinate) => Number.isSafeInteger(coordinate) && Math.abs(coordinate) <= coordinateLimitMm,
    )
  );
}

function validateClaims(
  claims: readonly FusionClaim[],
  sourceIds: ReadonlySet<string>,
  config: FusionConflictConfig,
): FusionAnalysisComputation<readonly FusionClaim[]> {
  if (claims.length > config.maximumClaims) {
    return failure("RESOURCE_LIMIT_EXCEEDED", "Fusion claim count exceeds the configured bound.");
  }
  const claimIds = new Set<string>();
  const sourceSemanticKeys = new Set<string>();
  const counts = new Map<string, number>();
  const ordered = [...claims].sort((left, right) => {
    const semanticOrder = compareText(left.semanticKey, right.semanticKey);
    return semanticOrder !== 0 ? semanticOrder : compareText(left.claimId, right.claimId);
  });
  const checkedClaims: FusionClaim[] = [];
  for (const claim of ordered) {
    if (
      !hasOnlyKeys(claim, claim.state === "unknown" ? unknownClaimKeys : knownClaimKeys) ||
      (claim.location !== undefined && !hasOnlyKeys(claim.location, locationKeys))
    ) {
      return failure("INVALID_CLAIM", "Fusion claim objects contain unsupported fields.");
    }
    if (
      !isBoundedIdentifier(claim.claimId) ||
      !isBoundedIdentifier(claim.semanticKey) ||
      !isBoundedIdentifier(claim.sourceId)
    ) {
      return failure(
        "INVALID_IDENTIFIER",
        "Fusion claim identifiers must be bounded stable codes.",
      );
    }
    if (!sourceIds.has(claim.sourceId)) {
      return failure("UNKNOWN_SOURCE", "A fusion claim references an undeclared source.");
    }
    if (claimIds.has(claim.claimId)) {
      return failure("DUPLICATE_CLAIM", "Fusion claim identifiers must be unique.");
    }
    claimIds.add(claim.claimId);
    const sourceSemanticKey = `${claim.sourceId}\u0000${claim.semanticKey}\u0000${claim.kind}`;
    if (sourceSemanticKeys.has(sourceSemanticKey)) {
      return failure(
        "DUPLICATE_CLAIM",
        "A source may provide only one claim per semantic key and kind.",
      );
    }
    sourceSemanticKeys.add(sourceSemanticKey);
    const groupKey = `${claim.semanticKey}\u0000${claim.kind}`;
    const count = (counts.get(groupKey) ?? 0) + 1;
    if (count > config.maximumClaimsPerSemanticKey) {
      return failure("RESOURCE_LIMIT_EXCEEDED", "A semantic key exceeds its source-claim bound.");
    }
    counts.set(groupKey, count);
    if (
      !(["classification", "dimension", "position", "presence", "topology"] as const).includes(
        claim.kind,
      ) ||
      !(
        ["fused", "inferred", "observed", "source-derived", "unknown", "user-asserted"] as const
      ).includes(claim.state) ||
      !validLocation(claim.location, config.coordinateLimitMm) ||
      (claim.confidenceBasisPoints !== undefined &&
        (!Number.isSafeInteger(claim.confidenceBasisPoints) ||
          claim.confidenceBasisPoints < 0 ||
          claim.confidenceBasisPoints > 10_000))
    ) {
      return failure("INVALID_CLAIM", "Fusion claim metadata is invalid.");
    }
    if (claim.state === "unknown") {
      if ("valueSha256" in claim || "numericValueMm" in claim) {
        return failure("INVALID_CLAIM", "Unknown claims cannot carry a hidden value or dimension.");
      }
      checkedClaims.push({
        claimId: claim.claimId,
        ...(claim.confidenceBasisPoints === undefined
          ? {}
          : { confidenceBasisPoints: claim.confidenceBasisPoints }),
        kind: claim.kind,
        ...(claim.location === undefined ? {} : { location: { ...claim.location } }),
        semanticKey: claim.semanticKey,
        sourceId: claim.sourceId,
        state: "unknown",
      });
      continue;
    }
    if (!validSha256(claim.valueSha256)) {
      return failure(
        "INVALID_CLAIM",
        "Known fusion claims require an exact lowercase SHA-256 value hash.",
      );
    }
    if (
      claim.numericValueMm !== undefined &&
      (!Number.isSafeInteger(claim.numericValueMm) ||
        Math.abs(claim.numericValueMm) > config.coordinateLimitMm)
    ) {
      return failure(
        "INVALID_CLAIM",
        "Fusion dimensional values must be bounded safe-integer millimetres.",
      );
    }
    if (
      claim.numericValueMm !== undefined &&
      claim.kind !== "dimension" &&
      claim.kind !== "position"
    ) {
      return failure(
        "INVALID_CLAIM",
        "Only dimensional or position claims may carry a millimetre scalar.",
      );
    }
    checkedClaims.push({
      claimId: claim.claimId,
      ...(claim.confidenceBasisPoints === undefined
        ? {}
        : { confidenceBasisPoints: claim.confidenceBasisPoints }),
      kind: claim.kind,
      ...(claim.location === undefined ? {} : { location: { ...claim.location } }),
      ...(claim.numericValueMm === undefined ? {} : { numericValueMm: claim.numericValueMm }),
      semanticKey: claim.semanticKey,
      sourceId: claim.sourceId,
      state: claim.state,
      valueSha256: claim.valueSha256,
    });
  }
  return success(checkedClaims);
}

function conflictCode(kind: KnownFusionClaim["kind"]): FusionConflict["code"] {
  switch (kind) {
    case "classification":
      return "CLASSIFICATION_CONFLICT";
    case "dimension":
      return "DIMENSION_CONFLICT";
    case "position":
      return "POSITION_CONFLICT";
    case "presence":
      return "PRESENCE_CONFLICT";
    case "topology":
      return "TOPOLOGY_CONFLICT";
  }
}

export function detectFusionConflicts(
  claims: readonly FusionClaim[],
  sourceIdsInput: readonly string[],
  configInput?: Partial<FusionConflictConfig>,
): FusionAnalysisComputation<readonly FusionConflict[]> {
  const configResult = resolveConflictConfig(configInput);
  if (!configResult.ok) return configResult;
  const config = configResult.value;
  const sourceIds = new Set(sourceIdsInput);
  if (
    sourceIds.size < 2 ||
    sourceIds.size > 32 ||
    sourceIds.size !== sourceIdsInput.length ||
    sourceIdsInput.some((sourceId) => !isBoundedIdentifier(sourceId))
  ) {
    return failure("INVALID_IDENTIFIER", "Fusion source identifiers must be unique and bounded.");
  }
  const checked = validateClaims(claims, sourceIds, config);
  if (!checked.ok) return checked;
  const groups = new Map<string, KnownFusionClaim[]>();
  for (const claim of checked.value) {
    if (claim.state === "unknown") continue;
    const key = `${claim.semanticKey}\u0000${claim.kind}`;
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }
  const conflicts: FusionConflict[] = [];
  for (const group of groups.values()) {
    if (group.length < 2 || new Set(group.map(({ valueSha256 }) => valueSha256)).size < 2) continue;
    const first = group[0];
    if (first === undefined) continue;
    const numeric = group
      .map(({ numericValueMm }) => numericValueMm)
      .filter((value): value is number => value !== undefined);
    const magnitudeMm =
      numeric.length === group.length ? Math.max(...numeric) - Math.min(...numeric) : undefined;
    if (
      (first.kind === "dimension" || first.kind === "position") &&
      magnitudeMm !== undefined &&
      magnitudeMm <= config.dimensionalToleranceMm
    ) {
      continue;
    }
    const orderedClaims = [...group].sort((left, right) =>
      compareText(left.sourceId, right.sourceId),
    );
    conflicts.push({
      claimIds: orderedClaims.map(({ claimId }) => claimId),
      code: conflictCode(first.kind),
      kind: first.kind,
      ...(magnitudeMm === undefined ? {} : { magnitudeMm }),
      requiresHumanDecision: true,
      semanticKey: first.semanticKey,
      severity:
        first.kind === "topology" || first.kind === "presence" || first.kind === "classification"
          ? "error"
          : "warning",
      sourceClaims: orderedClaims,
      sourceIds: orderedClaims.map(({ sourceId }) => sourceId),
    });
    if (conflicts.length > config.maximumConflicts) {
      return failure(
        "RESOURCE_LIMIT_EXCEEDED",
        "Detected fusion conflicts exceed the configured output bound.",
      );
    }
  }
  conflicts.sort((left, right) => {
    const keyOrder = compareText(left.semanticKey, right.semanticKey);
    return keyOrder !== 0 ? keyOrder : compareText(left.kind, right.kind);
  });
  return success(conflicts);
}

function validateCoverage(
  sourceIds: ReadonlySet<string>,
  registeredSourceIds: ReadonlySet<string>,
  expectedRegions: readonly FusionExpectedRegion[],
  observations: readonly FusionCoverageObservation[],
): FusionAnalysisComputation<{
  readonly expectedRegions: readonly FusionExpectedRegion[];
  readonly observations: readonly FusionCoverageObservation[];
}> {
  const regionKeys = new Set<string>();
  const orderedRegions = expectedRegions
    .map((region) => ({ ...region }))
    .sort((left, right) => {
      const levelOrder = compareText(left.levelId, right.levelId);
      return levelOrder !== 0 ? levelOrder : compareText(left.regionId, right.regionId);
    });
  for (const region of orderedRegions) {
    if (
      !hasOnlyKeys(region, expectedRegionKeys) ||
      !isBoundedIdentifier(region.levelId) ||
      !isBoundedIdentifier(region.regionId)
    ) {
      return failure(
        "INVALID_IDENTIFIER",
        "Fusion coverage region identifiers must be bounded stable codes.",
      );
    }
    const key = `${region.levelId}\u0000${region.regionId}`;
    if (regionKeys.has(key)) {
      return failure("DUPLICATE_REGION", "Expected fusion coverage regions must be unique.");
    }
    regionKeys.add(key);
  }
  const observationKeys = new Set<string>();
  const orderedObservations = observations
    .map((observation) => ({
      ...(observation.evidenceSha256 === undefined
        ? {}
        : { evidenceSha256: observation.evidenceSha256 }),
      levelId: observation.levelId,
      regionId: observation.regionId,
      sourceId: observation.sourceId,
      state: observation.state,
    }))
    .sort((left, right) => {
      const regionOrder = compareText(
        `${left.levelId}\u0000${left.regionId}`,
        `${right.levelId}\u0000${right.regionId}`,
      );
      return regionOrder !== 0 ? regionOrder : compareText(left.sourceId, right.sourceId);
    });
  for (let index = 0; index < orderedObservations.length; index += 1) {
    const observation = orderedObservations[index];
    const originalObservation = observations[index];
    if (observation === undefined) continue;
    if (
      originalObservation !== undefined &&
      !hasOnlyKeys(originalObservation, coverageObservationKeys)
    ) {
      return failure("INVALID_COVERAGE", "Coverage observations contain unsupported fields.");
    }
    const regionKey = `${observation.levelId}\u0000${observation.regionId}`;
    const observationKey = `${regionKey}\u0000${observation.sourceId}`;
    if (!sourceIds.has(observation.sourceId)) {
      return failure("UNKNOWN_SOURCE", "A coverage observation references an undeclared source.");
    }
    if (!registeredSourceIds.has(observation.sourceId)) {
      return failure("INVALID_COVERAGE", "Unregistered sources cannot establish fused coverage.");
    }
    if (!regionKeys.has(regionKey)) {
      return failure("INVALID_COVERAGE", "A coverage observation references an unexpected region.");
    }
    if (observationKeys.has(observationKey)) {
      return failure(
        "DUPLICATE_REGION",
        "A source may provide one coverage state per expected region.",
      );
    }
    observationKeys.add(observationKey);
    if (
      !(["inferred", "supported", "unknown"] as const).includes(observation.state) ||
      (observation.state === "supported" && !validSha256(observation.evidenceSha256)) ||
      (observation.state !== "supported" && observation.evidenceSha256 !== undefined)
    ) {
      return failure(
        "INVALID_COVERAGE",
        "Coverage state and immutable evidence hash are inconsistent.",
      );
    }
  }
  return success({ expectedRegions: orderedRegions, observations: orderedObservations });
}

export function computeFusionCoverage(
  sourceIdsInput: readonly string[],
  registeredSourceIdsInput: readonly string[],
  expectedRegions: readonly FusionExpectedRegion[],
  observations: readonly FusionCoverageObservation[],
): FusionAnalysisComputation<FusionCoverageSummary> {
  const sourceIds = new Set(sourceIdsInput);
  const registeredSourceIds = new Set(registeredSourceIdsInput);
  if (
    sourceIds.size < 2 ||
    sourceIds.size !== sourceIdsInput.length ||
    registeredSourceIds.size !== registeredSourceIdsInput.length ||
    [...registeredSourceIds].some((sourceId) => !sourceIds.has(sourceId)) ||
    sourceIdsInput.some((sourceId) => !isBoundedIdentifier(sourceId))
  ) {
    return failure(
      "INVALID_IDENTIFIER",
      "Coverage source and registered-source manifests must be unique and consistent.",
    );
  }
  if (sourceIds.size > 32 || expectedRegions.length > 10_000 || observations.length > 100_000) {
    return failure(
      "RESOURCE_LIMIT_EXCEEDED",
      "Fusion coverage input exceeds bounded source or region limits.",
    );
  }
  const checked = validateCoverage(sourceIds, registeredSourceIds, expectedRegions, observations);
  if (!checked.ok) return checked;
  const observationsByRegion = new Map<string, FusionCoverageObservation[]>();
  for (const observation of checked.value.observations) {
    const key = `${observation.levelId}\u0000${observation.regionId}`;
    const values = observationsByRegion.get(key) ?? [];
    values.push(observation);
    observationsByRegion.set(key, values);
  }
  const regions: FusionCoverageRegionResult[] = checked.value.expectedRegions.map((region) => {
    const values = observationsByRegion.get(`${region.levelId}\u0000${region.regionId}`) ?? [];
    const state = values.some(({ state }) => state === "supported")
      ? "supported"
      : values.some(({ state }) => state === "inferred")
        ? "inferred"
        : "unknown";
    return {
      levelId: region.levelId,
      regionId: region.regionId,
      sourceIds: values
        .filter((value) => value.state === state)
        .map(({ sourceId }) => sourceId)
        .sort(compareText),
      state,
    };
  });
  const supportedRegionCount = regions.filter(({ state }) => state === "supported").length;
  const inferredRegionCount = regions.filter(({ state }) => state === "inferred").length;
  const totalRegionCount = regions.length;
  return success({
    inferredRegionCount,
    registeredSourceCount: registeredSourceIds.size,
    regions,
    supportedCoverageBasisPoints:
      totalRegionCount === 0 ? 0 : Math.floor((supportedRegionCount * 10_000) / totalRegionCount),
    supportedRegionCount,
    totalRegionCount,
    unknownRegionCount: totalRegionCount - supportedRegionCount - inferredRegionCount,
  });
}

export function recommendFusionDisposition(
  coverage: FusionCoverageSummary,
  conflicts: readonly FusionConflict[],
  configInput?: Partial<FusionDispositionConfig>,
): FusionAnalysisComputation<FusionDisposition> {
  const configResult = resolveDispositionConfig(configInput);
  if (!configResult.ok) return configResult;
  const config = configResult.value;
  const reasons: FusionDisposition["reasons"][number][] = [];
  if (coverage.registeredSourceCount === 0) reasons.push("NO_REGISTERED_SOURCES");
  if (coverage.supportedRegionCount === 0) reasons.push("NO_SUPPORTED_REGIONS");
  if (coverage.supportedCoverageBasisPoints < config.minimumPartialCoverageBasisPoints) {
    reasons.push("INSUFFICIENT_COVERAGE");
  }
  if (
    conflicts.filter(({ severity }) => severity === "error").length >
    config.maximumErrorConflictsBeforeAbstention
  ) {
    reasons.push("CONFLICT_LIMIT_EXCEEDED");
  }
  const status =
    reasons.length > 0
      ? "abstained"
      : coverage.supportedCoverageBasisPoints === 10_000 && coverage.unknownRegionCount === 0
        ? "full-proposal"
        : "partial-proposal";
  return success({
    reasons: [...new Set(reasons)].sort(compareText),
    status,
    version: fusionAnalysisVersion,
  });
}

export function analyzeFusionProposalObservations(
  input: FusionProposalAnalysisInput,
  conflictConfig?: Partial<FusionConflictConfig>,
  dispositionConfig?: Partial<FusionDispositionConfig>,
): FusionAnalysisComputation<FusionProposalAnalysis> {
  const resolvedConflictConfig = resolveConflictConfig(conflictConfig);
  if (!resolvedConflictConfig.ok) return resolvedConflictConfig;
  const resolvedDispositionConfig = resolveDispositionConfig(dispositionConfig);
  if (!resolvedDispositionConfig.ok) return resolvedDispositionConfig;
  const conflicts = detectFusionConflicts(
    input.claims,
    input.sourceIds,
    resolvedConflictConfig.value,
  );
  if (!conflicts.ok) return conflicts;
  const coverage = computeFusionCoverage(
    input.sourceIds,
    input.registeredSourceIds,
    input.expectedRegions,
    input.coverageObservations,
  );
  if (!coverage.ok) return coverage;
  const disposition = recommendFusionDisposition(
    coverage.value,
    conflicts.value,
    resolvedDispositionConfig.value,
  );
  if (!disposition.ok) return disposition;
  return success({
    conflictConfig: resolvedConflictConfig.value,
    conflicts: conflicts.value,
    coverage: coverage.value,
    dispositionConfig: resolvedDispositionConfig.value,
    disposition: disposition.value,
    version: fusionAnalysisVersion,
  });
}

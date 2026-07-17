import type {
  AdapterObservation,
  ConfidenceSample,
  CorrectionInstrumentation,
  GeometryObservation,
  ProcessingObservation,
} from "./types.js";

const maximumObservationBundleBytes = 5_242_880;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export function parseObservationBundle(raw: Uint8Array): readonly AdapterObservation[] {
  if (raw.byteLength > maximumObservationBundleBytes) {
    throw new Error("OBSERVATION_BUNDLE_TOO_LARGE");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("OBSERVATION_BUNDLE_MALFORMED");
  }
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error("OBSERVATION_BUNDLE_INVALID_ROOT");
  }
  return Object.freeze(value.map((entry) => parseObservation(entry)));
}

function parseObservation(value: unknown): AdapterObservation {
  const object = record(value, "observation");
  const status = oneOf(object.status, ["abstained", "failed", "proposal"] as const, "status");
  const core = {
    adapterId: boundedString(object.adapterId, 3, 80, "adapterId"),
    adapterVersion: boundedString(object.adapterVersion, 1, 100, "adapterVersion"),
    crossScopeViolationCount: boundedInteger(
      object.crossScopeViolationCount,
      0,
      1_000,
      "crossScopeViolationCount",
    ),
    fixtureId: boundedString(object.fixtureId, 3, 200, "fixtureId"),
    ...(object.processing === undefined ? {} : { processing: parseProcessing(object.processing) }),
    sourceSha256: patternString(object.sourceSha256, sha256Pattern, "sourceSha256"),
  };
  if (status === "abstained") {
    exactKeys(object, [...Object.keys(core), "code", "status"], "abstention");
    return {
      ...core,
      code: boundedString(object.code, 3, 80, "code"),
      status,
    };
  }
  if (status === "failed") {
    exactKeys(object, [...Object.keys(core), "safeCode", "status"], "failure");
    return {
      ...core,
      safeCode: boundedString(object.safeCode, 3, 80, "safeCode"),
      status,
    };
  }
  exactKeys(
    object,
    [...Object.keys(core), "confidenceSamples", "correction", "geometry", "status"],
    "proposal",
    ["correction", "processing"],
  );
  if (!Array.isArray(object.confidenceSamples) || object.confidenceSamples.length > 1_000) {
    throw new Error("confidenceSamples must be a bounded array.");
  }
  return {
    ...core,
    confidenceSamples: object.confidenceSamples.map((entry) => parseConfidence(entry)),
    ...(object.correction === undefined ? {} : { correction: parseCorrection(object.correction) }),
    geometry: parseGeometry(object.geometry),
    status,
  };
}

function parseProcessing(value: unknown): ProcessingObservation {
  const object = record(value, "processing");
  exactKeys(object, ["cpuMilliseconds", "peakMemoryMebibytes", "wallMilliseconds"], "processing");
  return {
    cpuMilliseconds: boundedNumber(object.cpuMilliseconds, 0, 300_000, "cpuMilliseconds"),
    peakMemoryMebibytes: boundedNumber(
      object.peakMemoryMebibytes,
      0,
      1_000_000,
      "peakMemoryMebibytes",
    ),
    wallMilliseconds: boundedNumber(object.wallMilliseconds, 0, 300_000, "wallMilliseconds"),
  };
}

function parseCorrection(value: unknown): CorrectionInstrumentation {
  const object = record(value, "correction");
  exactKeys(object, ["actionCount", "automatedReviewMilliseconds", "humanStudy"], "correction");
  if (object.humanStudy !== false)
    throw new Error("Automated observations cannot claim a human study.");
  return {
    actionCount: boundedInteger(object.actionCount, 0, 10_000, "actionCount"),
    automatedReviewMilliseconds: boundedInteger(
      object.automatedReviewMilliseconds,
      0,
      86_400_000,
      "automatedReviewMilliseconds",
    ),
    humanStudy: false,
  };
}

function parseConfidence(value: unknown): ConfidenceSample {
  const object = record(value, "confidence sample");
  exactKeys(object, ["confidence", "correct", "kind"], "confidence sample");
  if (typeof object.correct !== "boolean") throw new Error("correct must be boolean.");
  return {
    confidence: boundedInteger(object.confidence, 0, 100, "confidence"),
    correct: object.correct,
    kind: oneOf(object.kind, ["level", "opening", "space", "wall"] as const, "kind"),
  };
}

function parseGeometry(value: unknown): GeometryObservation {
  const object = record(value, "geometry");
  exactKeys(
    object,
    [
      "calibrationResidualsMillimetres",
      "hiddenOmittedRegionCount",
      "invalidRoomCount",
      "levelCount",
      "openingCentreErrorsMillimetres",
      "unhostedOpeningCount",
      "wallEndpointErrorsMillimetres",
    ],
    "geometry",
  );
  return {
    calibrationResidualsMillimetres: numericArray(
      object.calibrationResidualsMillimetres,
      "calibrationResidualsMillimetres",
    ),
    hiddenOmittedRegionCount: boundedInteger(
      object.hiddenOmittedRegionCount,
      0,
      1_000,
      "hiddenOmittedRegionCount",
    ),
    invalidRoomCount: boundedInteger(object.invalidRoomCount, 0, 1_000, "invalidRoomCount"),
    levelCount: boundedInteger(object.levelCount, 0, 20, "levelCount"),
    openingCentreErrorsMillimetres: numericArray(
      object.openingCentreErrorsMillimetres,
      "openingCentreErrorsMillimetres",
    ),
    unhostedOpeningCount: boundedInteger(
      object.unhostedOpeningCount,
      0,
      1_000,
      "unhostedOpeningCount",
    ),
    wallEndpointErrorsMillimetres: numericArray(
      object.wallEndpointErrorsMillimetres,
      "wallEndpointErrorsMillimetres",
    ),
  };
}

function numericArray(value: unknown, name: string): readonly number[] {
  if (!Array.isArray(value) || value.length > 2_000) throw new Error(`${name} must be bounded.`);
  return value.map((entry) => boundedNumber(entry, 0, 10_000_000, name));
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  object: Record<string, unknown>,
  expectedKeys: readonly string[],
  name: string,
  optionalKeys: readonly string[] = [],
): void {
  const allowed = new Set(expectedKeys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${name} contains unknown field ${key}.`);
  }
  const optional = new Set(optionalKeys);
  for (const key of expectedKeys) {
    if (!optional.has(key) && !(key in object)) throw new Error(`${name} is missing ${key}.`);
  }
}

function boundedString(value: unknown, minimum: number, maximum: number, name: string): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new Error(`${name} is outside its string bounds.`);
  }
  return value;
}

function patternString(value: unknown, pattern: RegExp, name: string): string {
  const result = boundedString(value, 1, 200, name);
  if (!pattern.test(result)) throw new Error(`${name} has an invalid format.`);
  return result;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
  const result = boundedNumber(value, minimum, maximum, name);
  if (!Number.isInteger(result)) throw new Error(`${name} must be an integer.`);
  return result;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside its numeric bounds.`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${name} is not supported.`);
  }
  return value;
}

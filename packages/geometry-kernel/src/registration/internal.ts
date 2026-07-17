import type { RegistrationComputation, RegistrationKernelErrorCode } from "./types.js";

export const e9 = 1_000_000_000;
export const ppm = 1_000_000;
export const defaultCoordinateLimitMm = 10_000_000;

export function failure(
  code: RegistrationKernelErrorCode,
  detail: string,
): RegistrationComputation<never> {
  return deepFreeze({ error: { code, detail }, ok: false });
}

export function success<TValue>(value: TValue): RegistrationComputation<TValue> {
  return deepFreeze({ ok: true, value });
}

export function deepFreeze<TValue>(value: TValue): TValue {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(value);
}

export function hasOnlyKeys(value: unknown, allowed: ReadonlySet<string>): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowed.has(key));
}

export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("A positive denominator is required.");
  if (numerator < 0n) return -((-numerator + denominator / 2n) / denominator);
  return (numerator + denominator / 2n) / denominator;
}

export function quantileNearestRank(sorted: readonly number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

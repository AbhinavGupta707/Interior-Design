import { renderCameraSchema, type RenderCamera } from "@interior-design/contracts";

import { failRenderScene } from "./errors.js";
import type { BlenderCameraTransform, BlenderPointMetres } from "./types.js";

const millimetresPerMetre = 1_000;
const collinearityThreshold = 1 - 1e-12;

function canonicalNumber(value: number): number {
  if (!Number.isFinite(value)) return failRenderScene("CAMERA_INVALID");
  return Object.is(value, -0) ? 0 : value;
}

export function c4MillimetresToBlenderMetres(valueMm: number): number {
  if (!Number.isSafeInteger(valueMm)) return failRenderScene("INPUT_INVALID");
  return canonicalNumber(valueMm / millimetresPerMetre);
}

export function mapC4PointMmToBlenderMetres(point: {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
}): BlenderPointMetres {
  return Object.freeze({
    x: c4MillimetresToBlenderMetres(point.xMm),
    y: c4MillimetresToBlenderMetres(point.yMm),
    z: c4MillimetresToBlenderMetres(point.zMm),
  });
}

type Vector3 = readonly [number, number, number];

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    return failRenderScene("CAMERA_INVALID");
  }
  return vector.map((value) => canonicalNumber(value / length)) as unknown as Vector3;
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    canonicalNumber(left[1] * right[2] - left[2] * right[1]),
    canonicalNumber(left[2] * right[0] - left[0] * right[2]),
    canonicalNumber(left[0] * right[1] - left[1] * right[0]),
  ];
}

function dot(left: Vector3, right: Vector3): number {
  return canonicalNumber(left[0] * right[0] + left[1] * right[1] + left[2] * right[2]);
}

export function deriveBlenderCamera(input: RenderCamera): BlenderCameraTransform {
  const parsed = renderCameraSchema.safeParse(input);
  if (!parsed.success) return failRenderScene("CAMERA_INVALID");
  const camera = parsed.data;
  const position = mapC4PointMmToBlenderMetres(camera.position);
  const target = mapC4PointMmToBlenderMetres(camera.target);
  const forward = normalize([target.x - position.x, target.y - position.y, target.z - position.z]);
  const canonicalUp: Vector3 = [0, 0, 1];
  const usesFallback = Math.abs(dot(forward, canonicalUp)) >= collinearityThreshold;
  const upReference: Vector3 = usesFallback ? [0, 1, 0] : canonicalUp;
  const right = normalize(cross(forward, upReference));
  const up = normalize(cross(right, forward));
  const negativeForward = forward.map((value) => canonicalNumber(-value)) as unknown as Vector3;
  const verticalFovRadians = canonicalNumber((camera.verticalFovMilliDegrees * Math.PI) / 180_000);
  if (!(verticalFovRadians > 0 && verticalFovRadians < Math.PI)) {
    return failRenderScene("CAMERA_INVALID");
  }
  const rotationMatrix3x3: BlenderCameraTransform["rotationMatrix3x3"] = [
    right[0],
    up[0],
    negativeForward[0],
    right[1],
    up[1],
    negativeForward[1],
    right[2],
    up[2],
    negativeForward[2],
  ];
  return Object.freeze({
    clipEndMetres: c4MillimetresToBlenderMetres(camera.clipEndMm),
    clipStartMetres: c4MillimetresToBlenderMetres(camera.clipStartMm),
    collinearityPolicy: usesFallback
      ? "positive-y-world-up-fallback-v1"
      : "canonical-positive-z-up-v1",
    positionMetres: position,
    rotationMatrix3x3,
    verticalFovRadians,
  });
}

export const c14PhotometricLumensPerWatt = 683 as const;

export function pointLightPowerWatts(luminousFluxLumens: number): number {
  if (!Number.isSafeInteger(luminousFluxLumens) || luminousFluxLumens <= 0) {
    return failRenderScene("INPUT_INVALID");
  }
  return canonicalNumber(luminousFluxLumens / c14PhotometricLumensPerWatt);
}

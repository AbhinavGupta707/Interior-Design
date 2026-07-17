import { createHash } from "node:crypto";

import type {
  CaptureArtifactDescriptor,
  CaptureScope,
  WorkerLeaseInput,
} from "./reference-boundary.js";

export const alphaScope = Object.freeze({
  captureSessionId: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
} satisfies CaptureScope);

export const foreignScope = Object.freeze({
  captureSessionId: alphaScope.captureSessionId,
  projectId: alphaScope.projectId,
  tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} satisfies CaptureScope);

export const syntheticJSONBytes = new TextEncoder().encode(
  '{"fixture":"VISIBLY_SYNTHETIC_C7","schemaVersion":"c7-roomplan-normalized-v1"}',
);

export const syntheticJSONArtifact = Object.freeze({
  artifactId: "33333333-3333-4333-8333-333333333333",
  byteSize: syntheticJSONBytes.byteLength,
  contentType: "application/json",
  kind: "roomplan-normalized-json",
  sha256: createHash("sha256").update(syntheticJSONBytes).digest("hex"),
} satisfies CaptureArtifactDescriptor);

export const syntheticUSDZBytes = Uint8Array.from([
  0x50, 0x4b, 0x03, 0x04, 0x56, 0x49, 0x53, 0x49, 0x42, 0x4c, 0x59, 0x5f, 0x53, 0x59, 0x4e, 0x54,
  0x48, 0x45, 0x54, 0x49, 0x43,
]);

export const syntheticUSDZArtifact = Object.freeze({
  artifactId: "33333333-3333-4333-8333-333333333334",
  byteSize: syntheticUSDZBytes.byteLength,
  contentType: "model/vnd.usdz+zip",
  kind: "structure-usdz",
  sha256: createHash("sha256").update(syntheticUSDZBytes).digest("hex"),
} satisfies CaptureArtifactDescriptor);

export const validWorkerLease = Object.freeze({
  attempt: 1,
  cancelled: false,
  captureSessionId: alphaScope.captureSessionId,
  expectedAttempt: 1,
  inputBytes: 8_192,
  objectCount: 1,
  packageCaptureSessionId: alphaScope.captureSessionId,
  packageProjectId: alphaScope.projectId,
  packageTenantId: alphaScope.tenantId,
  projectId: alphaScope.projectId,
  rights: {
    serviceProcessingConsent: true,
    trainingUseConsent: "denied",
  },
  roomCount: 2,
  sharedWorldOrigin: true,
  surfaceCount: 2,
  tenantId: alphaScope.tenantId,
  transforms: [
    {
      basisNanounits: [1_000_000_000, 0, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
      translationMicrometres: { x: 0, y: 1_250_000, z: 0 },
    },
  ],
} satisfies WorkerLeaseInput);

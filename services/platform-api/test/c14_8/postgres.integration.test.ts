import type { Actor, CreateCaptureEnvelopeRequest } from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";
import { applyC4Migration } from "../../src/c4.js";
import { applyC5Migration } from "../../src/c5.js";
import { applyC6Migration } from "../../src/c6.js";
import { applyC14_8MigrationLifecycle, applyC7Migration } from "../../src/c7.js";
import { applyC8Migration } from "../../src/c8.js";
import { PostgresCaptureBackend } from "../../src/modules/capture/postgres.js";
import type {
  AbortMultipartUploadInput,
  AssetObjectStorage,
  CompleteMultipartUploadInput,
  CreateMultipartUploadInput,
  SignObjectAccessInput,
  SignUploadPartInput,
} from "../../src/storage/object-storage.js";
import { alphaTenantId } from "../c4/fixtures.js";
import { actors } from "../c6/support.js";

const databaseUrl =
  process.env.C14_8_TEST_DATABASE_URL ??
  process.env.C8_TEST_DATABASE_URL ??
  process.env.C7_TEST_DATABASE_URL ??
  "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const horizontalSectors = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;
const verticalBands = ["lower", "middle", "upper"] as const;
const semanticLayers = [
  "structural-evidence",
  "fixed-fittings",
  "movable-furniture",
  "appearance",
  "temporary-clutter",
] as const;

class C14_8StorageFixture implements AssetObjectStorage {
  abortMultipartUpload(_input: AbortMultipartUploadInput): Promise<void> {
    void _input;
    return Promise.resolve();
  }
  completeMultipartUpload(_input: CompleteMultipartUploadInput): Promise<void> {
    void _input;
    return Promise.resolve();
  }
  createMultipartUpload(_input: CreateMultipartUploadInput): Promise<string> {
    void _input;
    return Promise.resolve(`c14-8-${randomUUID()}`);
  }
  readiness(): Promise<void> {
    return Promise.resolve();
  }
  signObjectAccess(_input: SignObjectAccessInput) {
    void _input;
    return Promise.resolve({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      url: "https://storage.invalid/c14-8-object",
    });
  }
  signUploadPart(input: SignUploadPartInput) {
    return Promise.resolve({
      expiresAt: input.expiresAt.toISOString(),
      requiredHeaders: {
        "content-length": String(input.byteSize),
        "x-amz-checksum-sha256": input.checksumSha256,
      },
      url: "https://storage.invalid/c14-8-part",
    });
  }
}

function owner(): Actor {
  const actor = actors["fixture|owner-alpha"];
  if (actor === undefined) throw new Error("The C14.8 owner fixture is unavailable.");
  return actor;
}

function correlation(label: string, digit: string) {
  return { requestId: label, traceId: digit.repeat(32) };
}

function envelope(input: {
  readonly assetId: string;
  readonly captureSessionId: string;
  readonly projectId: string;
  readonly runtime?: "physical-device" | "simulator-fixture";
  readonly sha256?: string;
}): CreateCaptureEnvelopeRequest {
  const roomId = randomUUID();
  const segmentId = randomUUID();
  const sampleId = randomUUID();
  const runtime = input.runtime ?? "physical-device";
  const now = Date.now();
  return {
    cameraSamples: [
      {
        ambientIntensity: 900,
        blurScoreMillionths: 900_000,
        cameraIntrinsicsMicropixels: {
          cx: 960_000_000,
          cy: 720_000_000,
          fx: 1_500_000_000,
          fy: 1_500_000_000,
          imageHeightPixels: 1_440,
          imageWidthPixels: 1_920,
        },
        exposureScoreMillionths: 900_000,
        intrinsicsModel: "pinhole-native-camera-raster",
        motionScoreMillionths: 10_000,
        orientation: "landscape-right",
        poseTransform: "camera-to-world",
        quaternionOrder: "x-y-z-w",
        quaternionNanounits: [0, 0, 0, 1_000_000_000],
        roomId,
        sampleId,
        segmentId,
        sourceAssetId: input.assetId,
        sourceTimestampMicroseconds: 1_000_000,
        timestampMicroseconds: 1_000_000,
        trackingState: "normal",
        translationMicrometres: { x: 0, y: 1_500_000, z: 0 },
      },
    ],
    capabilities: {
      appBuild: "148",
      appVersion: "1.0.0",
      arWorldTracking: runtime === "physical-device",
      cameraIntrinsics: runtime === "physical-device",
      cameraPoses: runtime === "physical-device",
      deviceModelIdentifier: runtime === "physical-device" ? "iPhone13,2" : "Simulator",
      operatingSystemVersion: "26.0",
      qualityTier: runtime === "physical-device" ? "guided-rgb" : "simulator-fixture",
      rgbKeyframes: true,
      rgbVideo: false,
      roomPlan: false,
      runtime,
      sceneDepth: false,
      schemaVersion: "capture-capabilities-v1",
    },
    captureSessionId: input.captureSessionId,
    coordinateSegments: [
      {
        coordinateSystem: "arkit-right-handed-y-up",
        endedAtMicroseconds: 2_000_000,
        reason: "initial",
        segmentId,
        startedAtMicroseconds: 0,
        translationUnit: "micrometres",
        worldOriginRelationship: "independent-unless-later-registered",
      },
    ],
    depthSources: [],
    endedAt: new Date(now - 1_000).toISOString(),
    generator: { name: "ios-guided-capture", version: "1.0.0" },
    intent: "room-by-room",
    mediaSources: [
      {
        assetId: input.assetId,
        byteSize: 1_024,
        kind: "rgb-keyframe",
        mimeType: "image/jpeg",
        sha256: input.sha256 ?? "8".repeat(64),
        transfer: {
          partCount: 1,
          reconciledAt: new Date(now).toISOString(),
          resumable: true,
          state: "complete",
        },
      },
    ],
    projectId: input.projectId,
    quality: {
      interruptionCount: 0,
      lowLightSampleCount: 0,
      missingCoverageCellCount: 23,
      motionWarningSampleCount: 0,
      occludedCoverageCellCount: 0,
      trackingLimitedSampleCount: 0,
      unusableBlurSampleCount: 0,
    },
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    roomPlanSources: [],
    rooms: [
      {
        coordinateSegmentIds: [segmentId],
        coverage: horizontalSectors.flatMap((horizontalSector, horizontalIndex) =>
          verticalBands.map((verticalBand, verticalIndex) => ({
            horizontalSector,
            status: horizontalIndex === 0 && verticalIndex === 1 ? "observed" : "missing",
            verticalBand,
          })),
        ),
        label: "Living room",
        roomId,
        semanticDeclarations: semanticLayers.map((layer) => ({
          layer,
          provenance: "user-asserted",
          status: layer === "structural-evidence" ? "partially-observed" : "unknown",
        })),
        sequence: 1,
        story: 0,
      },
    ],
    schemaVersion: "capture-envelope-v1",
    startedAt: new Date(now - 3_000).toISOString(),
    transferState: "complete",
  };
}

describeWithPostgres("C14.8 live Postgres capture-envelope boundary", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    await applyC1Migration(sql);
    await bootstrapC1Fixtures(sql, "test");
    await applyC2Migration(sql);
    await applyC3Migration(sql);
    await applyC4Migration(sql);
    await applyC5Migration(sql);
    await applyC6Migration(sql);
    await applyC7Migration(sql);
    await applyC8Migration(sql);
    await applyC14_8MigrationLifecycle(sql);
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  it("binds exact current C2 evidence, rejects fixtures/withdrawals, and mutates no canonical state", async () => {
    const projectId = randomUUID();
    const assetId = randomUUID();
    await sql`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${alphaTenantId}::uuid, 'C14.8 synthetic live project')
    `;
    await sql`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key, status
      ) VALUES (
        ${assetId}::uuid, ${alphaTenantId}::uuid, ${projectId}::uuid, 'photograph',
        'c14-8-synthetic-room.jpg', 'image/jpeg', 'image/jpeg', 1024,
        ${"8".repeat(64)}, ${`sources/${randomUUID()}`}, 'ready'
      )
    `;
    await sql`
      INSERT INTO asset_rights_assertions (
        tenant_id, project_id, asset_id, basis,
        service_processing_consent, training_use_consent
      ) VALUES (
        ${alphaTenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'owned-by-user', true, 'denied'
      )
    `;
    const backend = new PostgresCaptureBackend(sql, new C14_8StorageFixture());
    const canonicalBefore = await sql<Array<{ readonly count: number }>>`
      SELECT count(*)::int AS count FROM canonical_model_snapshots
      WHERE project_id = ${projectId}::uuid
    `;
    const createSession = async (label: string) =>
      backend.createSession({
        actor: owner(),
        correlation: correlation(`c14-8-${label}`, "1"),
        idempotencyKey: `c14-8-session-${label}-${randomUUID()}`,
        projectId,
        request: {
          captureLabel: label,
          deviceCapability: "arkit-rgb",
          expectedRoomCount: 1,
          mode: "single-room",
          rights: {
            basis: "owned-by-user",
            serviceProcessingConsent: true,
            trainingUseConsent: "denied",
          },
        },
      });

    const session = (await createSession("accepted")).value;
    const request = envelope({ assetId, captureSessionId: session.id, projectId });
    const command = {
      actor: owner(),
      captureSessionId: session.id,
      correlation: correlation("c14-8-envelope-accept", "2"),
      idempotencyKey: `c14-8-envelope-${randomUUID()}`,
      projectId,
      request,
    };
    const accepted = await backend.acceptEnvelope(command);
    expect((await backend.acceptEnvelope(command)).value).toEqual(accepted.value);
    expect(accepted.value.envelope.capabilities.qualityTier).toBe("guided-rgb");
    expect(await backend.findEnvelope(randomUUID(), projectId, session.id)).toBeUndefined();
    expect(await backend.findEnvelope(alphaTenantId, projectId, session.id)).toEqual(
      accepted.value,
    );
    expect(await backend.findSession(alphaTenantId, projectId, session.id)).toMatchObject({
      state: "accepted",
    });
    await expect(
      backend.cancelSession({
        actor: owner(),
        captureSessionId: session.id,
        correlation: correlation("c14-8-cancel-accepted", "3"),
        idempotencyKey: `c14-8-cancel-${randomUUID()}`,
        projectId,
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_RESULT_IMMUTABLE" });
    await expect(
      sql`
        UPDATE capture_envelopes SET accepted_at = clock_timestamp()
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
          AND capture_session_id = ${session.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);

    const fixtureSession = (await createSession("fixture-rejected")).value;
    await expect(
      backend.acceptEnvelope({
        ...command,
        captureSessionId: fixtureSession.id,
        idempotencyKey: `c14-8-fixture-${randomUUID()}`,
        request: envelope({
          assetId,
          captureSessionId: fixtureSession.id,
          projectId,
          runtime: "simulator-fixture",
        }),
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_ENVELOPE_FIXTURE_NOT_ACCEPTABLE" });

    await sql`
      INSERT INTO reconstruction_rights_withdrawals (
        tenant_id, project_id, asset_id, reason_code, withdrawn_at
      ) VALUES (
        ${alphaTenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'RIGHTS_WITHDRAWN', clock_timestamp()
      )
    `;
    expect(await backend.findEnvelope(alphaTenantId, projectId, session.id)).toBeUndefined();
    const withdrawnSession = (await createSession("withdrawn-source")).value;
    await expect(
      backend.acceptEnvelope({
        ...command,
        captureSessionId: withdrawnSession.id,
        idempotencyKey: `c14-8-withdrawn-${randomUUID()}`,
        request: envelope({ assetId, captureSessionId: withdrawnSession.id, projectId }),
      }),
    ).rejects.toMatchObject({ code: "CAPTURE_ENVELOPE_SOURCE_BINDING_MISMATCH" });

    await backend.withdrawRights({
      actorUserId: owner().userId,
      captureSessionId: session.id,
      correlation: correlation("c14-8-rights-withdraw", "4"),
      projectId,
      reasonCode: "SERVICE_PROCESSING_REVOKED",
      tenantId: alphaTenantId,
    });
    expect(await backend.findEnvelope(alphaTenantId, projectId, session.id)).toBeUndefined();
    expect(await backend.findSession(alphaTenantId, projectId, session.id)).toMatchObject({
      state: "accepted",
    });
    const canonicalAfter = await sql<Array<{ readonly count: number }>>`
      SELECT count(*)::int AS count FROM canonical_model_snapshots
      WHERE project_id = ${projectId}::uuid
    `;
    expect(canonicalAfter).toEqual(canonicalBefore);
  });
});

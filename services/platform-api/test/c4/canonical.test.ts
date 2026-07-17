import {
  canonicalHomeSnapshotSchema,
  modelSnapshotRecordSchema,
  type ModelProfile,
  type ModelSnapshotRecord,
} from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { LocalCanonicalSnapshotCodec } from "../../src/modules/models/core/canonical.js";
import {
  CanonicalGeometryValidationError,
  CanonicalModelService,
  maximumCanonicalSnapshotByteLength,
} from "../../src/modules/models/core/service.js";
import type {
  AvailableModelProfileSummary,
  CanonicalModelRepository,
  CanonicalSnapshotCodec,
  CreateCanonicalSnapshotResult,
  PersistCanonicalSnapshotCommand,
} from "../../src/modules/models/core/types.js";
import {
  alphaProjectId,
  alphaTenantId,
  canonicalSnapshotFixture,
  ownerUserId,
} from "./fixtures.js";

const codec = new LocalCanonicalSnapshotCodec();

class RecordingRepository implements CanonicalModelRepository {
  readonly commands: PersistCanonicalSnapshotCommand[] = [];
  available: AvailableModelProfileSummary[] = [];

  createSnapshot(command: PersistCanonicalSnapshotCommand): Promise<CreateCanonicalSnapshotResult> {
    this.commands.push(command);
    const record = modelSnapshotRecordSchema.parse({
      canonicalByteLength: command.canonical.canonicalByteLength,
      createdAt: "2026-07-17T12:00:00.000Z",
      createdBy: command.actor.userId,
      id: "70000000-0000-4000-8000-000000000001",
      modelId: command.snapshot.modelId,
      profile: command.profile,
      projectId: command.projectId,
      schemaVersion: command.snapshot.schemaVersion,
      snapshot: command.canonical.snapshot,
      snapshotSha256: command.canonical.snapshotSha256,
      version: 1,
    });
    return Promise.resolve({ record, replayed: false });
  }

  getCurrentSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
  ): Promise<ModelSnapshotRecord | undefined> {
    void tenantId;
    void projectId;
    void profile;
    return Promise.resolve(undefined);
  }

  getSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    snapshotId: string,
  ): Promise<ModelSnapshotRecord | undefined> {
    void tenantId;
    void projectId;
    void profile;
    void snapshotId;
    return Promise.resolve(undefined);
  }

  listAvailableProfiles(): Promise<readonly AvailableModelProfileSummary[]> {
    return Promise.resolve(this.available);
  }
}

function createCommand(snapshot = canonicalSnapshotFixture()) {
  return {
    actor: {
      displayName: "Synthetic owner",
      role: "owner" as const,
      subject: "fixture|homeowner-alpha",
      tenantId: alphaTenantId,
      userId: ownerUserId,
    },
    correlation: {
      requestId: "c4-unit-request",
      spanId: "2".repeat(16),
      traceId: "1".repeat(32),
      traceParent: `00-${"1".repeat(32)}-${"2".repeat(16)}-00`,
    },
    expectedCurrentSnapshotSha256: null,
    idempotencyKey: "c4-unit-create-0001",
    profile: snapshot.profile,
    projectId: snapshot.projectId,
    snapshot,
  };
}

describe("C4 canonical snapshot fallback codec", () => {
  it("sorts entity collections without mutating input and hashes their canonical order", () => {
    const original = canonicalSnapshotFixture();
    const firstLevel = original.elements.levels[0];
    if (firstLevel === undefined) {
      throw new Error("Fixture must contain one level.");
    }
    const secondLevel = {
      ...firstLevel,
      id: "50000000-0000-4000-8000-000000000009",
    };
    const left = canonicalHomeSnapshotSchema.parse({
      ...original,
      elements: { ...original.elements, levels: [secondLevel, firstLevel] },
    });
    const right = canonicalHomeSnapshotSchema.parse({
      ...original,
      elements: { ...original.elements, levels: [firstLevel, secondLevel] },
    });

    const leftEncoding = codec.encode(left);
    const rightEncoding = codec.encode(right);

    expect(leftEncoding.snapshotSha256).toBe(rightEncoding.snapshotSha256);
    expect(leftEncoding.canonicalJson).toBe(rightEncoding.canonicalJson);
    expect(left.elements.levels.map(({ id }) => id)).toEqual([secondLevel.id, firstLevel.id]);
    expect(leftEncoding.snapshot.elements.levels.map(({ id }) => id)).toEqual([
      firstLevel.id,
      secondLevel.id,
    ]);
  });

  it("retains authored polygon order and changes the hash when point order changes", () => {
    const forward = canonicalSnapshotFixture();
    const space = forward.elements.spaces[0];
    if (space?.boundary.knowledge !== "known") {
      throw new Error("Fixture space requires a known synthetic boundary.");
    }
    const reversed = canonicalHomeSnapshotSchema.parse({
      ...forward,
      elements: {
        ...forward.elements,
        spaces: [
          {
            ...space,
            boundary: { ...space.boundary, value: [...space.boundary.value].reverse() },
          },
        ],
      },
    });
    expect(codec.encode(reversed).snapshotSha256).not.toBe(codec.encode(forward).snapshotSha256);
  });

  it("uses UTF-8 byte length and rejects non-I-JSON unpaired surrogate strings", () => {
    const unicode = canonicalSnapshotFixture({ limitationDetail: "Synthetic café limitation." });
    const encoded = codec.encode(unicode);
    expect(encoded.canonicalByteLength).toBe(Buffer.byteLength(encoded.canonicalJson, "utf8"));
    expect(encoded.canonicalByteLength).toBeGreaterThan(encoded.canonicalJson.length);

    const invalidUnicode = canonicalSnapshotFixture({
      limitationDetail: "Synthetic invalid surrogate \ud800 limitation.",
    });
    expect(() => codec.encode(invalidUnicode)).toThrow(/unpaired UTF-16 surrogate/u);
  });
});

describe("C4 canonical model service", () => {
  it("rejects error findings and persists deterministic warnings and information only", async () => {
    const rejectedRepository = new RecordingRepository();
    const rejected = new CanonicalModelService(rejectedRepository, codec, () => [
      {
        affectedElementIds: ["50000000-0000-4000-8000-000000000002"],
        code: "SPACE_SELF_INTERSECTION",
        location: {
          levelId: "50000000-0000-4000-8000-000000000001",
          xMm: 2_000,
          yMm: 1_500,
        },
        message: "Synthetic polygon self-intersects.",
        severity: "error",
      },
    ]);
    await expect(rejected.createSnapshot(createCommand())).rejects.toBeInstanceOf(
      CanonicalGeometryValidationError,
    );
    expect(rejectedRepository.commands).toHaveLength(0);

    const acceptedRepository = new RecordingRepository();
    const accepted = new CanonicalModelService(acceptedRepository, codec, () => [
      {
        affectedElementIds: ["50000000-0000-4000-8000-000000000001"],
        code: "UNKNOWN_STOREY_HEIGHT",
        message: "Storey height remains explicitly unknown.",
        severity: "warning",
      },
      {
        affectedElementIds: [],
        code: "SYNTHETIC_INPUT",
        message: "This is a synthetic fixture.",
        severity: "information",
      },
    ]);
    await accepted.createSnapshot(createCommand());
    expect(acceptedRepository.commands[0]?.retainedGeometryFindings).toEqual([
      expect.objectContaining({ code: "SYNTHETIC_INPUT", severity: "information" }),
      expect.objectContaining({ code: "UNKNOWN_STOREY_HEIGHT", severity: "warning" }),
    ]);
  });

  it("returns exactly the three frozen profile summaries with explicit empty states", async () => {
    const repository = new RecordingRepository();
    repository.available = [
      {
        currentSnapshotId: "70000000-0000-4000-8000-000000000001",
        currentSnapshotSha256: "a".repeat(64),
        modelId: "40000000-0000-4000-8000-000000000001",
        profile: "existing",
        status: "available",
        updatedAt: "2026-07-17T12:00:00.000Z",
        version: 1,
      },
    ];
    const service = new CanonicalModelService(repository, codec, () => []);
    await expect(service.listProfiles(alphaTenantId, alphaProjectId)).resolves.toEqual({
      profiles: [
        expect.objectContaining({ profile: "existing", status: "available" }),
        { profile: "proposed", status: "empty" },
        { profile: "as-built", status: "empty" },
      ],
      projectId: alphaProjectId,
    });
  });

  it("enforces the frozen 10 MiB canonical record ceiling independently of transport", async () => {
    const repository = new RecordingRepository();
    const snapshot = canonicalSnapshotFixture();
    const oversizedCodec: CanonicalSnapshotCodec = {
      encode: () => ({
        canonicalByteLength: maximumCanonicalSnapshotByteLength + 1,
        canonicalJson: "{}",
        snapshot,
        snapshotSha256: "a".repeat(64),
      }),
    };
    const service = new CanonicalModelService(repository, oversizedCodec, () => []);
    await expect(service.createSnapshot(createCommand(snapshot))).rejects.toMatchObject({
      code: "CANONICAL_SNAPSHOT_TOO_LARGE",
      statusCode: 413,
    });
    expect(repository.commands).toHaveLength(0);
  });
});

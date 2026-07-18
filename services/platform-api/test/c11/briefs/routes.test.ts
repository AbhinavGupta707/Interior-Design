import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../../src/correlation.js";
import { registerErrorHandling } from "../../../src/errors.js";
import { InMemoryBriefRepository } from "../../../src/modules/briefs/memory.js";
import { registerBriefRoutes } from "../../../src/modules/briefs/routes.js";
import { BriefService } from "../../../src/modules/briefs/service.js";
import type { InMemoryBriefSourceVerifier } from "../../../src/modules/briefs/sources.js";
import { FixtureProjectRepository, fixtureIdentity, tokenFor } from "../../c6/support.js";
import {
  FixtureBriefKernel,
  alphaProjectId,
  alphaTenantId,
  assistantEntry,
  briefId,
  c11Now,
  entryId,
  evidenceEntry,
  householdEntry,
  referenceItem,
  secondEntryId,
  snapshotId,
  sourceVerifier,
} from "./support.js";

function authorization(subject: Parameters<typeof tokenFor>[0]) {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

function updateRequest(
  subject: Parameters<typeof tokenFor>[0],
  expectedRevision: number,
  operations: readonly object[],
  idempotencyKey = randomUUID(),
) {
  return {
    headers: authorization(subject),
    method: "PUT" as const,
    payload: { expectedRevision, idempotencyKey, operations },
    url: `/v1/projects/${alphaProjectId}/design-brief`,
  };
}

describe("C11 design-brief routes", () => {
  let repository: InMemoryBriefRepository;
  let server: FastifyInstance;
  let sources: InMemoryBriefSourceVerifier;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    repository = new InMemoryBriefRepository(new FixtureBriefKernel(), {
      clock: { now: () => new Date(c11Now) },
      uuid: { randomUUID: () => briefId },
    });
    sources = sourceVerifier();
    const service = new BriefService({ repository, sources });
    registerBriefRoutes(server, fixtureIdentity(), new FixtureProjectRepository(), service);
  });

  afterEach(async () => server.close());

  it("creates, reads and exactly replays an attributable draft", async () => {
    const key = randomUUID();
    const request = updateRequest(
      "fixture|owner-alpha",
      0,
      [{ entry: householdEntry(), kind: "entry.add" }],
      key,
    );
    const created = await server.inject(request);
    const replayed = await server.inject(request);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ id: briefId, revision: 1, status: "draft" });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(replayed.json()).toEqual(created.json());
    const read = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: request.url,
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("private, no-store");
    expect(read.json()).toEqual(created.json());

    const conflictingReplay = await server.inject(
      updateRequest(
        "fixture|owner-alpha",
        0,
        [{ entry: householdEntry(secondEntryId), kind: "entry.add" }],
        key,
      ),
    );
    expect(conflictingReplay.statusCode).toBe(409);
    expect(conflictingReplay.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces role and tenant scope before resource disclosure", async () => {
    const missing = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/design-brief`,
    });
    expect(missing.statusCode).toBe(404);
    const viewerWrite = await server.inject(
      updateRequest("fixture|viewer-alpha", 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    expect(viewerWrite.statusCode).toBe(403);
    const foreignRead = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/design-brief`,
    });
    const foreignWrite = await server.inject(
      updateRequest("fixture|owner-beta", 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    expect(foreignRead.statusCode).toBe(404);
    expect(foreignWrite.statusCode).toBe(404);
    expect(
      await repository.listHistory("20000000-0000-4000-8000-000000000001", alphaProjectId),
    ).toEqual([]);
  });

  it("requires proposal confirmation for assistant provenance and accepts actor corrections", async () => {
    const forged = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [
        {
          entry: {
            ...householdEntry(),
            provenance: {
              ...householdEntry().provenance,
              statedByUserId: randomUUID(),
            },
          },
          kind: "entry.add",
        },
      ]),
    );
    expect(forged.statusCode).toBe(409);
    expect(forged.json()).toMatchObject({ code: "BRIEF_USER_PROVENANCE_FORGED" });

    const missingMessageId = randomUUID();
    const missing = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [
        {
          entry: {
            ...assistantEntry(),
            provenance: {
              ...assistantEntry().provenance,
              sourceMessageId: missingMessageId,
            },
          },
          kind: "entry.add",
        },
      ]),
    );
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({
      code: "BRIEF_ASSISTANT_PROVENANCE_REQUIRES_PROPOSAL",
    });

    const foreignMessageId = randomUUID();
    sources.messages.set(`${alphaTenantId}:${alphaProjectId}:${foreignMessageId}`, {
      contentSha256: "f".repeat(64),
      createdAt: c11Now,
      messageId: foreignMessageId,
      projectId: "30000000-0000-4000-8000-000000000002",
      sessionId: randomUUID(),
      tenantId: alphaTenantId,
    });
    const foreign = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [
        {
          entry: {
            ...assistantEntry(),
            provenance: {
              ...assistantEntry().provenance,
              sourceMessageId: foreignMessageId,
            },
          },
          kind: "entry.add",
        },
      ]),
    );
    expect(foreign.statusCode).toBe(409);
    expect(foreign.json()).toMatchObject({
      code: "BRIEF_ASSISTANT_PROVENANCE_REQUIRES_PROPOSAL",
    });

    const unconfirmed = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [{ entry: assistantEntry(), kind: "entry.add" }]),
    );
    expect(unconfirmed.statusCode).toBe(409);
    expect(unconfirmed.json()).toMatchObject({
      code: "BRIEF_ASSISTANT_PROVENANCE_REQUIRES_PROPOSAL",
    });
    const valid = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    expect(valid.statusCode).toBe(200);
    const validBody = valid.json<{
      readonly entries: ReadonlyArray<{
        readonly provenance: { readonly method: string; readonly statedByUserId?: string };
      }>;
      readonly revision: number;
    }>();
    expect(validBody.revision).toBe(1);
    expect(validBody.entries[0]?.provenance).toMatchObject({ method: "user-stated" });
  });

  it("permits exactly one concurrent expected-revision writer", async () => {
    await server.inject(
      updateRequest("fixture|owner-alpha", 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    const responses = await Promise.all([
      server.inject(
        updateRequest("fixture|editor-alpha", 1, [
          { entry: householdEntry(secondEntryId), kind: "entry.add" },
        ]),
      ),
      server.inject(
        updateRequest("fixture|owner-alpha", 1, [
          {
            entry: householdEntry("b1000000-0000-4000-8000-000000000099"),
            kind: "entry.add",
          },
        ]),
      ),
    ]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(
      await repository.listHistory("10000000-0000-4000-8000-000000000001", alphaProjectId),
    ).toHaveLength(2);
  });

  it("rejects withdrawn-only and empty brief acceptance at the API boundary", async () => {
    const withdrawn = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [
        { entry: { ...householdEntry(), status: "withdrawn" }, kind: "entry.add" },
      ]),
    );
    expect(withdrawn.statusCode).toBe(200);
    const acceptWithdrawn = await server.inject({
      headers: authorization("fixture|owner-alpha"),
      method: "POST",
      payload: { expectedRevision: 1, idempotencyKey: randomUUID() },
      url: `/v1/projects/${alphaProjectId}/design-brief/accept`,
    });
    expect(acceptWithdrawn.statusCode).toBe(422);
    expect(acceptWithdrawn.json()).toMatchObject({ code: "BRIEF_ACCEPTANCE_EMPTY" });
    const empty = await server.inject(
      updateRequest("fixture|owner-alpha", 1, [{ entryId, kind: "entry.remove" }]),
    );
    expect(empty.statusCode).toBe(200);
    const acceptEmpty = await server.inject({
      headers: authorization("fixture|owner-alpha"),
      method: "POST",
      payload: { expectedRevision: 2, idempotencyKey: randomUUID() },
      url: `/v1/projects/${alphaProjectId}/design-brief/accept`,
    });
    expect(acceptEmpty.statusCode).toBe(422);
    expect(acceptEmpty.json()).toMatchObject({ code: "BRIEF_ACCEPTANCE_EMPTY" });
    expect(await repository.listAcceptances(alphaTenantId, alphaProjectId)).toHaveLength(0);
  });

  it("records acceptance history and requires an edit to reopen", async () => {
    const created = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    expect(created.statusCode).toBe(200);
    const acceptance = {
      headers: authorization("fixture|editor-alpha"),
      method: "POST" as const,
      payload: { expectedRevision: 1, idempotencyKey: randomUUID() },
      url: `/v1/projects/${alphaProjectId}/design-brief/accept`,
    };
    const accepted = await server.inject(acceptance);
    const replayed = await server.inject(acceptance);
    expect(accepted.json()).toMatchObject({ revision: 2, status: "accepted" });
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    const duplicate = await server.inject({
      ...acceptance,
      payload: { expectedRevision: 2, idempotencyKey: randomUUID() },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "BRIEF_ALREADY_ACCEPTED" });
    const reopened = await server.inject(
      updateRequest("fixture|owner-alpha", 2, [
        { entry: householdEntry(secondEntryId), kind: "entry.add" },
      ]),
    );
    expect(reopened.json()).toMatchObject({ revision: 3, status: "draft" });
    expect(reopened.json()).not.toHaveProperty("acceptedAt");
    expect(
      await repository.listAcceptances("10000000-0000-4000-8000-000000000001", alphaProjectId),
    ).toHaveLength(1);
    expect(
      (await repository.listHistory("10000000-0000-4000-8000-000000000001", alphaProjectId)).map(
        ({ reason }) => reason,
      ),
    ).toEqual(["created", "accepted", "reopened"]);
  });

  it("validates exact C2 sources and rights hashes before mutation", async () => {
    const created = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [
        { entry: evidenceEntry(), kind: "entry.add" },
        { item: referenceItem(), kind: "reference.add" },
      ]),
    );
    expect(created.statusCode).toBe(200);
    const wrongRights = await server.inject(
      updateRequest("fixture|owner-alpha", 1, [
        {
          item: { ...referenceItem(), id: randomUUID(), rightsRecordSha256: "d".repeat(64) },
          kind: "reference.add",
        },
      ]),
    );
    expect(wrongRights.statusCode).toBe(409);
    expect(wrongRights.json()).toMatchObject({ code: "BRIEF_SOURCE_RIGHTS_CHANGED" });
    const missingAsset = await server.inject(
      updateRequest("fixture|owner-alpha", 1, [
        {
          entry: {
            ...evidenceEntry(secondEntryId),
            provenance: { assetId: randomUUID(), capturedAt: c11Now, method: "evidence-linked" },
          },
          kind: "entry.add",
        },
      ]),
    );
    expect(missingAsset.statusCode).toBe(409);
    expect(missingAsset.json()).toMatchObject({ code: "BRIEF_SOURCE_NOT_FOUND" });
    const missingSnapshot = await server.inject(
      updateRequest("fixture|owner-alpha", 1, [
        {
          entry: {
            ...householdEntry(secondEntryId),
            classification: "observed-evidence",
            provenance: {
              capturedAt: c11Now,
              method: "system-derived",
              sourceSnapshotId: randomUUID(),
            },
          },
          kind: "entry.add",
        },
      ]),
    );
    expect(missingSnapshot.statusCode).toBe(409);
    expect(missingSnapshot.json()).toMatchObject({ code: "BRIEF_SNAPSHOT_NOT_FOUND" });
    const exactSnapshot = await server.inject(
      updateRequest("fixture|owner-alpha", 1, [
        {
          entry: {
            ...householdEntry(secondEntryId),
            classification: "observed-evidence",
            provenance: {
              capturedAt: c11Now,
              method: "system-derived",
              sourceSnapshotId: snapshotId,
            },
          },
          kind: "entry.add",
        },
      ]),
    );
    expect(exactSnapshot.statusCode).toBe(200);
    expect(
      await repository.listHistory("10000000-0000-4000-8000-000000000001", alphaProjectId),
    ).toHaveLength(2);
  });

  it("rejects stale and severe malformed bodies without side effects", async () => {
    const extra = await server.inject({
      ...updateRequest("fixture|owner-alpha", 0, [{ entry: householdEntry(), kind: "entry.add" }]),
      payload: {
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        operations: [{ entry: householdEntry(), kind: "entry.add" }],
        rawPrompt: "must never be accepted",
      },
    });
    expect(extra.statusCode).toBe(400);
    const malformed = await server.inject(
      updateRequest("fixture|owner-alpha", 0, [
        { entry: { ...householdEntry(), statement: "" }, kind: "entry.add" },
      ]),
    );
    expect(malformed.statusCode).toBe(400);
    expect(
      await repository.listHistory("10000000-0000-4000-8000-000000000001", alphaProjectId),
    ).toEqual([]);
  });

  it("keeps audit results bounded and free of private brief content", async () => {
    await server.inject(
      updateRequest("fixture|owner-alpha", 0, [{ entry: householdEntry(), kind: "entry.add" }]),
    );
    const audit = await repository.listAudit(
      "10000000-0000-4000-8000-000000000001",
      alphaProjectId,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(
      /closed storage|statement|message|operations|prompt/iu,
    );
    expect(audit[0]).toMatchObject({ action: "brief.create", revision: 1 });
    expect(audit[0]?.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(entryId).toBeDefined();
  });
});

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { registerModelFusionRoutes } from "../../src/modules/model-fusion/routes.js";
import { ModelFusionService } from "../../src/modules/model-fusion/service.js";
import { alphaProjectId } from "../c4/fixtures.js";
import { FixtureProjectRepository, fixtureIdentity, tokenFor } from "../c6/support.js";
import {
  branch,
  discrepancyId,
  fusionRequest,
  MemoryFusionRepository,
  MemoryFusionVerification,
  publishSyntheticProposal,
} from "./support.js";

function authorization(subject: Parameters<typeof tokenFor>[0]) {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

describe("C9 public model-fusion routes", () => {
  let repository: MemoryFusionRepository;
  let server: FastifyInstance;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    repository = new MemoryFusionRepository();
    const verification = new MemoryFusionVerification();
    registerModelFusionRoutes(
      server,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      new ModelFusionService({
        baseVerifier: verification,
        repository,
        sourceVerifier: verification,
      }),
    );
  });

  afterEach(async () => server.close());

  it("creates and exactly replays, then lets a viewer list and read without mutation", async () => {
    const url = `/v1/projects/${alphaProjectId}/fusion-jobs`;
    const request = {
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c9-route-create-0001",
      },
      method: "POST" as const,
      payload: fusionRequest,
      url,
    };
    const created = await server.inject(request);
    const replayed = await server.inject(request);
    expect(created.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(replayed.json()).toEqual(created.json());
    const job = created.json<{ readonly id: string }>();
    const listed = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ readonly jobs: unknown[] }>().jobs).toHaveLength(1);
    expect(
      (
        await server.inject({
          headers: authorization("fixture|viewer-alpha"),
          method: "GET",
          url: `${url}/${job.id}`,
        })
      ).statusCode,
    ).toBe(200);
  });

  it("enforces viewer read-only behavior and foreign-tenant non-disclosure", async () => {
    const url = `/v1/projects/${alphaProjectId}/fusion-jobs`;
    const viewer = await server.inject({
      headers: {
        ...authorization("fixture|viewer-alpha"),
        "idempotency-key": "c9-viewer-create-0001",
      },
      method: "POST",
      payload: fusionRequest,
      url,
    });
    expect(viewer.statusCode).toBe(403);
    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url,
    });
    expect(foreign.statusCode).toBe(404);
    expect(repository.jobs.size).toBe(0);
  });

  it("requires optimistic versions for cancellation and retry fencing", async () => {
    const url = `/v1/projects/${alphaProjectId}/fusion-jobs`;
    const created = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c9-transition-create-0001",
      },
      method: "POST",
      payload: fusionRequest,
      url,
    });
    const first = created.json<{ readonly id: string; readonly version: number }>();
    const stale = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c9-transition-stale-0001",
      },
      method: "POST",
      payload: { expectedVersion: 99 },
      url: `${url}/${first.id}/cancel`,
    });
    expect(stale.statusCode).toBe(409);
    const cancelled = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c9-transition-cancel-0001",
      },
      method: "POST",
      payload: { expectedVersion: first.version },
      url: `${url}/${first.id}/cancel`,
    });
    const terminal = cancelled.json<{ readonly version: number }>();
    const retried = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c9-transition-retry-0001",
      },
      method: "POST",
      payload: { expectedVersion: terminal.version },
      url: `${url}/${first.id}/retry`,
    });
    expect(retried.json()).toMatchObject({ attempt: 2, state: "queued" });
  });

  it("records attributed decisions and emits only an exact branch-pinned C5 draft", async () => {
    const url = `/v1/projects/${alphaProjectId}/fusion-jobs`;
    const created = await server.inject({
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c9-review-create-0001",
      },
      method: "POST",
      payload: fusionRequest,
      url,
    });
    const job = created.json<{ readonly id: string }>();
    const current = repository.jobs.get(job.id);
    if (!current) throw new Error("Synthetic C9 job is missing.");
    const proposal = publishSyntheticProposal(repository, current);

    const review = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c9-review-decision-0001",
      },
      method: "POST",
      payload: {
        decisions: [
          {
            choice: "accept-candidate",
            correctedOperations: [],
            discrepancyId,
            reason: "The visibly synthetic source claim is the reviewed choice.",
          },
        ],
        expectedProposalVersion: proposal.version,
      },
      url: `${url}/${job.id}/proposal/discrepancy-decisions`,
    });
    expect(review.statusCode).toBe(200);
    const reviewed = review.json<{
      readonly decisions: readonly { readonly id: string; readonly decidedBy: string }[];
      readonly proposal: { readonly version: number };
    }>();
    expect(reviewed.decisions[0]?.decidedBy).toBeDefined();
    expect(reviewed.proposal.version).toBe(2);

    const draft = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c9-review-draft-0001",
      },
      method: "POST",
      payload: {
        branchId: branch.id,
        decisionIds: reviewed.decisions.map(({ id }) => id),
        expectedBranchRevision: branch.revision,
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedProposalVersion: reviewed.proposal.version,
      },
      url: `${url}/${job.id}/proposal/operation-drafts`,
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({
      branchId: branch.id,
      expectedBranchRevision: 0,
      expectedHeadSnapshotSha256: branch.headSnapshotSha256,
      operations: [{ type: "space.rename.v1" }],
    });
    expect(JSON.stringify(draft.json())).not.toMatch(/preview|commit|canonicalWrite|signedUrl/u);
  });
});

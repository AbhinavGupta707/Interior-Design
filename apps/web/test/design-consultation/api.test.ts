import { describe, expect, it, vi } from "vitest";

import {
  ConsultationProblem,
  createConsultationClient,
} from "../../src/features/design-consultation/api";
import {
  buildBriefInitializationRequest,
  intakeBriefFacts,
} from "../../src/features/design-consultation/brief-initialization";
import { brief, consultation, ids, intakeSeed, proposal, workspace } from "./fixtures";

function bodyText(init: RequestInit): string {
  if (typeof init.body !== "string") throw new Error("Expected a JSON string body");
  return init.body;
}

describe("C11 browser client", () => {
  it("strictly validates the composed workspace", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(workspace));
    await expect(createConsultationClient(transport).loadWorkspace(ids.project)).resolves.toEqual(
      workspace,
    );
    expect(transport).toHaveBeenCalledWith(
      `/api/c11/projects/${ids.project}/workspace`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("uses only C11 paths for brief writes and preserves revision/idempotency", async () => {
    const originalAssistantOperations = structuredClone(proposal.operations);
    const transport = vi.fn().mockResolvedValue(Response.json({ ...brief, revision: 4 }));
    await createConsultationClient(transport).confirmProposal(
      ids.project,
      proposal,
      brief.revision,
    );
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(bodyText(init)) as Record<string, unknown>;
    expect(url).toBe(
      `/api/c11/projects/${ids.project}/design-consultations/${ids.session}/proposals/${ids.proposal}/confirm`,
    );
    expect(url).not.toMatch(/model|snapshot|operation-drafts/u);
    expect(body.expectedBriefRevision).toBe(brief.revision);
    expect(body).not.toHaveProperty("operations");
    expect(new Headers(init.headers).get("idempotency-key")).toBe(body.idempotencyKey);
    expect(proposal.operations).toEqual(originalAssistantOperations);
  });

  it("reuses the deterministic initialization body and key for revision zero", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json({ ...brief, revision: 1 }));
    const selected = new Set(intakeBriefFacts(intakeSeed).map(({ key }) => key));
    const initialization = await buildBriefInitializationRequest(intakeSeed, selected, ids.user);
    await createConsultationClient(transport).initializeBrief(ids.project, initialization);
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/c11/projects/" + ids.project + "/design-brief");
    expect(JSON.parse(bodyText(init))).toEqual(initialization);
    expect(new Headers(init.headers).get("idempotency-key")).toBe(initialization.idempotencyKey);
  });

  it("closes the exact session after a corrected update and reports cleanup failure", async () => {
    const updated = { ...brief, revision: 4 };
    const successTransport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(updated))
      .mockResolvedValueOnce(
        Response.json({
          ...consultation,
          cancelledAt: "2026-07-18T09:15:00.000Z",
          state: "cancelled",
        }),
      );
    const success = await createConsultationClient(successTransport).applyCorrectedBriefPatch(
      ids.project,
      ids.session,
      brief,
      proposal.operations,
      ids.user,
      "2026-07-18T09:10:00.000Z",
    );
    expect(success.kind).toBe("closed");
    const [firstUrl, firstInit] = successTransport.mock.calls[0] as [string, RequestInit];
    const [secondUrl] = successTransport.mock.calls[1] as [string, RequestInit];
    expect([firstUrl, secondUrl]).toEqual([
      "/api/c11/projects/" + ids.project + "/design-brief",
      "/api/c11/projects/" + ids.project + "/design-consultations/" + ids.session + "/cancel",
    ]);
    const correctedBody = JSON.parse(bodyText(firstInit)) as {
      operations: typeof proposal.operations;
    };
    const correctedOperation = correctedBody.operations[0];
    expect(correctedOperation?.kind).toBe("entry.add");
    if (correctedOperation?.kind !== "entry.add") throw new Error("Expected entry.add");
    expect(correctedOperation.entry.provenance).toEqual({
      capturedAt: "2026-07-18T09:10:00.000Z",
      method: "user-stated",
      statedByUserId: ids.user,
    });
    expect(correctedOperation.entry.provenance).not.toHaveProperty("sourceMessageId");

    const failureTransport = vi
      .fn()
      .mockResolvedValueOnce(Response.json(updated))
      .mockResolvedValueOnce(Response.json({ detail: "unavailable" }, { status: 503 }));
    const failure = await createConsultationClient(failureTransport).applyCorrectedBriefPatch(
      ids.project,
      ids.session,
      brief,
      proposal.operations,
      ids.user,
      "2026-07-18T09:10:00.000Z",
    );
    expect(failure).toMatchObject({ brief: updated, kind: "cleanup-failed" });
    expect(failureTransport).toHaveBeenCalledTimes(2);
  });

  it("treats a turn as proposal creation rather than a brief mutation", async () => {
    const transport = vi.fn().mockResolvedValue(Response.json(proposal));
    const result = await createConsultationClient(transport).submitTurn(
      ids.project,
      consultation.id,
      brief.revision,
      "Keep this <script>displayed as data</script>.",
    );
    expect(result.status).toBe("pending");
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(bodyText(init)) as Record<string, unknown>;
    expect(url).toMatch(/\/turns$/u);
    expect(body.expectedBriefRevision).toBe(brief.revision);
    expect(body.message).toContain("<script>");
  });

  it("fails closed for malformed, offline, stale and expired responses", async () => {
    const malformed = createConsultationClient(
      vi.fn().mockResolvedValue(Response.json({ externalNetworkUsed: true })),
    );
    await expect(malformed.loadWorkspace(ids.project)).rejects.toMatchObject({
      kind: "invalid-response",
    });

    const offline = createConsultationClient(vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(offline.loadWorkspace(ids.project)).rejects.toBeInstanceOf(ConsultationProblem);

    const conflict = createConsultationClient(
      vi.fn().mockResolvedValue(Response.json({ detail: "Reload." }, { status: 409 })),
    );
    await expect(conflict.acceptBrief(ids.project, brief)).rejects.toMatchObject({
      kind: "conflict",
    });

    const expired = createConsultationClient(
      vi.fn().mockResolvedValue(Response.json({ detail: "Expired." }, { status: 410 })),
    );
    await expect(expired.getProposal(ids.project, ids.session, ids.proposal)).rejects.toMatchObject(
      {
        kind: "proposal-expired",
      },
    );
  });
});

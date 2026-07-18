import { describe, expect, it } from "vitest";

import { DesignAgentService } from "../../../src/modules/design-agent/service.js";
import {
  alphaOwner,
  CapturingTelemetry,
  correlation,
  FakeModelPort,
  fixtureIds,
  MemoryBriefCommandPort,
  MemoryDesignAgentRepository,
  MutableClock,
  SequenceUuidFactory,
  validModelResult,
} from "./support.js";

function harness(
  providerMode: "deterministic-local" | "external-disabled" = "deterministic-local",
) {
  const clock = new MutableClock();
  const model = new FakeModelPort();
  const repository = new MemoryDesignAgentRepository();
  const briefs = new MemoryBriefCommandPort(repository);
  const telemetry = new CapturingTelemetry();
  const service = new DesignAgentService({
    briefs,
    clock,
    model,
    repository,
    telemetry,
    uuid: new SequenceUuidFactory(),
  });
  const create = () =>
    service.createSession({
      actor: alphaOwner,
      correlation,
      projectId: fixtureIds.alphaProject,
      request: {
        baseBriefId: fixtureIds.brief,
        baseBriefRevision: 1,
        idempotencyKey: fixtureIds.idempotency,
        providerMode,
      },
    });
  const submit = (message = "We prefer warm oak.") =>
    service.submitTurn({
      actor: alphaOwner,
      correlation,
      projectId: fixtureIds.alphaProject,
      request: {
        clientMessageId: fixtureIds.message,
        expectedBriefRevision: 1,
        message,
      },
      sessionId: fixtureIds.session,
    });
  const confirm = () => {
    clock.current = new Date(clock.current.getTime() + 1_000);
    return service.confirmProposal({
      actor: alphaOwner,
      correlation,
      projectId: fixtureIds.alphaProject,
      proposalId: fixtureIds.proposal,
      request: {
        expectedBriefRevision: 1,
        idempotencyKey: fixtureIds.confirmIdempotency,
      },
      sessionId: fixtureIds.session,
    });
  };
  return { briefs, clock, confirm, create, model, repository, service, submit, telemetry };
}

describe("C11 design-agent proposal orchestration", () => {
  it("replays a completed session create before mutable brief validation", async () => {
    const replay = harness();
    const created = await replay.create();
    replay.briefs.current = { ...replay.briefs.current, revision: 2 };
    await expect(replay.create()).resolves.toEqual({ replayed: true, session: created.session });
    await expect(
      replay.service.createSession({
        actor: alphaOwner,
        correlation,
        projectId: fixtureIds.alphaProject,
        request: {
          baseBriefId: fixtureIds.brief,
          baseBriefRevision: 1,
          idempotencyKey: fixtureIds.idempotency,
          providerMode: "external-disabled",
        },
      }),
    ).rejects.toThrow(/idempotency conflict/iu);
    await expect(
      replay.service.createSession({
        actor: alphaOwner,
        correlation,
        projectId: fixtureIds.alphaProject,
        request: {
          baseBriefId: fixtureIds.brief,
          baseBriefRevision: 1,
          idempotencyKey: "18888888-8888-4888-8888-888888888888",
          providerMode: "deterministic-local",
        },
      }),
    ).rejects.toMatchObject({ code: "DESIGN_AGENT_STALE_BRIEF", statusCode: 409 });
  });

  it("creates a bounded local session, persists a proposal without mutation, then confirms through the brief command port", async () => {
    const { briefs, confirm, create, model, repository, submit } = harness();
    const created = await create();
    expect(created).toMatchObject({
      replayed: false,
      session: {
        baseBriefId: fixtureIds.brief,
        baseBriefRevision: 1,
        providerMode: "deterministic-local",
        state: "active",
      },
    });

    const proposed = await submit();
    expect(proposed.turn.proposal).toMatchObject({
      baseBriefId: fixtureIds.brief,
      baseBriefRevision: 1,
      projectId: fixtureIds.alphaProject,
      status: "pending",
    });
    expect(proposed.turn.proposal.operations).toHaveLength(1);
    expect(briefs.updateCalls).toHaveLength(0);
    expect(model.requests[0]).toMatchObject({
      adapterId: "deterministic-local-v1",
      promptId: "c11-consultation-extract-v1",
      toolId: "c11.propose-brief-patch-v1",
    });

    const confirmed = await confirm();
    expect(confirmed).toMatchObject({
      briefRevision: 2,
      proposal: { status: "confirmed" },
      replayed: false,
    });
    expect(briefs.updateCalls).toHaveLength(1);
    expect(briefs.updateCalls[0]?.request).toMatchObject({
      expectedRevision: 1,
      operations: [{ kind: "entry.add" }],
    });
    await expect(
      repository.findSession(fixtureIds.alphaTenant, fixtureIds.alphaProject, fixtureIds.session),
    ).resolves.toMatchObject({ state: "completed" });
  });

  it("idempotently replays the same client message and rejects same-ID/different-body reuse", async () => {
    const { create, model, service, submit } = harness();
    await create();
    const original = await submit();
    const replay = await submit();
    expect(replay).toEqual({ replayed: true, turn: original.turn });
    expect(model.requests).toHaveLength(1);
    await expect(submit("We prefer polished concrete.")).rejects.toMatchObject({
      code: "DESIGN_AGENT_MESSAGE_ID_CONFLICT",
      statusCode: 409,
    });
    await expect(
      service.submitTurn({
        actor: { ...alphaOwner, userId: "73333333-3333-4333-8333-333333333333" },
        correlation,
        projectId: fixtureIds.alphaProject,
        request: {
          clientMessageId: fixtureIds.message,
          expectedBriefRevision: 1,
          message: "We prefer warm oak.",
        },
        sessionId: fixtureIds.session,
      }),
    ).rejects.toMatchObject({ code: "DESIGN_AGENT_MESSAGE_ID_CONFLICT", statusCode: 409 });
    expect(model.requests).toHaveLength(1);
  });

  it("supersedes every older pending proposal when a newer turn is stored", async () => {
    const latest = harness();
    await latest.create();
    await latest.submit();
    latest.clock.current = new Date(latest.clock.current.getTime() + 1_000);
    const second = await latest.service.submitTurn({
      actor: alphaOwner,
      correlation,
      projectId: fixtureIds.alphaProject,
      request: {
        clientMessageId: fixtureIds.secondMessage,
        expectedBriefRevision: 1,
        message: "We prefer muted green as well.",
      },
      sessionId: fixtureIds.session,
    });
    await expect(
      latest.service.getProposal(
        fixtureIds.alphaTenant,
        fixtureIds.alphaProject,
        fixtureIds.session,
        fixtureIds.proposal,
      ),
    ).resolves.toMatchObject({ status: "rejected" });
    expect(second.turn.proposal).toMatchObject({
      id: fixtureIds.secondProposal,
      status: "pending",
    });
    expect(
      [...latest.repository.proposals.values()].filter(({ status }) => status === "pending"),
    ).toHaveLength(1);
    await expect(latest.confirm()).rejects.toMatchObject({
      code: "DESIGN_AGENT_PROPOSAL_INACTIVE",
      statusCode: 409,
    });
    expect(latest.briefs.updateCalls).toHaveLength(0);
  });

  it("expires proposals before confirmation and never calls the brief command", async () => {
    const { briefs, clock, confirm, create, submit } = harness();
    await create();
    await submit();
    clock.current = new Date("2026-07-18T10:30:01.000Z");
    await expect(confirm()).rejects.toMatchObject({
      code: "DESIGN_AGENT_PROPOSAL_EXPIRED",
      statusCode: 409,
    });
    expect(briefs.updateCalls).toHaveLength(0);
  });

  it("fences stale base revisions and cancelled sessions before confirmation", async () => {
    const stale = harness();
    await stale.create();
    await stale.submit();
    stale.briefs.current = { ...stale.briefs.current, revision: 2 };
    await expect(stale.confirm()).rejects.toMatchObject({
      code: "DESIGN_AGENT_STALE_BRIEF",
      statusCode: 409,
    });
    expect(stale.briefs.updateCalls).toHaveLength(0);

    const cancelled = harness();
    await cancelled.create();
    await cancelled.submit();
    await cancelled.service.cancelSession({
      actor: alphaOwner,
      correlation,
      idempotencyKey: fixtureIds.cancelIdempotency,
      projectId: fixtureIds.alphaProject,
      sessionId: fixtureIds.session,
    });
    await expect(cancelled.confirm()).rejects.toMatchObject({
      code: "DESIGN_AGENT_SESSION_INACTIVE",
      statusCode: 409,
    });
    expect(cancelled.briefs.updateCalls).toHaveLength(0);
  });

  it("fails closed for cross-project, cross-tenant and mismatched persisted proposal scopes", async () => {
    const crossScope = harness();
    await crossScope.create();
    await crossScope.submit();
    await expect(
      crossScope.service.getProposal(
        fixtureIds.alphaTenant,
        fixtureIds.betaProject,
        fixtureIds.session,
        fixtureIds.proposal,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      crossScope.service.getProposal(
        fixtureIds.betaTenant,
        fixtureIds.alphaProject,
        fixtureIds.session,
        fixtureIds.proposal,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    const proposalEntry = [...crossScope.repository.proposals.entries()][0];
    if (proposalEntry === undefined) throw new Error("Synthetic proposal fixture is missing.");
    crossScope.repository.proposals.set(proposalEntry[0], {
      ...proposalEntry[1],
      projectId: fixtureIds.betaProject,
    });
    await expect(crossScope.confirm()).rejects.toMatchObject({ statusCode: 404 });
    expect(crossScope.briefs.updateCalls).toHaveLength(0);
  });

  it("rejects malformed/tool-smuggling model output before persistence", async () => {
    const malformed = harness();
    await malformed.create();
    malformed.model.handler = (request) => {
      const valid = validModelResult(request) as Record<string, unknown>;
      return Promise.resolve({
        ...valid,
        output: {
          ...(valid.output as Record<string, unknown>),
          toolCalls: [{ arguments: { url: "https://attacker.invalid" }, name: "network.fetch" }],
        },
      });
    };
    await expect(malformed.submit()).rejects.toMatchObject({
      code: "DESIGN_AGENT_INVALID_MODEL_OUTPUT",
      statusCode: 502,
    });
    expect(malformed.repository.turns.size).toBe(0);
    expect(malformed.briefs.updateCalls).toHaveLength(0);
  });

  it("keeps the external adapter honestly disabled without invoking the model port", async () => {
    const disabled = harness("external-disabled");
    await disabled.create();
    await expect(disabled.submit()).rejects.toMatchObject({
      code: "DESIGN_AGENT_EXTERNAL_DISABLED",
      statusCode: 503,
    });
    expect(disabled.model.requests).toHaveLength(0);
    expect(disabled.repository.turns.size).toBe(0);
  });

  it("maps timeout/cancellation failures to safe codes and emits redaction-safe telemetry only", async () => {
    const timed = harness();
    await timed.create();
    const privateMessage = "My health condition and credential SECRET-C11 must stay private.";
    timed.model.handler = () =>
      Promise.reject(
        Object.assign(new Error("Synthetic safe model failure."), {
          privateDetail: privateMessage,
          safeCode: "MODEL_TIMEOUT",
        }),
      );
    const error = await timed.submit(privateMessage).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "DESIGN_AGENT_TIMEOUT", statusCode: 504 });
    expect(JSON.stringify(error)).not.toContain("SECRET-C11");
    expect(JSON.stringify(timed.telemetry.events)).not.toContain("SECRET-C11");
    expect(timed.telemetry.events.at(-1)).toMatchObject({
      operationCount: 0,
      safeCode: "MODEL_TIMEOUT",
      stage: "turn",
    });

    const cancelled = harness();
    await cancelled.create();
    cancelled.model.handler = () =>
      Promise.reject(
        Object.assign(new Error("Synthetic safe model cancellation."), {
          safeCode: "MODEL_CANCELLED",
        }),
      );
    await expect(cancelled.submit(privateMessage)).rejects.toMatchObject({
      code: "DESIGN_AGENT_CANCELLED",
      statusCode: 409,
    });
  });

  it("keeps review-only professional questions unconfirmable", async () => {
    const review = harness();
    await review.create();
    review.model.handler = (request) =>
      Promise.resolve({
        manifest: {
          adapter: "deterministic-local-v1",
          externalNetworkUsed: false,
          promptRegistryVersion: "c11-brief-consultation-prompts-v1",
          toolRegistryVersion: "c11-brief-tools-v1",
        },
        output: {
          clarifyingQuestions: [],
          operations: [],
          professionalReview: [
            {
              question: "The structural implications require professional review.",
              reason: "structural",
              status: "review-required",
            },
          ],
          summary: "One question requires accountable professional review.",
        },
        requestId: request.requestId,
        schemaVersion: "model-gateway-result-v1",
      });
    const turn = await review.submit("Can we remove this structural wall?");
    expect(turn.turn.proposal.professionalReview).toHaveLength(1);
    await expect(review.confirm()).rejects.toMatchObject({
      code: "DESIGN_AGENT_PROPOSAL_HAS_NO_PATCH",
      statusCode: 422,
    });
    expect(review.briefs.updateCalls).toHaveLength(0);
  });

  it("rejects unknown request keys and overlong messages before any model work", async () => {
    const bounded = harness();
    await bounded.create();
    await expect(
      bounded.service.submitTurn({
        actor: alphaOwner,
        correlation,
        projectId: fixtureIds.alphaProject,
        request: {
          clientMessageId: fixtureIds.message,
          expectedBriefRevision: 1,
          message: "We prefer oak.",
          tool: "sql.execute",
        },
        sessionId: fixtureIds.session,
      }),
    ).rejects.toMatchObject({ code: "DESIGN_AGENT_TURN_INVALID", statusCode: 422 });
    await expect(bounded.submit("x".repeat(8_001))).rejects.toMatchObject({
      code: "DESIGN_AGENT_TURN_INVALID",
      statusCode: 422,
    });
    expect(bounded.model.requests).toHaveLength(0);
  });
});

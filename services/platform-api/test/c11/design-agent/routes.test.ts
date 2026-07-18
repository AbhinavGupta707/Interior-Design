import {
  briefPatchProposalSchema,
  consultationSessionSchema,
  designBriefSchema,
  projectSchema,
  type Actor,
  type LocalPersona,
  type Project,
} from "@interior-design/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../../src/correlation.js";
import { registerErrorHandling } from "../../../src/errors.js";
import { LocalFixtureTokenProvider } from "../../../src/modules/identity/jwt.js";
import { IdentityService } from "../../../src/modules/identity/service.js";
import type { IdentityStore } from "../../../src/modules/identity/store.js";
import { registerDesignAgentRoutes } from "../../../src/modules/design-agent/routes.js";
import { DesignAgentService } from "../../../src/modules/design-agent/service.js";
import type {
  CreateProjectCommand,
  ProjectRepository,
} from "../../../src/modules/projects/repository.js";
import {
  alphaOwner,
  FakeModelPort,
  fixtureIds,
  MemoryBriefCommandPort,
  MemoryDesignAgentRepository,
  MutableClock,
  SequenceUuidFactory,
} from "./support.js";

const sessionSecret = "c11-design-agent-route-secret-at-least-thirty-two-bytes";
const actors = Object.freeze({
  "fixture|c11-alpha-editor": {
    ...alphaOwner,
    displayName: "Synthetic Alpha Editor",
    role: "editor",
    subject: "fixture|c11-alpha-editor",
    userId: "34333333-3333-4333-8333-333333333333",
  },
  "fixture|c11-alpha-owner": alphaOwner,
  "fixture|c11-alpha-viewer": {
    ...alphaOwner,
    displayName: "Synthetic Alpha Viewer",
    role: "viewer",
    subject: "fixture|c11-alpha-viewer",
    userId: "35333333-3333-4333-8333-333333333333",
  },
  "fixture|c11-beta-owner": {
    ...alphaOwner,
    displayName: "Synthetic Beta Owner",
    subject: "fixture|c11-beta-owner",
    tenantId: fixtureIds.betaTenant,
    userId: "36333333-3333-4333-8333-333333333333",
  },
} satisfies Record<string, Actor>);

type Subject = keyof typeof actors;

class RouteIdentityStore implements IdentityStore {
  findFixtureActor(persona: LocalPersona): Promise<Actor | undefined> {
    void persona;
    return Promise.resolve(undefined);
  }

  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    const actor = (actors as Partial<Record<string, Actor>>)[subject];
    return Promise.resolve(actor?.tenantId === tenantId ? actor : undefined);
  }
}

const project = projectSchema.parse({
  createdAt: "2026-07-18T09:00:00.000Z",
  id: fixtureIds.alphaProject,
  name: "Synthetic C11 route project",
  status: "active",
  tenantId: fixtureIds.alphaTenant,
  updatedAt: "2026-07-18T09:00:00.000Z",
  version: 1,
});

class RouteProjectRepository implements ProjectRepository {
  create(command: CreateProjectCommand): Promise<Project> {
    void command;
    return Promise.reject(new Error("Project creation is outside the C11 route fixture."));
  }

  findById(tenantId: string, projectId: string): Promise<Project | undefined> {
    return Promise.resolve(
      tenantId === project.tenantId && projectId === project.id ? project : undefined,
    );
  }

  list(tenantId: string): Promise<readonly Project[]> {
    return Promise.resolve(tenantId === project.tenantId ? [project] : []);
  }
}

function tokenFor(subject: Subject): string {
  return new LocalFixtureTokenProvider(sessionSecret).issueLocal({
    subject,
    tenantId: actors[subject].tenantId,
  }).accessToken;
}

function headers(subject: Subject, idempotencyKey?: string) {
  return {
    authorization: `Bearer ${tokenFor(subject)}`,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

function consultationUrl(sessionId?: string): string {
  return `/v1/projects/${fixtureIds.alphaProject}/design-consultations${sessionId === undefined ? "" : `/${sessionId}`}`;
}

describe("C11 production consultation routes", () => {
  let briefs: MemoryBriefCommandPort;
  let clock: MutableClock;
  let model: FakeModelPort;
  let repository: MemoryDesignAgentRepository;
  let server: FastifyInstance;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    repository = new MemoryDesignAgentRepository();
    briefs = new MemoryBriefCommandPort(repository);
    clock = new MutableClock();
    model = new FakeModelPort();
    const service = new DesignAgentService({
      briefs,
      clock,
      model,
      repository,
      uuid: new SequenceUuidFactory(),
    });
    registerDesignAgentRoutes(
      server,
      new IdentityService(
        "test",
        new RouteIdentityStore(),
        new LocalFixtureTokenProvider(sessionSecret),
      ),
      new RouteProjectRepository(),
      service,
    );
  });

  afterEach(async () => server.close());

  async function create(subject: Subject = "fixture|c11-alpha-owner") {
    return server.inject({
      headers: headers(subject, fixtureIds.idempotency),
      method: "POST",
      payload: {
        baseBriefId: fixtureIds.brief,
        baseBriefRevision: 1,
        idempotencyKey: fixtureIds.idempotency,
        providerMode: "deterministic-local",
      },
      url: consultationUrl(),
    });
  }

  async function submit(subject: Subject = "fixture|c11-alpha-owner") {
    return server.inject({
      headers: headers(subject, fixtureIds.message),
      method: "POST",
      payload: {
        clientMessageId: fixtureIds.message,
        expectedBriefRevision: 1,
        message: "We prefer warm oak.",
      },
      url: `${consultationUrl(fixtureIds.session)}/turns`,
    });
  }

  it("serves create/get/turn/proposal/confirm with frozen full response schemas", async () => {
    const created = await create();
    const replayedCreate = await create();
    expect([created.statusCode, replayedCreate.statusCode]).toEqual([201, 201]);
    expect(consultationSessionSchema.safeParse(created.json()).success).toBe(true);
    expect(replayedCreate.headers["idempotent-replay"]).toBe("true");

    const fetched = await server.inject({
      headers: headers("fixture|c11-alpha-viewer"),
      method: "GET",
      url: consultationUrl(fixtureIds.session),
    });
    expect(fetched.statusCode).toBe(200);
    expect(consultationSessionSchema.safeParse(fetched.json()).success).toBe(true);

    const submitted = await submit();
    const replayedTurn = await submit();
    expect([submitted.statusCode, replayedTurn.statusCode]).toEqual([201, 201]);
    expect(briefPatchProposalSchema.safeParse(submitted.json()).success).toBe(true);
    expect(replayedTurn.headers["idempotent-replay"]).toBe("true");
    expect(model.requests).toHaveLength(1);

    const proposal = await server.inject({
      headers: headers("fixture|c11-alpha-viewer"),
      method: "GET",
      url: `${consultationUrl(fixtureIds.session)}/proposals/${fixtureIds.proposal}`,
    });
    expect(proposal.statusCode).toBe(200);
    expect(briefPatchProposalSchema.safeParse(proposal.json()).success).toBe(true);

    clock.current = new Date(clock.current.getTime() + 1_000);
    const confirmationInput = {
      headers: headers("fixture|c11-alpha-owner", fixtureIds.confirmIdempotency),
      method: "POST" as const,
      payload: {
        expectedBriefRevision: 1,
        idempotencyKey: fixtureIds.confirmIdempotency,
      },
      url: `${consultationUrl(fixtureIds.session)}/proposals/${fixtureIds.proposal}/confirm`,
    };
    const confirmed = await server.inject(confirmationInput);
    const replayedConfirmation = await server.inject(confirmationInput);
    expect([confirmed.statusCode, replayedConfirmation.statusCode]).toEqual([200, 200]);
    expect(designBriefSchema.safeParse(confirmed.json()).success).toBe(true);
    expect(confirmed.json()).toMatchObject({
      id: fixtureIds.brief,
      projectId: fixtureIds.alphaProject,
      revision: 2,
    });
    expect(replayedConfirmation.json()).toEqual(confirmed.json());
    expect(replayedConfirmation.headers["idempotent-replay"]).toBe("true");
    for (const response of [created, fetched, submitted, proposal, confirmed]) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("cancels idempotently, rejects pending proposals, and returns the session schema", async () => {
    await create();
    await submit();
    const input = {
      headers: headers("fixture|c11-alpha-editor", fixtureIds.cancelIdempotency),
      method: "POST" as const,
      url: `${consultationUrl(fixtureIds.session)}/cancel`,
    };
    const cancelled = await server.inject(input);
    const replayed = await server.inject(input);
    expect([cancelled.statusCode, replayed.statusCode]).toEqual([200, 200]);
    expect(consultationSessionSchema.parse(cancelled.json())).toMatchObject({
      id: fixtureIds.session,
      state: "cancelled",
    });
    expect(replayed.headers["idempotent-replay"]).toBe("true");
  });

  it("enforces role, project scope, actor-bound turns, and header/body idempotency", async () => {
    const viewerCreate = await create("fixture|c11-alpha-viewer");
    expect(viewerCreate.statusCode).toBe(403);
    await create();
    await submit();

    const crossActorReplay = await submit("fixture|c11-alpha-editor");
    expect(crossActorReplay.statusCode).toBe(409);
    expect(crossActorReplay.json()).toMatchObject({ code: "DESIGN_AGENT_MESSAGE_ID_CONFLICT" });
    expect(model.requests).toHaveLength(1);

    const viewerConfirm = await server.inject({
      headers: headers("fixture|c11-alpha-viewer", fixtureIds.confirmIdempotency),
      method: "POST",
      payload: {
        expectedBriefRevision: 1,
        idempotencyKey: fixtureIds.confirmIdempotency,
      },
      url: `${consultationUrl(fixtureIds.session)}/proposals/${fixtureIds.proposal}/confirm`,
    });
    expect(viewerConfirm.statusCode).toBe(403);

    const foreign = await server.inject({
      headers: headers("fixture|c11-beta-owner"),
      method: "GET",
      url: consultationUrl(fixtureIds.session),
    });
    expect(foreign.statusCode).toBe(404);

    const mismatch = await server.inject({
      headers: headers("fixture|c11-alpha-owner", fixtureIds.cancelIdempotency),
      method: "POST",
      payload: {
        clientMessageId: "19999999-9999-4999-8999-999999999999",
        expectedBriefRevision: 1,
        message: "We prefer linen.",
      },
      url: `${consultationUrl(fixtureIds.session)}/turns`,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});

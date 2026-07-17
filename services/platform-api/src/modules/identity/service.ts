import {
  sessionSchema,
  type LocalPersona,
  type LocalSessionResponse,
  type Session,
} from "@interior-design/contracts";
import type { RuntimeEnvironment } from "@interior-design/config";

import { ApiError } from "../../errors.js";
import { parseBearerToken, unauthenticated } from "./http.js";
import type { SessionTokenProvider } from "./jwt.js";
import type { IdentityStore } from "./store.js";

export class IdentityService {
  readonly #runtimeEnvironment: RuntimeEnvironment;
  readonly #store: IdentityStore;
  readonly #tokens: SessionTokenProvider;

  constructor(
    runtimeEnvironment: RuntimeEnvironment,
    store: IdentityStore,
    tokens: SessionTokenProvider,
  ) {
    this.#runtimeEnvironment = runtimeEnvironment;
    this.#store = store;
    this.#tokens = tokens;
  }

  get providerAvailable(): boolean {
    return this.#tokens.available;
  }

  async createLocalSession(persona: LocalPersona): Promise<LocalSessionResponse> {
    if (this.#runtimeEnvironment === "production" || this.#tokens.issueLocal === undefined) {
      throw new ApiError({
        code: "LOCAL_AUTH_UNAVAILABLE",
        detail: "Local fixture sign-in is unavailable in this environment.",
        statusCode: 503,
        title: "Local Sign-In Unavailable",
      });
    }
    const actor = await this.#store.findFixtureActor(persona);
    if (actor === undefined) {
      throw new ApiError({
        code: "FIXTURE_PERSONA_UNAVAILABLE",
        detail: "The synthetic fixture persona is unavailable; run the explicit local bootstrap.",
        statusCode: 503,
        title: "Fixture Persona Unavailable",
      });
    }
    const token = this.#tokens.issueLocal({ subject: actor.subject, tenantId: actor.tenantId });
    const session = sessionSchema.parse({
      actor,
      authMode: "local-fixture",
      expiresAt: token.expiresAt,
    });
    return { accessToken: token.accessToken, session };
  }

  async authenticate(authorization: string | readonly string[] | undefined): Promise<Session> {
    const principal = await this.#tokens.verify(parseBearerToken(authorization));
    if (this.#runtimeEnvironment === "production" && principal.authMode === "local-fixture") {
      throw unauthenticated();
    }
    const actor = await this.#store.findSessionActor(principal.tenantId, principal.subject);
    if (actor === undefined) {
      throw unauthenticated();
    }
    return sessionSchema.parse({
      actor,
      authMode: principal.authMode,
      expiresAt: principal.expiresAt,
    });
  }
}

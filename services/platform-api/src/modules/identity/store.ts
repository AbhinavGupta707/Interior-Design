import type { Actor, LocalPersona } from "@interior-design/contracts";

export interface IdentityStore {
  findFixtureActor(persona: LocalPersona): Promise<Actor | undefined>;
  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined>;
}

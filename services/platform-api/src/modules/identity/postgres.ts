import {
  actorSchema,
  localPersonaSchema,
  memberRoleSchema,
  tenantIdSchema,
  userIdSchema,
  type Actor,
  type LocalPersona,
} from "@interior-design/contracts";
import type { Sql } from "postgres";
import { z } from "zod";

import type { IdentityStore } from "./store.js";

interface ActorRow {
  readonly display_name: string;
  readonly role: string;
  readonly subject: string;
  readonly tenant_id: string;
  readonly user_id: string;
}

const fixtureSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenants: z.array(
      z
        .object({
          id: tenantIdSchema,
          members: z.array(
            z
              .object({
                displayName: z.string().trim().min(1).max(100),
                persona: localPersonaSchema,
                role: memberRoleSchema,
                subject: z.string().trim().min(3).max(200),
                userId: userIdSchema,
              })
              .strict(),
          ),
          name: z.string().trim().min(1).max(120),
        })
        .strict(),
    ),
  })
  .strict();

export type IdentityFixtureSet = z.infer<typeof fixtureSetSchema>;

function mapActor(row: ActorRow | undefined): Actor | undefined {
  if (row === undefined) {
    return undefined;
  }
  return actorSchema.parse({
    displayName: row.display_name,
    role: row.role,
    subject: row.subject,
    tenantId: row.tenant_id,
    userId: row.user_id,
  });
}

export class PostgresIdentityStore implements IdentityStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async findFixtureActor(persona: LocalPersona): Promise<Actor | undefined> {
    const rows = await this.#sql<ActorRow[]>`
      SELECT
        users.display_name,
        memberships.role,
        users.subject,
        memberships.tenant_id,
        users.id AS user_id
      FROM identity_memberships AS memberships
      INNER JOIN identity_users AS users ON users.id = memberships.user_id
      WHERE memberships.fixture_persona = ${persona}
        AND memberships.is_fixture = true
      LIMIT 1
    `;
    return mapActor(rows[0]);
  }

  async findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    const rows = await this.#sql<ActorRow[]>`
      SELECT
        users.display_name,
        memberships.role,
        users.subject,
        memberships.tenant_id,
        users.id AS user_id
      FROM identity_memberships AS memberships
      INNER JOIN identity_users AS users ON users.id = memberships.user_id
      WHERE memberships.tenant_id = ${tenantId}::uuid
        AND users.subject = ${subject}
      LIMIT 1
    `;
    return mapActor(rows[0]);
  }
}

export function parseIdentityFixtureSet(value: unknown): IdentityFixtureSet {
  return fixtureSetSchema.parse(value);
}

export async function seedIdentityFixtures(
  sql: Sql,
  fixtureSet: IdentityFixtureSet,
): Promise<void> {
  await sql.begin(async (transaction) => {
    for (const tenant of fixtureSet.tenants) {
      await transaction`
        INSERT INTO identity_tenants (id, name)
        VALUES (${tenant.id}::uuid, ${tenant.name})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      `;
      for (const member of tenant.members) {
        await transaction`
          INSERT INTO identity_users (id, subject, display_name)
          VALUES (${member.userId}::uuid, ${member.subject}, ${member.displayName})
          ON CONFLICT (id) DO UPDATE
          SET subject = EXCLUDED.subject,
              display_name = EXCLUDED.display_name
        `;
        await transaction`
          INSERT INTO identity_memberships (
            tenant_id,
            user_id,
            role,
            fixture_persona,
            is_fixture
          )
          VALUES (
            ${tenant.id}::uuid,
            ${member.userId}::uuid,
            ${member.role},
            ${member.persona},
            true
          )
          ON CONFLICT (tenant_id, user_id) DO UPDATE
          SET role = EXCLUDED.role,
              fixture_persona = EXCLUDED.fixture_persona,
              is_fixture = true
        `;
      }
    }
  });
}

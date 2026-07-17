# C4 canonical model API development

## Scope and truth boundary

`c4-canonical-home-v1` persists deterministic 2.5D canonical snapshots for three separate
profiles: `existing`, `proposed`, and `as-built`. It validates schema, provenance and geometry but
does not infer a plan, repair geometry, establish hidden construction, or make survey, structural,
regulatory, planning, professional or as-built truth claims. Missing measurements remain explicit
attributed unknowns. Use only synthetic fixtures in this workflow.

The canonical system of record is validated JSON. Integers are millimetres or milli-degrees in the
frozen project-local right-handed coordinate system. A render, mesh, scan, photo, video or property
address is not canonical dimensional authority.

## Create a clean disposable database

Start the loopback-only PostGIS service from the repository root:

```sh
docker compose -f infrastructure/local/compose.yaml up -d --wait postgres
```

Create only the named disposable C4 database. The first command intentionally removes that exact
test database so repeated runs start with an empty schema:

```sh
docker compose -f infrastructure/local/compose.yaml exec -T -e PGPASSWORD=local-development-only postgres \
  dropdb --host 127.0.0.1 --username localdev --if-exists interior_design_c4_test
docker compose -f infrastructure/local/compose.yaml exec -T -e PGPASSWORD=local-development-only postgres \
  createdb --host 127.0.0.1 --username localdev --owner localdev interior_design_c4_test
```

Build the workspace boundaries, apply C1 through C4 in order, and seed only the frozen synthetic C1
personas:

```sh
pnpm --filter @interior-design/config build
pnpm --filter @interior-design/contracts build
pnpm --filter @interior-design/authz build
pnpm --filter @interior-design/domain-model build
pnpm --filter @interior-design/geometry-kernel build

C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c4_test \
NODE_ENV=test \
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap

C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c4_test \
NODE_ENV=test \
pnpm --filter @interior-design/platform-api exec tsx src/c2.ts migrate

C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c4_test \
NODE_ENV=test \
pnpm --filter @interior-design/platform-api exec tsx src/c3.ts migrate

C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c4_test \
NODE_ENV=test \
pnpm --filter @interior-design/platform-api exec tsx src/c4.ts migrate
```

Migration `0004_canonical_models.sql` adds profile pointers, immutable snapshots, project/profile
idempotency and append-only audit rows. Composite foreign keys keep snapshot and current-pointer
references inside the same tenant/project/model/profile boundary. Triggers reject snapshot/audit
updates or deletes, pointer rollback/non-monotonic versions, and idempotency rewrites. Canonical
JSONB, SHA-256 and canonical UTF-8 byte length are stored together; validation findings retain only
non-blocking warnings/information because error findings reject the mutation.

## Configuration and canonicalisation integration

| Variable               | Development/test default                 | Production rule                          |
| ---------------------- | ---------------------------------------- | ---------------------------------------- |
| `C4_DATABASE_URL`      | `C1_DATABASE_URL`, then loopback PostGIS | C4 or C1 PostgreSQL URL is required      |
| `C1_AUTH_MODE`         | `local`                                  | Existing fail-closed C1 OIDC rules apply |
| `C4_TEST_DATABASE_URL` | unset                                    | Enables only the live C4 integration     |

PostgreSQL JSONB does not preserve object-key order. API writes and every API read therefore parse
the JSONB value and run it through the canonical codec port before comparing SHA-256 and byte
length. Never hash `jsonb::text`, use database text ordering as canonical bytes, or assume a JSONB
round-trip retains insertion order.

The API's `CanonicalSnapshotCodec` adapter delegates to the integrated
`@interior-design/domain-model` canonical byte/hash implementation. It does not retain a second
serializer. The geometry dependency likewise calls the integrated
`validateCanonicalGeometry` implementation directly.

## Frozen HTTP profile

All four routes require a C1 bearer session and a tenant-owned project:

1. `GET /v1/projects/:projectId/models` returns exactly `existing`, `proposed`, and `as-built` in
   that order. A profile without a snapshot is `{ profile, status: "empty" }`.
2. `GET /v1/projects/:projectId/models/:profile` returns the immutable current snapshot record.
   Empty, foreign and unknown states use the same non-disclosing `404` public response.
3. `GET /v1/projects/:projectId/models/:profile/snapshots/:snapshotId` retrieves one immutable
   snapshot only inside the requested tenant/project/profile boundary.
4. `POST /v1/projects/:projectId/models/:profile/snapshots` accepts strict
   `{ expectedCurrentSnapshotSha256, snapshot }`. The route project/profile must match the body.

Owner and editor roles may create; viewers are read-only. Every POST requires the established
8–128 character `Idempotency-Key`. Same-key/same-canonical-body replay returns the original record
and `Idempotent-Replay: true`; reusing a key for a different actor/body returns
`409 IDEMPOTENCY_CONFLICT`. `expectedCurrentSnapshotSha256` is `null` only before the first profile
snapshot. A stale value returns `409 REVISION_CONFLICT`.

The POST route alone permits a `10,486,784` byte transport envelope, leaving the global Fastify
1 MiB bound unchanged for every unrelated route. The service independently enforces the frozen
10 MiB (`10,485,760` byte) canonical-record ceiling after canonicalisation. Schema/geometry failures
never persist an idempotency, snapshot, pointer or audit effect. Geometry errors return a bounded,
located `422 CANONICAL_GEOMETRY_INVALID` finding list; snapshot bodies are never copied into logs.

Proposed and as-built snapshots require `derivedFromSnapshotSha256` belonging to the same project.
An optional `propertyId` must belong to the same tenant/project. Existing snapshots cannot claim a
derivation. A profile keeps one stable `modelId`; changing it is a revision conflict. Historical
rows remain readable after the current pointer advances.

## Verification

Provider-free focused and owned-package checks:

```sh
pnpm --filter @interior-design/platform-api exec vitest run test/c4
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api build
git diff --check
```

Run the live suite only against the named disposable database:

```sh
C4_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c4_test \
pnpm --filter @interior-design/platform-api exec vitest run test/c4/postgres.integration.test.ts
```

The suite applies C1–C4, then proves exact profile empties, owner/editor/viewer policy, tenant and
project non-disclosure, same-key replay/different-body conflict, stale and simultaneous expected
hash behavior, one-effect counts, monotonic versions, immutable history, same-boundary pointer
constraints, retained warnings and exact codec-based hash/byte recomputation after JSONB round-trip.
An unset `C4_TEST_DATABASE_URL` is a reported skip, not live evidence.

Remove only the disposable database when finished. Stopping the stack preserves shared volumes:

```sh
docker compose -f infrastructure/local/compose.yaml exec -T -e PGPASSWORD=local-development-only postgres \
  dropdb --host 127.0.0.1 --username localdev --if-exists interior_design_c4_test
docker compose -f infrastructure/local/compose.yaml down
```

## Residual limits

C4 remains TypeScript and 2.5D. Its integrated codec and geometry kernel have independent golden,
adversarial, JSONB round-trip and live API coverage, but they do not establish geometric
equivalence, survey accuracy or professional truth. There is no plan inference,
capture/reconstruction, geometry repair, 3D compiler, GPU/provider work, real property/customer
data or professional review in this checkpoint.

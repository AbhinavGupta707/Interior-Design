# C3 property dossier API development

## Scope and non-negotiable boundary

`c3-property-v1` resolves only repository-owned synthetic property identities or accepts an
explicit manual identity. It does not call live address, UPRN, EPC, mapping or planning services.
An address, UPRN or identity point never establishes the current interior, wall thickness,
structure, legal boundary or planning position. Use no real address, credential, provider response
or customer data in this workflow.

The accepted exact fixture is `14 Example Mews, Testford, ZZ1 1ZZ` with synthetic UPRN
`000000000014`. `20 Shared Point Court` deliberately returns two alternatives with different UPRNs
at the same `EPSG:27700` point. A missing fixture returns `no-match`; disabled and injected-outage
states return `unavailable` with distinct `providerState` values. The adapter never falls back from
disabled or unavailable to fixture data.

## Create a clean disposable database

Start the pinned loopback PostGIS service from the repository root:

```sh
docker compose -f infrastructure/local/compose.yaml up -d --wait postgres
```

For a clean gate, create a database whose name is reserved for this synthetic C3 test. The first
command intentionally removes only that named disposable database so repeated runs begin from an
empty schema:

```sh
docker compose -f infrastructure/local/compose.yaml exec -T postgres \
  dropdb --username localdev --if-exists interior_design_c3_test
docker compose -f infrastructure/local/compose.yaml exec -T postgres \
  createdb --username localdev --owner localdev interior_design_c3_test
```

Build the workspace packages used through their compiled export condition, then apply C1, C2 and
C3 in order and seed only the frozen C1 personas:

```sh
pnpm --filter @interior-design/config build
pnpm --filter @interior-design/contracts build
pnpm --filter @interior-design/authz build
pnpm --filter @interior-design/provider-adapters build

C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c3_test \
NODE_ENV=test \
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap

C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c3_test \
NODE_ENV=test \
pnpm --filter @interior-design/platform-api exec tsx src/c2.ts migrate

C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c3_test \
NODE_ENV=test \
pnpm --filter @interior-design/platform-api exec tsx src/c3.ts migrate
```

Migration `0003_property_dossier.sql` stores SHA-256 of the normalized provider payload, never the
raw response or address query. It creates tenant/project composite keys for opaque 15-minute
resolution snapshots, immutable historical identities and source records, one optimistic current
selection, append-only dossier versions, resolution consumption, project-scoped idempotency and
minimal audit events. Database triggers reject source/dossier/audit mutation and invalid current
selection or idempotency transitions.

## Configuration and provider states

| Variable                    | Development/test default                 | Production rule                                                 |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `C3_DATABASE_URL`           | `C1_DATABASE_URL`, then loopback PostGIS | C3 or C1 PostgreSQL URL is required                             |
| `C3_PROPERTY_PROVIDER_MODE` | `fixture`                                | defaults to and currently permits only `disabled`               |
| `C1_AUTH_MODE`              | `local`                                  | C1 OIDC fail-closed rules still apply                           |
| `C1_LOCAL_SESSION_SECRET`   | conspicuous repository local-only secret | never use the local secret outside loopback development/testing |

`C3_PROPERTY_PROVIDER_MODE` accepts `fixture`, `disabled`, or `unavailable` outside production.
`disabled` is the deliberate manual-only state. `unavailable` is an explicit failure simulation.
Production rejects fixture or unavailable mode because no provider, credentials, licence, privacy
notice, retention policy or data-processing approval has been activated.

Executable development startup composes C1, C2 and C3. Start the local object store as well when
running the whole API because C2 readiness remains active:

```sh
docker compose -f infrastructure/local/compose.yaml up -d --wait postgres object-storage
C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
C1_AUTH_MODE=local \
C3_PROPERTY_PROVIDER_MODE=fixture \
NODE_ENV=development \
pnpm --filter @interior-design/platform-api dev
```

## Frozen HTTP workflow

All routes use a C1 bearer session and reload server-owned membership/role authority. Owners and
editors may resolve, select and refresh. Viewers may read the dossier and source records only.
Foreign and unknown project, resolution and candidate IDs return the same non-disclosing `404`.

Every POST/PUT requires an `Idempotency-Key` of 8–128 characters. Selection requires the current
property `expectedVersion` (`0` before the first selection). Refresh requires the current dossier
version. Reusing an idempotency key with the same actor/operation/body replays the original public
response. Reusing it differently returns `409 IDEMPOTENCY_CONFLICT`; a stale version returns
`409 REVISION_CONFLICT`.

1. `POST /v1/projects/:projectId/property/resolutions` accepts only `{ countryCode: "GB", query }`.
   The server owns resolution/candidate UUIDs and the exact 15-minute expiry. The query is hashed,
   not stored or logged.
2. `PUT /v1/projects/:projectId/property` accepts either the opaque `resolutionId` + `candidateId`
   pair or explicit manual address fields. Expired, foreign, unknown or already-consumed candidates
   all return non-disclosing `404`. Manual selection creates neither UPRN nor coordinate.
3. `GET /v1/projects/:projectId/property/dossier` returns the current immutable dossier version.
4. `POST /v1/projects/:projectId/property/dossier/refresh` creates exactly one version for an
   idempotent request. The project property row serializes concurrent selection/refresh effects.
5. `GET /v1/projects/:projectId/property/source-records` returns normalized source metadata, fields
   and SHA-256 only.

Every generated dossier contains source observations, user assertions, bounded estimates,
inferences and explicit unknowns. Confidence is present only on estimates/inferences. Current room
layout, wall thicknesses, structural system and legal boundary stay unknown. Planning stays
`not-reviewed`, every item has `interiorClaim: none`, every established item references an immutable
source record, and every dossier carries coverage warnings. Existing C1 intake values appear only
as unverified user assertions. Model training remains denied for every C3 source.

## Verification

Provider-free and strict package checks:

```sh
pnpm --filter @interior-design/provider-adapters lint
pnpm --filter @interior-design/provider-adapters typecheck
pnpm --filter @interior-design/provider-adapters test:unit
pnpm --filter @interior-design/provider-adapters build
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api exec vitest run test/c3
pnpm --filter @interior-design/platform-api build
git diff --check
```

Run the real transaction suite only against the named disposable database:

```sh
C3_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c3_test \
pnpm --filter @interior-design/platform-api exec vitest run test/c3/postgres.integration.test.ts
```

The live suite proves exact/ambiguous/no-match/disabled/outage/manual behavior, C1 intake sourcing,
tenant and role isolation, candidate expiry/consumption, same-key replay, stale and simultaneous
selection/refresh writes, one-effect counts, append-only source/dossier history, safe audit fields,
absence of raw/query columns and all five epistemic classifications. An unset
`C3_TEST_DATABASE_URL` is a reported skip, not passing live evidence.

After the test, remove only the disposable database and stop the local stack without deleting its
shared volumes:

```sh
docker compose -f infrastructure/local/compose.yaml exec -T postgres \
  dropdb --username localdev --if-exists interior_design_c3_test
docker compose -f infrastructure/local/compose.yaml down
```

## Residual limits

No live property, address, UPRN, EPC, mapping or planning adapter exists in C3. There is no real
provider licence/privacy/retention decision, no customer data, no current-interior evidence and no
planning/structural/boundary review. The fixture dossier is for deterministic product and
comprehension testing only; it is not property, survey or professional evidence.

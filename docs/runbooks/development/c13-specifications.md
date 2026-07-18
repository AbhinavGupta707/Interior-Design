# C13 immutable specifications and substitutions

## Scope and composition boundary

This runbook covers the C13-L2 specification kernel and the isolated platform API module. It turns one exact, already-confirmed C12 option into immutable specification revisions and projects every schedule from the same retained lines. It does not ingest catalog media, compose the platform server, change C5/C10/C12, or add a new public contract.

The root integration must instantiate `PostgresSpecificationRepository` and `SpecificationService`, inject the C10 scene-job port, and call `registerSpecificationRoutes`. This lane intentionally does not register those routes centrally. The C13-L1 catalog publisher is the only expected writer of the `catalog_releases`, `catalog_asset_versions`, and `catalog_release_assets` inputs owned by migration 0013.

All fixtures and local evidence are creator-authored synthetic data. No network ingestion, provider, paid service, customer data, price, stock, supplier, delivery claim, or training permission is used. Catalog payloads require all four commercial fields to be `not-provided` and training to be denied.

## Authoritative creation

`POST /v1/projects/:projectId/specifications/from-c12-confirmation` accepts only:

- `confirmationId`;
- `catalogReleaseId`; and
- `catalogReleaseSha256`.

The repository resolves and rechecks the exact C12 confirmation, confirmed option head, immutable option set and bundle, accepted brief revision/hash, proposed branch and revision, C5 commit, and current canonical result snapshot. Caller-supplied option, bundle, brief, model, branch, commit, snapshot, or hash pins are rejected by strict schemas and are never substituted for this join.

Each initial line retains its stable line/element IDs, kind, level, room-or-review state, exact release/version/C12 content/metadata/placement/right hashes, selection source, decision, bounded note, and quantity state. Furnishings and lights are one counted canonical element; finish quantity remains explicitly unknown with reason `not-derived-in-c13`.

## Read wire shapes and schedule projections

The three collection/projection responses are deliberately enveloped:

```text
GET /v1/projects/:projectId/specifications
  { projectId, specifications }

GET /v1/projects/:projectId/specifications/:specificationId/revisions
  { specificationId, revisions }

GET /v1/projects/:projectId/specifications/:specificationId/schedule-lines
  { specificationId, revision, lines }
```

The wire returns the one source of line truth. `projectSpecificationSchedules` remains the deterministic pure projection for element, finish, product/light, and room groupings; grouped schedules are not separately persisted or returned from `/schedule-lines`.

## Selection changes and exact substitution

Selection-board edits append a new specification revision and never rewrite an existing revision or line. They use `PUT /v1/projects/:projectId/specifications/:specificationId/selection-board`; `POST` is not registered. Same-key/same-body PUT requests replay the exact revision.

A substitution preview:

1. resolves the current specification line, exact proposed C5 branch head, canonical snapshot, published release/version, and approved rights server-side;
2. constructs the existing `c12-design-element-operation-v1` / `design.element.replace.v1` envelope;
3. preserves the element ID, element kind, level, placement/target, and attribution while replacing catalog-derived values;
4. reruns canonical integer-millimetre geometry validation; and
5. persists an expiring, non-canonical preview labelled `bounded-catalog-preview-only`.

Cross-kind changes, non-selectable/withdrawn/expired rights, forged bindings, stale source pins, or blocking geometry fail before publication. Room containment uses integer geometry and includes the exact 1 mm boundary case. A finish area is never inferred here.

## Atomic C5 plus specification confirmation

Confirmation uses this fixed PostgreSQL lock order:

```text
project -> specification head -> substitution head -> C5 proposed branch/profile
```

Inside one transaction the repository rechecks preview expiry/state, specification and branch heads, canonical snapshot bytes/hash/version, catalog release/version/rights hashes, retained operation hash, C5 preview hash, candidate replay, and geometry. It then appends the C5 canonical snapshot, commit, operation envelope, audit/outbox data and advances the branch/profile, followed by the next specification revision/lines, confirmation, scene link, audit/outbox data, and idempotency response.

Any stale pin, changed-body idempotency key, concurrent confirmation loss, rights withdrawal, hash mismatch, geometry failure, or injected failure rolls back every C5 and C13 write. Same-key/same-body calls replay the exact retained result.

C10 is invoked only after the transaction commits. A C10 request failure leaves the valid C5/specification result committed, records `retry-required`, and can be retried. The retry URL's specification ID and revision must match the immutable scene binding; a valid same-project scene job cannot be dispatched through a different URL.

## Read-only C10 enrichment seam

`SpecificationSceneBindingResolver.resolveConfirmedSceneBinding(tenantId, projectId, sceneJobId)` is the narrow uncomposed port for root-owned C10 enrichment. It returns the exact immutable binding:

- C5 branch ID/revision and result snapshot ID/hash;
- specification ID/revision/revision hash;
- catalog release ID/hash; and
- immutable specification lines with their exact catalog/C12 hashes.

The orchestrator may inject this read-only port into C10 derived GLB metadata after merge. It does not mutate canonical snapshots and does not change the C10 public v1 contract.

## Migration and tenant context

Migration `0013_specifications.sql` requires migration 0012 and creates composite tenant/project catalog history, specification heads/revisions/lines, previews/confirmations, scene links/events, C13 idempotency effects, privacy-minimised audit, and outbox rows. History tables reject update/delete; mutable heads advance one step; every foreign key is `RESTRICT`.

Apply against a disposable database after migrations 0001–0012:

```sh
psql "$C13_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f services/platform-api/migrations/0013_specifications.sql
```

Every repository operation begins a transaction and immediately uses:

```sql
SELECT set_config('app.tenant_id', :tenant_id, true);
```

Every C13 tenant table has both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`, with matching `USING` and `WITH CHECK` predicates. Production application roles must be non-owner, `NOSUPERUSER`, and `NOBYPASSRLS`. PostgreSQL foreign-key code `23503` is mapped at the repository boundary to a generic 404 without copying database detail.

Useful checks:

```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname LIKE 'specification%' OR relname LIKE 'catalog_%'
ORDER BY relname;

SELECT tablename, policyname, qual, with_check
FROM pg_policies
WHERE tablename LIKE 'specification%' OR tablename LIKE 'catalog_%'
ORDER BY tablename, policyname;
```

## Verification

Run the deterministic kernel and platform suites:

```sh
pnpm --filter @interior-design/specification typecheck
pnpm --filter @interior-design/specification lint
pnpm --filter @interior-design/specification test:unit

pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api exec vitest run \
  test/c13/specifications --exclude 'dist/**'

pnpm exec tsc --noEmit -p tests/security/specification/tsconfig.json
pnpm exec vitest run tests/security/specification
git diff --check
```

Run live migration/RLS/lifecycle checks only against a disposable local database with the clean C1–C13 chain already applied:

```sh
C13_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/c13_disposable \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c13/specifications/rls.integration.test.ts \
  test/c13/specifications/postgres.integration.test.ts
```

The RLS suite creates a constrained probe role named `c13_specification_rls_probe`; use a disposable database. It proves the active role is a non-owner, non-superuser, no-`BYPASSRLS` role, sees only its tenant, cannot insert across tenants, and receives only a foreign-key code for a missing same-tenant composite target. The lifecycle suite creates a real synthetic C12 confirmation, authoritatively creates C13, previews/replays a replacement, atomically advances C5 plus C13, resolves the exact scene binding, proves injected rollback, and permits exactly one concurrent confirmation.

## Evidence limits

- The implementation module is isolated and uncomposed in this lane; no root server/BFF/browser journey is claimed.
- C10 dispatch is exercised through an injected synthetic port; no C10 compiler, GLB metadata, browser, GPU, or object-storage evidence is claimed here.
- No physical device, LiDAR, external provider, paid service, customer data, live product data, procurement, structural/regulatory review, or professional approval was exercised.
- Geometry tests validate deterministic canonical integer bounds, including severe and 1 mm cases; they are not surveyed/as-built evidence.

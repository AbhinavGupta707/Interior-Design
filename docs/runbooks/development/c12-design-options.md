# C12 durable design-option runtime

## Purpose and production composition

This runbook covers the C12-L3 backend that turns an exact accepted C11 brief and exact committed C4/C5 source snapshot into durable, immutable design proposals. Generation is proposal-only: it does not create a proposed C4 snapshot, C5 branch, preview, commit, operation envelope, or model audit event. Only an explicit human confirmation can do that work.

The root integration instantiates `PostgresDesignOptionRepository`, `PostgresDesignOptionSourceVerifier`, `DesignOptionService`, and `DesignOptionWorkerRuntime`, registers the frozen routes, and starts `DesignOptionProcessingRunner` when the C12 worker is enabled. Constraint derivation is backed by the accepted C11 brief and exact canonical source; exact asset verification uses the versioned creator-owned synthetic catalog. A missing dependency remains an explicit unavailable/abstain state, never a fabricated success.

No external provider, GPU, paid service, customer data, external key, or training permission is needed for the local workflow. The live test uses synthetic fixtures with `trainingAllowed: false`.

## Apply and verify the schema

Migration `0012_design_options.sql` requires migrations 0001 through 0011. Apply it in a transaction:

```sh
psql "$C12_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f services/platform-api/migrations/0012_design_options.sql
```

The migration creates tenant/project-scoped jobs and attempts; immutable option sets, bundles, and options; mutable option heads with append-only state events; idempotency effects; exact C5-linked confirmations; privacy-minimised audit/outbox records; indexes; constraints; and tenant RLS policies. It also replaces the C5 operation-envelope schema/type check with the paired invariant:

- C5 operation types require `c5-model-operation-v1`.
- `design.element.create.v1`, `design.element.replace.v1`, and `design.element.remove.v1` require `c12-design-element-operation-v1`.

Migration 0005 is not rewritten.

Useful checks:

```sql
SELECT id, applied_at
FROM platform_schema_migrations
WHERE id = '0012_design_options';

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname LIKE 'design_option_%'
ORDER BY relname;

SELECT tablename, policyname
FROM pg_policies
WHERE tablename LIKE 'design_option_%'
ORDER BY tablename, policyname;
```

Set `app.tenant_id` on every tenant-bound database transaction when using an application role that is subject to RLS. Keep broad/table-owner credentials out of workers.

## Public HTTP surface and authorisation

The frozen routes are:

```text
POST /v1/projects/:projectId/design-option-jobs
GET  /v1/projects/:projectId/design-option-jobs
GET  /v1/projects/:projectId/design-option-jobs/:jobId
POST /v1/projects/:projectId/design-option-jobs/:jobId/cancel
POST /v1/projects/:projectId/design-option-jobs/:jobId/retry
GET  /v1/projects/:projectId/design-option-jobs/:jobId/options
GET  /v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId
POST /v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId/confirm
```

Create, cancel, retry, and confirm require the frozen mutation actions and therefore owner/editor access. Reads allow viewers. Project lookup occurs inside the authenticated tenant; foreign project, job, and option guesses are not disclosed. Confirmation additionally rejects `machine:` and `service:` principals. All mutation bodies are strict runtime schemas. Create, cancel, retry, and confirm require idempotency keys. Direct confirmation requires a UUID `Idempotency-Key` header that exactly equals `confirmOptionRequest.idempotencyKey`; a missing, malformed, or mismatched pair fails before repository mutation. An exact same-key replay returns the retained response and a changed body or resource conflicts.

Never accept client-authored frozen constraints. `DesignOptionService` obtains the exact accepted brief/current source through `DesignOptionSourceVerifier`, then passes the normalized request (sorted directions, bounded option count, and exact brief/source pins), exact proposed working-model reference, accepted brief, source record, and working snapshot through `DesignConstraintDerivationPort`. It sorts the returned constraints by stable ID and hashes the canonical I-JSON bytes.

## Job and worker lifecycle

The normal lifecycle is:

```text
queued -> deriving-constraints -> generating -> validating -> publishing -> succeeded
```

The worker surface has no actor and no C4/C5 mutation capability. It can only claim, heartbeat, advance one stage, publish, abstain, fail, or acknowledge a requested cancellation. A granted lease carries the exact accepted C11 brief payload, exact committed source snapshot, exact proposed working snapshot, frozen constraints, and job pins needed by the deterministic engine. Claims are bounded to 30–3600 seconds. PostgreSQL re-parses and recomputes the accepted brief content/snapshot hashes and canonical source snapshot hash/byte length under the exact tenant/project before claim or reclaim. Missing, reopened, foreign, or mismatched inputs fail the queued attempt with `SOURCE_CHANGED` instead of granting a token. Publication checks the authoritative pins again. Every worker write carries tenant, project, job, attempt, expected job version, worker ID, and opaque lease token. Expired leases may be reclaimed with a new token; the old owner loses the publication fence.

Cancellation of queued work completes immediately. Cancellation of leased work enters `cancel-requested` until the exact fenced worker acknowledges it. Typed abstention uses `NO_FEASIBLE_DIVERSE_SET`; safe failure codes distinguish stale sources, infeasible constraints, resource limits, and internal failures. Retry creates a new attempt only after exact brief/source verification succeeds again. Partial sets are never published.

Publication re-parses every set, option, bundle, asset placement, constraint result, and retained operation. It enforces the requested count, exact job/project/working-base pins, unique option IDs, full constraint coverage, hard-constraint success, pairwise diversity, bounded payloads, creator-owned/service-processing rights, and deterministic replay to the retained candidate snapshot hash.

Hash rules use canonical I-JSON and SHA-256:

- constraints: sorted by constraint ID before hashing;
- operation bundle: hash the complete bundle body excluding `bundleSha256`;
- option set: hash the complete set body excluding `setSha256`;
- canonical model snapshots: use the C4 canonical model validator and exact integer millimetres/milli-degrees.

## Atomic confirmation

Confirmation is a single PostgreSQL transaction and fence:

1. Lock and scope the project, job, option head, immutable option/bundle/set, accepted brief revision, and exact source snapshot.
2. Recompute constraint, bundle, set, working-base, candidate, and asset-rights hashes; re-run the retained operations and blocking geometry checks.
3. Create or reuse only the exact derived proposed base.
4. Create an isolated proposed C5 branch at that base.
5. Persist an exact preview and commit the retained operations as the authenticated human actor using `c12-design-element-operation-v1` envelopes.
6. Verify the resulting canonical snapshot hash, then persist the option-head transition, append-only state event, C12 confirmation, privacy-minimised audit/outbox records, and idempotency response.

Any expired option, stale pin, forged bundle/asset, failed constraint, lease/publication mismatch, concurrent confirmation, C5 validation error, or result-hash mismatch aborts the transaction. No partial proposed snapshot, branch, preview, commit, envelope, confirmation, audit, or outbox row remains. Confirming one option does not expire or retarget its siblings; each confirmed sibling gets an independent branch from the exact working base.

## Diagnostics and privacy

Only log identifiers, versions, stages, outcomes, counts, and exact hashes needed for diagnosis. `safeDesignOptionLogFields` drops keys for briefs, statements, household/accessibility narratives, assets, operations, prompts, payloads, tokens, credentials, and lease tokens. The SQL audit/outbox checks reject those keys as well. Never log request bodies, retained operations, asset metadata, or raw PostgreSQL errors to a client.

Useful bounded diagnostics:

```sql
SELECT id, version, attempt, state, stage, safe_code, retryable, updated_at
FROM design_option_jobs
WHERE tenant_id = current_setting('app.tenant_id')::uuid
  AND project_id = :project_id
ORDER BY created_at, id
LIMIT 100;

SELECT job_id, attempt, job_version, state, stage, lease_owner,
       lease_expires_at, heartbeat_at
FROM design_option_attempts
WHERE tenant_id = current_setting('app.tenant_id')::uuid
  AND project_id = :project_id
ORDER BY created_at, job_id
LIMIT 100;
```

Treat lease tokens and full option payloads as sensitive. Do not paste them into tickets or logs.

## Tests

Run the scoped deterministic suites:

```sh
pnpm --filter @interior-design/model-operations typecheck
pnpm --filter @interior-design/model-operations lint
pnpm --filter @interior-design/model-operations test:unit

pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api exec vitest run test/c12
```

Run the guarded PostgreSQL suite only against a disposable or synthetic local database with migrations 0001–0011 available:

```sh
C12_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c12/postgres.integration.test.ts
```

Run the root production-composition gate against a disposable local database. It applies C1–C12, sends C12 actions through the actual Next BFF to a listening API, runs the real deterministic worker, confirms two isolated branches, preserves the existing profile, compiles one branch through C10, and validates the resulting GLB bytes and hash:

```sh
C12_PRODUCTION_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/c12_disposable \
  pnpm exec vitest run tests/integration/design-options/live-production.integration.test.ts
```

When a broad test command shares one database, serialize migration-bearing files (`--pool=forks --maxWorkers=1`). Concurrent idempotent DDL from separate Vitest workers can otherwise race in PostgreSQL before product tests begin.

The live suite reapplies the migration idempotently, uses synthetic fixture identities/projects, proves exact brief/source/working payloads reach the leased worker, stale accepted inputs cannot be leased, expired leases are reclaimed and old workers fenced, cancel/retry/abstain remain durable, no proposed C4/C5 mutation occurs before confirmation, and stale confirmation rollback, exact replay, concurrent sibling confirmation, result-snapshot linkage, RLS activation, and append-only rejection all hold. Without `C12_TEST_DATABASE_URL`, it skips honestly.

Finish with:

```sh
git diff --check
```

## Known evidence limits

- The production-composed local baseline is deterministic and uses creator-owned synthetic bounded-proxy assets. It is not evidence of human-rated design quality or real-product availability.
- No external provider, GPU render, paid service, customer data, physical device, structural/regulatory review, or professional approval was exercised in C12.
- The C12-derived GLB gate uses the already-verified local C10 compiler and an in-memory immutable object-store adapter; C10 separately retains its live S3-compatible storage evidence.
- Connected Chrome and automated Chromium/Firefox/WebKit evidence cover the web surface. The Codex in-app Browser controller failed during bootstrap before tab acquisition and is recorded as unavailable, not as a pass.

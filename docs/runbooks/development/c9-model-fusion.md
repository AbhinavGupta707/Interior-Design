# C9 durable model-fusion development runbook

## Safety boundary

C9 reconciles exact, immutable C6 plan proposals, C7 RoomPlan proposals and C8 completed
reconstruction results against one exact `existing` C4 base snapshot. It publishes only an
immutable, uncertainty-labelled proposal and attributed discrepancy decisions. A generated C9
operation draft is pinned to an exact C5 branch, revision and head snapshot hash.

C9 never calls a C5 preview or commit route, writes a model branch, writes a canonical snapshot,
or treats appearance media as dimensional truth. Producer output is a proposal until a user
reviews it and a later, separate C5 workflow validates and commits the operations. Source rights
are rechecked when a job is created, claimed and published. Service processing must be permitted;
training consent remains independently denied.

Do not put source payloads, addresses, object keys, URLs, local paths, credentials, lease tokens,
candidate snapshots or operations in logs. Audit and outbox records contain only bounded IDs,
hashes, counts, stages and safe codes.

## Database and migration order

Migration `services/platform-api/migrations/0009_model_fusion.sql` requires the C5, C6, C7 and C8
markers. It creates tenant/project-scoped jobs and exact source manifests, durable fenced attempts,
append-only rights withdrawals, proposals, decisions, operation drafts, audit events and outbox
records. Proposal and draft tables reference existing C4/C5 records but do not mutate them.

Start the local stack and apply migrations in order:

```sh
docker compose -f infrastructure/local/compose.yaml up -d --wait postgres

export C1_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design'
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap
pnpm --filter @interior-design/platform-api exec tsx src/c2.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c3.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c4.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c5.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c6.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c7.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c8.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c9.ts migrate
```

Readiness includes `c9-database` and remains unavailable until marker `0009_model_fusion` exists.
Database URL lookup is `C9_DATABASE_URL`, then C8, C7, C6 and C1. Production requires an explicit
URL. The migration registry is shared and orchestrator-owned; this lane supplies migration 0009
but does not edit the registry.

## Public API and durable lifecycle

The frozen public routes are:

- `GET|POST /v1/projects/:projectId/fusion-jobs`
- `GET /v1/projects/:projectId/fusion-jobs/:fusionJobId`
- `POST /v1/projects/:projectId/fusion-jobs/:fusionJobId/cancel`
- `POST /v1/projects/:projectId/fusion-jobs/:fusionJobId/retry`
- `GET /v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal`
- `POST /v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal/discrepancy-decisions`
- `POST /v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal/operation-drafts`

Every mutation requires an 8–128 character `Idempotency-Key`. Reusing the key with the same actor,
action and canonical request replays the stored response; changing any of them conflicts. Cancel,
retry, review and draft requests carry optimistic versions. Worker leases bind tenant, project,
job, attempt, owner, token and expiry. Expired or superseded attempts cannot advance, fail,
acknowledge cancellation or publish.

The normal state sequence is `queued` → `registering` → `fitting` → `comparing` → `proposed`.
Provider-free execution may publish `abstained` instead. Any leased stage can become
`cancel-requested`; the exact fenced worker or an expiry/reclaim path completes cancellation.
Failed, cancelled and abstained jobs can retry only while policy and rights permit. Immutable
publication is atomic with terminal attempt/job state and redacted audit/outbox records.

## Worker and producer ports

Enable the C9 runner explicitly:

```sh
export C2_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design'
export C9_FUSION_WORKER_ENABLED='true'
# Optional only when Python is not `python3` or the repository layout is non-standard:
export C9_INFERENCE_PYTHON_COMMAND='python3'
export C9_INFERENCE_PYTHONPATH="$PWD/services/inference-worker/src"
pnpm --filter @interior-design/spatial-worker dev
```

The default C9 composition uses `GeometryKernelRegistrationProducer` and
`PythonScanToModelProducer`. Project-local sources receive an explicit identity registration;
source-local inputs require a non-degenerate, reflection-safe control-point transform through the
C9 geometry kernel. The semantic producer adapts exact C6 plan and C7 RoomPlan proposal payloads
to the bounded private `python -m inference_worker.scan_to_model` stdin/stdout protocol and then
schema-validates and canonically re-hashes the returned existing-condition candidate.

No provider key or GPU is required for this path. The child process receives only bounded JSON,
exact source/evidence/tool pins and an abort signal—never public paths, URLs, object-store locators
or broad credentials. C8 reconstruction results currently expose no inline parametric semantic
observations in their immutable result contract, so they remain registered evidence but cannot be
promoted into dimensional geometry by this adapter. If fewer than two registered source kinds
provide explicit semantic observations, the producer emits a bounded
`FUSION_INSUFFICIENT_SEMANTIC_SOURCES` abstention. It never substitutes fixture geometry.

Source acquisition permits at most 32 sources, 8 MiB per payload and 32 MiB total. It verifies the
exact source schema, element count, SHA-256, current rights and exact base snapshot before any
producer call. Candidate snapshots are schema-validated and canonically re-hashed before
publication. The protocol bounds output size, discrepancy count and runtime, and cancellation or
lease loss fences every stage.

Source-local inputs are never auto-aligned from appearance or assumed origins. The web workspace
requires three measured source-to-project correspondences for every selected source-local input.
Every coordinate is an exact integer millimetre within the shared bound; blank, fractional,
out-of-range, duplicate or collinear control points fail closed and keep job creation disabled.
The correspondences are evidence, not a prompt to guess. Project-local sources use the explicit
identity registration.

After fitting, the production adapter compares the exact base and candidate walls. A defensible
uniform position difference becomes an attributed discrepancy with exact magnitude and a
deterministic C5 `wall.translate.v1` suggestion. An aligned wall produces no discrepancy. These
operations remain proposal/draft material only and cannot mutate the base.

## Web workspace

Run the API and web app on loopback after migrations:

```sh
pnpm --filter @interior-design/platform-api dev
pnpm --filter @interior-design/web dev
```

Open `/fusion/<projectId>`. The same-origin `/api/c9/**` BFF reauthenticates with the server-owned
session and validates all C1/C4/C5/C6/C7/C8/C9 responses before returning bounded JSON. It never
returns media locators or credentials. Owner/editor can create, cancel, retry, decide and build a
draft. Viewer access is read-only.

Producer capability labels default honestly to `unavailable`. Set these presentation flags only
after startup/preflight confirms the geometry module and Python fitter are actually available in
the running deployment:

```sh
export C9_GEOMETRY_PRODUCER_STATUS='available'
export C9_SEMANTIC_PRODUCER_STATUS='available'
```

The flags do not install a producer, run preflight, grant rights, create credentials or bypass
durable fences. The standalone browser acceptance fixture always labels itself synthetic and
`No live C9 producer`; it is presentation evidence only, not producer-live evidence.

## Disposable production-path acceptance

`tests/e2e/model-fusion/live-api.mjs` is the local, visibly synthetic C9 acceptance harness. It
applies C1-C9, seeds exact C6 plan and C7 RoomPlan proposals plus one existing snapshot whose first
wall is offset by 25 mm, and starts the real C1/C4/C5/C6/C7/C8/C9 API composition. It uses an
object-storage adapter that fails if the journey unexpectedly requests storage; no cloud service
or provider key is involved.

Start a disposable PostgreSQL database, then run the API harness from the repository root:

```sh
export C9_LIVE_DATABASE_URL='postgresql://local-user@127.0.0.1:55449/interior_design_c9_live'
export C9_LIVE_API_PORT='4119'
pnpm --filter @interior-design/platform-api exec tsx --conditions=development \
  "$PWD/tests/e2e/model-fusion/live-api.mjs"
```

In separate terminals, run the real worker and web app:

```sh
export C2_DATABASE_URL="$C9_LIVE_DATABASE_URL"
export C2_POLL_MS='100'
export C2_HEARTBEAT_MS='5000'
export C2_LEASE_MS='60000'
export C2_WORKER_ID='c9-live-acceptance'
export C9_FUSION_WORKER_ENABLED='true'
export C9_INFERENCE_PYTHON_COMMAND='python3'
export C9_INFERENCE_PYTHONPATH="$PWD/services/inference-worker/src"
pnpm --filter @interior-design/spatial-worker exec tsx --conditions=development src/index.ts

HOME_DESIGN_API_BASE_URL='http://127.0.0.1:4119' \
C9_GEOMETRY_PRODUCER_STATUS='available' \
C9_SEMANTIC_PRODUCER_STATUS='available' \
pnpm --filter @interior-design/web dev --hostname 127.0.0.1 --port 3019
```

Run desktop-owner and mobile-viewer browser acceptance, then assert the no-mutation database
boundary:

```sh
C9_LIVE_FUSION_URL='http://localhost:3019' \
  pnpm exec playwright test --config tests/e2e/model-fusion/playwright.live.config.ts

pnpm --filter @interior-design/platform-api exec tsx --conditions=development \
  "$PWD/tests/e2e/model-fusion/live-api.mjs" assert
```

The final assertion requires at least one terminal job, proposal and draft while the canonical
snapshot count remains one and the branch revision remains zero. Stop and delete the disposable
database after the run; its repeated-run counts are diagnostic data, not product metrics.

## Focused verification

Run from the repository root:

```sh
pnpm --filter @interior-design/platform-api exec vitest run test/c9
pnpm --filter @interior-design/spatial-worker exec vitest run test/model-fusion
pnpm --filter @interior-design/web exec vitest run test/model-fusion

pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/spatial-worker typecheck
pnpm --filter @interior-design/web typecheck
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/spatial-worker lint
pnpm --filter @interior-design/web lint
pnpm --filter @interior-design/platform-api build
pnpm --filter @interior-design/spatial-worker build
pnpm --filter @interior-design/web build
```

`services/spatial-worker/test/model-fusion/production-producers.test.ts` is the provider-free
cross-lane integration gate. It invokes the real C9 geometry producer plus a real Python fitter
subprocess for exact C6+C7 inputs, validates the returned C4 candidate, checks its canonical hash
and rejects credentials, URLs and mutation authority in output. It is distinct from the visibly
synthetic browser fixture.

The live PostgreSQL suite is gated. Without `C9_TEST_DATABASE_URL`, report it as `NOT RUN`, never
passed:

```sh
C9_TEST_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c9_test' \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c9/postgres.integration.test.ts --maxWorkers=1
```

Use a disposable database. The gated suite applies C1–C9 and checks real migration registration,
all tenant-scoped durable stores, deny-by-default source-rights lookup and installation of every
material append-only trigger. The focused repository/service/worker suites separately exercise
lease expiry/reclaim, cancellation, retry fencing, rights withdrawal, atomic publication,
idempotency, optimistic conflicts, redacted telemetry and the no-C5-write boundary.

## Manual browser checks

1. Sign in with a local fixture persona and open a project that has an exact existing-model base
   plus at least two eligible proposal/result kinds.
2. Confirm source kind, evidence label, scale status, element count and hash are visible. Confirm
   training remains denied and producer availability is honest.
3. For every source-local input, enter three measured, non-collinear source/project control-point
   pairs. Confirm blank, non-integer, out-of-range and collinear values prevent submission.
4. Create a job, then exercise queued/registering/fitting/comparing, cancel, retry, full, partial,
   disconnected, abstained and stale-version recovery states with deterministic test producers
   only.
5. Confirm registrations expose method, confidence, residual counts/millimetres and findings;
   discrepancies expose source claims, base/candidate claims, unknown and inferred labels.
6. Record each decision type: accept candidate, keep base, correct, mark unknown and defer. Reload
   stale state and verify optimistic conflict recovery.
7. Build an exact operation draft and verify branch ID, revision, head hash, proposal and operations.
   Confirm no C5 preview/commit request occurs and the branch/head remains unchanged.
8. Repeat as a viewer, keyboard-only, offline and at 390×844. Check visible focus, meaningful live
   status, no horizontal overflow, no framework overlay, no unexpected console errors and no
   failed requests beyond intentionally simulated recovery cases.

Keep screenshots outside Git. This runbook does not constitute physical-device, provider, GPU,
COLMAP/Open3D, accuracy, capacity or human-review evidence.

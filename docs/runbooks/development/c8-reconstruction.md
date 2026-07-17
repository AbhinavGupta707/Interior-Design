# C8 reconstruction development runbook

## Boundary and evidence labels

C8 accepts exact, immutable C2 assets and creates independent reconstruction jobs. It never reads or writes raw media through the public API, calls C5, mutates a canonical snapshot, merges evidence with plans/RoomPlan, or presents geometry as surveyed or professionally verified. Geometry result metadata is `proposal-only`; an optional Nerfstudio/gsplat-style appearance result is `non-dimensional` and cannot establish cameras, scale or geometry.

Development fixtures must be visibly synthetic or independently rights-cleared. Service processing is required. Training use is always `denied`. Do not put media, sanitized frames, local paths, object keys, signed URLs, credentials, provider output, customer labels or runtime caches in Git, logs, screenshots or test reports.

The public UI is `/reconstruction/<projectId>`. Owner/editor can create, cancel and retry; viewers can inspect sources, jobs, diagnostics and results read-only. The same-origin BFF reauthenticates through the server-owned session and validates C1/C2/C8 responses before returning bounded JSON.

## Database and migration order

Migration `services/platform-api/migrations/0008_reconstruction.sql` requires C2 and C7 markers. It adds:

- tenant/project-scoped jobs with exact request and source-manifest hashes;
- immutable source snapshots and append-only rights withdrawals;
- durable attempts with owner/token/expiry fencing and a three-attempt ceiling;
- append-only completed/abstained results;
- append-only, locator-free audit and outbox records; and
- triggers that enforce monotonic state/version transitions and immutable publication.

Start local Postgres, then apply C1 through C8 in order. Use a disposable database for live tests.

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
```

Readiness includes `c8-database` and remains unavailable until marker `0008_reconstruction` exists. Database URL lookup is `C8_DATABASE_URL`, then C7, C6, C2 and C1. Production requires an explicit URL.

The shared migration registry is orchestrator-owned. This lane supplies migration `0008`; the orchestrator must add it to the shared registry during integration.

## Public lifecycle

Frozen routes:

- `GET|POST /v1/projects/:projectId/reconstruction-jobs`
- `GET /v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId`
- `POST /v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/cancel`
- `POST /v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/retry`
- `GET /v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/result`

The frozen public surface has no C8 eligible-source listing. The web journey therefore starts from
the validated C2 `ready` asset list. A later C8-only rights withdrawal is always rechecked and
rejected server-side, but can remain visible in that C2 list. During shared integration, the
orchestrator should decide whether C2 rights state or a shared read model should expose that
withdrawal; this lane does not widen the frozen API or mutate another checkpoint's asset record.

Every mutation requires an 8–128 character `Idempotency-Key`. The key is bound to tenant, actor, action and canonical request bytes. Exact repetition replays the stored response; any different actor/action/body conflicts. Cancel/retry also require exact `expectedVersion`.

Public states are:

1. `created`
2. `preparing`
3. `ready-for-reconstruction`
4. `reconstructing-geometry`
5. optional `reconstructing-appearance`
6. `completed` or `abstained`

Cancellation from `created` is immediate. Cancellation from any leased stage becomes `cancel-requested`; only the fenced worker, or expiry/reclaim path, can finish cancellation. Failed/cancelled jobs may be retryable, and retry creates the next durable attempt. Published completed/abstained jobs and results cannot be retried or rewritten.

## Worker seam and publication fencing

`PostgresReconstructionRepository` is the narrow internal producer seam. It exposes:

- `claimNext({ workerId, leaseSeconds })`
- `advanceAttempt({ jobId, attempt, leaseToken, workerId, stage })`
- `publishResult({ jobId, attempt, leaseToken, workerId, result })`
- `failAttempt(...)`
- `acknowledgeCancellation(...)`
- `withdrawSource(...)`

Lease tokens are never public, logged or placed in audit/outbox metadata. Claim and publication recheck each current C2 asset status, byte count, detected MIME type, SHA-256, rights basis, service consent, denied training status and C8 withdrawal record. An expired or superseded token cannot advance, fail or publish. Publication also requires exact job/project/source-manifest scope and reparses the frozen C8 result schema.

Worker implementations in the other C8 lanes must supply real media-preparation/geometry output through this seam. This lane contains no automatic fake worker. Unit/Postgres tests inject explicit deterministic result fixtures only; those fixtures are not provider, camera, GPU, algorithm-accuracy or production-capacity evidence.

## Honest local runtime states

The web BFF defaults all unadvertised capabilities to `unavailable`. Set a status to `available` only when the composed local process actually provides it:

```sh
export C8_GEOMETRY_WORKER_STATUS='available'
export C8_APPEARANCE_PROVIDER_STATUS='available'
export C8_GPU_STATUS='available'
```

These flags affect presentation only. They do not create a provider, grant credentials or bypass worker leases. With defaults, the UI says that no geometry worker, appearance provider or GPU is advertised. A created job stays durably queued and can be cancelled. It never displays fixture output as live output.

## Focused verification

```sh
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api exec vitest run test/c8

pnpm --filter @interior-design/web typecheck
pnpm --filter @interior-design/web lint
pnpm --filter @interior-design/web exec vitest run test/reconstruction
pnpm --filter @interior-design/web build
```

The Postgres suite is guarded. Without `C8_TEST_DATABASE_URL`, report it as `NOT RUN`, never passed:

```sh
C8_TEST_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c8_test' \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c8/postgres.integration.test.ts --maxWorkers=1
```

That live suite applies C1–C8 and proves exact replay, tenant isolation, lease expiry/reclaim, stale-token rejection, cancellation in preparation/ready/geometry/appearance, retry attempt fencing, rights withdrawal, immutable publication, safe audit/outbox records and an unchanged canonical snapshot count.

## Real local browser journey

1. Run the migrated platform API and web app on loopback.
2. Sign in with an existing local fixture persona.
3. Open a synthetic project and upload a visibly synthetic JPEG/PNG/HEIC or MP4/QuickTime asset through C2 with service processing allowed and training denied.
4. Wait for C2 to mark the asset `ready`.
5. Open `/reconstruction/<projectId>`.
6. Confirm the runtime panel. With no composed worker/provider/GPU it must show three `unavailable` states.
7. Select exact immutable sources, confirm service processing and start. The job should render `created`/durably queued without invented progress.
8. Exercise cancel and retry. In a composed worker run, inspect preparation, geometry, optional appearance and terminal states.
9. Use a deterministic test result only in the explicit test harness. Verify partial registration, disconnected components, unknown scale and abstention copy remain visible; geometry and appearance remain separate.
10. Repeat at desktop and 390×844 mobile width, keyboard-only and as the viewer persona. Check no horizontal overflow, visible focus, meaningful live-region status, no framework overlay, no unexpected console warning/error and no failed network request.

The Browser/in-app automation gate is distinct from component tests and production builds. Keep screenshots outside Git. Physical iOS camera/RGB-D, COLMAP/Open3D algorithm runs, CUDA dense geometry and Nerfstudio/gsplat output remain `NOT RUN` unless the named real hardware/runtime was actually used.

# C10 durable scene backend development runbook

## Authority and safety boundary

C10 turns one exact, persisted and committed C4 snapshot into a derived browser scene. A scene is
visualisation output only: it never becomes canonical dimensional truth and never mutates a model
snapshot, profile, branch or operation. The API accepts only the frozen snapshot reference; it
reloads the canonical record, checks committed status and re-hashes the persisted payload before a
job is created, retried, loaded by a worker or published.

The platform API does not contain a fixture or fallback compiler. `POST /scene-jobs` returns
`SCENE_COMPILER_UNAVAILABLE` until the real worker is explicitly enabled. The spatial-worker
executable then composes `SceneCompilationRunner`, the real `1.0.0` scene compiler, the narrow
tenant-fenced worker port, PostgreSQL and the existing private S3-compatible store. A job cannot
succeed without validated GLB bytes and a manifest bound to the exact snapshot, compiler and
configuration hashes.

Do not log or return canonical payloads, GLB bytes, manifests, object keys, bucket/provider IDs,
credentials, signed URLs or lease tokens. The public records and audit/outbox rows contain only
bounded IDs, hashes, counts, safe codes and lifecycle state. Training permission remains separate
from service processing and is never implied by C10.

## Database and migration

Migration `services/platform-api/migrations/0010_scenes.sql` requires marker
`0009_model_fusion`. It creates tenant/project-scoped jobs, append-only attempts (maximum three),
content-bound artifacts, immutable scenes/cache entries, audit events and outbox rows. Exact
foreign keys pin the C4 snapshot ID, hash and version. Publication and terminal attempt/job state
are one transaction; triggers deny mutation of scene, artifact, cache, audit and outbox rows.

Apply migrations in order after starting PostgreSQL:

```sh
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
pnpm --filter @interior-design/platform-api exec tsx src/c10.ts migrate
```

Database lookup is `C10_DATABASE_URL`, then C9, C8, C7, C6 and C1. Production requires one of
those variables. Readiness includes required `c10-database` and `c10-scene-storage` checks.
Optional `c10-scene-compiler` remains unavailable until the exact worker activation below is
present; this is deliberately honest and does not make a compiler appear merely because the API
or object store is ready.

## Public API and authorization

The frozen routes are:

- `GET|POST /v1/projects/:projectId/scene-jobs`
- `GET /v1/projects/:projectId/scene-jobs/:sceneJobId`
- `POST /v1/projects/:projectId/scene-jobs/:sceneJobId/cancel`
- `POST /v1/projects/:projectId/scene-jobs/:sceneJobId/retry`
- `GET /v1/projects/:projectId/scene-jobs/:sceneJobId/scene`
- `POST /v1/projects/:projectId/scene-jobs/:sceneJobId/scene/access`

Owner/editor may create, cancel and retry; viewer is read-only. Project lookup is performed in the
authenticated tenant before job lookup so foreign tenants receive non-disclosing not-found
responses. Mutations require `Idempotency-Key`; reuse with a different canonical request conflicts.
Cancel/retry require `expectedVersion`.

The cache identity is the exact source snapshot hash, compiler name/version and canonical compile
configuration. A presentation label is not part of cache identity. Job state is
`queued -> leased -> compiling -> publishing -> succeeded`; active work can move through
`cancel-requested -> cancelled`, and retry appends a new attempt without rewriting the old one.
Expired leases can be reclaimed, while token/owner/attempt/expiry fences deny stale workers at
every stage.

Signed access is POST-only, audited and limited to five minutes. Production URLs must be HTTPS;
HTTP is accepted only by the deterministic loopback test adapter. Neither access response nor the
scene record exposes a storage locator.

## Object storage and L1 composition

The API and spatial-worker processes must receive the same explicit activation. The worker binary
contains compiler version `1.0.0`; do not configure a different API descriptor because jobs would
correctly remain unclaimable.

```sh
export C10_SCENE_WORKER_ENABLED='true'
export C10_SCENE_COMPILER_VERSION='1.0.0'
export C10_DATABASE_URL='postgresql://deployment-user:secret@database.example.invalid/interior_design'
```

`C10_SCENE_COMPILER_VERSION` is consumed by the API descriptor; the spatial worker always claims
with its compiled-in version. Omit the variables or set activation to `false` to keep both
processes honestly disabled. Any other activation value fails startup validation.

Default composition reuses the existing S3-compatible C2 configuration:

```sh
export C2_STORAGE_ENDPOINT='https://storage.example.invalid'
export C2_STORAGE_ACCESS_KEY_ID='deployment-secret'
export C2_STORAGE_SECRET_ACCESS_KEY='deployment-secret'
export C2_STORAGE_REGION='eu-west-2'
export C2_STORAGE_FORCE_PATH_STYLE='false'
```

Local defaults use the loopback object store. Production requires a non-loopback HTTPS endpoint
and explicit credentials. `S3SceneObjectStorage` derives the private locator internally from the
GLB SHA-256, sends checksum metadata and conditional immutable writes, and signs access without
returning the locator or provider identity. `InMemorySceneObjectStorage` is provider-free and for
tests/local composition only.

The production `services/spatial-worker` executable builds `SceneWorkerService` from
`PostgresSceneRepository`, `PostgresSceneSnapshotVerifier` and `S3SceneObjectStorage`, then gives
that narrow port to `SceneCompilationRunner`. The runner:

1. claims using the real compiler descriptor and retains the returned lease privately;
2. reloads the exact committed C4 source through the narrow port and advances monotonically from
   `leased` to `compiling` to `publishing`;
3. compiles and publishes real validator-clean GLB bytes plus the frozen manifest, or fails with a
   bounded safe code;
4. serialises periodic heartbeats with stage transitions, stops on fencing/cancellation and
   acknowledges a real cancellation with the same lease.

The port never supplies broad object-store credentials or a storage locator. GLB verification
rejects malformed/chunk-invalid documents, external URIs, required extensions and manifest count
drift before storage or publication.

## Verification

Run from the repository root:

```sh
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api test:unit
pnpm --filter @interior-design/platform-api exec vitest run test/c10
git diff --check
```

The PostgreSQL test is gated; without `C10_TEST_DATABASE_URL`, report it as not run:

```sh
C10_TEST_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c10_test' \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c10/postgres.integration.test.ts --reporter=dot
```

Use a disposable database. The live gate applies C1-C10 and proves exact committed-snapshot
loading, idempotency/cache reuse, lease stages, cancellation acknowledgement, retry append/fencing,
atomic immutable publication, signed-access audit and unchanged model/branch counts. Storage tests
cover checksum binding, conditional content addressing, safe signing and redacted failures.

The full production-composed gate additionally exercises the actual runner and compiler against
the disposable database and loopback object store, then downloads and re-hashes the signed GLB:

```sh
C10_RUNNER_TEST_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c10_runner_test' \
C10_RUNNER_TEST_STORAGE_ENDPOINT='http://127.0.0.1:8333' \
  pnpm exec vitest run tests/integration/scenes/live-production.integration.test.ts
```

This backend lane alone is not compiler-live, GPU, browser, physical-device, geometry-accuracy,
capacity or human-review evidence. Those states must remain explicitly unavailable until the
corresponding lane supplies and verifies them.

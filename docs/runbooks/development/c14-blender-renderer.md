# C14 durable render-stills control plane

## Evidence boundary

This runbook covers the integrated C14 durable still-render product: PostgreSQL persistence, tenant-safe API composition, exact C10/C13 authority resolution, content-addressed artifact publication, spatial-worker lifecycle, and the fixed renderer subprocess boundary.

No Blender executable, Blender version command, capability probe, render, GPU, Metal, CUDA, OptiX, or Cycles workload was invoked on the development Mac during the 2026-08-11 close-out. Automated subprocess evidence uses only `workers/blender-renderer/test/fixtures/inert-renderer.mjs`, an inert repository fixture which records the argument vector and runs inert marker scripts. The disposable C1-C14 integration uses the separately named `FrozenInertRenderer`, which emits bounded synthetic fixture bytes. The checked-in `renderer/c14_render.py` is an authorised-host integration driver, not locally executed render evidence.

The product is now composed in the executable platform API and spatial worker. The API registers the C14 routes, resolves C10 scenes and C13 specification/catalog authority, constructs the render-scene boundary, brokers opaque access, and keeps the worker absent when C14 is disabled. Enabling a production renderer still requires the complete immutable authorised-host pin set. Local inert evidence proves the control plane only; it does not make a renderer profile production-available.

## Authority and data flow

The public create body contains only `sourceSceneJobId`, camera/lighting/profile choices, an optional specification ID/revision selection, a bounded label, and the enhancement selection. The server-owned `RenderSourceResolver` must resolve and pin:

- one succeeded C10 scene job, scene, GLB artifact bytes hash, scene-manifest hash, and canonical source-snapshot hash;
- when selected, the exact C13 specification revision hash, catalog release hash, and current eligible rights;
- the matching immutable binding embedded in the GLB extras; and
- the authoritative profile capability and conservative disk estimate.

Caller-supplied source, artifact, specification, release, rights, renderer, executable, or manifest hashes are not accepted as authority. `PortBackedRenderSourceResolver` exposes narrow injected ports so this lane does not import unmerged C14-L1 symbols.

The safe lifecycle is:

```text
queued -> preparing -> rendering-safe -> validating-safe -> publishing-safe -> succeeded
```

Cancellation becomes `cancel-requested` while leased and is acknowledged by the fenced worker, or terminalised when the lease is stale. A failed/cancelled job may append attempt 2 or 3 through an idempotent retry. Attempts and their event history are never rewritten.

The optional enhancement is a child of an already committed geometry-safe result. Child creation runs after the base transaction and can be repaired by the enhancement request path. Disabled, rejected, failed, unavailable, or missing enhancement state cannot roll back, delay, or hide the safe result.

## Public routes

`registerRenderStillRoutes` implements the frozen paths:

- `GET /v1/projects/:projectId/render-capabilities`
- `POST /v1/projects/:projectId/render-jobs`
- `GET /v1/projects/:projectId/render-jobs`
- `GET /v1/projects/:projectId/render-jobs/:jobId`
- `POST /v1/projects/:projectId/render-jobs/:jobId/cancel`
- `POST /v1/projects/:projectId/render-jobs/:jobId/retry`
- `GET /v1/projects/:projectId/render-jobs/:jobId/result`
- `POST /v1/projects/:projectId/render-jobs/:jobId/artifacts/:artifactId/access`
- `GET /v1/projects/:projectId/render-jobs/:jobId/enhancement`
- `POST /v1/projects/:projectId/render-jobs/:jobId/enhancement`

Every route authenticates and authorises the project action before accessing a repository. Responses are private/no-store. Mutation routes require an idempotency key and expected-version fence where the public contract specifies one. A reused key with the exact operation/body hash replays its retained response; a changed body conflicts.

Artifact-access responses contain an opaque URL and exact public artifact metadata, never an object key. The injected access gateway signer must bind artifact ID, result ID, manifest hash, role, media type, SHA-256, byte length, and expiry. The frozen maximum TTL is 300 seconds.

## Migration and execution roles

Migration `0014_render_stills.sql` requires migration 0013 and creates:

- durable jobs, immutable attempt declarations, fenced attempt heads, and append-only attempt events;
- atomic disk reservations and append-only releases;
- immutable results, artifacts, and cache identities;
- optional enhancement child jobs/results/artifacts;
- tenant-scoped idempotency effects; and
- privacy-minimised audit and outbox history.

All tenant tables use composite tenant/project foreign keys and both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. The API role must be non-owner, `NOSUPERUSER`, and `NOBYPASSRLS`; each repository transaction sets `app.tenant_id` locally before data access.

Queue discovery is available only through:

```sql
c14_claim_render_job(text, text[], text, bigint, integer)
```

The migration revokes this function from `PUBLIC`. Integration must grant `EXECUTE` only to the named non-login renderer-worker role. That role must not receive broad table access, database ownership, `BYPASSRLS`, or API/object/provider credentials. Because the queue tables use `FORCE RLS` and a claim intentionally searches across tenants, the security-definer function must remain owned by a separately protected non-runtime migration/function owner that can bypass RLS; no API or worker principal may inherit or assume that owner. Retain the function's fixed `search_path`, constrained validation, and `PUBLIC` revocation.

The claim function capability-matches, locks each volume admission calculation, uses `FOR UPDATE ... SKIP LOCKED`, and fences lease ownership with a private UUID. A stale lease is reclaimable only by a worker reporting the same stable volume ID as its active reservation, and only after a fresh disk check; another volume cannot silently inherit its reservation. Never expose the lease token in an API, log, audit payload, metric label, or outbox row.

## Disk admission and workspace

For estimate `E`, admission requires:

```text
unreserved free bytes >= max(15 GiB + E, 3 * E)
```

The reservation and claim occur atomically. The spatial worker measures the same configured filesystem and rechecks admission at preparing, rendering, validation, and publication heartbeats. Losing admission aborts work. Succeeded, failed, cancelled, stale-cancelled, and retry terminal paths append exactly one reservation release.

Each render uses a unique workspace under a configured dedicated root. The workspace must:

- be an absolute, real directory outside the repository and object-store roots;
- reject symlink roots/leaves and traversal;
- use mode `0700`, with staged source/manifest files at `0600`;
- contain fixed `scene.glb`, `render-scene.json`, and `output/` leaves only; and
- be removed in a terminal `finally` path.

Do not reuse a workspace across attempts or place customer material in a shared temp name.

## Renderer subprocess boundary

An authorised-host deployment supplies an immutable descriptor containing absolute executable/script paths and their SHA-256 values. Both files must be regular, non-symlink files whose resolved path and bytes match the descriptor. The executable is invoked with `shell: false`, a fixed working directory, and this fixed argument shape:

```text
--background --factory-startup --disable-autoexec --offline-mode
--python-exit-code 41 --python <pinned-script> --
--render-scene <workspace>/render-scene.json
--source-glb <workspace>/scene.glb
--output-directory <workspace>/output
```

No caller-controlled argument, shell fragment, startup file, addon, site package, or arbitrary environment key may be added. The child receives only bounded platform variables plus isolated Blender user paths and `PYTHONNOUSERSITE=1`. Database, S3, cloud, token, credential, OpenAI, and provider variables are stripped. Standard input is closed; stdout/stderr byte totals, wall time, and the detached process group are bounded. Cancellation, lease loss, timeout, or output overflow terminates the process group.

Before publication the boundary verifies:

- staged GLB and render-scene manifest hashes;
- exact PNG signatures and dimensions;
- OpenEXR magic, required channels, finite samples, and exact dimensions through the injected EXR inspector;
- GLB finiteness, no external resources/scripts, allowed extensions, object-ID coverage, and exact C13 extras through the injected GLB inspector; and
- every artifact hash/size plus the deterministic output-manifest bytes.

The inspectors are mandatory production ports. Do not substitute filename, extension, or successful-process-exit checks.

## Object publication and orphan handling

Safe artifact bytes are uploaded first under content-addressed internal keys using create-if-absent, exact content type/length, SHA-256 checksum, and collision revalidation. Only after all five frozen roles exist does one lease/result-fenced database transaction insert the result, artifacts, cache identity, terminal job/attempt event, audit/outbox rows, and reservation release.

If any upload or transaction loses its fence, no partial result is visible. Uploaded content-addressed bytes may be an orphan and are safe to retain because they are immutable and unaddressable through the API. Operations may garbage-collect only objects that have no retained `render_artifacts` or enhancement-artifact reference after a conservative age window. Never delete by job prefix and never delete an object merely because one publication attempt failed; another exact result may share its hash.

## Integrated composition and activation checklist

The following root integration is complete:

1. Migration 0014 is in the central registry and the empty C1-C14 bootstrap path.
2. The executable API instantiates `PostgresRenderRepository`, `RenderStillService`, storage, exact C10/C13 authority adapters, opaque access signing and route registration.
3. The worker composition adapts C14-L1 render-scene construction while preserving the exact source, specification and catalog pins.
4. Production GLB/OpenEXR inspectors, content-addressed derived storage and post-download hash/size/type verification are wired behind narrow ports.
5. Optional enhancement remains a persisted child that can never replace or hide the geometry-safe result.

Before an authorised renderer host may accept jobs, all of these remain mandatory:

1. Create separate API, renderer-worker and protected claim-function-owner roles; grant the worker only constrained claim execution and its exact private repository operations.
2. Configure a dedicated workspace volume, stable volume ID, worker identity, capability list and lease/heartbeat values.
3. Set explicit absolute executable and script paths plus their SHA-256 values, renderer build/version, host fingerprint and authorised-host acceptance hash. Discovery, a PATH fallback and a hard-coded Mac path are forbidden.
4. Keep every production profile `available: false`, `acceptingNewJobs: false`, and hardware evidence `deferred` until acceptance proves that exact build/script/profile/host combination.

The executable application maps validated central configuration into typed constructors. The renderer and worker modules do not discover environment state themselves. `workers/blender-renderer/scripts/host-acceptance.ts` also requires an explicit absolute `C14_ACCEPTANCE_BLENDER_PATH`; the local close-out does not execute that script.

## Verification

The repeatable source/control-plane gate uses only inert or frozen fixtures:

```sh
pnpm test:c14
git diff --check
```

`pnpm test:c14` runs source-only render-scene, inert renderer, API, worker, web, evaluation, performance, security and enhancement suites; six standalone TypeScript checks; C14 Python lint/typechecking; the disposable integration; and meaningful API/dependency-boundary checks. Generated `dist/test/**` copies are excluded. Without the two live environment variables, only the disposable integration case is intentionally skipped.

Run live migration/RLS/claim and C1-C14 control-plane tests only against explicitly disposable database and S3 scopes:

```sh
C14_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/c14_disposable \
C14_RUNNER_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/c14_control \
C14_RUNNER_TEST_STORAGE_ENDPOINT=http://127.0.0.1:8333 \
  pnpm test:c14
```

The C14 PostgreSQL suite creates and removes constrained probe roles. It proves forced tenant isolation, no worker table access, one concurrent claim winner, exact disk threshold admission, stale-cancellation release, append-only rejection, exact replay, and changed-body conflict. The full-chain test starts at empty migrations, creates real C1-C13 records, compiles an exact C10 GLB, resolves a current C13 substitution revision, claims and fences the C14 job, publishes five immutable synthetic artifacts, brokers access, re-downloads and verifies every byte/hash/type, confirms redacted logs and proves canonical model counts are unchanged. It reuses only a database containing exactly migrations 0001-0014 and can run repeatedly. `FrozenInertRenderer` is never Blender evidence.

Browser acceptance is separate and also fixture-labelled:

```sh
pnpm exec playwright test --config tests/e2e/render-stills/playwright.config.ts
pnpm exec playwright test --config apps/web/playwright.config.ts
```

Authorised-host acceptance is a separate checkpoint. Record the executable and script hashes, Blender build identity, host fingerprint, profile/capability, input and output hashes, wall/resource limits, and the fact that the host is permitted. Do not relabel inert-fixture results as Blender, Cycles, GPU, or render-pass evidence.

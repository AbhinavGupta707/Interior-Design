# C7 native capture backend and RoomPlan converter

## Safety boundary

C7 accepts a server-issued capture brief, immutable checksum-bound RoomPlan source artifacts and one exact package manifest. It produces one immutable existing-state proposal or explicit abstention. C7 never invokes C5, never writes a canonical model or branch, and never treats captured appearance, USDZ, inferred hidden geometry or an address as dimensional truth. A later authorised review/commit flow must validate any accepted proposal.

Source evidence is immutable. Every package binds artifact ID, kind, media type, optional room ID, byte count and SHA-256. The worker streams and rehashes every object before parsing the bounded normalized and quality JSON. Unsupported curves, stairs, hidden structure, thickness, global anchors and other unobserved facts remain findings or unknowns rather than inferred geometry.

Training use is always `denied`. Service-processing permission can be withdrawn monotonically. Authorization is evaluated before project/session disclosure, and all persistence queries include tenant, project and capture-session keys.

These checks use only visibly synthetic fixtures. A local test pass does not prove physical-device RoomPlan or LiDAR capture quality, measurement accuracy, structural suitability, regulatory compliance, cost or professional review.

## Migration and readiness

`services/platform-api/migrations/0007_native_capture.sql` requires the C2, C4 and C6 migration markers. Apply C1 through C7 to a disposable database; do not point verification at a database containing user data.

From the repository root, with the existing local services running:

```sh
C7_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c7_test' \
  pnpm --filter @interior-design/platform-api exec tsx src/c7.ts migrate
```

The API readiness set includes `c7-database` and `c7-object-storage`. Readiness fails until migration `0007_native_capture` is recorded and the source, derived and quarantine buckets are reachable. Database lookup is `C7_DATABASE_URL`, then `C6_DATABASE_URL`, `C2_DATABASE_URL`, then `C1_DATABASE_URL`; production has no implicit database. Storage continues to use the C2 S3-compatible configuration boundary and requires production HTTPS/non-loopback configuration.

Migration `0007` creates:

- tenant/project/session-scoped sessions and immutable briefs;
- append-only rights events;
- immutable source descriptors, upload sessions and checksum-bound part declarations;
- one immutable package and up to three fenced processing attempts;
- one immutable proposal/abstention result; and
- redacted append-only audit and outbox events.

Composite keys prevent cross-tenant, cross-project, cross-session, cross-artifact, cross-package and cross-attempt substitution. Triggers enforce legal monotonic state transitions, source identity immutability, lease fencing, append-only history and terminal result immutability.

## Frozen public routes

The API registers exactly:

- `GET|POST /v1/projects/:projectId/capture-sessions`
- `GET /v1/projects/:projectId/capture-sessions/:captureSessionId`
- `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/cancel`
- `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/retry`
- `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions`
- `GET /v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions/:uploadSessionId`
- `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions/:uploadSessionId/parts`
- `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions/:uploadSessionId/complete`
- `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/packages`
- `GET /v1/projects/:projectId/capture-sessions/:captureSessionId/proposal`

Every mutation requires the existing bounded `Idempotency-Key`. The same tenant, actor, operation, key and canonical request body returns the stored response with `Idempotent-Replay: true`; any substitution conflicts. A signed part is valid only for the immutable planned byte count and SHA-256 checksum. Completion requires every consecutive part exactly once with the same checksum and provider token.

Finalization locks the session and all registered artifacts. It rejects incomplete uploads; missing, extra or substituted artifacts; identity/mode/rights mismatch; non-consecutive room sequence; invalid capture interval; expiry; cancellation; or withdrawn rights. It then creates one package and one queued attempt atomically. It does not mutate canonical state.

## Lifecycle, cancellation and retry fencing

Session states are `created`, `uploading`, `uploaded`, `processing`, `proposed`, `abstained`, `cancel-requested`, `cancelled` and `failed`.

- Cancelling before processing aborts open provider uploads, fences queued work and terminates the session.
- Provider-abort failure never rolls back a rights, expiry or cancellation fence. The upload/artifact becomes terminal in PostgreSQL, its provider ID remains internally retained, and the source-bucket multipart lifecycle must reap any unconfirmed provider upload without reopening signing or finalization.
- Cancelling or withdrawing rights during processing changes both the session and live attempt to `cancel-requested`. Publication re-locks and rechecks session, lease token/owner/expiry, brief expiry, rights and absence of an existing result.
- A worker can acknowledge only its exact live cancellation token. Expired abandoned cancellations are completed by the bounded queue cleanup path.
- A retry is allowed only after a pre-publication retryable failure, retained rights, an unexpired brief, a retained package and fewer than three attempts. It appends a new queued attempt; the failed attempt is never rewritten.
- Proposed, abstained and cancelled sessions and every result row are immutable.

Run expiry as a bounded administrative operation:

```sh
C7_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c7_test' \
C2_STORAGE_ENDPOINT='http://127.0.0.1:8333' \
  pnpm --filter @interior-design/platform-api exec tsx src/c7.ts expire
```

Use `migrate-and-expire` only when both actions are intended.

## RoomPlan worker

Set `C7_ROOMPLAN_WORKER_ENABLED=true` to enable the C7 queue alongside the existing spatial worker. The worker uses the established C2 runtime configuration; in particular its database variable remains `C2_DATABASE_URL` and its storage variables remain `C2_S3_ENDPOINT`, `C2_S3_REGION`, `C2_S3_ACCESS_KEY_ID`, `C2_S3_SECRET_ACCESS_KEY` and `C2_S3_FORCE_PATH_STYLE`.

Local example:

```sh
NODE_ENV=development \
C7_ROOMPLAN_WORKER_ENABLED=true \
C2_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c7_test' \
C2_S3_ENDPOINT='http://127.0.0.1:8333' \
C2_S3_REGION='local' \
C2_S3_ACCESS_KEY_ID='localdev' \
C2_S3_SECRET_ACCESS_KEY='local-development-only' \
C2_S3_FORCE_PATH_STYLE='true' \
  pnpm --filter @interior-design/spatial-worker dev
```

The shown credentials are repository-local fixture values only. Do not reuse them outside the loopback development stack or commit real credentials.

The validator accepts only `c7-roomplan-normalized-v1` integer micrometre translations and integer nanounit bases. It rejects schema/version/session/project/hash mismatches, non-finite or floating coordinates, count/range excess, duplicate entity/room/measurement/edge/corner identifiers, broken or cyclic parents, non-wall opening parents, room/story mismatch, bad room sequencing, incompatible world origins, non-right-handed or non-orthonormal bases and measurements that reference absent entities.

Conversion is deterministic and bounded. Apple RoomPlan x/y/z is mapped to canonical east/up/north without floating-point geometry. Half-away-from-zero integer division converts micrometres to millimetres. Straight observed walls, bounded floors, hosted openings and supported objects can become a canonical-shaped `profile=existing` proposal with a source mapping for every emitted element. Curves, stairs and unsupported observations remain unresolved. Low quality, incompatible input or ambiguous topology yields an explicit abstention.

## Focused verification

Materialize the lockfile without modifying it:

```sh
pnpm install --frozen-lockfile --offline
```

Run all owned static and deterministic checks:

```sh
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api exec vitest run test/c7 --exclude 'dist/**'

pnpm --filter @interior-design/spatial-worker typecheck
pnpm --filter @interior-design/spatial-worker lint
pnpm --filter @interior-design/spatial-worker exec vitest run test/roomplan --exclude 'dist/**'
```

The integration files are environment-gated. An unset variable is a reported skip, not passing live evidence. Use a disposable database because the tests deliberately prove append-only behavior and leave synthetic evidence rows:

```sh
C7_TEST_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c7_test' \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c7/postgres.integration.test.ts --maxWorkers=1

C7_TEST_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design_c7_test' \
  pnpm --filter @interior-design/spatial-worker exec vitest run \
  test/roomplan/postgres.integration.test.ts --maxWorkers=1

C7_TEST_S3_ENDPOINT='http://127.0.0.1:8333' \
C7_TEST_S3_ACCESS_KEY='localdev' \
C7_TEST_S3_SECRET_KEY='local-development-only' \
C7_TEST_S3_REGION='local' \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c7/s3.integration.test.ts --maxWorkers=1
```

The live PostgreSQL suites apply C1 through C7 before exercising exact replay/conflict, tenant isolation, checksum binding, concurrent identical part declaration, substitution rejection, package finalization, retry append, expiry, rights withdrawal, stale-lease rejection, cancellation acknowledgement, one-result publication and immutable history. The S3 suite performs one real visibly synthetic checksum-bound multipart upload and readback. No paid provider, outbound inference, customer evidence, GPU or physical RoomPlan/LiDAR claim is involved.

## Operational diagnostics

If C7 routes or readiness are missing, diagnose registration first: confirm the platform process composes `registerC7Module`, migration `0007_native_capture` is present and readiness lists `c7-database`/`c7-object-storage`. Only then inspect authentication, authorization, database or storage failures.

Safe logs and audit/outbox metadata may include IDs, hashes, counts, attempt numbers, states and safe codes. They must not include source bytes/JSON, object keys, provider upload IDs, signed URLs, raw RoomPlan data, credentials or tokens. Storage errors and worker failures are deliberately normalized before logging or public disclosure.

# C2 evidence API development runbook

## Scope and safety boundary

`c2-ingest-v1` accepts rights-aware plan, photograph, video and document uploads. The platform API
owns upload-session state, immutable source locators, tenant/project isolation, multipart signing,
durable processing-job creation and short-lived ready-asset access. It does not inspect media bytes,
claim malware scanning, infer geometry or expose storage provider identifiers.

Use only synthetic fixtures locally. Source objects are immutable after completion. Reset the local
object-store volume deliberately when synthetic completed sources are no longer needed; there is no
source replacement or delete route.

## Start local dependencies

From the repository root:

```sh
docker compose -f infrastructure/local/compose.yaml up -d postgres object-storage
docker compose -f infrastructure/local/compose.yaml ps
```

The checked-in stack binds PostGIS to `127.0.0.1:54321` and SeaweedFS S3 to
`127.0.0.1:8333`. Its four lifecycle buckets are `source`, `derived`, `issued` and `quarantine`.
C2 reads/writes only `source`, `derived` and `quarantine`.

Apply C1 before C2, then bootstrap only the explicit synthetic identities:

```sh
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap
pnpm --filter @interior-design/platform-api exec tsx src/c2.ts migrate
```

Run the API with `pnpm --filter @interior-design/platform-api dev`. Executable development and
production startup always composes C2. Test/composition harnesses that inject C1 boundaries must opt
in with injected C2 boundaries.

## Configuration

| Variable                       | Local default                                          | Production rule                                             |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| `C2_DATABASE_URL`              | falls back to `C1_DATABASE_URL`, then loopback PostGIS | one database URL is required                                |
| `C2_STORAGE_ENDPOINT`          | `http://127.0.0.1:8333`                                | required non-loopback HTTPS URL                             |
| `C2_STORAGE_REGION`            | `local`                                                | explicit provider region recommended                        |
| `C2_STORAGE_ACCESS_KEY_ID`     | conspicuous local fixture value                        | required explicitly                                         |
| `C2_STORAGE_SECRET_ACCESS_KEY` | conspicuous local fixture value                        | required explicitly                                         |
| `C2_STORAGE_FORCE_PATH_STYLE`  | `true`                                                 | `false` unless the selected compatible provider requires it |

Production never falls back to loopback, HTTP, local credentials or an implicit SDK credential
chain. Credential values, provider upload IDs, object keys and signed URLs must not enter logs.

## HTTP workflow

All routes require a C1 bearer session and tenant-scoped project membership. Mutations also require
an 8–128 character `Idempotency-Key`. Reusing a key with a different actor, operation or body returns
`IDEMPOTENCY_CONFLICT`.

1. `POST /v1/projects/:projectId/assets/upload-sessions` fixes byte size, full-file SHA-256,
   declared MIME, safe display filename, kind and rights. `serviceProcessingConsent` must be true;
   training permission defaults independently to `denied`.
2. `GET /v1/projects/:projectId/assets/upload-sessions/:sessionId` returns the strict public session
   fields plus the shared-contract `recordedPartNumbers` array. It is always sorted and unique;
   empty sessions return `[]`.
3. `POST .../:sessionId/parts` binds the exact planned byte size, part number, SHA-256 checksum and
   a maximum 15-minute expiry into the signed request. The client must send every returned
   `requiredHeaders` entry unchanged.
4. `POST .../:sessionId/complete` requires ordered consecutive parts from one, exact recorded
   checksums, provider ETags, the declared full-file SHA-256 and the immutable aggregate size. It
   completes the source once and atomically enqueues one processing job.
5. `DELETE .../:sessionId` aborts only an incomplete session. Complete versus abort is serialized by
   a session row lock, so exactly one terminal mutation wins.
6. `GET /v1/projects/:projectId/assets` and `GET .../assets/:assetId` return locator-free public DTOs.
7. `POST .../assets/:assetId/access` signs only a ready representation for at most five minutes.
   Originals are attachments. Only safe raster derived previews/thumbnails are inline. Viewers may
   inspect inventory and safe derivatives but cannot upload, mutate sessions or access originals.

Foreign tenant/project/asset/session IDs and unknown IDs use the same non-disclosing `404` response.

## Multipart and storage invariants

- Sources use opaque server-generated `sources/<uuid>` keys in the distinct `source` bucket.
- The application part target/maximum is 128 MiB. A final part may be smaller; every non-final part
  is at least five MiB. At most 10,000 parts and two GiB are accepted.
- Part SHA-256 is a signed header. S3 ETags are provider completion tokens, never whole-file hashes.
- Ambiguous completion retries recover only if the uniquely generated source object exists with the
  immutable expected byte size. The hostile-media worker still streams and verifies the full SHA-256
  before a ready result.
- Access never uses a quarantined artifact. Raw SVG or a non-raster derivative is not issued inline.
- Source keys and source fingerprints are protected by database triggers. Rights assertions,
  derived artifact records and C2 audit events are append-only.

## Durable processing jobs

Completion inserts one validated `c2-ingest-v1` command into `asset_processing_jobs`. Workers lease
with `FOR UPDATE SKIP LOCKED`; a claim moves the job from `queued` or `retryable` to `leased`,
increments and revalidates the attempt number, changes the asset from `uploaded` to `processing`,
and expires after 30–900 seconds. Safe failures may return to `retryable` up to ten attempts. A
validated result atomically records immutable artifacts, transitions the asset to `ready`,
`quarantined` or `rejected`, and marks the job `succeeded`. An exhausted job becomes `failed` and
rejects the asset with the public `processing-failed` code. Every commit is fenced by the current
lease token. Worker error details are never stored; only bounded safe codes are kept.

## Expiry cleanup and readiness

Run deterministic cleanup manually or from a trusted scheduler:

```sh
pnpm --filter @interior-design/platform-api exec tsx src/c2.ts cleanup-expired
```

Cleanup leases expired active sessions with `SKIP LOCKED`, idempotently aborts their provider upload,
marks the session `expired`, marks the unfinished asset `aborted`, and appends a system audit event.
The command prints only a count. `GET /health/ready` requires migration `0002_assets_evidence` and
successful head checks for `source`, `derived` and `quarantine`.

## Verification

Provider-free checks:

```sh
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api test:unit
C1_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
  pnpm --filter @interior-design/platform-api exec vitest run test/c2/postgres.integration.test.ts
C2_TEST_S3_ENDPOINT=http://127.0.0.1:8333 \
  pnpm --filter @interior-design/platform-api exec vitest run test/c2/s3.integration.test.ts
```

The Postgres suite uses provider fakes while exercising real transactions, two tenants, viewer
denial, idempotent retries, complete/abort races, durable job retries, access and source-key
immutability. The S3 suite uses one synthetic object to prove real path-style multipart signing,
checksum/header binding, completion and attachment access. Neither suite claims worker media
inspection, antivirus, cloud S3 or real customer evidence.

With the migrated local stack, API and spatial worker already running, execute the complete
synthetic upload-to-preview journey and the live adversarial API/media pack:

```sh
C2_LIVE_STACK_API_URL=http://127.0.0.1:4100 \
  node tests/integration/evidence/live-stack-smoke.mjs
C2_LIVE_STACK_API_URL=http://127.0.0.1:4100 \
  node tests/integration/evidence/run-live-api-harness.mjs
```

The smoke harness proves signed multipart upload, durable leasing, bounded processing, a fetchable
derived JPEG and viewer denial for original-source access. The adversarial harness creates isolated
synthetic tenants and passes bearer fixtures to Vitest only through the child environment; it must
not print or persist those credentials.

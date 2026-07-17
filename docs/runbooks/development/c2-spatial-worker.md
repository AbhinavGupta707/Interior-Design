# C2 spatial worker development runbook

## Scope and status

This runbook covers the provider-free `c2-ingest-v1` hostile-media worker in `services/spatial-worker`. It validates and prepares immutable evidence; it does not parse floor-plan geometry, reconstruct rooms, call external AI providers or claim that a malware scan happened.

The default development path uses local PostgreSQL/PostGIS and the loopback S3-compatible service. Source, derived and quarantine buckets are separate security/lifecycle classes. The worker reads only `source`, writes generated artifacts only to `derived`, and never copies, replaces, deletes or moves the source object. Quarantine is a database/access transition; the baseline does not fabricate or move a source object into the quarantine bucket.

## Processing sequence

1. Claim one eligible job inside a PostgreSQL transaction with `FOR UPDATE SKIP LOCKED`.
2. Strictly parse the stored shared command, cross-check its asset/project envelope, increment the bounded attempt, establish a UUID lease and preserve the first processing timestamp across retries.
3. Transition the matching tenant/project asset from `uploaded` or expired `processing` to `processing`.
4. Stream the source into a new mode-0700 `c2-ingest-*` directory using an exclusive mode-0600 file while incrementally counting bytes and computing SHA-256.
5. Reject checksum/size mismatch before inspection or derived writes.
6. Compare `file-type`, `/usr/bin/file`, declared MIME, asset kind and parser/container evidence.
7. Inspect and rasterise with bounded Sharp, Poppler or FFmpeg tooling. Child processes receive arrays, `shell: false`, no stdin, a minimal environment, a deadline and a combined stdout/stderr ceiling.
8. Hash previews/thumbnails, build content-addressed keys, write the metadata/provenance manifest locally, and parse the complete shared result before any derived object write.
9. Use `If-None-Match: *` for derived writes. On an existing key, verify byte size and SHA-256 metadata instead of overwriting.
10. Revalidate the result and, while the lease is current, atomically insert artifact records, transition the asset, complete the job and append a safe audit event.
11. Remove the isolated directory deterministically. On shutdown or lease loss, stop committing side effects and let the durable lease expire for another attempt.

## Media policy

| Input         | Checks                                                                                                                                                                                                       | Derived output                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| JPEG/PNG      | signature, parser, one frame/page, width/height ≤ 20,000, total pixels ≤ 100 million                                                                                                                         | orientation-normalised flattened JPEG preview and thumbnail with metadata stripped |
| SVG           | UTF-8, bounded to 16 MiB, valid SVG signature, dimensions/pixels; rejects DTD/entity, scripts, styles/imports, event handlers, animation, foreign/embedded content and every non-fragment resource reference | raster JPEG only; raw SVG is never a derived artifact                              |
| PDF           | signature, `pdfinfo` parse, 1–500 pages, bounded subprocess work/output                                                                                                                                      | Poppler first-page raster re-encoded by Sharp plus thumbnail                       |
| MP4/QuickTime | signature, major brand/container agreement, exactly one bounded video stream, allowed audio/video codecs, dimensions/pixels and duration                                                                     | one bounded FFmpeg frame re-encoded by Sharp plus thumbnail                        |
| HEIC/HEIF     | signature agreement only                                                                                                                                                                                     | rejected as `unsupported-type`; no speculative transcode                           |

The contract prose freezes video duration at 30 minutes. The exported shared numeric constant and result-schema maximum are currently `108_000_000` ms (30 hours). The worker deliberately enforces the stricter prose requirement, `1_800_000` ms. The orchestrator/shared-contract owner should reconcile this inconsistency; this lane does not edit `packages/contracts/**`.

The worker caps media streams at 16, SVG source at 16 MiB, subprocess output at 1 MiB by default and temporary storage at 2.5 GiB by default. Source upload size remains bounded by the shared 2 GiB contract. A source larger than the result schema can represent is failed without inventing a `verifiedSource` fingerprint.

## Malware language

No malware scanner daemon or signature database is installed for C2. Baseline controls are checksum, magic/signature agreement, parser validation, codec/container validation, resource ceilings, isolated temporary storage and safe derived output. The metadata manifest says `antivirus: not-configured`.

`ThreatScanner` is a narrow test/adapter seam. Only an adapter that positively returns `malware-suspected` creates a shared-schema `quarantined` result. A configured adapter that returns no suspicion signal is recorded as such and is not described as antivirus clearance.

## Environment

Development/test defaults are deliberately local. Production has no credential defaults.

| Variable                                                          | Development default            | Rule                                                                          |
| ----------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `NODE_ENV`                                                        | `development`                  | `development`, `test` or `production`                                         |
| `C2_DATABASE_URL`                                                 | local C1 PostgreSQL URL        | must be a PostgreSQL URL with user, host and database; required in production |
| `C2_S3_ENDPOINT`                                                  | `http://127.0.0.1:8333`        | HTTPS, except plaintext loopback outside production; no URL credentials/query |
| `C2_S3_REGION`                                                    | `local`                        | non-empty bounded string                                                      |
| `C2_S3_ACCESS_KEY_ID` / `C2_S3_SECRET_ACCESS_KEY`                 | local-only fixture credentials | both required in production; never logged                                     |
| `C2_S3_FORCE_PATH_STYLE`                                          | `true`                         | `true` or `false`                                                             |
| `C2_SOURCE_BUCKET` / `C2_DERIVED_BUCKET` / `C2_QUARANTINE_BUCKET` | frozen literal names           | cannot be redirected to another lifecycle class                               |
| `C2_WORKER_ID`                                                    | `spatial-worker-local`         | bounded safe identifier, not a secret                                         |
| `C2_LEASE_MS`                                                     | `60000`                        | 10–300 seconds                                                                |
| `C2_HEARTBEAT_MS`                                                 | `15000`                        | at least one second and strictly less than half the lease                     |
| `C2_POLL_MS`                                                      | `1000`                         | 100 ms–60 seconds                                                             |
| `C2_TEMP_ROOT`                                                    | OS temporary root              | resolved absolute parent; each job receives a fresh child                     |
| `C2_TEMP_MAX_BYTES`                                               | `2684354560`                   | 256 MiB–3 GiB                                                                 |
| `C2_SUBPROCESS_TIMEOUT_MS`                                        | `30000`                        | 1–120 seconds                                                                 |
| `C2_SUBPROCESS_MAX_OUTPUT_BYTES`                                  | `1048576`                      | 4 KiB–4 MiB                                                                   |
| `C2_FILE_PATH`                                                    | `/usr/bin/file`                | executable path/name; no shell                                                |
| `C2_PDFINFO_PATH` / `C2_PDFTOPPM_PATH`                            | `pdfinfo` / `pdftoppm`         | missing Poppler rejects PDF support honestly                                  |
| `C2_FFPROBE_PATH` / `C2_FFMPEG_PATH`                              | `ffprobe` / `ffmpeg`           | missing tools/decoder reject video support honestly                           |

Run:

```bash
pnpm --filter @interior-design/spatial-worker dev
```

`SIGINT` and `SIGTERM` abort active uncommitted work, clean its temporary directory, close S3/PostgreSQL clients and leave the lease recoverable after expiry.

## Frozen migration/API integration assumptions

This lane cannot edit migration `0002` or API files. `PostgresProcessingJobRepository` expects the C2-L1 migration to expose the following internal worker columns and legal states:

- `asset_processing_jobs`: `id`, `tenant_id`, `project_id`, `asset_id`, `command jsonb`, `result jsonb`, `status` (`queued`, `retryable`, `processing`, `completed`, `failed`), `attempt_count`, `maximum_attempts`, `available_at`, `lease_owner`, `lease_token uuid`, `lease_expires_at`, `processing_started_at`, `last_error_code`, `created_at`, `updated_at`, `completed_at`;
- `assets`: tenant/project-scoped `id`, `status`, `detected_mime_type`, `rejection_code`, `technical_metadata`, `updated_at`;
- `derived_asset_artifacts`: `id`, tenant/project/asset IDs, `bucket`, `object_key`, `kind`, `mime_type`, `byte_size`, `sha256`, plus uniqueness compatible with `(tenant_id, project_id, asset_id, kind, sha256)`;
- `asset_audit_events`: `id`, tenant/project/asset IDs, `event_type`, `details`, and a database-owned occurrence timestamp.

The L1 integration must either match those names/states or adapt this repository during orchestrator integration. Every predicate includes tenant, project and asset identity. `processing_started_at` must remain stable across retries so the result/manifest `executedAt` and content-addressed manifest are idempotent.

When an infrastructure failure exhausts attempts before a full source fingerprint exists, the repository marks the job failed and the asset `rejected` with `processing-failed`, leaving `result` null. This avoids falsely populating the frozen result's required `verifiedSource` field. The API should tolerate that terminal internal failure projection.

## Storage permissions

Use a worker identity restricted to:

- read the one source bucket/key prefix described by validated commands;
- create-if-absent and head objects in the derived bucket/prefix;
- no source put/copy/delete, no bucket administration, no issued-bucket access and no broad cloud credentials;
- quarantine-bucket write only when a future reviewed adapter actually emits a quarantine artifact.

Object keys, provider upload IDs, signed URLs, bearer credentials, filenames, rights free text, tool stderr and media content must not enter logs. Structured worker logs contain only bounded event/error codes and internal UUIDs/attempt/status fields.

## Verification

```bash
pnpm --filter @interior-design/spatial-worker lint
pnpm --filter @interior-design/spatial-worker typecheck
pnpm --filter @interior-design/spatial-worker test:unit
pnpm --filter @interior-design/spatial-worker test:integration
pnpm --filter @interior-design/spatial-worker build
```

The synthetic suite generates tiny JPEG, SVG, PDF and MP4 inputs and covers checksum/signature/malformed failures, limits, missing tools, subprocess timeout/error/output, argument/path isolation, metadata stripping, manifest provenance, log redaction, conditional retry idempotence, lease loss/recovery and exhausted pre-verification failure.

This lane does not include migration `0002`, so a real Postgres/SeaweedFS end-to-end run requires the integrated C2-L1 lane. Do not record live lease/storage evidence until that integrated path has actually run.

## Troubleshooting

- `unsupported-type` for PDF/video: confirm the exact configured executable exists and the local build supports the input codec. Do not change the result to success.
- `signature-mismatch`: compare upload declaration with both magic detectors; never trust extension/filename.
- `resource-limit`: inspect dimensions, pages, duration, stream count, subprocess deadline/output or temporary usage. Do not raise production limits ad hoc.
- repeated `retryable`: check local database/object storage readiness and lease clock behavior. Derived objects from a partial attempt are safe only when their key and SHA-256 metadata match.
- `lease-lost`: another worker or clock expiry owns the durable decision. The losing worker must not commit results.
- startup failure: logs intentionally expose only `configuration-or-runtime-unavailable`; validate environment values directly without printing secrets.

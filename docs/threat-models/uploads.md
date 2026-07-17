# C2 immutable evidence upload threat model and adversarial acceptance

## Status, scope, and evidence claim

This is the independent C2-L4 threat model and executable acceptance contract for `c2-ingest-v1`. It covers plan, photograph, video, document, multipart, processing, storage, access, tenancy, logging, and cleanup boundaries.

The provider-free contract/fixture tests run before the production lanes merge. Live API, loopback S3, Postgres, worker, log, and browser suites are environment-gated and deliberately skip with a named reason when their isolated synthetic environment is unavailable. A skipped suite is not security evidence. C2 does not claim malware-scanner coverage, safe parsing merely because a file has an allowed extension, physical-device evidence, or production-cloud hardening.

## Protected assets and objectives

Protected assets are source evidence bytes and checksums; rights and training-consent decisions; tenant/project/session/asset ownership; provider upload IDs, bucket names, object keys and signing credentials; short-lived signed URLs; derived previews and manifests; processing leases and job commands; audit/correlation records; filenames and media metadata that may reveal household information.

Security objectives are:

1. authenticate and freshly authorise every public operation;
2. keep every tenant-owned lookup and mutation scoped by tenant and project;
3. keep source bytes immutable and source/derived/quarantine lifecycle classes separate;
4. treat filename, extension, declared MIME, ETag, metadata and parser diagnostics as hostile hints;
5. recompute full source size/SHA-256 before a ready result;
6. bound bytes, parts, decoded geometry, pages, duration, frames, streams, subprocesses, output, wall time and temporary disk;
7. never render raw SVG or expose an original inline;
8. strip metadata from ready previews and avoid external resource resolution;
9. serialize terminal transitions and make retries/leases/idempotency deterministic; and
10. exclude capabilities, internal locators, credentials, rights free text, avoidable filenames and media content from logs/problems.

## Actors and entry points

| Actor                          | Capability                                                                  | Threat posture                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Owner/editor                   | Create, resume, sign parts, complete/abort, list/read, request ready access | May be malicious, compromised, racing, or confused; never supplies authority fields.                    |
| Viewer                         | List/inspect ready inventory and safe preview                               | Must not create, sign, complete, abort, write, or obtain originals.                                     |
| Foreign tenant member          | Legitimate identity for a different tenant/project                          | Must learn no more than an unknown-ID probe.                                                            |
| Anonymous/probe                | No valid bearer session                                                     | May enumerate IDs, replay URLs, flood bodies, or send malformed JSON.                                   |
| Object store                   | Receives checksum-bound signed operations                                   | Provider ETag and upload ID are tokens, not source integrity or public fields.                          |
| Spatial worker                 | Reads internal validated commands and invokes bounded parsers               | Has no authority to widen buckets, tenant ownership, readiness, or canonical state.                     |
| Media/parser/subprocess        | Consumes hostile bytes and metadata                                         | May crash, hang, allocate, emit floods, read external resources, or return misleading metadata.         |
| Support/observability operator | Sees structured logs/metrics                                                | Must not receive bearer capabilities, signed URLs, object keys, media, or avoidable household metadata. |

Public entry points are the eight frozen C2 HTTP routes, signed S3 PUT/GET URLs, the worker command/result boundary, PostgreSQL job leasing, media parser/subprocess inputs, preview rendering, logs/traces, and the expiry/cleanup loop.

## Trust boundaries

| Boundary                           | Untrusted input                                                                         | Required validation/mitigation                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client → API                       | Bearer header, route IDs, JSON, idempotency key, filename, MIME, size/hash, rights text | C1 authentication; runtime-strict schemas and bounds; server-derived actor/tenant/action; generic problems; body/header/rate limits.                            |
| API → object store                 | Bucket/key/upload ID, part number, checksum, expiry, headers                            | Server-generated opaque source key; literal lifecycle bucket; checksum-bound signature; ≤900 s; no response/log leakage.                                        |
| Multipart → completion transaction | Recorded byte sizes/checksums/ETags/order, concurrent complete/abort                    | Consecutive unique parts from 1; non-final minimum; declared total and SHA fixed; ETag only provider token; row/transaction serialization; one job.             |
| Source store → worker              | Object stream plus persisted processing command                                         | Parse `assetProcessingCommandSchema` before side effects; source bucket only; stream size/hash recomputation; no public filename as path/argument.              |
| Worker → parser/subprocess         | Hostile bytes/container metadata                                                        | No shell; fixed executable and argument arrays; isolated temporary directory; input/output/time/disk/process ceilings; kill process group; safe stderr summary. |
| Parser → result/persistence        | Detected MIME, dimensions/pages/duration, artifacts, diagnostics                        | Runtime result schema plus cross-field resource checks; content-addressed derived key; atomic job/asset result; no source overwrite.                            |
| API → browser/viewer               | Filename, status, rejection, preview/original URL                                       | React text escaping; no raw SVG/XML/object/embed; viewer write/original denial; original attachment; ≤300 s; referrer/leak controls.                            |
| Services → telemetry               | IDs, failures, headers, signed queries, metadata                                        | Allowlisted structured fields and route templates; header/body/query redaction; no media or raw parser output.                                                  |

## Abuse cases, controls, and executable evidence

| Threat/abuse                                                                      | Required outcome                                                                                                        | Evidence in this lane                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `../`, Windows separators, NUL/control names                                      | Reject at request boundary; no storage/subprocess side effect                                                           | `contracts.security.test.ts`; live filename test                                                  |
| Dot names, percent-encoded separators, bidi/confusable extension, shell/flag text | Treat only as escaped display metadata; never decode into a key or pass as an argument                                  | Static finding C2-QA-004; shell-name fixture; worker source/live media tests; E2E inert-text test |
| Extension/declared MIME disagrees with signature/kind                             | Edge may accept the allowlisted declaration as a hint; worker rejects `signature-mismatch`                              | MIME/PDF fixture; contract and live worker suites                                                 |
| PNG+SVG or other polyglot/trailing active content                                 | Reject or create a metadata-free derived raster with no active marker                                                   | Polyglot fixture; live preview-marker assertions                                                  |
| SVG entity, `file:` entity, remote `<image>/<use>`                                | Resolve neither filesystem nor network; reject or isolated rasterize; never serve raw                                   | SVG XXE/external fixtures; live preview and browser embedding assertions                          |
| Image dimension/pixel bomb                                                        | Inspect before full decode; reject above dimension or 100 MP; decoded allocation bounded                                | Metadata-only PNG claim; contract gap test; live worker suite                                     |
| PDF page/decompression/recursive stream bomb                                      | Bound pages, streams, recursion, decoded bytes, wall time, output and temp disk                                         | Tiny `/Count 501` and `/FlateDecode` length claims; live worker suite                             |
| Video duration/frame/codec/container bomb                                         | Bound duration, streams/frames, parser output, wall time and temp disk; reject malformed metadata                       | Tiny `mvhd` and impossible box fixtures; contract-duration finding; live worker suite             |
| Parser/subprocess option injection, escape, hang or output flood                  | Fixed executable/argument arrays, no shell, no filename arguments, `--` where applicable, quotas and kill               | Shell-name/output fixtures; gated worker-source audit; live terminal-result test                  |
| EXIF/GPS privacy                                                                  | Original stays attachment-only; every ready preview removes EXIF/GPS sentinel                                           | Valid synthetic zero-coordinate EXIF fixture; live preview assertion                              |
| Duplicate/reordered/gapped/undersized parts                                       | Reject before provider completion/job enqueue; preserve resumable state                                                 | Contract cases and live multipart suite                                                           |
| Checksum/ETag confusion                                                           | Part checksum is bound; ETag remains opaque; full streamed SHA/size decides ready                                       | Contract separation test and live wrong-full-hash test                                            |
| Same idempotency key with altered body                                            | Conflict; identical replay has one immutable asset/session effect                                                       | Live idempotency test                                                                             |
| Complete/abort race or terminal replay                                            | Serialized terminal state, no 500/partial state, one job, replayed part URL unusable                                    | Live concurrent race/replay test                                                                  |
| Crashed/stale lease                                                               | Reclaim only after expiry, increment bounded attempt, never overwrite source/artifact, at most one active job           | Gated Postgres stale-lease assertion plus production worker tests                                 |
| Bucket/key substitution                                                           | Only `source`, `derived`, `quarantine` literals and non-traversing opaque keys                                          | Contract command tests; strict public response test                                               |
| Cross-tenant dedup ownership confusion                                            | Reuse computation only; create distinct tenant-owned asset and never grant access                                       | Live same-content/two-tenant test                                                                 |
| Signed URL TTL/header manipulation/replay/leak                                    | Upload ≤900 s and checksum header; access ≤300 s; original attachment; fresh auth per issue; no API/log locator leakage | Contract TTL/scheme tests; live signed-header, replay, access and log tests                       |
| Viewer write/original escalation                                                  | `403` same-tenant write/original denial; preview/read only                                                              | Live API and browser viewer tests                                                                 |
| Project/session/asset IDOR/enumeration                                            | Tenant+project predicates; foreign and unknown produce same safe `404` body class                                       | Live foreign/unknown comparisons; Postgres tenant-column audit                                    |
| Log/problem leakage                                                               | No bearer/cookie/key/upload ID/signed query/rights free text/avoidable filename/media or parser flood                   | Gated isolated-log scan; C1 problem convention; worker output bounds                              |
| Expired/aborted multipart cleanup                                                 | Terminal state is immutable; provider abort is idempotent; janitor is deterministic and audited                         | Live abort/race test; optional seeded-expiry test; production cleanup metrics/tests               |

## Resource and state policy

The enforcement order is cheap-to-expensive: request/header/body bounds → declared allowlist/size → streamed signature and checksum → bounded metadata inspection → decoder/rasterizer/preview generation. A limit breach is a safe typed rejection, never a retry storm or success claim. The generator stores only tiny malformed headers/claims, never an actual high-expansion payload.

Legal session transitions are `initiated → uploading → completed`, `initiated/uploading → aborted`, and `initiated/uploading → expired`. `completed`, `aborted`, and `expired` are terminal. Completion atomically fixes provider completion, asset `uploaded`, one processing job, and audit event. Abort may win before that transaction or become an idempotent no-op after completion; it must never revert an uploaded source. A leased job may be reclaimed only after lease expiry and below the attempt ceiling. Existing content-addressed derived output is verified/reused, not overwritten.

Signed URLs are bearer capabilities. Replay inside their TTL is a residual risk unless the provider/use is single-shot; therefore TTLs are short, issuance is freshly authorised, query strings are redacted, referrers are restricted, upload URLs bind required checksum headers, multipart completion/abort invalidates part URLs, and originals are attachment-only. A URL must never become an audit/event payload.

## Fixture inventory and safety

`tests/fixtures/c2/adversarial/factory.ts` deterministically generates fifteen cases covering traversal/control/shell names, MIME mismatch, PNG/SVG polyglot, SVG external entity/resource, image/PDF/video metadata bombs, malformed/output-heavy codec metadata, and EXIF/GPS. Every case is ≤4 KiB. `.invalid` is the only remote domain; the only `file:` path is intentionally nonexistent; GPS is zero-valued synthetic metadata. There is no malware, real bomb, PII, address, customer media, credential, or executable fixture.

## Findings to route before C2 integration closes

### C2-QA-001 — High — video ceiling is 30 hours in schemas, 30 minutes in the checkpoint

Location: `docs/orchestration/checkpoints/C2_CONTRACT.md:63` versus `packages/contracts/src/index.ts:383` and `:456`.

Impact: a worker that follows the frozen numeric schemas can admit up to 30 hours of video while the accepted product/security contract says 30 minutes, multiplying frames, parser time, disk and compute exposure by 60.

Required owner action: orchestrator/shared-contract owner must resolve the frozen value; C2-L2 must enforce the resolved value before decode. Do not hide the mismatch in a worker-only constant.

### C2-QA-002 — High — 100 MP is not enforced by the shared technical-metadata schema

Location: `packages/contracts/src/index.ts:381-389` versus policy at `:453`.

Impact: `20,000 × 20,000` (400 MP) passes the per-dimension result schema even though the policy ceiling is 100 MP. A result can be schema-valid while violating the resource policy.

Required owner action: C2-L2 must enforce the cross-field product before decode/result commit; orchestrator should add shared `superRefine` coverage when the frozen contract can be amended.

### C2-QA-003 — Medium — resumable part numbers have no frozen response field

Location: checkpoint route requirement at `docs/orchestration/checkpoints/C2_CONTRACT.md:47`; strict `assetUploadSessionSchema` at `packages/contracts/src/index.ts:271-282`.

Impact: the API cannot both return already-recorded part numbers and validate against the strict frozen session schema. Ad-hoc response drift can break resume clients or leak provider data.

Required owner action: orchestrator/shared-contract owner must freeze one public field (the acceptance pack expects `recordedPartNumbers: number[]`) before generated clients are treated as complete.

### C2-QA-004 — Medium defense-in-depth — pathless misleading filenames remain valid

Location: `packages/contracts/src/index.ts:200-214`.

Impact: `.`, `..`, percent-encoded separators, bidi controls and shell/flag-looking names may pass because they contain no literal slash/backslash/ASCII control. This is safe only if the name remains escaped display metadata and is never decoded, normalized into storage, used as a process argument, or reflected into an active URL/HTML context.

Required owner action: C2-L1/L2/L3 must prove opaque server keys, argument isolation, bidi-safe text rendering and no filename logging. The orchestrator may later tighten display-name policy without treating filename as identity.

## Execution runbook

Run provider-free static/contract evidence now:

```sh
pnpm exec vitest run tests/security/evidence tests/integration/evidence
pnpm exec tsc -p tests/security/evidence/tsconfig.json --noEmit
pnpm exec tsc -p tests/integration/evidence/tsconfig.json --noEmit
pnpm exec tsc -p tests/e2e/evidence-adversarial/tsconfig.json --noEmit
pnpm exec prettier --check tests/security/evidence tests/integration/evidence tests/e2e/evidence-adversarial tests/fixtures/c2/adversarial docs/threat-models/uploads.md
```

After C2-L1/L2 merge, point the suite only at a disposable synthetic environment:

```sh
C2_ADVERSARIAL_API_URL=http://127.0.0.1:3001 \
C2_ADVERSARIAL_ALPHA_PROJECT_ID=<synthetic-alpha-project-uuid> \
C2_ADVERSARIAL_BETA_PROJECT_ID=<synthetic-beta-project-uuid> \
C2_ADVERSARIAL_ALPHA_OWNER_TOKEN=<short-lived-token> \
C2_ADVERSARIAL_BETA_OWNER_TOKEN=<short-lived-token> \
C2_ADVERSARIAL_ALPHA_VIEWER_TOKEN=<short-lived-token> \
C2_ADVERSARIAL_MEDIA=1 \
pnpm exec vitest run tests/integration/evidence/live-api.integration.test.ts

C2_ADVERSARIAL_STATIC_PRODUCTION=1 \
pnpm exec vitest run tests/security/evidence/worker-static.security.test.ts

C2_ADVERSARIAL_DATABASE_URL=<disposable-postgres-url> \
pnpm exec vitest run tests/integration/evidence/live-postgres.integration.test.ts
```

Optional evidence variables:

- `C2_ADVERSARIAL_LOG_PATH`: isolated API/worker log to scan after live probes.
- `C2_ADVERSARIAL_EXPIRED_SESSION_ID`: orchestrator-seeded expired synthetic session for terminal cleanup evidence.
- `C2_ADVERSARIAL_STALE_LEASE_ASSET_ID`: orchestrator-seeded stale synthetic job that the running worker has reclaimed.
- `C2_ADVERSARIAL_PROCESS_TIMEOUT_MS`: worker polling ceiling, default 60,000 ms.

Run browser acceptance against the integrated production build with pre-created synthetic owner/viewer Playwright storage states (never commit them):

```sh
C2_ADVERSARIAL_WEB_URL=http://127.0.0.1:3100 \
C2_ADVERSARIAL_EVIDENCE_PATH=/evidence/<synthetic-project-id> \
C2_ADVERSARIAL_OWNER_STORAGE_STATE=/tmp/c2-owner-state.json \
C2_ADVERSARIAL_VIEWER_STORAGE_STATE=/tmp/c2-viewer-state.json \
C2_ADVERSARIAL_READY_ASSET_NAME=synthetic-ready.png \
pnpm exec playwright test --config tests/e2e/evidence-adversarial/playwright.config.ts
```

The live log must be isolated to this run; the database must be migrated, synthetic and disposable; SeaweedFS must remain loopback-only. Do not pass tokens on command lines in shared CI logs—inject them as masked environment secrets. Record pass/skip counts separately for provider-free, live API/S3, Postgres/stale lease, worker source, log, desktop browser and mobile browser evidence.

## Residual risk and closure criteria

Actual malware detection remains unavailable until a scanner adapter/daemon exists; no screen or report may say “virus free.” A stolen signed URL remains usable within its TTL. Parser vulnerabilities and third-party codec defects remain possible despite quotas and isolation. Storage/provider IAM, lifecycle, versioning, backup and production edge controls require integration/deployment evidence. Cleanup needs metrics and an audited reconciliation run, not merely an abort response. C2 closes only when the routed findings are resolved or explicitly accepted by the orchestrator and every required live gate has non-skipped evidence.

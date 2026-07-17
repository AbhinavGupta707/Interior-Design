# C2 Contract — Immutable multimodal evidence ingestion

## Status and outcome

- Checkpoint: C2
- Starting integration commit: `660086a` (completed C1 ledger on `main`)
- Frozen protocol: `c2-ingest-v1`
- Outcome: an authorised project member can submit a plan, photograph, video or document with a rights assertion; resume a multipart transfer; see its processing state; and access a ready original or derived preview through a short-lived URL. Source evidence remains immutable, derived artifacts remain separate, and hostile, malformed or unsupported content fails closed with safe user-facing language.
- Runtime: the default path is provider-free PostGIS plus loopback-only SeaweedFS. No cloud account, API key, GPU, real address or customer file is required.
- Scope boundary: C2 validates and prepares evidence. It does not interpret floor-plan geometry, reconstruct a room, infer hidden structure or claim antivirus coverage that is not present.

## Frozen dependencies and shared artifacts

- Public and worker schemas/routes: `packages/contracts/src/index.ts`, validated by `packages/contracts/test/c2.test.ts`.
- API object access: AWS SDK for JavaScript v3 `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` 3.1089.x, configured for path-style local S3 and replaceable production S3-compatible storage.
- Worker inspection: Node 22, `file-type` 22.0.x, `sharp` 0.35.x, bounded `ffprobe`/`ffmpeg`, `pdfinfo`/Poppler and `/usr/bin/file` invoked with argument arrays and no shell. A decoder or executable being absent produces a safe rejection or disabled capability, never a success claim.
- Worker queue: durable PostgreSQL jobs leased with `FOR UPDATE SKIP LOCKED`; commands and results must parse the frozen Zod schemas before side effects are committed.
- Migration allocation: `services/platform-api/migrations/registry.json`; only C2-L1 owns append-only `0002_assets_evidence.sql`.
- Scaffold manifests, lockfile, shared contracts, migration registry and this contract are orchestrator-owned and read-only to every worker.

## Rights, privacy and content policy

- `serviceProcessingConsent` must be explicitly true before a session is created.
- Rights basis is one of user-owned, permission-granted, public-domain or licensed. Attribution and an HTTPS licence URL can be retained when applicable.
- Training use is a separate decision and defaults to `denied`. Service processing consent never implies model-training permission.
- Only the frozen declared MIME allowlist is accepted at the edge. Declared MIME, filename and extension are untrusted hints; the worker checks signatures, parsability and codec/container metadata.
- Originals may contain metadata and are never exposed inline by default. Generated previews strip metadata. Raw SVG is never served or rendered directly; any supported SVG preview is resource-isolated and rasterised with external references disabled. PDF/video/image previews are derived artifacts.
- C2 has no installed malware-scanner daemon. Signature, parser, checksum and resource-limit controls are enforced now; `malware-suspected` is a typed quarantine result for the scanner adapter. The UI and evidence must not describe the baseline as a completed antivirus scan.
- Logs and problem responses exclude signed URLs, storage provider upload IDs, object keys, bearer credentials, rights free text, filenames where avoidable and media contents.

## Immutability and storage model

- The source, derived, issued and quarantine buckets remain distinct lifecycle/security classes. C2 writes originals only to `source` and generated artifacts only to `derived` or `quarantine`.
- Source keys are opaque, server-generated and unique per asset. Completing a transfer may create that key once; overwrite/copy-as-replacement paths are forbidden. Quarantining changes access and status rather than rewriting or moving the source bytes.
- Public `Asset` and access responses never contain bucket names, object keys or provider upload identifiers. Internal locators exist only in validated processing commands and storage adapters.
- A declared full-file SHA-256 and byte size are fixed when the session is created. Every part carries SHA-256. Completion requires ordered consecutive part numbers beginning at one. S3 ETags are retained as provider completion tokens but are never treated as the whole-object checksum.
- The worker streams the completed source, recomputes byte size and full SHA-256, and rejects any mismatch before producing a ready result. A matching existing fingerprint may deduplicate processing internally, but it never grants project access or changes ownership.
- Signed part URLs live at most 15 minutes. Ready-asset access URLs live at most five minutes and require a fresh project/action authorisation check on every issuance. Originals use attachment disposition; safe derived images may use inline disposition.

## Frozen HTTP surface

All routes inherit C1 bearer authentication, non-disclosing project lookup, correlation IDs and problem details. Every mutation requires a bounded `Idempotency-Key`; reuse with a different request fails. Viewer fixtures may list/inspect ready assets but may not create, complete, abort or obtain original-source access.

| Method   | Route                                                                | Behaviour                                                                                              |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST`   | `/v1/projects/:projectId/assets/upload-sessions`                     | Validate rights/metadata; create one immutable asset and provider multipart upload idempotently.       |
| `GET`    | `/v1/projects/:projectId/assets/upload-sessions/:sessionId`          | Return resumable state and already-recorded part numbers without provider secrets.                     |
| `POST`   | `/v1/projects/:projectId/assets/upload-sessions/:sessionId/parts`    | Validate the requested part and issue a checksum-bound short-lived upload URL.                         |
| `POST`   | `/v1/projects/:projectId/assets/upload-sessions/:sessionId/complete` | Reconcile consecutive parts, complete once, enqueue one processing job and return current asset state. |
| `DELETE` | `/v1/projects/:projectId/assets/upload-sessions/:sessionId`          | Abort an incomplete provider upload idempotently and make the session terminal.                        |
| `GET`    | `/v1/projects/:projectId/assets`                                     | List the project evidence inventory without internal storage locators.                                 |
| `GET`    | `/v1/projects/:projectId/assets/:assetId`                            | Return one authorised asset and its safe status/rejection code.                                        |
| `POST`   | `/v1/projects/:projectId/assets/:assetId/access`                     | Issue a short-lived URL for an authorised ready representation; fail closed otherwise.                 |

Expired sessions are terminal and their unfinished multipart uploads are eligible for deterministic cleanup. Complete/abort races are serialised. Foreign project, asset and session identifiers return the same non-disclosing result as unknown identifiers.

## Frozen persistence and processing state

Migration `0002` owns these logical records: `assets`, `asset_rights_assertions`, `asset_upload_sessions`, `asset_upload_parts`, `asset_processing_jobs`, `derived_asset_artifacts` and append-only asset audit events. Tenant and project identifiers are present on every tenant-owned record and every repository predicate. Provider upload IDs, keys and command JSON are internal-only columns. Constraints enforce legal statuses, unique source keys, one active job per asset, terminal-session immutability and unique part numbers.

The normal state sequence is `pending-upload → uploading → uploaded → processing → ready`. Abort, expiry, rejection and quarantine are explicit terminal or review states. The completion transaction enqueues the processing command with the asset transition to `uploaded`. Workers claim a lease, revalidate the command, process into an isolated temporary directory with quotas, persist a validated result and artifact manifest, then atomically complete the job and asset transition. A crashed lease can be retried up to the frozen attempt limit without overwriting a source or an existing content-addressed derived artifact.

Resource ceilings are part of `c2-ingest-v1`: two GiB total source, 10,000 multipart parts, five MiB minimum non-final part, 128 MiB target/maximum part in this application, 100 megapixels and 20,000 pixels per image dimension, 500 PDF pages and 30 minutes video duration. Decompression, frames, streams, recursive containers, wall time, subprocess output and temporary disk are additionally bounded by the worker. HEIC/HEIF or a codec absent from the local build is rejected as unsupported rather than transcoded speculatively.

## Adaptive isolated lanes

Every task is a project-scoped Codex worktree created from the committed C2 prelude. Model and reasoning are passed explicitly at creation.

| Lane                            | Model / reasoning       | Exclusive writable paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Required output                                                                                                                                                                                |
| ------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C2-L1 asset/storage backend     | `gpt-5.6-sol` / `xhigh` | `services/platform-api/src/modules/assets/**`, `services/platform-api/src/storage/**`, `services/platform-api/src/c2.ts`, `services/platform-api/test/c2/**`, `services/platform-api/migrations/0002_assets_evidence.sql`, `docs/runbooks/development/c2-evidence-api.md`; minimal composition edits to `services/platform-api/src/app.ts`, `services/platform-api/src/server.ts`, `services/platform-api/README.md`                                                                         | migration/repositories, deny-by-default routes, multipart S3 adapter, checksum/idempotency/concurrency logic, durable processing job creation, tests and local runbook                         |
| C2-L2 hostile-media worker      | `gpt-5.6-sol` / `xhigh` | `services/spatial-worker/src/**`, `services/spatial-worker/test/**`, `services/spatial-worker/README.md`, `docs/runbooks/development/c2-spatial-worker.md`                                                                                                                                                                                                                                                                                                                                   | leased job runner, stream hashing/sniffing, bounded safe inspectors, metadata-stripped previews/manifests, quarantine/retry behavior and synthetic tests                                       |
| C2-L3 cross-surface evidence UX | `gpt-5.6-sol` / `high`  | `apps/web/src/features/evidence/**`, `apps/web/src/app/evidence/**`, `apps/web/src/app/api/c2/**`, `apps/web/test/c2/**`, `apps/web/src/features/projects/projects-screen.tsx`, `apps/web/src/app/globals.css`, `apps/ios-capture/HomeDesignCapture/Features/Evidence/**`, `apps/ios-capture/HomeDesignCapture/App/AppRootView.swift`, `apps/ios-capture/HomeDesignCapture/Core/Navigation/CaptureFlowModel.swift`, `apps/ios-capture/HomeDesignCaptureTests/C2/**`, `tests/e2e/evidence/**` | accessible rights-first selection, hashing/multipart progress, pause/resume/retry/cancel, inventory/status/access, explicit local/unsupported states, responsive browser and simulator tests   |
| C2-L4 adversarial QA            | `gpt-5.6-sol` / `xhigh` | `tests/security/evidence/**`, `tests/integration/evidence/**`, `tests/e2e/evidence-adversarial/**`, `tests/fixtures/c2/adversarial/**`, `docs/threat-models/uploads.md`                                                                                                                                                                                                                                                                                                                      | independent contract/security harness and synthetic malformed/polyglot/bomb metadata fixtures covering tenant, URL, parser, replay, race, quota and log-redaction attacks; no production edits |

Workers must not edit each other's paths, root manifests/locks, `packages/contracts/**`, the migration registry, this contract, the ledger, `.github`, `.codex`, accepted ADRs, Xcode project files or generated/shared clients. Findings that require an owner change are reported to the orchestrator; the owning lane or orchestrator patches them after integration.

## Required checkpoint gate

1. Frozen install, formatting, lint, strict typecheck, unit, contract, integration, security and production builds pass from integrated `main`.
2. Real PostGIS and loopback S3 evidence proves migration, source/derived separation, multipart resume/complete/abort, full checksum verification, job leasing/retry and immutable originals.
3. Adversarial cases prove traversal/control filenames, MIME/signature mismatch, malformed/polyglot payloads, oversized image/PDF/video claims, decompression/parser limits, duplicate/reordered parts, completion/abort races, URL expiry, signed-URL/log redaction, viewer denial and two-tenant IDOR resistance.
4. A production web build is exercised in the in-app browser at desktop and narrow mobile sizes using a real API/object-store path: assert rights, upload a small synthetic fixture, observe progress and processing, reload/resume, inspect inventory/error/access states, use keyboard navigation, check overflow and require zero console errors.
5. The iOS project is regenerated only by the orchestrator. Unit/simulator tests cover document/media selection states, rights, hash/progress/resume/failure and unsupported/offline behavior. Computer Use verifies the visible Simulator journey; it does not claim physical camera, background-transfer or real-device evidence.
6. Integration review checks public responses/build artifacts for provider IDs, keys, signed URLs or secrets; verifies no raw SVG/unsafe preview is served inline; and records every unavailable scanner/codec/device capability honestly.
7. The ledger records task IDs, explicit model/reasoning, worker/merge SHAs, commands, live-service counts, browser/simulator evidence, integration repairs, limitations and final checkpoint SHA before C3 opens.

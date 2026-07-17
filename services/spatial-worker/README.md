# Spatial worker

The C2 spatial worker is a durable, provider-free ingestion process for untrusted plans, photographs, videos and documents. It consumes the frozen `c2-ingest-v1` command, streams the immutable source from S3-compatible storage, verifies its full byte count and SHA-256, inspects it inside a fresh quota-controlled directory, creates metadata-stripped derived images and a provenance manifest, then atomically records a validated result.

The worker does not infer geometry, call an AI provider, overwrite source evidence, serve raw SVG or claim antivirus coverage. The baseline has no malware scanner. A scanner can only quarantine through the explicit `ThreatScanner` seam; absence is recorded as `not-configured`.

## Main controls

- strict production environment validation and loopback-only plaintext development storage;
- PostgreSQL leases using `FOR UPDATE SKIP LOCKED`, bounded attempts, renewal, expiry recovery and backoff;
- shared Zod validation for every claimed command and committed result;
- incremental source hashing and byte counting without buffering large sources;
- `file-type` plus `/usr/bin/file` signature checks and declared/detected MIME agreement;
- bounded Sharp, Poppler and FFmpeg/FFprobe inspection with argument arrays, no shell, scrubbed child environments, deadlines and output limits;
- image dimension/pixel, PDF page, video duration/stream/codec/container and temporary-disk limits;
- SVG rejection for scripts, entities, external resources, event handlers and active/embedded content;
- conditional, content-addressed derived writes with immutable-source separation;
- deterministic cleanup, lease heartbeats, shutdown recovery and structured redacted logs.

HEIC/HEIF is deliberately rejected as unsupported. Missing Poppler or FFmpeg capabilities also reject safely instead of reporting success.

## Commands

From the repository root:

```bash
pnpm --filter @interior-design/spatial-worker lint
pnpm --filter @interior-design/spatial-worker typecheck
pnpm --filter @interior-design/spatial-worker test:unit
pnpm --filter @interior-design/spatial-worker build
pnpm --filter @interior-design/spatial-worker dev
```

No customer media belongs in Git. All tests generate tiny synthetic fixtures. See `docs/runbooks/development/c2-spatial-worker.md` for configuration, database assumptions and local-operation details.

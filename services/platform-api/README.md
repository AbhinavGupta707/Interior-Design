# Platform API

Typed Fastify platform API for the Home Design Studio modular monolith. C1 adds provider-neutral
session verification, tenant-owned projects, structured intake, idempotent mutations, optimistic
concurrency, and safe audit events on PostgreSQL. C2 adds rights-aware immutable evidence sessions,
checksum-bound multipart uploads, durable processing jobs and short-lived ready-asset access through
a fail-closed S3-compatible adapter. C3 adds tenant-safe synthetic/manual property resolution and an
immutable source-aware dossier with explicit unknowns. No paid or cloud provider is required locally.
C4 adds immutable, hash-addressed canonical home snapshots with separate existing, proposed and
as-built profile pointers, deterministic geometry validation and optimistic hash concurrency.

## Local commands

From the repository root:

```sh
pnpm --filter @interior-design/config build
pnpm --filter @interior-design/contracts build
pnpm --filter @interior-design/authz build
pnpm --filter @interior-design/provider-adapters build
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap
pnpm --filter @interior-design/platform-api exec tsx src/c2.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c3.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c4.ts migrate
pnpm --filter @interior-design/platform-api dev
```

The compiled service can be run after its workspace dependencies are built:

```sh
pnpm --filter @interior-design/platform-api start
```

The safe default listener is `127.0.0.1:4100`. Configuration is validated before the server
listens. The service reads these settings and never logs credential values:

| Variable                            | Local default                                                         | Purpose                                         |
| ----------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| `NODE_ENV`                          | `development`                                                         | `development`, `test`, or `production`          |
| `PLATFORM_API_HOST`                 | `127.0.0.1`                                                           | Listener host                                   |
| `PLATFORM_API_PORT`                 | `4100`                                                                | Listener port                                   |
| `PLATFORM_API_LOG_LEVEL`            | `info`                                                                | Structured log level                            |
| `PLATFORM_API_READINESS_TIMEOUT_MS` | `1000`                                                                | Per-dependency readiness deadline               |
| `PLATFORM_API_SHUTDOWN_TIMEOUT_MS`  | `10000`                                                               | Graceful shutdown deadline                      |
| `C1_DATABASE_URL`                   | loopback `localdev` database from `infrastructure/local/compose.yaml` | PostgreSQL connection; required in production   |
| `C1_AUTH_MODE`                      | `local` outside production; `oidc` in production                      | Select fixture or OIDC verification             |
| `C1_LOCAL_SESSION_SECRET`           | conspicuous source-controlled local/test value                        | Optional local HMAC secret, minimum 32 bytes    |
| `C1_OIDC_ISSUER`                    | none                                                                  | Exact OIDC JWT issuer                           |
| `C1_OIDC_AUDIENCE`                  | none                                                                  | Required OIDC JWT audience                      |
| `C1_OIDC_PUBLIC_KEY_BASE64`         | none                                                                  | Base64 PEM key for RS256 signature verification |
| `C2_DATABASE_URL`                   | C1/loopback database                                                  | Optional C2 database override                   |
| `C2_STORAGE_ENDPOINT`               | `http://127.0.0.1:8333`                                               | S3-compatible endpoint; HTTPS in production     |
| `C2_STORAGE_REGION`                 | `local`                                                               | S3 signing region                               |
| `C2_STORAGE_ACCESS_KEY_ID`          | conspicuous local fixture value                                       | Explicit storage access key                     |
| `C2_STORAGE_SECRET_ACCESS_KEY`      | conspicuous local fixture value                                       | Explicit storage secret                         |
| `C2_STORAGE_FORCE_PATH_STYLE`       | `true` locally                                                        | Path-style S3 switch                            |
| `C3_DATABASE_URL`                   | C1/loopback database                                                  | Optional C3 database override                   |
| `C3_PROPERTY_PROVIDER_MODE`         | `fixture` outside production; `disabled` in production                | Synthetic, explicit unavailable, or manual-only |
| `C4_DATABASE_URL`                   | C1/loopback database                                                  | Optional C4 database override                   |

## Operational contracts

- `GET /health` and `GET /health/live` are process liveness checks and return `200` with
  `{ "status": "ok" }`.
- `GET /health/ready` evaluates injected dependencies. Required failures return `503`; failure
  messages are never returned to callers.
- C1 readiness requires PostgreSQL and the selected identity provider. Unconfigured OIDC is
  reported as unavailable and never falls back to local fixtures.
- C2 readiness requires migration `0002_assets_evidence` plus the distinct source, derived and
  quarantine buckets. Production storage configuration requires explicit credentials and a
  non-loopback HTTPS endpoint; no SDK credential-chain fallback is used.
- C3 readiness requires migration `0003_property_dossier`. Production property resolution remains
  disabled/manual-only; fixture and injected-unavailable modes cannot be activated in production.
- C4 readiness requires migration `0004_canonical_models`. Snapshot reads recompute canonical bytes,
  SHA-256 and byte length through the codec after every JSONB round-trip.
- Every response includes validated/generated `x-request-id`, W3C `traceparent`, and
  `x-trace-id` headers.
- Errors use `application/problem+json` and include stable code, status, request ID, and trace ID.
  Unexpected failures are logged with correlation metadata and a safe error type; internal error
  messages are not sent to callers or copied into request logs.
- `SIGINT` and `SIGTERM` trigger one bounded, idempotent Fastify shutdown.

The C1 HTTP routes are the frozen `/v1/auth/local/session`, `/v1/session`, `/v1/projects`, project
detail, and project intake surfaces. Mutations require `Idempotency-Key`; intake writes also require
`expectedVersion`. Unknown and foreign project IDs return the same non-disclosing `404` response.
See `docs/runbooks/development/c1-local-identity.md` for migration, fixture, authentication, test,
and shutdown procedures.

The C2 HTTP surface is the frozen `c2-ingest-v1` session/part/complete/abort/inventory/access route
set. Every tenant-owned query includes tenant and project predicates, public DTOs exclude provider
upload IDs and object keys, and complete versus abort is serialized. See
`docs/runbooks/development/c2-evidence-api.md` for storage, lifecycle, cleanup, worker-job and
verification procedures.

The C3 HTTP surface is the frozen resolution, selection, dossier, refresh and source-record route
set. Opaque candidates expire after 15 minutes; manual selection invents no UPRN or coordinate;
source records retain normalized SHA-256 rather than raw provider payload; and dossier versions keep
planning/current-interior/structure/boundary limitations explicit. Address/query fields are redacted
from structured logging. See `docs/runbooks/development/c3-property-api.md` for provider modes,
disposable database setup, route semantics and live transaction verification.

The C4 HTTP surface is the frozen four-route model profile/snapshot API. Lists always include exact
existing/proposed/as-built summaries; owner/editor snapshot writes require an idempotency key and
expected current SHA-256; viewers are read-only; and empty/foreign/unknown reads are
non-disclosing. The C4 create route alone has a bounded envelope above 1 MiB while the canonical
record remains capped at 10 MiB. Snapshot bodies and internal persistence fields are excluded from
logs. See `docs/runbooks/development/c4-canonical-model-api.md` for the clean C1–C4 database run,
JSONB canonicalisation rule, concurrency semantics, trigger checks and residual integration limits.

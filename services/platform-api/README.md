# Platform API

Typed Fastify platform API for the Home Design Studio modular monolith. C1 adds provider-neutral
session verification, tenant-owned projects, structured intake, idempotent mutations, optimistic
concurrency, and safe audit events on PostgreSQL. No paid or cloud provider is required locally.

## Local commands

From the repository root:

```sh
pnpm --filter @interior-design/config build
pnpm --filter @interior-design/contracts build
pnpm --filter @interior-design/authz build
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap
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

## Operational contracts

- `GET /health` and `GET /health/live` are process liveness checks and return `200` with
  `{ "status": "ok" }`.
- `GET /health/ready` evaluates injected dependencies. Required failures return `503`; failure
  messages are never returned to callers.
- C1 readiness requires PostgreSQL and the selected identity provider. Unconfigured OIDC is
  reported as unavailable and never falls back to local fixtures.
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

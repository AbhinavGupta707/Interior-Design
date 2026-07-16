# Platform API

Typed Fastify substrate for the Home Design Studio modular monolith. C0 provides no paid or
cloud dependency: the process is ready by default, and later modules inject their own bounded
readiness checks.

## Local commands

From the repository root:

```sh
pnpm --filter @interior-design/config build
pnpm --filter @interior-design/platform-api dev
```

The compiled service can be run after both packages are built:

```sh
pnpm --filter @interior-design/platform-api start
```

The safe default listener is `127.0.0.1:4100`. Configuration is validated before the server
listens. Only these non-secret settings are read:

| Variable                            | Default       | Purpose                                |
| ----------------------------------- | ------------- | -------------------------------------- |
| `NODE_ENV`                          | `development` | `development`, `test`, or `production` |
| `PLATFORM_API_HOST`                 | `127.0.0.1`   | Listener host                          |
| `PLATFORM_API_PORT`                 | `4100`        | Listener port                          |
| `PLATFORM_API_LOG_LEVEL`            | `info`        | Structured log level                   |
| `PLATFORM_API_READINESS_TIMEOUT_MS` | `1000`        | Per-dependency readiness deadline      |
| `PLATFORM_API_SHUTDOWN_TIMEOUT_MS`  | `10000`       | Graceful shutdown deadline             |

## Operational contracts

- `GET /health` and `GET /health/live` are process liveness checks and return `200` with
  `{ "status": "ok" }`.
- `GET /health/ready` evaluates injected dependencies. Required failures return `503`; failure
  messages are never returned to callers.
- Every response includes validated/generated `x-request-id`, W3C `traceparent`, and
  `x-trace-id` headers.
- Errors use `application/problem+json` and include stable code, status, request ID, and trace ID.
  Unexpected failures are logged with correlation metadata and a safe error type; internal error
  messages are not sent to callers or copied into request logs.
- `SIGINT` and `SIGTERM` trigger one bounded, idempotent Fastify shutdown.

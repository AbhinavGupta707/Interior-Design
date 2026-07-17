# C1 local identity, projects, and intake

This runbook starts the C1 platform API with synthetic two-tenant identities and the real local
PostgreSQL service. Local fixture authentication is deliberately conspicuous, is enabled only in
development/test, and cannot be enabled in production. Do not use real people, addresses, or
intake prose in this environment.

## Start PostgreSQL and apply the migration

From the repository root, start only the pinned loopback PostgreSQL/PostGIS dependency and wait for
its declared health check:

```sh
docker compose -f infrastructure/local/compose.yaml up -d --wait postgres
```

The migration never seeds fixture identities. Apply migration `0001` and seed the frozen synthetic
personas through the explicit local bootstrap command:

```sh
C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
NODE_ENV=development \
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap
```

`migrate` applies only the append-only SQL file. `bootstrap-fixtures` seeds only the deterministic
fixture file after the schema exists. `migrate-and-bootstrap` performs both. Fixture bootstrap
fails before writing when `NODE_ENV=production`.

Migration `0001_identity_projects_intake.sql` creates identity tenants/users/memberships,
tenant-owned projects and structured intake, transactional mutation-idempotency records, and
minimal audit events. It does not modify the migration registry and does not seed customer or
fixture data.

## Run the API in local fixture mode

```sh
C1_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
C1_AUTH_MODE=local \
NODE_ENV=development \
pnpm --filter @interior-design/platform-api dev
```

The optional `C1_LOCAL_SESSION_SECRET` must contain at least 32 bytes. When it is absent in
development/test, the service uses a source-controlled local-only signing secret. Never reuse that
default or a fixture token outside the loopback development environment.

The synthetic sign-in personas are `homeowner-alpha`, `editor-alpha`, `viewer-alpha`, and
`homeowner-beta`. A sign-in returns a 15-minute bearer token:

```sh
curl --fail-with-body \
  --header 'content-type: application/json' \
  --data '{"persona":"homeowner-alpha"}' \
  http://127.0.0.1:4100/v1/auth/local/session
```

Send the returned `accessToken` as `Authorization: Bearer <token>`. Do not place bearer tokens in
URLs, logs, screenshots, or committed fixtures. The API logger redacts authorization and cookie
headers.

All project and intake mutations also require an `Idempotency-Key` of 8–128 characters beginning
with an alphanumeric character and then using alphanumerics, `.`, `_`, `:`, or `-`. Reusing a key
with the same validated body returns the original effect; reusing it for a different actor,
operation, or body returns `409 IDEMPOTENCY_CONFLICT`.

An intake is created with `expectedVersion: 0`. Each successful change increments the version.
Submitting a new idempotency key with a stale version returns `409 REVISION_CONFLICT` without
overwriting the stored intake. `GET /v1/projects/:projectId/intake` returns `204` until an intake
exists.

## Authentication modes and production fail-closed behavior

`C1_AUTH_MODE` accepts `local` or `oidc`. Development/test defaults to `local`; production defaults
to `oidc`. A configured OIDC verifier requires all of:

| Variable                    | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `C1_OIDC_ISSUER`            | Exact accepted JWT issuer                                |
| `C1_OIDC_AUDIENCE`          | Required JWT audience                                    |
| `C1_OIDC_PUBLIC_KEY_BASE64` | Base64-encoded PEM public key for RS256 signature checks |

OIDC bearer tokens must contain a signed UUID `tenant_id` claim plus `sub`, `iss`, `aud`, `iat`,
and `exp`. The service verifies RS256 signature, issuer, audience, expiry/not-before, and a maximum
one-hour lifetime, then reloads user ID, display name, and role from the database using the signed
tenant/subject pair. Client-supplied user or role fields never establish authority.

When OIDC is selected but incomplete, the process does not silently fall back to fixtures:
authenticated routes return `503 IDENTITY_PROVIDER_UNAVAILABLE`, and readiness reports the
`identity-provider` check as unavailable. Production local sign-in always returns
`503 LOCAL_AUTH_UNAVAILABLE`, even if `C1_AUTH_MODE=local` is supplied. Production also requires an
explicit `C1_DATABASE_URL` before startup.

## Verify against real PostgreSQL

The default lane suite uses repository doubles and skips the destructive integration fixture. With
the loopback PostgreSQL container healthy, run the real migration/persistence/isolation suite
explicitly:

```sh
C1_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
pnpm --filter @interior-design/platform-api test:integration
```

The test deletes C1 project/intake/idempotency/audit rows only for the two frozen synthetic tenant
IDs, creates data through HTTP, closes the server and its pool, creates a new server/pool, and proves
the project and latest intake still exist. It also covers two-tenant non-disclosure, viewer write
denial, create/update replay, key/body conflict, stale versions, malformed sessions, audit
redaction, and bounded cleanup.

Run the complete lane checks from the repository root:

```sh
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api test:unit
pnpm --filter @interior-design/platform-api test:contract
C1_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
pnpm --filter @interior-design/platform-api test:integration
pnpm --filter @interior-design/platform-api build
git diff --check
```

## Stop local services

Stop the API with `Ctrl-C` and wait for the bounded shutdown log. Then stop the local Compose
project while preserving its named volumes:

```sh
docker compose -f infrastructure/local/compose.yaml down
```

Do not use `down --volumes` for normal C1 cleanup; that would erase unrelated local dependency
state as well as the synthetic C1 database rows.

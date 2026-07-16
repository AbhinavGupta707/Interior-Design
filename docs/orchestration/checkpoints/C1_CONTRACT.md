# C1 Contract — Identity, project and home intake

## Status

- Checkpoint: C1
- Base: integrated `main` after C0
- Outcome: an authenticated fixture user can create a project, enter structured home/design intake, resume it across web/iOS, and cannot access another tenant's data.
- Providers: local fixture authentication is enabled only in local/test environments. The OIDC port remains disabled until a provider and credentials are explicitly selected.
- Data: synthetic UK residential fixture data only; no real customer data.

## Frozen shared contracts

- TypeScript schemas and routes: `packages/contracts/src/index.ts`
- Authorisation API: `packages/authz/src/index.ts`
- Two-tenant fixtures: `tests/fixtures/c1/tenants.json`
- Migration allocation: `services/platform-api/migrations/registry.json`; C1-L1 exclusively owns `0001_identity_projects_intake.sql`.
- Database: PostgreSQL/PostGIS through Postgres.js 3.4.9. Every tenant-owned query must include the authenticated tenant identifier. SQL-first migrations are append-only.
- Idempotency: mutating HTTP routes require a bounded `Idempotency-Key`; the same key and body has one effect, while key reuse with a different body fails.
- Concurrency: intake updates require `expectedVersion`; stale updates fail without overwriting the current record.
- Authentication: bearer sessions are short-lived and issuer/audience/expiry validated. Production must fail closed when OIDC is unconfigured. Local fixture tokens and personas are visibly synthetic.
- Audit: project creation and intake changes record actor, tenant, action, target, request correlation and timestamp without storing bearer tokens or unnecessary intake text in logs.

## HTTP surface

| Method | Route                            | Behaviour                                                                                              |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST` | `/v1/auth/local/session`         | Local/test-only fixture sign-in; production returns an unavailable problem without creating a session. |
| `GET`  | `/v1/session`                    | Return the validated current actor/session.                                                            |
| `POST` | `/v1/projects`                   | Create one tenant-owned project idempotently.                                                          |
| `GET`  | `/v1/projects`                   | List only projects visible to the actor's tenant.                                                      |
| `GET`  | `/v1/projects/:projectId`        | Return an authorised project; foreign IDs must not disclose existence.                                 |
| `GET`  | `/v1/projects/:projectId/intake` | Return the current structured intake or an explicit empty state.                                       |
| `PUT`  | `/v1/projects/:projectId/intake` | Create/update structured intake idempotently with optimistic concurrency.                              |

Invalid input uses the existing safe problem-details surface. Cross-tenant and unknown project lookups return the same non-disclosing result. Route handlers must not trust tenant, user or role fields supplied by clients.

## Exclusive lanes

### C1-L1 — identity/project/intake backend

- Owns `services/platform-api/src/modules/{identity,projects,intake}/**`, `services/platform-api/src/c1.ts`, `services/platform-api/test/c1/**`, `services/platform-api/migrations/0001_identity_projects_intake.sql`, and `docs/runbooks/development/c1-local-identity.md`.
- May make the smallest required edits to `services/platform-api/src/app.ts`, `server.ts` and `README.md` to compose the frozen C1 modules.
- Must not edit root manifests/locks, contracts, authz, web/iOS or the migration registry.

### C1-L2 — authorisation/security

- Owns `packages/authz/**`, `tests/security/identity/**` and `docs/threat-models/identity.md`.
- Must preserve the exported authorisation names/types frozen in the prelude.
- Must not edit API, web/iOS, contracts, root manifests/locks or migrations.

### C1-L3 — web/iOS onboarding

- Owns `apps/web/src/features/{auth,onboarding,projects}/**`, `apps/web/src/app/{sign-in,projects,onboarding}/**`, `apps/web/src/app/page.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/app-shell.tsx`, `apps/web/test/c1/**`, `apps/web/package.json`, `apps/ios-capture/HomeDesignCapture/Features/Projects/**`, `apps/ios-capture/HomeDesignCapture/App/AppRootView.swift`, `apps/ios-capture/HomeDesignCapture/Core/Models/CaptureProject.swift`, `apps/ios-capture/HomeDesignCaptureTests/C1/**`, and `tests/e2e/onboarding/**`.
- Must use the frozen contract, expose loading/empty/offline/expired/forbidden/retry states, preserve a local-fixture label, and avoid claiming native capture is implemented in C1.
- Must not edit API, authz, contracts, root manifests/locks, Xcode project files or migrations.

## Checkpoint gate

1. Frozen install, lint, typecheck, unit, contract, integration and production builds pass.
2. A real local Postgres run proves migrations, persistence, idempotent create/update and two-tenant isolation.
3. Security tests cover forged tenant/role fields, IDOR, expired/malformed/replayed sessions, viewer writes, enumeration and log redaction.
4. Browser testing covers sign-in, create project, complete/edit/resume intake, expiry/recovery, keyboard navigation, responsive layout and console/network errors.
5. iOS simulator tests cover project loading, offline/expired states and deterministic fixture fallback; they make no physical capture claim.
6. The ledger records lane SHAs, merge order, integration patches, commands, artifacts, manual gaps and final checkpoint SHA before C2 opens.

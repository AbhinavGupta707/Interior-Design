# C1 identity, project and intake threat model

## Status and scope

This document covers the C1 identity boundary and the project/intake authorisation kernel. It is a design and test contract for the backend integration lane; it is not evidence that HTTP routes, session verification, persistence queries or production identity are secure before those components are merged and tested.

The C1 provider posture is deliberately narrow:

- local fixture authentication is allowed only in local and test environments;
- the OIDC port stays disabled until a provider, credentials and validation policy are selected;
- fixtures are synthetic UK household identities; and
- no network, provider or database is required by the authorisation security suite.

## Protected assets and security objectives

Protected assets are tenant membership and role assignments, session material, project and structured-intake data, idempotency/concurrency state, and audit/correlation records.

The objectives are:

1. authenticate a current session before authorisation;
2. derive actor identity, tenant and role only from a server-validated session and server-owned membership state;
3. deny unregistered actions, invalid actors, invalid resources, viewer writes and every cross-tenant access;
4. make a foreign project indistinguishable from an unknown project to the caller;
5. keep policy deterministic, total and auditable; and
6. avoid putting session material, unnecessary intake content or existence-sensitive policy details in logs or responses.

Availability against volumetric denial of service is a platform concern. C1 must still bound authentication attempts and request work, but this package is not a rate limiter or session verifier.

## Trust boundaries

1. **Client to HTTP boundary:** headers, cookies, route parameters, JSON, tenant IDs, user IDs and role fields are untrusted. TypeScript types do not validate this boundary.
2. **Authentication boundary:** a bearer token or cookie becomes a session only after signature/MAC, issuer, audience, time and mode checks. Local-fixture and OIDC credentials must have distinct acceptance paths.
3. **Membership boundary:** the authenticated subject is resolved to an active, server-owned membership. The resulting `Actor` is runtime-validated before policy evaluation. A structurally valid actor built from request JSON is still untrusted.
4. **Authorisation boundary:** `authoriseProjectAction` receives the validated actor, a server-selected action and a resource tenant loaded or constrained by the server. It returns an internal decision; its reason is not an HTTP disclosure contract.
5. **Persistence boundary:** every tenant-owned list, lookup and mutation includes the authenticated tenant predicate. Authorisation does not repair an unscoped query.
6. **Telemetry boundary:** correlation and audit fields cross into logs. Credentials, cookies, raw authorisation headers and unnecessary intake text do not.

## Authorisation policy

The explicit same-tenant matrix is:

| Role   | `project:create` | `project:read` | `intake:read` | `intake:update` |
| ------ | ---------------- | -------------- | ------------- | --------------- |
| owner  | allow            | allow          | allow         | allow           |
| editor | allow            | allow          | allow         | allow           |
| viewer | deny             | allow          | allow         | deny            |

All unlisted roles and actions deny. Every action denies for a foreign or invalid resource tenant. Missing or schema-invalid actor context denies. The policy evaluation order is fixed:

1. unknown action → `unknown-action`;
2. missing or invalid actor → `insufficient-role`;
3. missing, invalid or foreign resource tenant → `cross-tenant`;
4. explicit role/action matrix → `allowed` or `insufficient-role`.

The four reason strings are the frozen internal API. Route handlers must map them to the safe problem-details surface instead of echoing them. In particular, `cross-tenant` must not reveal that a project exists.

`projectActions` is frozen at runtime so another module cannot extend the allow-list by mutating the exported array. The kernel runtime-validates an `Actor` with the shared schema and validates the resource tenant ID. It catches hostile accessors/proxies and returns a denial rather than throwing. It intentionally does not authenticate an actor or establish membership provenance; the backend must do that before calling it.

## Route-to-action expectations

| Method and route                     | Required authentication and authorisation                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /v1/auth/local/session`        | No project action. Environment-gate local fixture mode before credential processing; rate-limit attempts; production returns the same unavailable problem whether a persona is known or unknown. |
| `GET /v1/session`                    | Valid current session. No project action. Return only the validated actor/session representation.                                                                                                |
| `POST /v1/projects`                  | `project:create` against the actor tenant. The resource tenant comes from the validated actor/membership, never the body.                                                                        |
| `GET /v1/projects`                   | `project:read` against an actor-tenant scope, then a query with the same tenant predicate. No tenant filter from the client may widen it.                                                        |
| `GET /v1/projects/:projectId`        | `project:read`. Resolve with both project ID and actor tenant, or load only through an equivalently scoped query. Unknown and foreign IDs return the same `404` problem.                         |
| `GET /v1/projects/:projectId/intake` | `intake:read` using the tenant-scoped project resource. A missing intake is an explicit empty state only after the parent project is authorised.                                                 |
| `PUT /v1/projects/:projectId/intake` | `intake:update` using the tenant-scoped project resource. Authorise before mutation; separately enforce idempotency and `expectedVersion`.                                                       |

Action names are selected by server route composition, not parsed from a client header or body. Project IDs identify a candidate; they do not grant access. Client-supplied `tenantId`, `userId`, `role`, `actor`, `subject` or action fields must be rejected by strict request schemas or ignored as non-authoritative input. They must never overwrite session-derived context.

## Session and identity boundaries

### Bearer sessions

- Accept bearer credentials only in the `Authorization` header over TLS; never in URLs, query strings or logs.
- Validate the permitted algorithm and key, issuer, audience, expiry and not-before time with bounded clock skew. Reject malformed, unsigned, expired, wrong-issuer and wrong-audience credentials before actor construction.
- Keep C1 access tokens short-lived. A bearer token can be replayed until expiry unless the backend adds a server-side session/JTI revocation check or proof-of-possession. C1 must not claim replay prevention merely because a JWT signature is valid.
- Do not fall back from failed OIDC validation to fixture validation. Issuer/audience/key namespaces and token formats must keep the modes distinct.
- Do not persist raw access tokens in application storage, audit records, traces, metrics or exception objects.

### Cookie sessions, if introduced

The frozen C1 contract specifies bearer sessions. If an integration also transports a session in a cookie, that is a new attack surface and requires all of the following:

- `HttpOnly`, `Secure`, a narrow `Path`, an intentional `SameSite` setting and no session identifier in client-readable storage;
- session identifier rotation after authentication and privilege changes to prevent fixation;
- Origin/Referer validation plus an unpredictable CSRF token for state-changing requests when `SameSite` alone is insufficient;
- no state-changing `GET` routes; and
- explicit precedence or rejection when bearer and cookie credentials are both present, preventing session confusion.

### Local fixture mode

- Enable fixture sign-in from validated server environment configuration, never from a request flag.
- Fail closed in production even when OIDC is unconfigured. Do not silently enable fixtures as a recovery path.
- Keep personas visibly synthetic and constrained to `tests/fixtures/c1/tenants.json` or equivalent test-only data.
- Fixture credentials/tokens must be non-production, short-lived and separately signed or stored. A production secret or reusable provider credential must never appear in source or tests.
- Rate-limit fixture session creation because a local mode exposed accidentally should not become an unlimited token mint.

### OIDC port

Until a provider is selected, the OIDC adapter must report unavailable and issue no session. Activation requires an allow-listed discovery/issuer configuration, exact audience, permitted algorithms, bounded JWKS caching/refresh, key-rotation behaviour, time validation, subject-to-membership resolution and tests for fail-closed provider/network errors. Discovery state is checked before debugging runtime permissions: an unregistered provider cannot be treated as active.

## Threat analysis

| Threat                                            | Required control                                                                                                                                                                                                                   | Residual risk / evidence still required                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Forged tenant, user, role or action fields        | Strict request schemas; construct actor from validated session plus server membership; choose action in route code; use persisted resource tenant. Kernel ignores authority-like resource extras and denies unknown roles/actions. | Backend integration tests must send forged fields to every route. A valid owner-shaped object is not proof of identity.                 |
| IDOR / cross-tenant project ID                    | Tenant predicate on every lookup/mutation plus kernel comparison.                                                                                                                                                                  | Real database tests must prove every query includes tenant scope.                                                                       |
| Project enumeration                               | Return the same `404` code, title, detail and response shape for unknown and foreign IDs; do not expose internal decision reasons. Apply comparable timing/work and rate limits.                                                   | Exact timing equality cannot be guaranteed; monitor and rate-limit systematic probes.                                                   |
| Viewer write / scope escalation                   | Explicit total role/action matrix; reject unknown roles; membership is server-owned.                                                                                                                                               | Compromise of the membership store or privileged administrator remains outside this pure kernel.                                        |
| Missing/malformed actor                           | Validate session first and actor schema again at the kernel; deny without throwing.                                                                                                                                                | Backend must ensure no route bypasses the authentication hook.                                                                          |
| Expired, early, malformed or wrong-issuer session | Verify all token time and trust claims before actor construction; no fallback between identity modes.                                                                                                                              | Requires backend session-verifier tests with a controlled clock.                                                                        |
| Bearer replay                                     | TLS, short expiry, secure client storage, token redaction; optionally revocation/JTI or proof-of-possession for stronger guarantees.                                                                                               | A stolen bearer remains usable until expiry without additional state. Document the selected C1 guarantee.                               |
| CSRF                                              | Bearer header is not automatically attached by browsers. If cookies are used, apply cookie, Origin and CSRF-token controls above.                                                                                                  | XSS can still act with user authority and requires separate web hardening.                                                              |
| Session fixation/confusion                        | Rotate cookie session IDs; define bearer/cookie precedence; bind server session to one subject and tenant context.                                                                                                                 | Requires cookie-mode tests if that transport is added.                                                                                  |
| Credential or PII leakage in logs                 | Header/cookie redaction, structured allow-listed audit fields, parameterised route names, bounded identifiers, no unnecessary intake text.                                                                                         | Backend log-capture tests must exercise success and every rejection/error path.                                                         |
| Login or ID probing abuse                         | Per-IP and, after safe parsing, per-subject/tenant limits; bounded body/header sizes; generic responses; metrics without credentials.                                                                                              | Distributed attacks need edge controls beyond the kernel.                                                                               |
| Compromised/revoked membership                    | Resolve active membership server-side; short session lifetime; check membership version/revocation for sensitive writes; audit actor, tenant, action and target.                                                                   | Stateless tokens alone delay role revocation until expiry. Owner recovery and administrator compromise need later operational controls. |
| Stale/replayed mutation                           | Authorise every attempt, then enforce bounded `Idempotency-Key` and intake `expectedVersion`; never treat idempotency as authorisation.                                                                                            | Persistence integration must prove same-key/different-body and stale-version failures.                                                  |
| Error-oracle differences                          | Use existing `application/problem+json` conventions with request/trace correlation; normalise foreign and unknown lookups.                                                                                                         | Integration tests must compare complete safe response bodies and ensure internal reasons stay server-side.                              |

## Logging and audit contract

Security-relevant operations record, at minimum, timestamp, authenticated actor user ID and subject reference, tenant ID, server-selected action, target type/ID, result, stable safe error code, request ID and trace ID. Project creation and intake mutation also retain the idempotency/concurrency outcome needed for investigation.

Logs and audits must not contain:

- bearer tokens, fixture tokens, cookie values, OIDC assertions or signing keys;
- full request headers;
- raw intake notes, address summaries or household/accessibility text unless a separately justified audit field requires it; or
- a client-visible distinction between foreign and nonexistent projects.

Use the existing correlated problem-details surface. Authentication failure is `401`; authenticated but disallowed same-tenant role actions may be `403`; missing and foreign project lookups use the same `404`. The backend may log an internal normalised denial reason, but it must not log raw credentials or emit the cross-tenant reason to the client.

## Executable evidence and integration exit criteria

The provider-free suite under `tests/security/identity/` proves:

- every owner/editor/viewer and registered-action combination;
- same-tenant decisions and multiple foreign-resource variants;
- viewer create/update denial;
- unknown and prototype-like action denial over deterministic generated cases;
- missing, malformed, unknown-role and hostile-proxy actor denial;
- missing, malformed, foreign and hostile-proxy resource denial;
- immutable action registration, deterministic results and no input mutation; and
- use of only the synthetic two-tenant C1 fixture plus a synthetic editor required to complete the matrix.

Backend integration is not complete until independent tests also prove:

1. each route invokes the expected action with session- and persistence-derived context;
2. forged request authority cannot change actor or resource scope;
3. every list/lookup/mutation query is tenant-scoped;
4. malformed, expired, early, replayed/revoked-as-supported, wrong-issuer and wrong-audience sessions fail closed;
5. foreign and unknown IDs have the same safe problem response and do not leak through logs;
6. viewer writes fail before database mutation;
7. local fixture mode is unavailable in production and OIDC remains unavailable until configured;
8. bearer/cookie/header redaction covers success, client error and server error paths;
9. rate/body/header limits are active at the identity and lookup boundaries; and
10. idempotency and optimistic concurrency checks occur in addition to, not instead of, authorisation.

Those checks require the merged backend lane. Until then, this lane establishes the policy kernel and the precise integration contract only; it does not claim route, database, OIDC, cookie, rate-limit or log-redaction enforcement.

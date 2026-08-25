# C14.1 Windows/backend handoff for native continuity

## Current Apple slice

The native manual-evidence correction at
`cc7bc757a4d0cc323e51f299bfdb9cffc984ee5c` uses existing C1/C2 behavior. It
requires no backend change. Do not create overlapping backend, web, CUDA,
Blender, migration or shared-contract work for that correction.

The next Apple checkpoint needs frozen typed exposure and runtime composition
of existing APIs. The Windows orchestrator should not invent broad replacement
routes where a checked-in C1–C14 authority already exists.

## Production mobile identity and environment

Before production native work can be accepted, the orchestrator must provide:

1. the approved native authentication flow replacing the development-only
   `/v1/auth/local/session` dependency;
2. access-token audience, refresh, logout and revocation behavior suitable for
   Keychain storage;
3. non-secret API base URLs per environment, supplied outside source; and
4. bounded privacy-safe 401/403/404/409/offline error behavior for native retry.

Tenant, actor, membership and role authority remain server-owned. No client
body may widen them. Tokens must not enter upload journals, screenshots,
result bundles or logs. Release currently points to `https://api.invalid` and
is therefore not production-ready.

## Existing route families to expose to Swift

### C1/C3 project, intake and property

- `GET|POST /v1/projects`
- `GET /v1/projects/:projectId`
- `GET|PUT /v1/projects/:projectId/intake`
- `POST /v1/projects/:projectId/property/resolutions`
- `PUT /v1/projects/:projectId/property`
- `GET /v1/projects/:projectId/property/dossier`
- `POST /v1/projects/:projectId/property/dossier/refresh`
- `GET /v1/projects/:projectId/property/source-records`

Property resolution must retain strict `{ countryCode: "GB", query }` input;
typed matched/ambiguous/no-match/unavailable output; opaque candidate expiry;
manual fallback; idempotency; optimistic concurrency; and non-disclosing
foreign/unknown IDs. `interiorKnowledgeStatus` remains
`unknown-without-evidence`. Address/provider observations establish no interior
geometry.

### C2/C7 evidence and capture

Keep the frozen C2 multipart asset routes and C7 capture-session, artifact
upload, package and proposal routes stable. Swift DTOs must exclude provider
object keys, broad credentials and durable signed URLs. Rights basis, service
processing and training permission remain distinct; training defaults denied.

### C8 reconstruction

Expose the existing routes:

- `GET|POST /v1/projects/:projectId/reconstruction-jobs`
- `GET /v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId`
- `POST .../:reconstructionJobId/cancel`
- `POST .../:reconstructionJobId/retry`
- `GET .../:reconstructionJobId/result`

The existing strict create request remains authoritative: label, mode,
appearance mode, rights, unique ready sources and registration anchors. RGB is
required; RGB-D/hybrid requires depth; supplied similarity alignment requires
at least three distinct correspondences. Unavailable inference must return a
typed abstention, never a fixture success.

Before Apple implementation, freeze whether an accepted C7 RoomPlan package
produces a C7 proposal only, starts a C8 job, or participates later in C9
fusion. The mobile client must not guess, silently duplicate jobs or invoke C8
v2 acceptance-only paths. Typed polling is sufficient initially; job creation
must be idempotent and status monotonic.

### C4/C5 model review and explicit confirmation

Expose current immutable `existing`, `proposed` and `as-built` reads; branches;
history/compare; non-mutating operation preview; exact-preview commit; and
restore-as-new-revision. Every mutation keeps runtime validation,
authorisation, expected-version/hash fences and audit behavior.

AI, C6, C7, C8 and C9 output remains a proposal/draft. It cannot bypass C5
preview, geometry validation and explicit authorised commit. Existing,
proposed and as-built states remain distinct, and each attribute retains
evidence/provenance or explicit unknown state.

### C10–C14 standalone native journey

Expose existing semantics without moving authority into iOS:

- C10 scene job create/list/read/cancel/retry and scene read/access;
- C11 brief read/update/accept plus consultation/turn/proposal confirmation;
- C12 option jobs, option reads and explicit option confirmation;
- C13 specification creation from an exact C12 confirmation, immutable
  revisions/schedules, selection board and substitution preview/confirmation;
- C14 render capability, jobs, result, short-lived artifact access and optional
  enhancement.

The mobile client consumes exact server pins, hashes and expected versions. It
must not author frozen constraints, model hashes, catalog authority,
price/stock/availability claims or canonical geometry. These native surfaces
remain unaccepted on 2026-08-25.

## Required Windows-orchestrator deliverables

1. A versioned OpenAPI/JSON-schema export or generated Swift package for the
   required route families, tied to an exact product commit.
2. A mobile-safe authentication/environment contract with no embedded
   credentials.
3. A route/worker capability matrix for local, staging and production,
   distinguishing live, disabled, abstention-only and acceptance-only paths.
4. A frozen C7 package → C8/C9 processing decision.
5. Disposable integration fixtures for one England apartment, using only a
   synthetic address and creator-owned synthetic evidence.
6. Cross-platform contract tests for strict decoding, idempotent replay, one
   bounded 401 refresh, 403/404 non-disclosure, 409 conflict/expiry, offline
   retry and exclusion of signed locators from durable mobile state.
7. Exact privacy/retention behavior for rights withdrawal and service/training
   permission changes while jobs are queued or leased.

The Windows orchestrator owns shared contract generation/composition and any
backend checkpoint. Apple work should consume the frozen boundary and must not
make broad overlapping backend edits.

## Acceptance boundary

Backend API availability alone does not accept the native product. Production
authentication/environment, physical RoomPlan/LiDAR, process-terminated
background transfer, canonical confirmation and native C10–C14 UI all require
their own evidence. See the dated
[Apple capability audit](../../evaluation/homeowner-journey/C14_1_APPLE_NATIVE_CAPABILITY_AUDIT_2026-08-25.md)
and the
[one-bedroom physical-device plan](C14_1_ONE_BEDROOM_PHYSICAL_DEVICE_PLAN.md).

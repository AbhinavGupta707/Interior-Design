# C14.6 Native Homeowner Onboarding and Proposal Readiness Contract

## Status and objective

- Status: frozen for implementation on 2026-08-26.
- Base: clean `main` at `4d12e9ce16c0a94b741051f1f50cff8cef2afd0b`.
- Integration branch: `codex/c14-6-native-homeowner-readiness`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Objective: let a new homeowner move from cold launch through a production-shaped authenticated
  session, project selection, England property context, structured renovation intake and
  rights-cleared evidence to honest capture or proposal-readiness guidance without using the web.

This checkpoint ends at **capture/proposal readiness**. It does not start or accept a C6 plan job,
production C8 reconstruction, C9 fusion or a C5 canonical commit. It must not weaken the exact
confirmed-twin gate already consumed by C14.5.

## Audited dependency boundary

The authoritative audit is
`docs/evaluation/homeowner-journey/C14_6_NATIVE_WEB_DEPENDENCY_AUDIT_2026-08-26.md`.
It proves that the required server capabilities already exist:

- C1 verifies local or configured OIDC bearer tokens, reloads membership server-side and exposes
  session, project and optimistic structured-intake routes;
- C3 exposes project-scoped resolve/select/dossier/source routes with fixture, disabled,
  unavailable, no-match, ambiguous and manual states;
- C2 already has a native rights/consent, immutable resumable-upload and inventory path;
- C6 can accept a server-ready plan asset, but calibration, candidate review and typed operation
  drafting are a separate substantial workflow; and
- C8/C9/C5 require richer source, registration, discrepancy and exact preview/commit workflows
  than this readiness checkpoint can honestly imply.

## Contract, migration and dependency impact

- Backend HTTP contract impact: none.
- Shared TypeScript schema impact: none.
- OpenAPI/generated-client impact: none. The C14.4 generated Swift package remains the exact
  C12/C14 continuity client and is not widened. C1-C3 reuse the already frozen server payloads and
  the existing native C1/C2 transport patterns.
- Database migration impact: none.
- Root manifest/lockfile impact: none.
- Native dependency impact: no third-party package. Apple `AuthenticationServices` is the only new
  system framework.
- Editable product surface: exact `apps/ios-capture/**` paths plus this checkpoint's audit,
  acceptance, active/master plan and ledger entries.

## Production-shaped sign-in and session recovery

- Local builds retain the conspicuous deterministic local-fixture sign-in path. Local fixture
  identity is never available as a production fallback.
- Staging/production use OAuth 2.1/OIDC Authorization Code with PKCE through
  `ASWebAuthenticationSession`, a public-client identifier, an exact callback URI and HTTPS
  authorization/token endpoints. No client secret is embedded or requested.
- Incomplete or invalid provider configuration renders an honest unavailable state. It never
  invents a provider, opens a local session or bypasses backend discovery/activation.
- Access and refresh credentials are stored only in ThisDeviceOnly Keychain items. Tokens, codes,
  verifiers, signed URLs and authorization state are never logged, cached in project recovery or
  included in screenshots/fixtures.
- Cold launch first attempts protected credential recovery/refresh and then calls `GET /v1/session`.
  That server response is the only actor, tenant and role authority. A token without a valid current
  membership does not unlock projects.
- A `401` invalidates the access token and performs at most one bounded refresh/retry. Missing,
  expired or rejected refresh credentials return to sign-in. No authentication loop is allowed.
- Sign-out removes local access and refresh credentials and clears project-local presentation state.
  The current backend has no provider logout/revocation route, so this checkpoint must not claim
  remote revocation.

## Project creation, selection and relaunch

- Project creation continues to use `POST /v1/projects`, one stable pending idempotency key and
  server-derived tenant/action authority.
- Project listing and selection use fresh authenticated server reads. Unknown or foreign projects
  remain non-disclosing.
- A protected bounded recovery item may retain only the last selected project UUID. Cold relaunch
  may reopen it only after the fresh project list proves current membership. The cached identifier
  is convenience, never authority.
- Signing out, switching projects or losing authoritative membership clears prior intake/property/
  readiness state and prevents late old-project responses from appearing in the new project.

## Structured renovation intake

- Native reads `GET /v1/projects/{projectId}/intake` and writes the existing exact C1 intake shape:
  dwelling type, optional room/level counts, household counts, goals, must-keep/must-change,
  accessibility needs, style words, notes and evidence-availability declarations.
- At least one goal is required; bounded lists/text/counts match the frozen C1 contract.
- Owner/editor writes use exact `expectedVersion` optimistic concurrency and one stable pending
  idempotency key. Viewer is read-only. A stale response never silently overwrites or rebases.
- Offline intake is readable only if already present in memory during the same project session; no
  mutation is queued or inferred complete.

## England postcode, address and property context

- The native flow is England-first and sends the existing `countryCode: GB` resolution request.
  It accepts a bounded address/postcode query, shows matched/ambiguous/no-match/unavailable states
  and never auto-selects an ambiguous candidate.
- Fixture provider results remain visibly synthetic. Disabled or unavailable provider state offers
  manual entry instead of fabricating a lookup.
- Manual entry records an England address without inventing a UPRN, coordinate, source observation,
  EPC, planning status or building form.
- Candidate/manual selection uses exact expected property version and a stable pending idempotency
  key. Expired resolution and stale selection remain distinct recoverable states.
- The dossier exposes source observation, user assertion, estimate, inference and unknown labels,
  coverage warnings, source/licence/version metadata and `planningStatus: not-reviewed`.
- Address, postcode, UPRN, coordinate and dossier context never establish an interior, canonical
  geometry, legal boundary, planning outcome, structural fact or survey.
- Address text is not included in the bounded project recovery cache.

## Rights, consent and evidence readiness

- The existing native C2 workspace remains the upload authority. It keeps source rights basis,
  explicit service-processing consent and model-training consent separate; training defaults to
  denied.
- Source bytes remain immutable and uploads remain hash-bound, resumable, project-scoped and
  server-authorised. A selected file, local capture or completed upload is not canonical geometry.
- Readiness is computed only from fresh project-scoped C1/C2/C3 reads:
  - onboarding-ready requires a saved structured intake and selected England property dossier;
  - C6 plan-ready requires at least one `ready` plan asset with service-processing consent;
  - capture guidance may route to the existing C7 or C8 capture/evidence branches according to
    device capability and declared/available evidence;
  - uploaded photo/video is evidence-ready only and is never labelled a completed production C8
    reconstruction; and
  - proposal readiness never satisfies C4/C5 confirmation or the C14.5 exact confirmed-twin gate.
- Quarantined, rejected, pending, processing, missing-rights, unavailable or cached-only evidence
  never passes a readiness check.

## Transport, validation, privacy and recovery

- All new API calls use the shared Keychain-backed bearer, ephemeral/no-cache URL sessions, strict
  allowed origins, percent-encoded identifiers, bounded bodies and typed fail-closed decoding.
- UUIDs, timestamps, versions, role/status enums, postcode/address bounds, source relations and
  dossier classification rules are validated before presentation or mutation.
- `401`, `403/404`, `409`, `410`, `422`, `429`, `503` and offline transport remain distinct.
- No client sends tenant, user, role, actor or action as authority. Server action authorisation,
  tenant predicates, audit attribution, exact versions and idempotency remain unchanged.
- Protected caches exclude bearer/refresh tokens, authorization codes, PKCE verifiers, customer
  prose, addresses, local file paths, signed URLs, source bytes and any proposal/confirmation
  authority.

## Adaptive layout and accessibility

- Cold-launch/sign-in, project selection, homeowner hub and setup/readiness screens support compact
  iPhone and regular-width iPad layouts.
- Regular width uses a stable setup sidebar/step structure; compact width uses an accessible picker
  or ordered sections without clipping critical actions.
- Dynamic Type, Accessibility XXXL, VoiceOver labels/hints/values, logical focus, 44-point controls,
  reduced motion, keyboard/indirect input and non-colour statuses remain supported.
- Loading, signed-out, provider-unavailable, offline, stale, forbidden, empty, ambiguous,
  unsupported, interrupted, failed and saved/read-only states remain understandable and operable.

## Single-session orchestration decision

The mandatory parallelism gate is not satisfied. Authentication/session state, Keychain token
recovery, app-root navigation, project restoration, intake/property composition, evidence
readiness and the adaptive SwiftUI journey share one target, one state graph and overlapping tests.
Splitting them would create overlapping ownership of `AppRootView`, configuration, navigation and
fixture injection without shortening the critical path.

No task, subagent or worktree is spawned. Historical worktrees remain untouched. The user-selected
`gpt-5.6-sol` / `xhigh` assignment is frozen before implementation.

## Required evidence

1. XcodeGen regeneration is byte-stable; the unchanged C14.4 generated Swift package still builds
   and tests without drift.
2. Unit tests cover configuration, PKCE/state/token parsing, Keychain recovery, session/member
   validation, one refresh/retry, sign-out, project restoration, intake validation/concurrency,
   property candidate/manual flows, dossier validation, role controls and readiness classification.
3. XCUITest on named iPhone and iPad Simulators covers cold launch, local sign-in/session restore,
   project create/select/relaunch, intake, matched/ambiguous/manual property, rights/consent,
   evidence readiness, proposal guidance, offline/degraded state and Accessibility XXXL controls.
4. Generic Simulator Debug/Release builds, Swift 6 strict concurrency, Xcode analysis and Release
   fixture/provider-secret exclusion scans pass where locally available.
5. Focused C1-C3 platform/contracts/security and C14.5 native regressions pass, followed by full
   repository `pnpm verify`.
6. Durable acceptance records exact commands/counts, screenshots, changed files, contract/
   migration impact, provider/hardware state, limitations, risks and final commit SHA.
7. A non-draft PR targets `main`; this session does not merge it.

## Explicit non-claims

- No physical-device, camera, RoomPlan/LiDAR, background transfer or representative-home evidence.
- No live OIDC provider activation, account provisioning, production deployment or remote token
  revocation acceptance. Simulator local-fixture sign-in proves UI/recovery behavior only.
- No live address/EPC/planning/mapping provider or property-data licence acceptance.
- No address-derived interior, boundary, survey, structural, regulatory, cost, availability or
  professional certainty.
- No C6 proposal execution/acceptance, production C8 reconstruction, C9 fusion, C4/C5 confirmation,
  provider/render hardware, confirmed-twin creation or C15 acceptance.

## Terminal rule

C14.6 closes only when a new homeowner can use the native app from cold launch through authorised
project, intake, property and evidence readiness without the web; fresh server state drives every
gate; required Simulator/software/repository evidence is recorded; explicit external/hardware/
proposal non-claims remain visible; and a non-draft PR is open against `main`.

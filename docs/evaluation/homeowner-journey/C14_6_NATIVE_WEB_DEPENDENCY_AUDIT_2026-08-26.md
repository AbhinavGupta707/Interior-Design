# C14.6 Native Web-Dependency Audit — 2026-08-26

## Audit position

At the C14.5 merge, iOS is a strong capture/evidence companion and a complete confirmed-twin-to-
render design client, but a new homeowner still needs the web before the first capture/proposal
decision. The smallest coherent next checkpoint is native onboarding and proposal readiness, not
native C4-C9 completion.

The audit found no missing backend route or shared schema for this checkpoint. C1, C2 and C3 are
already server-authoritative and sufficient. C6/C8/C9/C5 are intentionally excluded because their
actual contracts require calibration, source manifests/anchors, discrepancy review and exact
preview/commit semantics that cannot be collapsed into a truthful “continue” button.

## Baseline and method

- Audited base: clean `main` at `4d12e9ce16c0a94b741051f1f50cff8cef2afd0b`.
- Audit branch: `codex/c14-6-native-homeowner-readiness`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Read set: both repository `AGENTS.md` files; active/master plans; complete current ledger;
  C14.5 audit, contract and acceptance; native app/config/navigation/auth/project/evidence/hub/
  design sources and tests; web auth/intake/property/evidence/proposal journeys; C1-C9 contracts,
  platform routes, provider adapters, runbooks and threat models.
- Baseline XcodeGen 2.45.4 regeneration was byte-stable. The tracked project SHA-256 remained
  `d9992c3d461b584e152ca0f91a752b09699bc131c590bfb8bbd401fbefc56507`.
- Xcode 26.4 (`17E192`) is present. The first sandboxed `simctl` preflight could not connect to
  CoreSimulatorService and is not evidence; Simulator execution is a required later checkpoint
  gate, not assumed from the prior C14.5 record.

## Actual dependency inventory

| Product stage                  | Native state at C14.5 merge                                                                                         | Existing server/web authority                                                                                                                                         | C14.6 disposition                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production-shaped sign-in      | Keychain access-token reuse exists, but non-local refresh deliberately fails closed and there is no sign-in surface | C1 accepts configured RS256 OIDC bearer tokens, reloads membership and exposes `GET /v1/session`; the web implements local fixture cookies only                       | Add provider-neutral native Authorization Code + PKCE and cold credential/session recovery. Keep an unconfigured provider visibly unavailable; claim no deployed provider |
| Project create/list/select     | Native and authorised                                                                                               | Existing C1 project routes, idempotency and tenant scope                                                                                                              | Preserve routes; add protected last-project convenience recovery that always rechecks the fresh list                                                                      |
| Structured renovation intake   | Missing                                                                                                             | Existing `GET/PUT /v1/projects/{id}/intake`, frozen `HomeIntake`, optimistic version and role policy; web form is the only consumer                                   | Implement the same bounded typed intake natively; no schema change                                                                                                        |
| Address/property identity      | Missing                                                                                                             | Existing C3 resolve/select/dossier/source routes; fixture/disabled/unavailable adapters and manual selection; web is the only consumer                                | Implement England-first query/candidate/manual flow and source-aware dossier natively; no provider activation                                                             |
| Evidence rights/consent/upload | Native                                                                                                              | Existing C2 immutable/resumable upload and server inventory; web duplicates this surface                                                                              | Reuse the native workspace, preserve separate service/training consent and feed only fresh ready assets into readiness                                                    |
| RoomPlan capture               | Native with deferred hardware gate                                                                                  | C7 capability/session/package/proposal workflow                                                                                                                       | Keep as an optional branch; Simulator cannot establish RoomPlan/LiDAR evidence                                                                                            |
| Photo/video capture            | Native evidence capture                                                                                             | C8 native capture uploads immutable C2 evidence but does not create a reconstruction job                                                                              | Keep as evidence capture; never label upload as production C8 completion                                                                                                  |
| C6 plan proposal               | Missing                                                                                                             | `POST /plan-processing-jobs` needs a server-ready plan; calibration, candidate decisions and typed C5 draft are separate exact routes and a substantial web workspace | C14.6 may mark a ready plan as eligible to start C6, but does not start or review it                                                                                      |
| C8 reconstruction              | Missing                                                                                                             | Job creation requires bounded RGB/RGB-D source manifests, privacy/rights declarations, modes and optional registration anchors                                        | Show evidence preparation guidance only. Production C8 remains unaccepted                                                                                                 |
| C9 fusion                      | Missing                                                                                                             | Requires an existing base snapshot, at least two distinct source kinds, anchors, discrepancy decisions and an exact C5 operation draft                                | Explicitly later; no readiness shortcut                                                                                                                                   |
| C4/C5 initialise/confirm       | Missing                                                                                                             | Existing web performs acknowledged unmeasured initialization, branches, typed preview and separate exact commit                                                       | Explicitly later; C14.6 cannot produce a confirmed twin                                                                                                                   |
| C10-C14 design                 | Native after exact gate                                                                                             | C14.5 already consumes current C4/C5/C10 and C11-C14 server authority                                                                                                 | Preserve unchanged; onboarding readiness never unlocks design                                                                                                             |

## Sign-in discovery findings

- Registration/activation comes before runtime debugging: the backend's OIDC verifier is present but
  no provider, issuer, audience, public key, native authorization endpoint, token endpoint or client
  registration is committed. Production therefore correctly reports the identity provider
  unavailable.
- The backend verifies bearer JWT signature, issuer, audience, time window, signed tenant and
  subject, then reloads the current database membership. It does not issue provider tokens, perform
  OAuth authorization-code exchange, refresh provider tokens, revoke provider sessions or expose
  discovery metadata.
- A native public-client Authorization Code + PKCE flow can sit in front of the existing bearer
  verifier without a backend contract change. Provider endpoints/client ID remain deployment
  configuration, not source credentials. An unconfigured app must stay useful as an honest
  unavailable/local-development surface.
- Existing `C7KeychainBackedTokenProvider` protects a short-lived bearer and retries once after
  invalidation. C14.6 must extend the native composition for refresh-token recovery while keeping
  access/refresh credentials in separate ThisDeviceOnly Keychain items and using `GET /v1/session`
  as the membership authority.

## Intake and property findings

- C1 intake is already structured, strict and bounded. It stores home type, room/level counts,
  household, goals, constraints/preferences, notes and declared evidence availability. A first
  write uses expected version zero; later writes use the exact current version.
- C3 property resolution returns one of matched, ambiguous, no-match or unavailable with provider
  state fixture, disabled or unavailable. Candidate selection is resolution-bound and expires;
  manual selection is always allowed and does not invent a UPRN or coordinate.
- The C3 dossier always declares `interiorKnowledgeStatus: unknown-without-evidence` and
  `planningStatus: not-reviewed`. Its items distinguish source observations, user assertions,
  estimates, inferences and unknowns, with source/licence/version records.
- There is no dedicated `GET project property` route, but the existing dossier route and
  source-record collection are sufficient. For an already authorised project, absence is an honest
  not-configured state; foreign/unknown identifiers remain non-disclosing at the server boundary.
- No shared client generation is required: the current iOS app already manually consumes strict C1
  and C2 DTOs, while the generated Swift package has a deliberately narrow C12/C14 continuity scope.
  Widening it would create contract churn without reducing this checkpoint's risk.

## Evidence and proposal-readiness findings

- Native C2 already captures rights basis, explicit service-processing consent, default-denied
  training consent, source hash/size, upload recovery, immutable completion and fresh inventory.
- Only a fresh `ready` asset with service-processing consent can be called processing-ready.
  Pending/uploading/processing/quarantined/rejected/aborted assets cannot pass.
- C6 has a genuinely small start contract (`assetId`, page zero, parser preference) but the product
  workflow immediately expands into calibration, candidate correction, exact typed C5 operation
  drafting and eventual explicit commit. Starting it without the review path would strand the
  homeowner, so C14.6 stops at an exact “ready to start plan proposal” state.
- C8 creation cannot be inferred from generic C2 photos/video alone: it requires exact source
  manifests, capture/privacy metadata, mode, rights and sometimes anchors. C8 v2 remains
  acceptance-only and has no production route.
- C9 requires two semantically distinct eligible source kinds plus a base snapshot, explicit
  discrepancy decisions and a persisted exact C5 draft. It cannot be represented by a generic
  “enough evidence” count.

## Frozen corrective direction

C14.6 implements one native cold-launch-to-readiness path:

1. restore or start a production-shaped session and validate it against `GET /v1/session`;
2. create, list, select and safely restore an authorised server project;
3. save/recover structured renovation intake with exact optimistic revision;
4. resolve an England address/postcode or save a manual England identity, then inspect the honest
   source-aware dossier;
5. upload or resume rights-cleared evidence through the existing native C2 workspace; and
6. present a fresh readiness checklist and route to C7/C8 capture or a truthful C6-ready/deferred
   proposal explanation.

The next native gap after C14.6 remains proposal and canonical confirmation: C6 processing/review,
production C8 as available, C9 reconciliation and C4/C5 initialise/preview/explicit commit. C14.6
must not describe those stages as complete.

## Security, privacy and recovery findings

- No client field establishes tenant, actor, user, role or action; every route authenticates and
  authorises server-side and every persistence read remains tenant-scoped.
- Tokens, refresh credentials, authorization codes, PKCE verifiers, addresses and customer prose
  do not belong in the bounded last-project/readiness cache.
- Last-project recovery can store only an opaque UUID and reopen it only after fresh membership.
- Project changes must cancel in-flight setup reads and clear the prior property/intake/readiness
  state before displaying another project.
- Offline/stale state is explanatory and read-only. No intake/property/evidence mutation is queued,
  silently retried with a new idempotency identity or inferred complete.

## Baseline limitations

This audit contains no live OIDC provider, real address/property provider, customer data,
production deployment, physical-device, RoomPlan/LiDAR, background-transfer, representative-home,
production C6/C8/C9, confirmed-twin, provider/render-hardware or C15 evidence. Those non-claims are
binding for the C14.6 implementation and acceptance record.

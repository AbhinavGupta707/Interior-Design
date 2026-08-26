# C14.7 Native Confirmed-Twin Integration Contract

## Status and objective

- Status: frozen for implementation on 2026-08-26.
- Base: `main` at `f97f61dc0139dc68fd47469bc700e84313ae9764` with the pre-existing,
  user-owned root `AGENTS.md` modification preserved and excluded from every checkpoint commit.
- Integration branch: `codex/c14-7-native-confirmed-twin-integration`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning; no subagent, separate task or
  worktree.
- Objective: complete the ordinary native homeowner journey from fresh C6/C8 proposal sources,
  through optional C9 reconciliation and explicit C4/C5 human review/correction/confirmation, to
  an exact succeeded C10 twin and the existing C11-C14 design loop.

This is the terminal native software-integration checkpoint before physical-device validation. It
must not close at another proposal-readiness state.

## Contract and persistence impact

- Add one acknowledgement-only C5 platform route for safe first existing-model initialization.
  Its body is exactly `{ confirmUnmeasuredInterior: true }`; authenticated actor, selected property,
  deterministic placeholder IDs, unknown dimensions, limitations, audit attribution and canonical
  snapshot construction remain server-owned. The native client never submits invented geometry.
- Add one read-only C9 eligible-source discovery route. It returns exact persisted C6/C7/C8 source
  descriptors calculated and rights-filtered by the platform. Discovery is not a lease: C9 job
  creation re-verifies every exact descriptor.
- Existing C4-C10 schemas, permissions, idempotency, optimistic branch revisions, preview expiry,
  geometry validation, provenance and job state machines remain authoritative.
- Shared TypeScript contract and platform-route impact: additive. No existing response is widened or
  weakened.
- OpenAPI/generated-client impact: none. The frozen generated C14.4 Swift client remains limited to
  C12/C14 continuity; native C4-C10 transport uses the same strict, fail-closed DTO pattern already
  accepted for C1-C3 and C14.5.
- Database migration and root dependency/lockfile impact: none.

## Native source-to-twin journey

1. Native reloads fresh session, current existing snapshot, C5 branches, C2 evidence, C6/C8/C9
   jobs and the C9 platform source inventory for the selected project. Local recovery cannot enable
   an action or satisfy a gate.
2. If no existing snapshot exists, an owner/editor may explicitly acknowledge an unmeasured
   interior. The platform binds the selected property and persists only the established unknown
   placeholder model; address/context remains non-geometric.
3. A user may start C6 only from an explicitly chosen fresh ready plan asset. Proposal candidates,
   calibration, warnings and candidate dispositions remain visible. Nothing is accepted by
   default. Corrected values become user assertions; accepted parser values remain source-derived;
   unresolved/unknown values stay unknown.
4. A user may start C8 only from explicitly selected, fresh, rights-cleared C2 image/video sources.
   Source byte count, SHA-256, MIME and kind are copied exactly from the server asset record.
   Geometry output remains a proposal. Appearance output is visually useful only and never becomes
   dimensional evidence.
5. C9 is optional and available only when the platform discovers at least two distinct eligible
   source kinds. The user selects every source, supplies required non-collinear correspondences and
   explicitly reviews each discrepancy. No source or decision is silently selected.
6. C6/C9 operation drafts are pinned to the current C5 branch revision/head and current C4 base.
   Native submits their exact typed operations to a separate C5 preview, displays all findings,
   blocking status, result hash and expiry, and requires a second explicit confirmation before the
   commit endpoint is called.
7. A successful commit must reload exact persisted C4/C5 state. Native then submits C10 compilation
   for that exact snapshot ID/hash and polls fresh server state. Only a succeeded matching C10 job
   satisfies the confirmed-twin gate.
8. The existing C14.5 model revalidates the same exact snapshot, changed C5 branch and C10 job before
   native offers the existing C11-C14 design studio. No local navigation flag can unlock it.

## Roles, isolation, recovery and failure semantics

- Owner/editor may initialize, start jobs, review, draft, preview, commit and compile. Viewer may
  inspect fresh state only. A fresh same-project role downgrade immediately removes mutation
  controls and invalidates pending mutation intent.
- Project switch, sign-out or membership loss cancels in-flight work, clears scoped state and stable
  pending keys, and rejects late responses by request identity and project/role pins.
- Relaunch reloads the server. A bounded protected presentation cache may describe the last stage
  only; it contains no operations, proposal decisions, geometry, preview/commit identifiers,
  eligibility or mutation authority. Offline/relaunch never advances state.
- `401`, forbidden/not-found, conflict/stale, expired preview, validation, unavailable producer,
  throttling and transport/offline errors stay distinct. Uncertain mutations reuse one exact pending
  idempotency key until the server result is resolved.

## Layout and accessibility

- The full journey supports compact iPhone and regular-width iPad Simulator layouts. iPad uses a
  stable stage sidebar/detail composition; iPhone uses an ordered stage picker/list without hiding
  confirmation or recovery actions.
- Loading, empty, read-only, blocked, unavailable-producer, processing, abstained, proposed,
  discrepancy-review, preview, stale, offline and confirmed states are labelled in text and remain
  operable at Accessibility XXXL, with logical VoiceOver labels, 44-point targets, keyboard/
  indirect input and reduced-motion-safe transitions.

## Required evidence

1. Contract/platform integration and security tests prove acknowledgement-only initialization,
   server-derived property/actor binding, rights-filtered source discovery, tenant isolation,
   re-verification and no appearance-to-geometry authority.
2. Native unit tests cover strict DTOs, C6 review/correction/provenance, C8 exact sources, C9 explicit
   selection/anchors/decisions, C5 preview/commit pins, C10 exact handoff, roles, project switching,
   stale responses, offline/relaunch and idempotency.
3. XCUITest proves the normal proposal-to-confirmed-twin-to-design path plus blocked/read-only/
   offline and Accessibility XXXL states on named iPhone and iPad Simulators.
4. XcodeGen stability, generated-client drift, Debug/Release Simulator builds, Swift 6 analysis,
   fixture exclusion, focused C4-C10/integration/security tests and full `pnpm verify` pass.
5. Durable acceptance records commands/counts, retained captures, exact hardware/provider state,
   changed files, contract/migration impact, limitations, risks and final commit SHA.
6. A non-draft PR targets `main`; this session does not merge it.

## Explicit non-claims

- No physical-device, camera, RoomPlan/LiDAR, background transfer or representative-home evidence.
- No live production provider, real CUDA/C8/C9 worker execution, render hardware/host or deployment
  acceptance. Simulator fixtures prove software state and layout only.
- No survey, structural, boundary, planning, regulatory, cost, availability or professional
  certainty; no C15 acceptance.

## Terminal rule

C14.7 closes only when an authorised native homeowner can use fresh exact persisted state to move
from an explicit C6 or C9 reviewed proposal through separate C5 preview and commit, exact succeeded
C10 compilation and the existing C11-C14 entry; the C8-to-C9 software path is present without
claiming real reconstruction execution; all named software/Simulator gates are recorded; and a
non-draft PR is open. A genuine unavailable external producer/hardware dependency may be shown as a
blocked runtime state but cannot be misreported as completed execution.

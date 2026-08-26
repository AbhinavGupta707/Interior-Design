# C14.5 Standalone iOS Homeowner Design Loop Contract

## Status and objective

- Status: frozen for implementation on 2026-08-26.
- Base: clean `main` at `0f4018befecda80488b9fa72e2116f621a9ef57c`.
- Integration branch: `codex/c14-native-homeowner-studio`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Objective: turn iOS from a capture-first companion into an adaptive homeowner hub and implement
  the native confirmed-twin-to-render journey through C10-C14.

“Standalone” in this checkpoint means the C10-C14 design loop no longer requires the web once its
server prerequisites exist. It does not mean the entire C1-C14 app journey is native. The audited
earlier gaps are frozen in
`docs/evaluation/homeowner-journey/C14_5_NATIVE_APP_AUDIT_2026-08-26.md` and must remain explicit in
the UI, acceptance record and PR.

## Contract and migration impact

- Backend HTTP contract impact: none.
- Shared schema/OpenAPI impact: none.
- Database migration impact: none.
- Root dependency/lockfile impact: none.
- Generated-client impact: consume the checked-in C14.4 Swift package unchanged. Its OpenAPI SHA is
  `c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508` and generator is
  `interior-design-continuity-generator-1.0.1`.
- Editable product surface: `apps/ios-capture/**` plus this checkpoint's audit, acceptance, plan and
  ledger entries. Shared contracts, accepted ADRs, migrations, root manifests and lockfiles remain
  read-only.

## Adaptive homeowner hub

Project selection must open a hub, never capture eligibility directly. The hub is server-driven and
must present three honest branches:

1. **Create or continue a home.** Native creates an authorised project using existing C1 typed and
   idempotent semantics and refreshes the server list. It may continue existing server projects. It
   must disclose that structured intake and property context are the next native gap.
2. **Capture and evidence.** Resume C2 evidence, C7 RoomPlan or C8 media workflows with their
   existing protected recovery. Capture is optional and must not gate access to an already eligible
   design project.
3. **Design.** Read current server prerequisites. Enter C10-C14 only when the exact confirmed-twin
   gate passes. Otherwise show the missing server stages as a checklist and keep design disabled.

The hub may cache only a last-verified presentation summary. Project creation, project membership,
prerequisite completion and design eligibility always come from fresh server reads.

## Exact confirmed-twin gate

Native design entry requires all of the following from authenticated, project-scoped reads:

- a current C4 `existing` snapshot with model ID, snapshot ID, SHA-256 and integer version;
- a C5 branch with `revision > 0`, head snapshot equal to that exact current snapshot and head
  snapshot different from the branch's immutable source snapshot; and
- a succeeded C10 scene job whose `existing` source tuple matches that exact snapshot ID and hash.

Missing, malformed, partial, foreign, unavailable or merely cached state never passes. A viewer may
read an eligible design journey but must not receive owner/editor mutation controls.

## Native C10-C14 journey

### C10 exploration

- Load current existing snapshot, branches, C10 jobs and the exact succeeded scene record.
- Present source snapshot identity, scene job/manifest pins, bounded geometry counts/bounds, mapped
  element/camera summaries and typed findings as derived exploration state.
- Do not describe appearance, a GLB, splats, stills or video as canonical dimensional truth.
- This checkpoint may use a geometry-summary exploration surface; it must not claim an interactive
  native 3D renderer unless that exact rendering path is implemented and verified.

### C11 brief

- Fetch the persisted brief and its content SHA-256.
- Allow owner/editor to create a draft from typed, attributable homeowner statements, edit by exact
  expected revision, and accept one exact revision/hash. Viewer remains read-only.
- Every entry retains classification, category, priority, status and user-stated provenance. Intent
  never mutates the confirmed twin.

### C12 options

- Create at least two deliberately different directions only from the exact accepted brief and
  exact current existing snapshot pins.
- Poll/list server jobs and compare persisted options, including assumptions, unknowns and
  trade-offs. No local option is authoritative.
- Confirm one pending option with exact brief/job/set/snapshot pins and an idempotency key. Then
  recover the persisted confirmation using the generated C14.4 Swift client. Confirmation creates
  proposed state only; existing/as-built remain unchanged.

### C13 specification and material decisions

- Load current catalog releases and active-rights assets from server authority.
- Create a specification only from the generated, server-recovered C12 confirmation ID and exact
  catalog release pins.
- Show specification lines and exact revision/model/catalog hashes.
- Allow a bounded material/product substitution preview and separate confirmation using exact
  branch/specification/candidate pins. Resulting geometry remains proposed until its existing server
  workflow says otherwise. Rights, cost and availability are never inferred.

### C14 render

- Discover selectable sources only through the generated C14.4 Swift client. Keep that eligibility
  snapshot separate from the raw host capability response.
- Render creation uses exact eligible C10/C13 source, mapped camera, frozen profile, canonical
  neutral lighting and explicit enhancement selection. Creation-time server revalidation is final;
  discovery is not a lease.
- Poll/list the exact persisted job. On success fetch the result and request fresh short-lived
  artifact access. Download through an ephemeral/no-cache session and verify media type, byte
  length and SHA-256 before rendering any bytes.
- Always keep geometry-safe output and provenance visible. Provider enhancement, if unavailable,
  must be shown as disabled/deferred rather than simulated.

## Transport, authentication and validation

- Use the existing Keychain-backed short-lived bearer provider for all new native reads/mutations.
  On `401`, invalidate once and retry once; never loop.
- Use ephemeral/no-cache URL sessions for continuity reads and artifact access/download.
- Percent-encode identifiers, require allowed API origins and never persist credentials or signed
  URLs.
- Decode bounded typed DTOs, reject malformed UUIDs, hashes, schema versions, non-finite geometry,
  scope mismatches, invalid ordering and oversized responses.
- Preserve server action authorisation, tenant/project scoping, idempotency keys, optimistic
  revisions and exact pins. Never send tenant/user/role fields as authority.
- Map expired, forbidden/not-found, conflict/stale, gone, validation, throttled, unavailable and
  offline states distinctly. No mutation is silently rebased, queued offline or inferred complete.

## Cold launch, recovery and degraded behavior

- Cold launch and project re-entry reload every authoritative stage from the server. Cross-device
  recovery succeeds without locally retained confirmation or eligibility records.
- A protected, bounded cache may keep only project ID, last-verified time, stage labels, exact IDs,
  hashes and safe status summaries needed to explain the last readable state.
- Cache files use complete-until-first-authentication protection and deterministic size/count caps.
  They contain no token, signed URL, source/render byte, customer prose, address, local file path,
  confirmation authority or eligibility authority.
- Offline mode is read-only, explicitly stale and mutation-free. Reconnection performs a fresh
  authoritative reload before enabling any action.
- Partial stage failures preserve independently verified readable state and never infer completion
  for an unavailable stage.

## Accessibility and adaptive layout

- Use an adaptive homeowner hub and design workspace suitable for iPhone portrait/landscape and
  iPad regular-width split presentation.
- Support Dynamic Type without clipped critical controls, VoiceOver names/values/hints, logical
  focus order, at least 44-point controls, non-colour status communication and reduced-motion
  behavior.
- Loading, empty, offline, expired, forbidden, stale, conflict, unsupported, interrupted, failed and
  succeeded states must remain operable and understandable.

## Single-session orchestration decision

The mandatory parallelism gate is not satisfied. Navigation, server-derived prerequisite state,
shared bearer transport, generated-client integration, recovery and the end-to-end SwiftUI flow all
share the same native target and critical path. Independent lanes would overlap the same XcodeGen
project, app root, navigation and tests.

No task, subagent or worktree is spawned. Historical worktrees remain untouched. This decision and
the `gpt-5.6-sol` / `xhigh` assignment are frozen before implementation.

## Required evidence

1. Deterministic XcodeGen regeneration and generated Swift package build/tests.
2. Swift unit coverage for prerequisite gating, strict parsing, scope/hash/version validation,
   project creation, role controls, idempotency, stale/error mapping, recovery bounds and artifact
   verification.
3. XCUITest on named iPhone and iPad Simulators covering hub branching, blocked/eligible design,
   C10-C14 happy path, cold launch, cross-device-style server recovery, offline/degraded UI,
   Dynamic Type/VoiceOver identifiers and layout overflow.
4. Generic Simulator and Release builds, Swift strict-concurrency diagnostics, fixture-exclusion
   scan and Xcode static analysis where feasible.
5. Focused repository contract/platform/web regression, security and homeowner-journey integration
   gates, followed by full `pnpm verify`.
6. An acceptance record with exact commands/counts, changed files, contract/migration/dependency
   impact, screenshots/artifacts where available, limitations, risks and commit SHA.
7. A non-draft PR targeting `main`. Do not merge it in this checkpoint session.

## Explicit non-claims

C14.5 provides no physical-device, RoomPlan/LiDAR, representative-home, production C8/C9,
provider/render-hardware or C15 acceptance. Simulator capture fixtures are not camera evidence.
Native project creation does not close native intake/property/C4-C9. A native geometry summary is
not an interactive renderer, survey, structure, regulation, cost, availability or professional
approval.

## Terminal rule

C14.5 closes only when the adaptive hub and server-authoritative native C10-C14 journey are
implemented and verified, the earlier native gaps remain explicitly recorded, the required gates
pass or are honestly classified, checkpoint evidence and ledger are updated, and a non-draft PR is
open against `main`.

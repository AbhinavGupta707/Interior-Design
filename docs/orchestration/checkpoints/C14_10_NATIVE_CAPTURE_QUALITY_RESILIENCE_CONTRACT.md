# C14.10 Contract — Native capture quality and resilience

## Authority and outcome

- Checkpoint: C14.10.
- Immutable predecessor: synchronized `origin/main` at
  `97352b7027476aa48461aea3788d1e02d3268b56`.
- Branch: `codex/c14-10-native-capture-quality-resilience`.
- Runtime and ownership: one `gpt-5.6-sol` / `xhigh` primary session is the sole planner,
  implementation writer, reviewer and completion authority. No subagent, worktree, separate task
  or parallel implementation lane is authorised.
- Delivery: one non-draft PR targeting `main`. The later user-directed independent review supersedes
  only the original leave-unmerged disposition and authorises normal merge after all four named
  GitHub checks pass on the exact final reviewed head.
- Outcome: camera-first capture completion is driven by retained, connected spatial evidence rather
  than the direction/height coverage grid. C14.10 also closes the inexpensive C14.8 shared-contract
  fixture and deterministic software fault-injection gaps without changing backend authority.

The accepted C14.8 physical journey proved one ordinary non-LiDAR iPhone could retain immutable RGB
keyframes with ARKit poses and intrinsics. The C14.9 physical benchmark then found the result sparse,
fragmented and unsuitable for a consumer digital twin despite 22 of 24 direction/height cells being
marked observed. C14.10 corrects that capture-quality signal. It does not promote a reconstruction,
establish dimensions or replace later physical acceptance.

## Frozen product and evidence rules

1. The default homeowner experience is continuous guided capture. The app automatically retains a
   bounded keyframe only when current tracking, blur, exposure and motion permit it and the candidate
   adds useful translation/baseline, view overlap, parallax or loop-closing evidence. A manual retain
   control remains an accessible fallback and is subject to the same fail-safe evidence checks.
2. The app retains at most 256 keyframes per room, at most 512 per envelope and no more than one
   automatic keyframe per two seconds. It never stores a continuous RGB stream under this contract.
3. Room readiness is computed per independent coordinate segment from retained samples. It requires:
   sufficient keyframe and feature observations; connected consecutive retained views; useful
   translation and parallax; overlap without near-duplicate views; a trajectory span; and a
   loop-closure observation near an earlier retained view. Thresholds are deterministic, integer-
   based and testable. A small/irregular room may satisfy them through one connected loop; a multi-
   zone room must add evidence in each homeowner-declared zone before readiness.
4. The existing eight-direction by three-height grid is secondary guidance only. It may point the
   homeowner toward unresolved areas and remains in the immutable envelope, but observed cells alone
   never satisfy readiness. Missing, occluded and unknown areas remain explicit.
5. Homeowner instructions remain simple: walk slowly around the room edges, keep the same walls and
   corners visible between views, step sideways rather than only rotating, pass every connected zone,
   and finish near the starting view. The UI explains what remains without claiming accuracy.
6. Feature count, overlap, parallax, connectivity and loop closure are capture-observability signals,
   not dimensions or reconstruction truth. ARKit poses remain proposal evidence. No appearance field,
   render, splat or reconstructed surface becomes canonical dimensional authority.
7. Interruptions, process relaunches and room transitions preserve independent coordinate segments.
   C14.10 never invents a segment transform. Completion evaluates each segment honestly and records
   unresolved disconnected segments.
8. Blur, exposure, tracking and resource-pressure failure is advisory and fail-safe: poor candidates
   are skipped without deleting earlier evidence. Resource degradation disables optional depth and
   reduces analysis cadence before it stops immutable RGB capture; it cannot fabricate quality.
9. C2 remains the immutable RGB authority, C7 remains capture/depth/RoomPlan authority, C8 remains
   proposal-only, C9 remains explicit reconciliation, C5 remains the only canonical mutation path and
   C10 consumes only an exact committed snapshot. Server membership, role, rights and source state are
   revalidated by the existing boundary.
10. Service-processing consent remains separate from model training, and training stays denied.
    Protected recovery contains no credential, signed URL, object key, address or advertising ID.

## Contract and fixture freeze

- `capture-envelope-v1` stays additive and backward-compatible. Spatial capture quality is carried
  as optional strict per-sample and summary fields; accepted envelopes without those fields remain
  readable, while new C14.10 native submissions must populate them.
- Language-neutral fixtures live under
  `packages/contracts/fixtures/capture-envelope-v1/` and are the single cross-language source.
  A manifest records each case name, expected verdict, canonical UTF-8 JSON bytes SHA-256 and, for
  valid cases, the expected canonical payload. Both TypeScript and Swift tests read the same files.
- Required cases cover canonical lower-case UUID output, uppercase UUID input canonicalisation,
  millisecond ISO-8601 timestamps and invalid precision/offset variants, absent versus present
  optional fields, duplicate/overlapping/unknown segments, segment/sample scoping, and unknown fields
  at envelope and nested levels.
- Canonical bytes use recursively key-sorted compact JSON, UTF-8 without BOM, no insignificant
  whitespace and no trailing newline. Hashes are SHA-256 of those exact bytes.
- Golden fixtures are test-target resources only. No fixture payload, manifest, scenario switch,
  synthetic engine or fixture copy may be present in the Release application product.
- No migration, OpenAPI/generated-client, root manifest/lockfile, platform authority or production
  reconstruction change is authorised.

## Deterministic software fault matrix

Fault injection is compiled only for test/Debug seams and uses explicit typed scripts, never timing
or external-network luck. Tests must cover:

- process relaunch before capture, with retained keyframes, during upload reconciliation and after
  immutable acceptance;
- offline capture/submission and deterministic online recovery without duplicate evidence;
- expired authentication, capture authority and signed upload access;
- project switch, actor switch, owner/editor to viewer downgrade and rights withdrawal while capture
  or an asynchronous retain/upload is in flight;
- protected-storage pressure, analysis pressure, optional-depth pressure and bounded thermal-like
  software degradation where Simulator can realistically model policy behavior; and
- stale callbacks, duplicate completion, cancellation and service unavailability.

Every injected fault must preserve immutable local/source bytes, consent separation, project scope,
independent segments and no-canonical-mutation authority. Simulator evidence is labelled software
policy/state evidence only.

## Acceptance and verification

1. TypeScript and Swift consume every shared golden case, agree on validity, canonical bytes and
   hashes, and reject adversarial UUID/timestamp/optional/segment/unknown-field cases identically.
2. Deterministic spatial-quality unit tests cover rectangular, irregular, multi-zone, rotate-in-place,
   near-duplicate, disconnected, interrupted and loop-closing trajectories plus threshold edges.
3. Native model/UI tests prove continuous bounded automatic selection, manual fallback, secondary
   grid guidance, simple instructions, unresolved-area review, incomplete acceptance, and safe
   relaunch/offline/authority/resource recovery.
4. XcodeGen is byte-stable; strict-concurrency unit tests, focused UI tests, Debug/Release Simulator
   builds, unsigned generic-iOS Release build, Release analysis and Release fixture exclusion pass.
5. Shared-contract, generated-contract drift, dependency/API seams, security, full `pnpm verify`,
   formatting and `git diff --check` pass on the final reviewed SHA.
6. The final evidence records exact commands, counts, hashes, hardware/provider truth, limitations,
   residual risks and the remaining physical handoff.
7. Push the final branch and maintain one non-draft PR. All four named GitHub checks must run on the
   exact final PR head; earlier green results do not transfer. Normal merge is authorised only after
   that exact-head result.

## Physical and professional non-claims

Simulator and software tests cannot accept physical process termination, camera delivery, ARKit
tracking, feature quality, thermal behavior, storage exhaustion, scene depth, LiDAR, RoomPlan,
VoiceOver field use, dimensions, reconstruction quality or representative-home performance. The
remaining physical handoff must repeat the accepted non-LiDAR room journey with C14.10 quality
signals, include an irregular or multi-zone room, exercise a real process termination/offline or
expired-authority case where safe, and then rerun the proposal-only visual benchmark. Separately
rights-cleared ground truth remains mandatory for any dimensional claim.

## Local implementation and independent-review closeout — 2026-08-28

- Original implementation: `9b0884c8c8b5632fbbf29e3bb9ee48243d223fe2`; contract freeze
  `e805c6e`; exact PR #16 base `97352b7027476aa48461aea3788d1e02d3268b56`; frozen review head
  `28316d49316b07731e5101cfe37c9681add69d4d`; reviewed source correction
  `733b137d532c1f39d78350f290e0730316da4760`.
- The continuous selector, per-independent-segment readiness, secondary grid, multi-zone coverage,
  retained-frame revalidation and bounded resource degradation satisfy the frozen software policy.
- Swift and TypeScript consume one shared 5,383-byte canonical fixture with SHA-256
  `e26d3f43c14d9d8def3ceb7105c539cc5351e66f579a1b529299216f5d104bb9` and agree across the frozen
  adversarial matrix.
- Deterministic Debug/test seams and existing protected-journal/transfer/authority tests cover the
  realistically simulatable relaunch, offline, expiry, scope/role/rights and resource cases. Release
  fixture/injector exclusion passed.
- Independent review corrected persisted automatic cadence and final-candidate skip behavior,
  actual-cell accounting, real resource-signal wiring/cleanup, envelope-wide readiness presentation,
  fixture-origin claim inflation, field-aware Swift/TypeScript canonical parity and exhaustive typed
  lifecycle-checkpoint coverage. Grid observations remain secondary and Simulator fixtures remain
  unable to create physical claims.
- Local native, shared-contract, security, C14, generated-drift, dependency/API-seam, build/analyze
  and full repository gates passed. Exact counts and limitations are frozen in
  `docs/evaluation/homeowner-journey/C14_10_NATIVE_CAPTURE_QUALITY_RESILIENCE_ACCEPTANCE_2026-08-28.md`.
- No migration, OpenAPI/generated-client, root manifest/lockfile, backend authority, canonical
  mutation or reconstruction-promotion impact exists.
- Physical camera/ARKit usefulness, real process and resource faults, optional LiDAR/RoomPlan,
  dimensions and visual reconstruction quality remain `NOT RUN` under
  `docs/runbooks/ios/C14_10_PHYSICAL_CAPTURE_QUALITY_HANDOFF.md`.
- Exact-head CI and normal-merge disposition are retained by PR #16. Physical acceptance remains
  separately `NOT RUN` and cannot be inferred from merge, Simulator, fixtures or compile evidence.

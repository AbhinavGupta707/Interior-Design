# C14.10 native capture quality and resilience acceptance — 2026-08-28

## Outcome

C14.10 is software-complete on implementation head
`9b0884c8c8b5632fbbf29e3bb9ee48243d223fe2`. Camera-first capture now defaults to a continuous
guided walk with bounded automatic keyframe selection. Readiness is derived from retained spatial
evidence—translation, overlap, parallax, feature observations, consecutive-view connectivity,
trajectory span/travel, loop closure, blur/exposure and unresolved declared zones. The existing
direction/height grid remains visible only as secondary guidance and cannot make a room ready.

The same checkpoint adds one language-neutral `capture-envelope-v1` golden corpus consumed directly
by Swift and TypeScript, plus deterministic Debug/test-only fault seams over the existing protected
journal, resumable transfer and server-authority boundaries. No backend authority, migration,
OpenAPI/generated client, root manifest, lockfile, canonical mutation path or reconstruction
promotion changed.

This is a software/Simulator acceptance only. It establishes no physical camera, ARKit feature,
process-termination, thermal, storage-exhaustion, LiDAR, RoomPlan, dimensional,
representative-home or reconstruction-quality result. Those rows remain `NOT RUN` in the physical
handoff.

## Authority and synchronization

- One `gpt-5.6-sol` / `xhigh` session was the sole planner, writer, reviewer and completion
  authority. No subagent, worktree, separate task or parallel implementation lane was used.
- Local `main` was synchronized to clean `origin/main` at
  `97352b7027476aa48461aea3788d1e02d3268b56` before branch creation.
- Contract freeze: `e805c6e` on branch `codex/c14-10-native-capture-quality-resilience`.
- Implementation: `9b0884c8c8b5632fbbf29e3bb9ee48243d223fe2`.
- The user-owned root `AGENTS.md` change remained byte-identical at SHA-256
  `6a8dd3f230ce5f9bab435e4ac242467597f2e861ff5ff71f94852e5cc21f9533`, unstaged and outside every
  checkpoint commit.

## Spatial-evidence completion policy

Automatic retention is limited to one frame per two seconds, 256 retained frames per room and 512
per envelope. The candidate must have normal tracking, bounded motion, accepted sharpness and
exposure, at least 60 observed features and, after the first view, a connected prior view with at
least 18% overlap. Unless it is a loop-closing view, it must add at least 120 mm of translation and
8% parallax and must remain below the 94% near-duplicate overlap ceiling. The actual frame is
revalidated at retention time; earlier telemetry cannot force a stale or poor frame into immutable
evidence. Manual retention remains available and uses the same fail-safe gates.

Each non-empty independent coordinate segment is evaluated separately. It needs at least eight
retained samples, at least 75% connected consecutive edges with every retained edge valid, at least
three useful translation and parallax observations, 1.2 m trajectory span, 2.4 m trajectory travel
and a loop closure. A singleton or weak post-interruption segment therefore cannot be hidden by a
strong earlier loop. Every non-occluded declared zone needs two retained samples. Independent
segments remain independent; C14.10 creates no transform between them.

The homeowner guidance is deliberately plain: walk slowly along room edges; keep a prior wall or
corner visible; step sideways instead of only turning; visit each connected zone; and finish near
the starting view. Rectangular rooms can close one connected loop, while irregular and multi-zone
rooms keep unvisited zones explicit. Incomplete capture may be reviewed and submitted honestly but
is never presented as spatially ready.

Resource policy degrades safely and deterministically: nominal analysis uses stride 1 with optional
depth and automatic selection; constrained uses stride 3 and disables optional depth; critical uses
stride 6 and disables both optional depth and automatic selection. Earlier immutable RGB evidence
is preserved, and no quality is fabricated.

## Shared golden contract

Both runtimes read `packages/contracts/fixtures/capture-envelope-v1/base.json` and `cases.json`
without maintaining a native copy. The canonical base is 5,383 UTF-8 bytes with SHA-256
`e26d3f43c14d9d8def3ceb7105c539cc5351e66f579a1b529299216f5d104bb9`. Canonical output is compact,
recursively key-sorted UTF-8 JSON with lowercase UUIDs, no BOM, insignificant whitespace or trailing
newline.

The shared verdict matrix covers canonical and uppercase UUID input; legacy spatial optionals
absent; optional story absent versus forbidden `null`; invalid UUID; missing timestamp zone; valid
millisecond offset; sub-millisecond and invalid-offset timestamps; nested transfer timestamp
precision; partial spatial optionals; duplicate and overlapping independent segments; sample scope
to an unknown segment; and unknown envelope/nested fields. Swift and TypeScript agree on validity,
canonical bytes and hashes. Legacy spatial-free envelopes remain readable; new native envelopes
populate the complete strict spatial set.

## Deterministic fault evidence

| Fault or transition                             | Software evidence                                                                                                           | Preserved result                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Relaunch/interruption                           | C14.8 protected-journal tests plus C14.10 retained-evidence and automatic-interruption tests                                | Retained bytes survive; a fresh independent segment is persisted before capture restarts       |
| Offline submission/transfer                     | Injected C14.10 offline submission plus existing C7/C8 resumable reconciliation tests                                       | No false acceptance; completed receipts remain scoped and retryable without duplicate evidence |
| Expired authentication/capture/upload authority | Typed C14.10 fault matrix plus C14.6 auth and C7/C8 expired-brief/signed-URL tests                                          | Current authority is revalidated; stale credentials or signed URLs are not replayed            |
| Project/actor/role/rights changes               | C14.8 scope/late-load/read-only recovery, C14.6 role downgrade and C7 withdrawal tests, plus injected pre-retain role fault | Late callbacks cannot cross scope; mutation fails closed; protected evidence is not reassigned |
| Service and resource degradation                | Typed service/storage faults, C14.10 resource-policy thresholds and existing C8 pressure stop/recovery                      | Optional work degrades first; no invented capability or canonical publication                  |

The scripted injector exists only behind `#if DEBUG`; Release uses the no-op production seam.
Software pressure policy is not a physical thermal or storage-exhaustion test.

## Verification record

| Gate                                | Result                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contract lint/typecheck/unit | Passed: 17 files / 96 tests                                                                                                                                         |
| Focused C14.10 native tests         | Passed, including shared goldens, threshold edges, rectangular/irregular/multi-zone readiness, interrupted segments, bounded selector, resources and fault matrix   |
| Complete native unit suite          | Passed: 224 logical tests / 234 device invocations, zero failures or skips                                                                                          |
| Guided capture UI journey           | Passed: 1/1                                                                                                                                                         |
| Simulator runtime                   | iPhone 17 Pro Max Simulator, iOS 26.4 build 23E244; software/UI behavior only                                                                                       |
| Native compile/build                | Debug and Release generic iOS Simulator passed; unsigned generic physical-iOS Release compile passed, compile-only                                                  |
| Release static analysis             | Passed                                                                                                                                                              |
| XcodeGen regeneration               | Byte-stable twice: `d9af33abc2d1606fbdbdf81f10834e213c3e218a02f073635b9d8f4dd8bc10a6`                                                                               |
| Release fixture exclusion           | Passed in Simulator and generic-iOS products; no fixture resources or Debug scenario/injector markers in either Release executable                                  |
| Generated contract drift            | Passed: `node packages/api-contracts/scripts/generate.mjs --check`                                                                                                  |
| API/dependency seams                | Passed: 21 API seam tests and 3 dependency-boundary tests                                                                                                           |
| Identity security                   | Passed: 933 tests                                                                                                                                                   |
| C14 source/control-plane gate       | Passed; 22 enhancement-boundary tests, 21 API seams and 3 dependency boundaries; optional disposable control plane skipped because unconfigured                     |
| Full repository verification        | Passed: Prettier; 24 lint, 24 typecheck, 45 unit-test and 24 build tasks; Ruff; mypy across 114 sources; Python 157 passed / 2 expected environment-dependent skips |
| Repository hygiene                  | `git diff --check` passed; user-owned `AGENTS.md` remained byte-identical and excluded                                                                              |

The first sandboxed full-repository run reached and passed all 24 builds before `uv` was denied
access to its normal user cache. The identical `corepack pnpm verify` gate was rerun with that cache
available and passed; this was an execution-environment restriction, not a product-test failure.

## Preserved authority and residual risk

C2 remains immutable RGB authority; C7 remains capture/depth/RoomPlan authority; C8 remains
proposal-only; C9 remains explicit reconciliation; C5 remains the only canonical mutation path; C10
consumes only an exact committed snapshot. Service processing and training permission remain
separate, with training denied. Protected recovery retains no credential, signed URL, object key,
address or advertising identifier.

The remaining physical handoff must repeat the ordinary non-LiDAR journey, add an irregular or
multi-zone room, exercise safe real relaunch/offline/authority cases, observe resource behavior and
then rerun the proposal-only visual benchmark. Optional LiDAR/RoomPlan evidence is a separate row
and cannot substitute for the non-LiDAR baseline. Rights-cleared ground truth is still mandatory for
any dimensional claim.

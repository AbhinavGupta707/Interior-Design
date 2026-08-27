# C14.8 device-neutral mobile capture acceptance — 2026-08-27

## Software outcome

C14.8 adds a camera-first guided capture branch to the standalone homeowner iOS app. An ordinary
ARKit-capable, non-LiDAR iPhone is the baseline: retained RGB keyframes carry synchronized
camera-to-world pose, native-raster pinhole intrinsics, tracking and bounded quality evidence.
Runtime scene depth and a separately accepted RoomPlan package are optional additional evidence;
their absence never blocks RGB capture.

The resulting `capture-envelope-v1` is strict, bounded, hash-pinned and device-neutral. It declares
capabilities, source fingerprints, resumable-transfer completion, explicit coordinate conventions,
room coverage, semantic evidence layers, occlusion/unknowns, quality, provenance and service/
training rights. The server revalidates the exact actor, tenant, project, C7 session, C2 sources,
optional depth and RoomPlan references before append-only acceptance. A separate explicit action
may create the existing C8 job from exact ready RGB sources; it does not publish geometry or bypass
C4/C5/C9/C10 authority.

This record is software and Simulator evidence. Physical Apple-device capture and Windows/RTX 5080
candidate benchmarking are explicitly `NOT RUN`.

## Authority and scope

- Frozen base: `f41123f75bad8f70770a499a78638f2f1fb06d84`.
- Branch: `codex/c14-8-device-neutral-mobile-capture`.
- Contract freeze: `e803b23`.
- Authoring runtime: one `gpt-5.6-sol` / `xhigh` session; Sol was the sole implementation writer and
  completion authority. One same-checkout, read-only Terra/high reviewer inspected frozen
  implementation head `179336aa123e9285c770c212579c6f22902eceb2`; Sol independently validated
  and corrected its material migration-lifecycle finding in
  `581c3580699f74d1150192c43384c785244975e0`.
- Independent merge review: a separate `gpt-5.6-sol` / `xhigh` primary froze exact PR head
  `91581c3d7e90850e0cc5a7d752359639b0ff0fc5` against the same base. The delegation gate admitted
  one context-minimal, same-checkout Terra/high read-only native audit; it ran no repository suite
  and made no edit. Sol independently inspected every material boundary, made all corrections and
  retained final verification, merge and cleanup authority. No worktree or separate task was used.
- Integration vehicle: non-draft PR
  [#11](https://github.com/AbhinavGupta707/Interior-Design/pull/11); it remains unmerged.
- The user-owned root `AGENTS.md` modification remained untouched and outside every checkpoint
  commit.

## Authority preserved

- C2 remains the immutable RGB source store. The envelope pins, but does not duplicate or mutate,
  every RGB source.
- C7 remains authoritative for capture session rights, bounded optional depth transport and
  independently accepted RoomPlan packages. Simulator capability is rejected at server acceptance.
- Independent segments declare `independent-unless-later-registered`; interruption and relaunch do
  not fabricate a common world origin.
- Structural evidence, fixed fittings, movable furniture, appearance and temporary clutter remain
  separate user-asserted/unknown declarations. Coverage may remain missing or occluded.
- C8 receives only rights-cleared ready RGB sources and returns proposal state. Empty registration
  anchors are intentional; C14.8 invents no cross-segment transform.
- C9 remains the explicit multi-source reconciliation authority; C5 remains the only canonical
  preview/commit path; C10 consumes only an exact committed snapshot.

## Simulator evidence

The complete native unit suite passed again during independent review: 196 logical tests / 203
device invocations with zero failures or skips on the iPhone 17 Pro Max Simulator, iOS 26.4
(23E244). The review result bundle is
`/private/tmp/c14-8-pr11-native.o0k9oi/C14_8NativeTests.xcresult`.
Normal Simulator signing was retained for this runtime test so the pre-existing Keychain
round-trip exercised its local entitlement; unsigned builds remain compile-only gates.
The guided-journey UI suite remains 1/1 from the unchanged native tree at the frozen PR input from
`/tmp/c14-8-final-ui-derived/Logs/Test/Test-HomeDesignCapture-2026.08.27_00-51-49-+0100.xcresult`.
The UI fixture visibly reports synthetic capability, exercises the optional capture entry from the
homeowner hub, room coverage and quality guidance, explicit incomplete acceptance and return to the
ordinary homeowner product.

The synthetic engine never claims camera, ARKit, depth or RoomPlan capability and the platform
rejects Simulator envelopes. The Simulator result therefore proves UI/state behavior only.

Retained visual evidence:
`docs/evaluation/homeowner-journey/artifacts/c14-8-mobile-capture/iphone-guided-capture-fixture.png`
(1320×2868 PNG; SHA-256
`c3878e45d77d05b88bd0ae5848a9e16ec061a22a83c9faaea86669ba9f86cd35`).

## Gate record

| Gate                                        | Result                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Focused C7/C14.8 contracts/routes/migration | Passed after correction: 4 files / 19 tests                                                                 |
| Complete shared-contract unit suite         | Passed within `pnpm verify`: 16 files / 93 tests                                                            |
| Platform contract/integration suite         | Passed: 56 files / 264 tests; 20 files / 53 unavailable-service cases skipped; live C14.8 run separately    |
| Live PostgreSQL C14.8 integration           | Passed: fresh path 2/2 and exact-base upgrade through 0015; real persistence, role and tenant scope proven  |
| Full repository verification                | Passed: 24 lint, 24 typecheck and 24 build tasks; Ruff/mypy clean; Python 157 passed / 2 skipped            |
| Dedicated identity security                 | Passed: 921 tests                                                                                           |
| C14 source/control-plane gate               | Passed; optional composed control-plane case remained unconfigured and is separate from the live C14.8 gate |
| Generated contract drift                    | Passed: `node packages/api-contracts/scripts/generate.mjs --check`                                          |
| Dependency and API seam gates               | Passed: 3 boundary tests and 21 API seam tests                                                              |
| Complete native unit suite                  | Re-passed: 196 logical tests / 203 device invocations, zero failures/skips                                  |
| Guided C14.8 Simulator UI journey           | Passed on unchanged native tree: 1/1 on iPhone 17 Pro Max Simulator, iOS 26.4 (23E244)                      |
| XcodeGen regeneration                       | Byte-stable: `6ef49f967fd7de51b5b35da57461b90ac9914031c0fc7352cfd4121cd927914a`                             |
| Release builds and analysis                 | Release builds re-passed on unchanged native tree; prior Release analysis remains passed                    |
| C14.8 Release-fixture exclusion             | Passed on Simulator and generic iOS products; no scenario, fixture view/engine or fixture-journey text      |
| Physical Apple-device matrix                | `NOT RUN`: final inventory exposed only the Mac and Simulators                                              |
| Windows / RTX 5080 reconstruction benchmark | `NOT RUN`: handoff only; no candidate was production-integrated                                             |
| Independent contract/privacy/state audit    | Three additional material replay/envelope findings corrected; prior migration correction retained           |

Xcode 26.4's default batch-mode compilation hit a compiler macro diagnostic in the pre-existing C7
Swift Testing declarations (`@const value should be initialized with a compile-time value`). The
same source and tests compile and pass with whole-module compilation. This is recorded as a toolchain
workaround, not a product-test failure.

## Independent merge-review corrections

Correction commit `dcf1b4f` closes three material fail-closed gaps found from exact input head
`91581c3d7e90850e0cc5a7d752359639b0ff0fc5`:

1. A video-only source set could claim the mandatory camera-first `rgbKeyframes` capability. The
   strict envelope now requires the declared keyframe capability to match the retained source set.
2. Exact envelope-acceptance replay returned its historical body before revalidating current C7/C2
   rights and source state. Replay now resolves the current rights-filtered envelope in the same
   transaction and fails closed after withdrawal, quarantine or other unavailability.
3. Once a C8 job link existed, a changed reconstruction appearance request could be returned as a
   replay. Existing-job replay now compares the exact derived C8 request and rejects a changed body.

The changes do not add a canonical mutation, infer a cross-segment transform, treat depth or
appearance as dimensional truth, or alter the C8 proposal-only boundary.

## Live PostgreSQL evidence

Disposable PostgreSQL 16.14 ran on loopback port `55432` under
`/private/tmp/interior-design-pr11-pg.gO0yZE`. The final fresh database began empty, applied the
applicable C1-C8 chain plus `0015`, and passed the two C14.8 live cases. Those cases persisted two
accepted envelopes, attributed acceptance to the authenticated owner, denied viewer mutation,
allowed same-tenant viewer read, hid foreign-tenant read, rejected fixture/source-withdrawal paths,
rejected stale acceptance replay after rights withdrawal, enforced append-only rows and left the
tested projects with zero canonical snapshots.

The upgrade database was built from the exact base commit's migrations `0001` through `0014`, then
ran `migrate-c14-8`. All `0001`-`0015` markers and the extended C7 session/artifact constraints were
present. A second composed lifecycle run returned `status: ok`, proving the applicable upgrade is
idempotent. Docker/Supabase's earlier `EOF` is historical and no longer an open C14.8 gate.

## Hardware and provider truth

`xcrun xctrace list devices` exposed the Mac and Simulators but no connected physical iPhone or
iPad. No physical permission, RGB delivery, ARKit pose/intrinsics, scene depth, RoomPlan,
interruption, background/relaunch upload, thermal, accessibility or representative-home acceptance
is claimed. The exact next procedure is
`docs/runbooks/ios/C14_8_PHYSICAL_DEVICE_CAPTURE_HANDOFF.md`.

No Windows/RTX 5080 run was performed. COLMAP, VGGT, MASt3R, Video Depth Anything and gsplat were not
added to production. Their exact accepted-capture evaluation boundary is
`docs/runbooks/development/C14_8_WINDOWS_RTX5080_CAPTURE_BENCHMARK.md`.

## Contract and migration impact

- New additive `capture-envelope-v1` shared contract and three platform routes.
- Additive C7 capabilities, `accepted` terminal state and optional bounded `depth-sequence` artifact.
- Migration `0015_device_neutral_capture_envelopes.sql` adds append-only envelope/reference/link
  tables and the minimum C7 constraint extensions. It does not alter canonical, operation, fusion,
  scene, design or render tables.
- The explicit composed admin lifecycle reapplies `0007` and `0015` in one transaction after the
  separately required C8 migration, and readiness fails closed until the `0015` marker exists.
- Native ARKit/SceneKit system-framework linkage, protected local capture journal, optional depth
  bytes, capability-aware guidance, exact acceptance and C8-start client composition.
- No root manifest/lockfile, OpenAPI, experimental reconstruction provider or production GPU route.

## Residual limits

- Physical non-LiDAR iPhone acceptance is mandatory before calling camera-first capture physically
  accepted. LiDAR evidence cannot substitute for it.
- Windows results require a physical accepted capture and remain evaluation-only until a later
  production contract explicitly promotes one candidate.
- No survey, exact structure, regulatory, planning, cost, availability, accessibility-professional
  or other professional certainty is established.

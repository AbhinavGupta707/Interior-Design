# C14.8 device-neutral mobile capture acceptance — 2026-08-27

## Outcome

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

This record now combines the original software/Simulator evidence with one privacy-minimised
physical non-LiDAR iPhone baseline. The Windows/RTX 5080 candidate benchmark remains `NOT RUN`;
only its verified private input handoff was prepared.

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
- Original integration vehicle: non-draft PR
  [#11](https://github.com/AbhinavGupta707/Interior-Design/pull/11), subsequently merged before the
  C14.9 benchmark checkpoint.
- Physical follow-up: `gpt-5.6-sol` / `high`, branch
  `codex/c14-8-physical-device-acceptance`, exact synchronized base
  `da017f6259cada36a59a6b906459c6514386c279`, source correction head
  `b89d6e24df1270c44acecc830cfc6a278021d137`. No subagent or implementation lane was used.
- Independent physical-PR review: a separate `gpt-5.6-sol` / `xhigh` primary froze PR #13 at
  exact original head `0ef5955f01bcc49c372fce02314dc4602e832053` against exact base
  `da017f6259cada36a59a6b906459c6514386c279`. One same-checkout, read-only Terra/high correctness
  reviewer was admitted; no task or worktree was created. Sol independently validated the finding,
  owned the correction in `62a1fc26cd0581e7edd6d59824c3b7ee5d012d25`, and retained all
  verification, merge and cleanup authority.
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

## Physical non-LiDAR baseline

One iPhone 12 running iOS 26.6 completed the ordinary guided-RGB journey against disposable,
private local services. The phone used Wi-Fi and the Mac used the same private LAN; USB was needed
only for initial development install/debug trust and was not needed for capture or authenticated
transfer. Development signing used the user's Personal Team only at build/install time. No account,
team, device, provisioning, credential, endpoint or machine-specific Xcode setting is committed.

The exact accepted Capture Envelope identity is its canonical SHA-256
`093e9f6259429ab28281ba60032fd6b3592f299eb90b4353103ffe7c11c48cd9`. It declares:

- runtime `physical-device`, quality tier `guided-rgb`, one room and 26 immutable RGB keyframes;
- 26 synchronized ARKit camera samples with native-raster pinhole intrinsics and camera-to-world
  poses, all retained samples reporting normal tracking;
- two explicitly independent coordinate segments and one safely recovered interruption;
- 24 declared coverage cells: 22 observed, one occluded and one missing;
- zero depth sources and zero RoomPlan sources; scene depth and RoomPlan capability are false;
- owner-supplied rights, service processing granted and model training denied.

Real behavior was observed for camera permission, live camera delivery, ARKit world tracking,
pose/intrinsic retention, lower/middle/upper and directional coverage guidance, motion/blur/
low-light/tracking-limited guidance, a deliberate interruption, safe completed-keyframe retention,
and fresh independent-segment recovery. The accepted summary correctly contains zero retained
low-light, motion-warning, tracking-limited or unusable-blur samples because those warnings cleared
before retention.

All 26 C2 originals completed authenticated checksum-bound resumable transfer before server-side
acceptance. Acceptance bound the exact C2/C7 fingerprints and did not create geometry. The explicit
C8 action queued a proposal-only job; after a lease-heartbeat correction kept one attempt fenced
through media preparation, the terminal result was the typed fail-closed abstention
`RECONSTRUCTION_PRIVACY_REVIEW_REQUIRED`. No reconstruction geometry, C4/C5 operation, canonical
snapshot, dimensional truth or appearance authority was published.

The official C14.9 exporter then re-fetched the accepted physical envelope under current rights,
downloaded the 26 immutable originals into private storage and passed offline verification. The
privacy-minimised export-manifest SHA-256 is
`e3aeaed3925640c25f35e252f84b358efdcbdc424ff39cef781a69416504db74`. The private transfer root,
raw media, UUIDs, signed URLs, bearer credentials and alias salt are deliberately absent from Git,
GitHub, this evidence record and screenshots.

Material defects corrected during the same checkpoint were: development Info override naming;
closed-timeline retry drift; microsecond-to-millisecond wire canonicalisation; UUID case
canonicalisation; app-container file re-homing; completion reconciliation; bounded fresh signed-URL
retry; background-upload response races; C8 worker media-probe timeout; reconstruction lease
heartbeat/fencing; optional C14.9 room `story` verification; and export-attempt scoping for expiring
signed access responses. Each correction has a focused regression. Production signing, TLS,
authorization, source immutability, consent separation and proposal-only authority were not
weakened.

Independent PR #13 review found one additional material lifecycle gap: the background URL sessions
requested relaunch events, but the app had no `UIApplicationDelegate` completion bridge and the
task-to-upload relationship existed only in process memory. Correction
`62a1fc26cd0581e7edd6d59824c3b7ee5d012d25` adds an app-owned coordinator, fixed C2/C7 session
identifiers, lifecycle reattachment, and a bounded protected recovery record containing only scope
UUIDs, checksum, part number, status and ETag. Signed URLs, request headers, credentials, object
keys, source paths and response bodies are never retained. Only a successful 2xx result with a
bounded valid ETag can be recovered; expired/403 authority is discarded so retry must obtain a
fresh signed part.

No physical recapture was required. The correction does not change source bytes, upload request
bytes or headers, multipart identity, server validation, canonical envelope bytes, the accepted
Capture Envelope SHA-256, or the export manifest. It changes only protected bookkeeping and
process-relaunch reattachment around the same uninterrupted upload path. The previously recorded
installed-app hash remains the identity of the binary actually used for physical capture; the new
correction is software/Simulator and Release-build evidence and is not relabelled as a physical
process-termination run.

## Simulator evidence

The complete native unit suite passed again during independent review: 196 logical tests / 203
device invocations with zero failures or skips on the iPhone 17 Pro Max Simulator, iOS 26.4
(23E244). The review result bundle was retained only as an ephemeral local artifact.
Normal Simulator signing was retained for this runtime test so the pre-existing Keychain
round-trip exercised its local entitlement; unsigned builds remain compile-only gates.
The guided-journey UI suite remains 1/1 from the unchanged native tree at the frozen PR input; its
result bundle was retained only as an ephemeral local artifact.
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

| Gate                                        | Result                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Focused C7/C14.8 contracts/routes/migration | Passed after correction: 4 files / 19 tests                                                                   |
| Complete shared-contract unit suite         | Passed within final `pnpm verify`: 16 files / 95 tests                                                        |
| Platform contract/integration suite         | Passed: 56 files / 266 tests; 20 files / 53 unavailable-service cases skipped; physical path run separately   |
| Live PostgreSQL C14.8 integration           | Passed: fresh path 2/2 and exact-base upgrade through 0015; real persistence, role and tenant scope proven    |
| Full repository verification                | Passed: 24 lint, 24 typecheck and 24 build tasks; Ruff/mypy clean; Python 157 passed / 2 skipped              |
| Dedicated identity security                 | Passed: 921 tests                                                                                             |
| C14 source/control-plane gate               | Passed; optional composed control-plane case remained unconfigured and is separate from the live C14.8 gate   |
| Generated contract drift                    | Passed: `node packages/api-contracts/scripts/generate.mjs --check`                                            |
| Dependency and API seam gates               | Passed: 3 boundary tests and 21 API seam tests                                                                |
| Complete native unit suite                  | Post-review pass: 209 tests (104 XCTest + 105 Swift Testing), zero failures                                   |
| Complete native UI suite                    | Passed on corrected source head: 32/32 on iPhone 17 Pro Max Simulator, iOS 26.4                               |
| Guided C14.8 Simulator UI journey           | Passed on unchanged native tree: 1/1 on iPhone 17 Pro Max Simulator, iOS 26.4 (23E244)                        |
| XcodeGen regeneration                       | Post-review byte-stable: `48e49c6693020cd1518cec9d03ef1f0a0dae9111fd88266b34af34a557ae9f4c`                   |
| Release builds and analysis                 | Post-review unsigned generic-iOS Release build and Release analysis passed                                    |
| C14.8 Release-fixture exclusion             | Passed on Simulator and generic iOS products; no scenario, fixture view/engine or fixture-journey text        |
| Physical Apple-device matrix                | Passed one non-LiDAR baseline: iPhone 12/iOS 26.6, 26 RGB+ARKit samples, interruption/recovery and acceptance |
| Private C14.9 export/verifier               | Source retained; durable copy re-passed: 28 protected regular files; no links or special files                |
| Windows / RTX 5080 reconstruction benchmark | `NOT RUN`: verified input handoff only; no candidate run or production integration                            |
| Independent contract/privacy/state audit    | Prior findings retained; PR #13 lifecycle reattachment gap corrected and regression-tested                    |

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

The earlier software closeout inventory contained no physical device; the follow-up described
above supersedes only that physical non-LiDAR gap. It does not establish LiDAR, scene depth,
RoomPlan, survey scale, thermal endurance, VoiceOver acceptance, representative-home performance
or a multi-room/whole-apartment result.

No Windows/RTX 5080 candidate run was performed. COLMAP, VGGT, MASt3R, Video Depth Anything and
gsplat were not added to production or promoted. The accepted physical input is privately exported
and verifier-clean, but benchmark execution must wait for this correction PR to merge and for the
Windows checkout to synchronize to the exact merged head under
`docs/runbooks/development/C14_9_CAPTURE_ENVELOPE_BENCHMARK.md`.

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

- This is one room and one device baseline, not the full device/OS, deny-then-grant, offline,
  process-termination, expired-URL, role/rights withdrawal, storage-pressure, thermal or
  accessibility matrix. Relaunch completion is software-tested but not physically exercised.
- The two coordinate segments remain independent; no cross-segment transform or common scale was
  inferred. One coverage cell is missing and one is user-declared occluded.
- Windows results require the merged correction head and remain evaluation-only even after a run;
  no candidate receives production or canonical authority.
- Physical dimensions, reference measurements, ground-truth accuracy, second-journey repeatability
  and all C14.9 geometric/resource metrics remain required.
- No survey, exact structure, regulatory, planning, cost, availability, accessibility-professional
  or other professional certainty is established.

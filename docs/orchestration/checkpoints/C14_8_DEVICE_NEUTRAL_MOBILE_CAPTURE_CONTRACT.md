# C14.8 Contract — Device-neutral mobile capture foundation

## Authority and checkpoint outcome

- Checkpoint: C14.8
- Immutable predecessor: merged `origin/main` at `f41123f75bad8f70770a499a78638f2f1fb06d84`
- Integration branch: `codex/c14-8-device-neutral-mobile-capture`
- Execution: one `gpt-5.6-sol` primary session at `xhigh`; Sol is the sole implementation writer and completion authority. No worktree or parallel implementation lane is authorised. At most one same-checkout, read-only Terra/high final audit may inspect the frozen final head.
- Outcome: the standalone homeowner iOS app offers a camera-first, room-by-room guided capture branch on ordinary ARKit-capable iPhones, including the non-LiDAR iPhone 12 class, while depth and RoomPlan remain optional additional evidence. The server accepts one immutable, versioned, device-neutral Capture Envelope and may start the existing C8 proposal workflow only from exact ready sources.

This corrective checkpoint closes the software boundary and Simulator journey. It cannot close physical-camera, ARKit, LiDAR, RoomPlan, representative-home, production reconstruction, or Windows/CUDA acceptance without the named hardware evidence.

## Audit decision and smallest coherent boundary

The accepted C7 path is LiDAR/RoomPlan-specific and intentionally retains no camera frames. The accepted C8 native path already stores RGB photo/video through C2 but uses AVFoundation-only guidance, synthetic sector advancement, and no synchronized ARKit pose/intrinsic stream. C14.7 already consumes server-authoritative C8 jobs as proposals and preserves C4/C5/C9/C10 authority.

C14.8 therefore adds one boundary rather than replacing those checkpoints:

1. C2 remains the immutable, checksum-bound store for RGB keyframes/video.
2. The existing C7 multipart transport is extended only for optional bounded depth evidence.
3. `capture-envelope-v1` pins exact C2 RGB source IDs/hashes, optional depth and RoomPlan package hashes, device capabilities, camera samples, coordinate-space segments, room coverage, quality, provenance, rights, semantic/occlusion declarations, and completed resumable-transfer state.
4. Envelope acceptance re-verifies tenant, project, actor, current rights, source fingerprints, upload completion, and referenced package identity on the server.
5. A separate explicit reconstruction transition re-verifies the immutable envelope hash and ready RGB sources before creating the unchanged C8 proposal job. It never publishes geometry or calls C5.

## Frozen product rules

1. RGB + ARKit world tracking is the baseline. Runtime capability detection must explain `guided-rgb`, `guided-rgb-depth`, `guided-rgb-depth-roomplan`, or visibly synthetic Simulator state. Absence of depth or RoomPlan never blocks RGB capture.
2. The guided journey captures protected RGB keyframes with synchronized ARKit transforms/intrinsics. Existing C8 video remains an accepted envelope source, but this checkpoint does not claim synchronized video poses unless the exact source carries them.
3. Coverage is room-scoped and records horizontal sector plus lower/middle/upper band. Missing and user-declared occluded cells remain explicit. Capture may be accepted incomplete only with those gaps retained.
4. Motion, lighting, blur, tracking, interruption, thermal/resource pressure, and missing-area guidance are advisory quality evidence, never accuracy or completeness proof.
5. Interruption or relaunch creates a new coordinate-space segment unless relocalisation is explicitly proven. Segments are never silently joined.
6. Every segment declares ARKit right-handed, gravity-aligned, Y-up coordinates and micrometre
   translation units. Camera samples declare camera-to-world pose, `[x,y,z,w]` quaternion order and
   pinhole intrinsics for the retained native camera raster. Optional depth declares its exact ARKit
   scene-depth image-plane alignment. Downstream tools may transform these values only through a
   separately hashed derived manifest.
7. Structural evidence, fixed fittings, movable furniture, appearance, and temporary clutter are separate envelope declarations. They are user assertions or unknowns, not automated geometry classifications.
8. Every raw RGB/depth source is immutable and hash-pinned. Protected local journals contain no bearer token, signed URL, object key, address, or advertising identifier and are scoped to one project.
9. Service processing consent is required; training use is fixed to denied. Rights withdrawal, role loss, project change, expiry, stale response, and source quarantine fail closed.
10. Viewer is read-only. Owner/editor may capture, accept, and explicitly start reconstruction; the server remains authoritative.
11. C8 output remains proposal-only, C8 appearance remains non-dimensional, C9 reconciliation remains explicit, C5 preview/commit remains the only canonical mutation path, and C10 consumes only a committed exact snapshot.

## Contract and migration freeze

- New shared schema: `capture-envelope-v1` plus exact acceptance/reconstruction response schemas in `packages/contracts/src/capture-envelope.ts`.
- Additive C7 transport changes: device capability declaration, `accepted` terminal state, and optional `depth-sequence` artifact kind. Existing RoomPlan v1 package/proposal schemas and routes remain valid.
- Additive routes:
  - `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/envelope`
  - `GET /v1/projects/:projectId/capture-sessions/:captureSessionId/envelope`
  - `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/envelope/reconstruction`
- Migration allocation: `0015_device_neutral_capture_envelopes.sql`. It may alter only the C7 session/artifact constraints required for the additive boundary and create append-only envelope/source/reference/link tables. No canonical-model, operation, fusion, scene, design, or render table is changed.
- No experimental reconstruction model, production route, queue, provider, weight, or GPU dependency is authorised.

## Required acceptance evidence

1. Strict TypeScript/Swift schema and validation tests cover unknown fields, bounds, duplicate IDs/timestamps, invalid camera transforms/intrinsics, cross-project sources, rights mismatch, incomplete transfer state, stale envelope hash, and non-RGB reconstruction inputs.
2. Platform contract/security tests prove authentication, owner/editor versus viewer, tenant/project scoping, exact immutable source binding, RoomPlan/depth reference binding, idempotent acceptance/reconstruction, role/rights/source-state revalidation, and no C4-C10 mutation.
3. Native unit tests cover capability tiers, ordinary RGB fallback, live guidance, explicit missing/occluded state, protected recovery, project/role invalidation, coordinate-segment restart, and stale asynchronous response rejection.
4. Simulator UI tests cover camera-first entry, visibly synthetic capability explanation, room/coverage/quality/interruption/recovery, incomplete acceptance, and return to the standalone homeowner hub. Simulator evidence is labelled non-camera/non-ARKit.
5. XcodeGen drift, Swift strict-concurrency build, Debug/Release build, static analysis, generated-contract drift, focused repository/security suites, and final diff review pass.
6. If an authorised physical device is connected, run the bounded field matrix and record model/OS/build. Otherwise every physical row is `NOT RUN` with an exact handoff; no physical acceptance claim is allowed.
7. The Windows/RTX 5080 handoff pins envelope inputs, candidates, versions, commands, metrics, artifact/hashing rules, and promotion prohibitions for COLMAP, VGGT/MASt3R, video-depth, and gsplat benchmarking. None is productionised here.

## Operational handoffs

- Physical Apple-device matrix:
  `docs/runbooks/ios/C14_8_PHYSICAL_DEVICE_CAPTURE_HANDOFF.md`.
- Accepted-capture Windows/RTX 5080 benchmark:
  `docs/runbooks/development/C14_8_WINDOWS_RTX5080_CAPTURE_BENCHMARK.md`.

## Terminal rule

C14.8 may be called software-complete only when the final reviewed SHA passes every affected software gate and one non-draft PR is open. Physical Apple-device capture and Windows reconstruction benchmarking remain separately unaccepted until their exact evidence is recorded. The PR must not be merged by this session.

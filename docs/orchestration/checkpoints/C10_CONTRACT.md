# C10 Contract — Deterministic scene and interactive walkthrough

## Authority, outcome and scope

- Checkpoint: C10
- Immutable predecessor: C9 ledger-close commit `77854a1726b40ba7ac7a05d26a39d881b7e38509`
- Outcome: an exact committed C4 snapshot compiles reproducibly to a validated GLB 2.0 artifact and immutable scene manifest, is delivered through a tenant-safe durable scene workflow, and can be explored in a responsive browser orbit/walk/section/selection/material viewer with an honest accessible 2D fallback.
- Contract versions: `c10-scene-job-v1`, `c10-scene-manifest-v1`, `c10-scene-artifact-v1`
- Scope boundary: C10 does not reconstruct evidence, resolve C9 discrepancies, mutate C4/C5 state, invent unknown geometry, claim survey accuracy, produce photoreal media, or close unavailable C7/C8 physical-device/GPU gates.

The authoritative product and safety rules remain `AGENTS.md`, the accepted C4–C9 contracts and ADRs, and the active blue-sky plan. C10 turns a committed model into a derived visualisation; it does not increase the source model's epistemic or professional authority.

## Primary-source and first-principles decisions

- glTF 2.0/GLB is the frozen delivery format. glTF is right-handed, uses metres, defines `+Y` as up and `+Z` as forward, requires finite IEEE-754 single-precision geometry and aligned binary accessors, and provides a binary container for runtime delivery. The compiler therefore maps canonical integer millimetres `[X, Y, Z]` to GLB metres `[X/1000, Z/1000, -Y/1000]` with a proper right-handed transform. [Khronos glTF 2.0.1 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- Every emitted GLB must pass the official Khronos validator with zero errors. Validator warnings are either fixed or allow-listed by a named, reviewed code in the evidence record; no home-scene warning is silently ignored. [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/)
- Stable canonical element IDs live in an immutable sidecar element map and in bounded node metadata; display names are not identity because glTF names are optional and non-unique.
- Browser rendering is event-driven when idle. React Three Fiber's `frameloop="demand"`, resource reuse and bounded draw calls are the baseline; interaction explicitly invalidates frames. [React Three Fiber performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- The 3D view is progressive enhancement. WebGL/capability failure, reduced motion, loading failure or an over-budget scene leaves the exact snapshot summary, level/element navigation and 2D route usable. A screenshot, fixture canvas or generated image is never presented as an interactive model.

## Frozen compiler and artifact decisions

1. Input is one exact persisted C4 snapshot ID/hash/model/profile. The API reloads and rehashes it server-side; stale hashes, foreign-tenant records, uncommitted proposals and direct snapshot payloads fail closed.
2. The default compile configuration is fixed to `parametric-v1`, `c4-z-up-to-gltf-y-up-v1`, `status-aware-neutral-v1`, `interactive-browser` and `omit-and-report`. Configuration and compiler versions participate in the determinism/cache key.
3. Canonical arrays and element IDs are sorted before compilation. Floating-point emission follows one explicit conversion/rounding path; buffers, buffer views, accessors, materials, meshes, nodes and JSON keys have deterministic order and four-byte alignment. Identical snapshot/compiler/config inputs must produce byte-identical GLB, manifest bytes and SHA-256 hashes across fresh processes on the supported runtime.
4. Known valid walls, openings, spaces/surfaces, stairs, fixed objects, furnishings, finishes, lights and cameras compile to bounded geometry or metadata. Openings cut or segment their host wall rather than being painted on top. Unknown/invalid/unsupported geometry is omitted with a located finding and element-map status; it is never filled with a plausible proxy.
5. Geometry is derived visualisation only. Appearance/status materials communicate element class and uncertainty without overwriting canonical finish or dimensional truth. C10 never writes a snapshot or typed operation.
6. Every mapped spatial element has a stable one-owner node mapping; non-spatial finish/material metadata has a stable GLB object mapping. Every omitted element has at least one safe finding code. Manifest counts, exact integer-millimetre bounds, source snapshot, compiler/config hashes, GLB hash/size and element map are immutable.
7. Public contracts contain no object key, filesystem path, signed provider request, lease token or storage credential. The GLB is checksum-bound, content-addressed under a derived-scene prefix and served by a short-lived audited URL; only HTTPS is valid outside loopback development.
8. GLB parsing/validation is bounded before publication. NaN/infinity, overflow, index/accessor violations, malformed topology, zip/archive input, external URI, scriptable content and unsupported required extensions fail closed.

## Frozen durable workflow and access decisions

- Public routes:
  - `GET|POST /v1/projects/:projectId/scene-jobs`
  - `GET /v1/projects/:projectId/scene-jobs/:sceneJobId`
  - `POST /v1/projects/:projectId/scene-jobs/:sceneJobId/cancel`
  - `POST /v1/projects/:projectId/scene-jobs/:sceneJobId/retry`
  - `GET /v1/projects/:projectId/scene-jobs/:sceneJobId/scene`
  - `POST /v1/projects/:projectId/scene-jobs/:sceneJobId/scene/access`
- Jobs are tenant/project scoped, idempotent and append-only across at most three attempts. Lease expiry/reclaim, heartbeat, cancellation, retry fencing, stale-worker denial and atomic immutable publication are required.
- The cache key is the exact snapshot hash plus compiler/config versions. A same-key replay returns one logical result; a different request under the same idempotency key conflicts. Cache reuse never crosses tenant/project access checks and still creates attributable access/audit evidence.
- Owner/editor may create, cancel, retry and read. Viewer may read jobs, scenes and short-lived artifacts but cannot trigger compilation or mutation. Foreign-tenant access denies before existence disclosure.
- Logs/traces carry safe codes, counts, stable IDs and hashes only. Snapshot bodies, raw GLB bytes, signed URLs, object keys, credentials and private worker envelopes are redacted.

## Frozen viewer behavior and budgets

1. The viewer is lazy-loaded and client-only. It verifies the scene/manifest/source tuple, loads the checksum-bound GLB, and rejects a hash, content-type or manifest mismatch.
2. Orbit, walk, section, level visibility, material/status mode, reset and stable element selection are explicit controls. Walk movement is keyboard/button accessible, bounded to model extents and collision-conservative; it never implies a physically traversable or regulation-compliant route.
3. Canvas selection and the DOM element list share the same canonical ID. The inspector shows element type, source profile/hash, mapped/omitted state, findings and the model's limitations. Viewer roles receive no compile/mutation controls.
4. Loading, empty, queued, compiling, failed, cancelled, expired-link, offline, WebGL-unavailable, context-loss and over-budget states are visible and recoverable. Keyboard focus never becomes trapped by the canvas; reduced motion disables animated transitions.
5. Frozen acceptance fixtures:
   - compact two-level home: GLB at most 4 MiB, 150,000 triangles, 300,000 vertices and 400 mapped nodes;
   - bounded stress home: GLB at most 20 MiB, 750,000 triangles, 1,500,000 vertices and 5,000 mapped nodes;
   - no public artifact may exceed the contract's 50 MiB/2,000,000-triangle/4,000,000-vertex ceilings.
6. On the recorded Mac/browser environment, the compact live scene must compile within 10 seconds, become visibly interactive within 5 seconds on desktop and 7 seconds at 390×844 after the scene response, sustain at least 30 median animation frames/second during the bounded Chromium interaction sample, use no more than 500 renderer calls, and stop continuous rendering when idle. These are environment-specific acceptance budgets, not universal device claims.
7. Chromium, Firefox and WebKit must complete the same semantic journey. At least Chromium must prove the real GLB canvas interaction on this host. A browser without usable WebGL must render and exercise the honest 2D/DOM fallback rather than be counted as 3D evidence.

## Adaptive isolated worktree plan

C10 retains three project-scoped worktrees. Compiler numerics, durable tenant/storage concurrency, and browser rendering/performance are separate substantial risks with exclusive write ownership. Every lane uses exact `gpt-5.6-sol` with `xhigh` reasoning because each includes geometry/specification, security/concurrency or cross-browser 3D integration; no C10 lane is merely mechanical.

| Lane                                 | Model / reasoning       | Exclusive editable paths                                                                                                                                                                                                                                                                                                                                                                | Required output                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C10-L1 scene compiler/runtime        | `gpt-5.6-sol` / `xhigh` | `packages/scene-compiler/src/**`, `packages/scene-compiler/test/**`, `services/spatial-worker/src/scene-compile/**`, `services/spatial-worker/test/scene-compile/**`                                                                                                                                                                                                                    | deterministic parametric mesh compiler, opening-aware walls, stable element map, GLB writer/validator boundary, exact hashes, bounded worker protocol, cancellation and golden/property/adversarial tests         |
| C10-L2 durable scene backend/storage | `gpt-5.6-sol` / `xhigh` | `services/platform-api/src/modules/scenes/**`, `services/platform-api/src/c10.ts`, `services/platform-api/test/c10/**`, `services/platform-api/migrations/0010_scenes.sql`, `docs/runbooks/development/c10-scenes.md`; exact allocated API composition files `services/platform-api/src/app.ts` and `services/platform-api/src/server.ts`                                               | tenant-safe job/cache/lease/cancel/retry/publication, exact snapshot verification, narrow storage adapter, signed access, audit/redaction/readiness and live Postgres/object-storage tests                        |
| C10-L3 viewer/independent acceptance | `gpt-5.6-sol` / `xhigh` | `apps/web/src/features/viewer-3d/**`, `apps/web/src/app/viewer/**`, `apps/web/src/app/api/c10/**`, `apps/web/test/viewer-3d/**`, `tests/e2e/viewer/**`, `tests/performance/viewer/**`, `tests/security/scenes/**`, `docs/evaluation/viewer/**`, `docs/threat-models/scenes.md`; exact allocated `apps/web/src/features/projects/projects-screen.tsx` and `apps/web/src/app/globals.css` | accessible lazy R3F viewer, orbit/walk/section/select/material/level controls, honest fallback and all states, independent security/GLB/browser/performance acceptance with desktop/mobile/cross-browser evidence |

Merge order is L1 → L2 → L3. Workers must not edit another lane, manifests/lockfiles, shared contracts/core authz, migration registry, accepted checkpoint contract, `.github`, `.codex`, `AGENTS.md` or the ledger. The orchestrator owns shared composition between compiler/backend/viewer, any dependency or barrel changes, integration repairs and final evidence.

## Required checkpoint gate

1. `UV_CACHE_DIR=.cache/uv pnpm verify`, focused C10 contracts/authz/identity suites and all pre-existing suites pass. Strict schemas reject unknown fields, stale/foreign/uncommitted snapshots, invalid terminal states, locator/path leakage, unsafe URLs, inconsistent artifact/manifest records and over-budget counts.
2. Compiler unit/property/golden tests cover coordinate handedness/metres, wall alignment/thickness/height, multiple segments, openings at ends/overlap/out of bounds, concave surfaces, levels/elevations, stairs, proxy-bounded objects, finish slots, lights/cameras, empty/unknown fields, invalid/self-intersecting/overflow/non-finite geometry, stable ordering and content hashes.
3. Fresh-process determinism produces byte-identical GLB and manifest outputs. Official Khronos GLB validation reports zero errors; independent parsing recomputes bounds/counts/element IDs and detects corrupt header/chunks/accessors/hashes.
4. A clean disposable PostGIS database applies C1–C10. Live API/worker/storage tests prove idempotency, cache identity, tenant/project/snapshot scope, lease reclaim, cancellation, retry fencing, stale publication denial, immutable atomic scene publication, viewer read-only access, signed URL expiry and zero canonical/branch mutation.
5. The integrated production path uses a real committed C4 snapshot, real API repository, real scene worker/compiler, real local object storage, real BFF and real browser. It must create a durable job, publish a validator-clean artifact, load it, select the same stable ID in 2D/DOM/3D, exercise orbit/walk/section/material/level controls and preserve the source snapshot unchanged.
6. Playwright covers desktop/mobile Chromium plus Firefox/WebKit semantic journeys, owner/viewer/foreign roles, every lifecycle and degraded state, keyboard/accessibility, context loss/offline/expired access, responsive overflow, console/page/network errors and the frozen performance instrumentation. Browser Computer Use/in-app Browser is attempted for visible evidence where available.
7. Artifact/provider/privacy checks prove no external URI, active content, raw evidence, object key, signed URL, credential or source snapshot body leaks through public manifests/logs. Derived GLB cannot be mistaken for surveyed or professional truth.
8. C7 physical RoomPlan, C8 real COLMAP/Open3D/neural/CUDA, representative-home accuracy and cloud-provider evidence remain exactly `NOT RUN`. They are upstream fidelity/release evidence and do not block C10's exact-model scene compiler gate; C10 does not promote them.
9. The ledger records task IDs, exact model/reasoning, worker/merge/product SHAs, commands/counts, live database/API/worker/storage/browser evidence, integration repairs, measured budgets and residual limitations before C11 may open.

## Continuation rule

C11 may open only after all three C10 lanes are merged, the production compiler/storage/viewer path is proven from an exact committed snapshot, the GLB/manifest determinism and validator gates pass, the accessible fallback and role boundaries are independently verified, the C10 evidence record and ledger-close commit are on `main` and pushed, and unavailable upstream hardware/runtime evidence remains explicitly named.

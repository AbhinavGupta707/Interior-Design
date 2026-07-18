# C10-L3 viewer acceptance — 17 July 2026

## Result

The integrated checkpoint implements the deterministic compiler, durable PostgreSQL/object-storage workflow, lazy same-origin viewer and independent contract/security/semantic test surfaces. A production-composed local run compiled and published real two-level geometry from an exact committed C4 snapshot. Fixture-backed browser semantics passed in Chromium, Firefox and WebKit. This host's headless Chromium exposed a major WebGL performance caveat, so actual-canvas interaction and performance budgets are **not measured on this host**. That is a capability limitation, not a passing performance claim.

## Evidence classification

| Evidence                                          | Classification                        | Result                                  |
| ------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| BFF/client/verification unit suites               | Local deterministic code evidence     | Passed                                  |
| Hostile artifact, role and IDOR suites            | Local deterministic security evidence | Passed                                  |
| Chromium mobile, Firefox and WebKit workflows     | Synthetic fixture / browser semantics | Passed                                  |
| Chromium desktop actual canvas                    | Not available on this host            | Skipped by production major-caveat gate |
| Desktop/mobile FPS, load and demand-idle budgets  | Not measured on this host             | Skipped by the same gate                |
| API/worker/compiler/Postgres/local object storage | Real local-backend evidence           | Passed                                  |
| Cloud provider/deployed tenant integration        | Provider evidence                     | Not run                                 |
| Physical mobile device and hardware GPU           | Hardware evidence                     | Not run                                 |

The synthetic server is limited to presentation and browser contract evidence. It generates a compact checksum-bound GLB, exposes scenario controls, and labels the UI with “Fixture presentation evidence … not real-backend evidence.”

## Acceptance coverage

- The BFF accepts only the frozen C10 route shapes, validates UUID path segments, requires the session cookie and bounded idempotency keys, parses strict request bodies, validates every upstream success response, strips unapproved upstream problem fields, and returns `no-store` responses.
- Signed URLs are never returned by the workspace endpoint, logged or persisted. The client receives a short-lived URL only from the access route and uses it directly for the single artifact fetch.
- Scene success requires an exact job/scene/access/source tuple, unexpired grant, canonical manifest hash, artifact hash, content type, byte count, valid two-chunk GLB framing and manifest-to-GLB semantic counts.
- External/data URIs, active-content markers, unsupported required extensions, malformed primitives and over-budget scenes fail closed into the exact DOM summary.
- Owner/editor mutations remain idempotent and explicit. Viewer-role workflows expose inspection and short-lived access only; mock IDOR responses intentionally return not-found for foreign projects.
- Orbit, bounded keyboard/button walk, section plane, level visibility, material/status modes, reset and canonical-ID selection are present in the lazy client-only renderer. The canvas has `tabindex=-1`; the synchronized DOM list and inspector remain primary accessible interaction surfaces.
- Empty, queued, leased/compiling, publishing, cancel-requested, succeeded, failed, cancelled, stale-session, offline, expired, context-loss, renderer-error, integrity-error and over-budget presentations are explicit.
- Reduced motion disables animated transitions. No-WebGL and major-caveat browsers receive a responsive bounds-only 2D/DOM summary that explicitly states it is not a floor plan or surveyed/professional/traversability truth.

## Verification record

| Command                                                  | Result                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run build --filter=@interior-design/web^...` | 8 declared dependency packages built successfully; this was required in the fresh worktree before the exact web build could resolve their existing `dist` exports |
| `pnpm --filter @interior-design/web lint`                | Passed                                                                                                                                                            |
| `pnpm --filter @interior-design/web typecheck`           | Passed                                                                                                                                                            |
| `pnpm --filter @interior-design/web test:unit`           | 26 files, 90 tests passed                                                                                                                                         |
| `pnpm --filter @interior-design/web build`               | Passed; `/viewer/[projectId]` and `/api/c10/[...segments]` emitted as dynamic routes                                                                              |
| `UV_CACHE_DIR=.cache/uv pnpm verify`                     | Passed formatting, all package lint/type/build gates, JavaScript suites and 117 passed Python tests with two named unavailable-runtime skips                      |
| Production API/worker/Postgres/S3-compatible gate        | Passed; exact committed two-level snapshot compiled, atomically published, signed-downloaded and checksum-verified with no canonical or branch mutation           |
| Compact compiler artifact                                | 29,456-byte GLB; 14 nodes, 9 meshes, 561 vertices, 281 triangles, 6 materials; SHA-256 `730e0b6b20d1a5438d17b15a592d4fda52b8d15c41fd76e5b54411f98f817a7a`         |
| Khronos validator and fresh-process determinism          | Zero errors/warnings; byte-identical compiler output across fresh supported-runtime processes                                                                     |
| Security TypeScript + Vitest                             | TypeScript passed; 3 files, 11 tests passed                                                                                                                       |
| E2E TypeScript + Playwright 1.61.1                       | TypeScript passed; 5 tests passed, 2 actual-canvas tests skipped by the production WebGL major-caveat gate                                                        |
| Performance TypeScript + Playwright                      | TypeScript passed; both desktop/mobile actual-canvas cases skipped by the same gate, so no numeric performance claim is made                                      |
| `git diff --check`                                       | Passed                                                                                                                                                            |

The required in-app Browser plugin was attempted twice before CLI Playwright, but its isolated runtime failed during bootstrap with `Cannot redefine property: process` before a tab or application request was created. The Playwright fallback is therefore the browser evidence source for this host; that plugin failure is not classified as an application failure.

Browser artifacts are written outside the repository under `/tmp/c10-viewer-*-results`; the inspected mobile fixture screenshot is `/tmp/c10-viewer-mobile.png`. No generated browser artifact is committed.

## Outstanding acceptance

No known C10 software-architecture gap remains in the local production composition. Still `NOT RUN` are a deployed cloud owner/editor/viewer journey, actual-GPU Chromium canvas load/FPS/call/idle measurements and physical-mobile evidence. Upstream physical RoomPlan, genuine COLMAP/Open3D/neural/CUDA reconstruction, representative-home accuracy and professional review also remain release/field gates; C10 does not promote or replace them.

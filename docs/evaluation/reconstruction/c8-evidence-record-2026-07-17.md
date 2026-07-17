# C8 checkpoint evidence record — 2026-07-17

## Outcome

C8 is implemented as a production-shaped code/integration checkpoint: guided native photo/video capture, deterministic privacy-reviewed media preparation, durable tenant-safe jobs, private reconstruction composition, proposal-only geometry, optional non-dimensional appearance, honest unavailable-runtime behavior and accessible web/native status journeys are integrated. It does not mutate the canonical home and it does not claim survey, physical-camera, RGB-D, CUDA or representative-accuracy evidence.

All repository inputs were visibly synthetic and rights-cleared. Service processing was allowed and training use denied. No customer media, source payload, object key, signed URL, secret, provider credential or live cloud service was used.

## Integrated evidence matrix

| Surface                                                   | Final state                                       | Evidence class                                         |
| --------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| Repository verification                                   | passed                                            | real lint/typecheck/unit/build/static gate             |
| C8 adapter registry                                       | passed; four adapters always registered           | real host discovery with bounded unavailable state     |
| Private TypeScript → Python worker protocol               | passed                                            | real local process and real host discovery             |
| FFmpeg/ffprobe 8.1 media preparation                      | passed for synthetic image/video                  | actual local executable                                |
| Durable C8 API/Postgres suite                             | 8/8 passed                                        | live disposable Postgres                               |
| Composed DB → rights → media → worker → artifact → result | 1/1 passed                                        | live disposable Postgres plus real worker composition  |
| Geometry/appearance adapter tests                         | passed                                            | strict parser/command and injected-executor fixtures   |
| Browser presentation                                      | 6/6 passed at 1440×960, 390×844 and keyboard mode | local Chromium, visibly synthetic                      |
| Live web/BFF/API journey                                  | 2/2 passed at desktop and 390×844                 | real Next app, API, disposable Postgres and fixture ID |
| iOS C8 acceptance                                         | 5/5 passed after fixture integration repair       | iPhone Air / iOS 26.4 Simulator, visibly synthetic     |
| Complete iOS scheme                                       | 143 cases / 150 invocations; zero failures/skips  | iPhone Air / iOS 26.4 Simulator                        |
| Generic iOS Release build                                 | passed                                            | unsigned arm64 compilation; not physical execution     |
| In-app Browser plugin                                     | initialization failed before tab acquisition      | `NOT RUN` through plugin; CLI Playwright fallback used |
| Physical iOS camera/RGB-D                                 | no eligible device                                | `NOT RUN`                                              |
| COLMAP/Open3D algorithms                                  | not installed on this host                        | `NOT RUN`                                              |
| Nerfstudio/gsplat/CUDA                                    | no eligible runtime or NVIDIA hardware            | `NOT RUN`                                              |
| Windows/NVIDIA acceptance package                         | package created, workstation unavailable          | `NOT RUN`                                              |
| Paid/cloud provider                                       | not required or invoked                           | `NOT RUN`                                              |

## Code and live service evidence

- `UV_CACHE_DIR=.cache/uv pnpm verify` passed Prettier, all 14 package lint/typecheck suites, every JavaScript unit suite, every production build, Ruff, strict mypy and 86/88 Python tests; the two Python skips are the named unavailable COLMAP/Open3D real-runtime cases. The spatial worker reported 84 passed and three live-only skips in the provider-free repository run.
- The focused reconstruction Python suite passed 74 with two real-runtime skips. Registry tests prove COLMAP, Open3D, Nerfstudio and gsplat remain discoverable even when unavailable; the public projection contains no executable path, credential or provider internals.
- The focused spatial reconstruction/media pack passed 26 with one separately executed live-database skip. Real FFmpeg integration decoded a synthetic still and video, sampled deterministically, stripped metadata and cleaned the temporary workspace. A two-frame integration invoked the actual private Python module and returned a bounded COLMAP-unavailable abstention on this Mac.
- Against `interior_design_c8_test`, the platform C8 Postgres suite passed 8/8. It covers exact idempotency, tenant/source scope, lease expiry and reclaim, stale-token denial, cancellation at every stage, retry fencing, rights withdrawal, immutable completed/abstained publication and no canonical mutation.
- Against the same disposable database, the composed spatial-worker suite passed 1/1: it loaded the exact source with current rights, prepared it, invoked the worker lifecycle, uploaded the locator-free diagnostic artifact and atomically published abstention while leaving canonical snapshot count unchanged.
- Independent reconstruction evaluation passed 7/7 and security passed 24/24. Synthetic/reference values remain labelled and are not representative-accuracy evidence.

## Browser and native user evidence

The local Playwright pack passed six Chromium journeys: owner consent/completion with geometry and appearance separated; partial, disconnected, unknown-scale, error and offline states; viewer read-only inspection; cancellation and explicit fenced replacement; 390×844 responsive layout without horizontal overflow; and keyboard-only consent/start with observable focus. The page identified itself as visibly synthetic, its CSP denied external assets/connections, and the test observed no unexpected console error, page error, failed request, disclosure marker or overflow.

A separate producer-live Playwright run passed 2/2 at desktop and 390×844 mobile through the real Next application, same-origin BFF, ready C1–C8 platform API, disposable Postgres and local fixture identity. Each journey signed in as the synthetic Alpha homeowner, created a real tenant project, navigated to `/reconstruction/<projectId>`, loaded the real C8 workspace, observed no eligible media and found all three uninstalled runtime capabilities honestly unavailable while the canonical home remained unchanged. The journeys found no overflow, disclosure marker, console error, page error or failed C8 request. The canonical `http://localhost:3000` origin was required because the Next development runtime correctly rejects mixed `127.0.0.1` HMR origins.

The in-app Browser capability was attempted first but failed during initialization with a process-global setup conflict before a tab could be acquired. CLI Playwright supplied the required local browser fallback. This is a limitation of that evidence route, not a product pass for the plugin.

The first merged iOS scheme run exposed a genuine integration defect: all five C8 XCUITests skipped because the C8 presentation fixture was not registered in the app. The checkpoint was not closed. The orchestrator added a Debug/local/exact-opt-in fixture, strict parser tests and app composition, regenerated Xcode deterministically, then reran the focused pack. Two fixture-activation unit tests and all five C8 XCUITests passed with zero skips. The final complete scheme passed 143 reported test cases / 150 XCTest invocations with zero failures and zero skips on iPhone Air / iOS 26.4 Simulator. The journeys cover permission denial/import fallback, interruption/late-worker fencing/replacement, unavailable depth and appearance, partial/disconnected/unknown-scale/completed diagnostics, largest Dynamic Type, recovery reachability and width containment. Every fixture screen visibly states that it is not camera, depth, provider, GPU or algorithm evidence.

An unsigned generic `arm64` Release build for `generic/platform=iOS` succeeded, compiling the AVFoundation camera/depth implementation under complete Swift concurrency. Binary inspection found none of `C8_UI_TEST_MODE`, `C8_UI_TEST_SCENARIO`, the fixture heading or the fixture limitation copy, proving the Debug acceptance protocol is excluded from the production executable.

## Registered runtime state on this host

- Host: Apple M1, `arm64`, macOS 26.5.1.
- Installed media runtime: FFmpeg/ffprobe 8.1.
- COLMAP: `COLMAP_NOT_INSTALLED`.
- Open3D: `OPEN3D_NOT_INSTALLED`.
- Nerfstudio and gsplat: `APPEARANCE_TOOL_UNAVAILABLE`; no PyTorch/CUDA/NVIDIA runtime.
- The RGB worker path therefore exercises real preparation and private process composition but truthfully publishes an abstention instead of fixture geometry.

## Honest residual limitations

- No physical iPhone/iPad was connected. Camera permission, autofocus/exposure, encoded depth, interruptions, thermal/system pressure, protected storage on hardware and physical accessibility remain `NOT RUN`.
- AVFoundation records whether an encoded still contains depth, but this run does not prove a usable depth payload, calibration/pose extraction or a native RGB-D-to-Open3D journey. Without validated known-pose RGB-D inputs, the worker keeps `RGBD_TSDF_INPUT_UNAVAILABLE` visible and may use only the independently labelled RGB proposal path.
- COLMAP/Open3D/Nerfstudio/gsplat adapters are implemented and deterministically validated, but their actual algorithms were not executed here. No accuracy, capacity, dense-CUDA, neural-view or splat-quality claim is supported.
- The Windows 11/NVIDIA package remains to be run on the pinned eligible workstation. Synthetic executors cannot satisfy that gate.
- No licensed/public-domain representative holdout with independent geometric truth was available, so geometric error and severe-error distributions remain unreported rather than invented.
- C8 results are independent proposals. Cross-evidence registration/discrepancy resolution and deterministic scene compilation belong to later checkpoints; the user explicitly stopped execution at C8, so C9 was not opened.

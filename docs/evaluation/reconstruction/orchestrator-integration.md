# C8 orchestrator integration

## Completed composition after lane merge

The orchestrator completed the shared composition after merging L3, L2, L1 and L4 in the frozen order.

1. `discover_reconstruction_adapters()` always registers COLMAP, Open3D, Nerfstudio and gsplat through their code-owned activation paths and exposes only bounded availability/hardware/safe-code state. On this Mac it truthfully reports COLMAP and Open3D not installed and both appearance tools unavailable.
2. `ReconstructionProcessingRunner` claims the durable L1 lease, rechecks exact L1/C2 source scope and rights, runs L2 preparation, advances the fenced stages, invokes the private Python protocol, uploads verified artifacts and asks L1 to atomically publish the immutable terminal result.
3. `PythonReconstructionProcessor` stages accepted sanitized frames as private direct children, validates every hash, sends no locator through the public API and constrains the Python module, working directory, timeout and output. The Python protocol composes L3 geometry and optional L4 appearance only from this trusted envelope.
4. Artifact paths must resolve beneath the attempt workspace and match the declared byte count and SHA-256 before upload. Public results contain descriptors only. Storage keys, paths, URLs, credentials, provider output and subprocess output do not enter public results or logs.
5. L1's database publication remains the final tenant/project/job/attempt/lease/cancellation/rights fence. Geometry stays `proposal-only`; optional appearance stays `non-dimensional`; neither path calls C5 or changes the canonical snapshot.
6. XcodeGen now includes the C8 native implementation, unit tests and five C8 acceptance journeys. A deterministic C8 presentation fixture is accepted only in a Debug/local build with exact opt-in and is compiled out of Release.
7. The independent Playwright fixture remains visibly synthetic. The live composed database path is covered below by the real platform repository and spatial worker integration suites; a signed-in in-app Browser run against a separately started full stack remains a distinct evidence class.

## Producer mapping confirmed

| L4 field              | Required producer fact                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `prepared`            | exact accepted `c8-media-preparation-v1`; zero `review-required` frames                           |
| `cameras`             | strict L3 camera schema, one pose/intrinsics record per registered sanitized frame                |
| `geometry`            | exact `c8-geometry-result-v1`, proposal-only inputs, explicit unit/scale/components/residual      |
| `rights`              | current service-processing approval and fixed training denial, rechecked before lease and publish |
| `attempt`             | durable fenced attempt 1–3                                                                        |
| `TrustedStagedFrames` | private direct-child image files whose SHA-256 equals the prepared manifest                       |
| publisher             | storage adapter that does not return/log a key, URL, path, payload, or credential                 |

The trusted Python bridge adapts L3's strict `c8-calibrated-cameras-v1` world-to-camera document into the private appearance input only when the geometry result contains a valid camera set and an eligible appearance runtime is registered. The public parser was not widened and arbitrary tool output remains rejected.

## Honest runtime boundary

- The composed RGB path is complete: immutable source → FFmpeg preparation/privacy gate → private worker protocol → COLMAP adapter discovery/execution or bounded abstention → verified artifact upload → atomic database publication.
- Known-pose Open3D TSDF, Nerfstudio and gsplat adapters and their private composition contracts are implemented and deterministically tested. Their real algorithms were not run because this Apple M1 host has no Open3D/COLMAP/PyTorch/CUDA/NVIDIA runtime.
- Native AVFoundation still capture records whether the encoded photo contains depth, but this run did not prove a physical depth payload, calibration/pose extraction, or a native RGB-D-to-Open3D journey. RGB-D/hybrid jobs retain an explicit `RGBD_TSDF_INPUT_UNAVAILABLE` finding and use the independently valid RGB geometry path when trusted known-pose TSDF inputs are not available.
- The physical camera/RGB-D and Windows/NVIDIA evidence gates remain `NOT RUN`; synthetic executors and Simulator states do not change that status.

## Exact integration commands

From the repository root after all C8 lanes are merged:

```sh
UV_CACHE_DIR=.cache/uv uv run ruff check \
  services/inference-worker/src/inference_worker/reconstruction/nerfstudio \
  services/inference-worker/src/inference_worker/reconstruction/gsplat \
  services/inference-worker/test/reconstruction/nerfstudio \
  services/inference-worker/test/reconstruction/gsplat \
  ml/reconstruction/windows-nvidia

UV_CACHE_DIR=.cache/uv uv run mypy \
  services/inference-worker/src/inference_worker/reconstruction/nerfstudio \
  services/inference-worker/src/inference_worker/reconstruction/gsplat \
  ml/reconstruction/windows-nvidia/run_fixed_adapter.py

UV_CACHE_DIR=.cache/uv uv run pytest -q \
  services/inference-worker/test/reconstruction

pnpm exec tsc -p tests/evaluation/reconstruction/tsconfig.json --noEmit
pnpm exec vitest run --config tests/evaluation/reconstruction/vitest.config.ts
pnpm exec tsc -p tests/security/reconstruction/tsconfig.json --noEmit
pnpm exec vitest run --config tests/security/reconstruction/vitest.config.ts
pnpm exec tsc -p tests/e2e/reconstruction/tsconfig.json --noEmit
pnpm exec playwright test --config tests/e2e/reconstruction/playwright.config.ts
```

Generate and verify the orchestrator-owned iOS project, then run the merged scheme on an installed simulator:

```sh
cd apps/ios-capture
xcodegen generate --spec project.yml
git diff -- HomeDesignCapture.xcodeproj/project.pbxproj
xcodebuild -project HomeDesignCapture.xcodeproj -scheme HomeDesignCapture \
  -destination 'platform=iOS Simulator,name=iPhone Air,OS=latest' \
  -derivedDataPath .build/C8DerivedData CODE_SIGNING_ALLOWED=NO test
```

Run the real web journey only with a live integrated stack and non-sensitive test session:

```sh
C8_LIVE_RECONSTRUCTION_URL=http://localhost:3000 \
pnpm exec playwright test --config tests/e2e/reconstruction/playwright.live.config.ts
```

The live specification can create its own local fixture session and tenant project through the real BFF/API. `C8_LIVE_RECONSTRUCTION_PATH` and `C8_LIVE_RECONSTRUCTION_STORAGE_STATE` remain optional overrides for an already-provisioned non-sensitive test project/session.

Finally run the repository gate:

```sh
UV_CACHE_DIR=.cache/uv pnpm verify
git diff --check
```

The live commands must record whether database/API/storage/worker, FFmpeg, L3 geometry tools, browser, simulator, physical device, and Windows/NVIDIA were actually exercised. Skips and missing hardware remain `NOT RUN`.

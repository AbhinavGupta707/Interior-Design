# C8-L4 orchestrator integration

## Required composition after lane merge

This lane does not own worker registration, durable job code, shared TypeScript contracts, native project generation, or web routes. The orchestrator must perform these steps after L3, L2, and L1 are merged.

1. Register `NeuralAppearanceAdapter.discover()` and `GsplatAppearanceAdapter.discover()` in the inference worker's official adapter discovery path. Expose unavailable registrations as bounded provider/hardware state; do not hide the feature and do not debug permissions until registration is present.
2. Compose `c8-neural-appearance-input-v1` only inside the trusted worker from the exact accepted prepared manifest, L3 camera manifest/artifact, L3 geometry result, durable job/project/attempt, method, and current rights decision. Do not add a public route accepting this envelope.
3. Resolve sanitized frame storage through the worker's narrow tenant-scoped storage credential. Pass the private direct-child mapping as `TrustedStagedFrames`; never place paths, keys, URLs, or credentials in the manifest, log, result, retry record, or API.
4. Supply cancellation and a final atomic publication fence covering tenant, project, job, attempt, optimistic version, terminal state, rights withdrawal, and cancellation. The `ArtifactPublisher` must synchronously store the artifact and immutable appearance manifest only after that fence. Retry creates a new attempt; a late old worker cannot publish.
5. Keep geometry and appearance as distinct shared results. Never feed a Nerfstudio checkpoint, radiance field, exported mesh, or splat back into the geometry or C5 canonical mutation path.
6. Add the C8 XCUITest source through the orchestrator-owned XcodeGen step after the C8-L2 fixture state/identifiers are present. Do not weaken the tests to make missing producer state pass.
7. Point the live Playwright journey at the real L1 web/BFF/API/worker stack and expand the opt-in test with producer-confirmed stable identifiers for source selection, consent, cancel/retry, and result diagnostics.

## Producer mapping to confirm

| L4 field              | Required producer fact                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `prepared`            | exact accepted `c8-media-preparation-v1`; zero `review-required` frames                           |
| `cameras`             | strict L3 camera schema, one pose/intrinsics record per registered sanitized frame                |
| `geometry`            | exact `c8-geometry-result-v1`, proposal-only inputs, explicit unit/scale/components/residual      |
| `rights`              | current service-processing approval and fixed training denial, rechecked before lease and publish |
| `attempt`             | durable fenced attempt 1–3                                                                        |
| `TrustedStagedFrames` | private direct-child image files whose SHA-256 equals the prepared manifest                       |
| publisher             | storage adapter that does not return/log a key, URL, path, payload, or credential                 |

If L3's camera artifact shape differs from `c8-calibrated-cameras-v1`, adapt it in the orchestrator-owned trusted composition layer or transfer an exact L4 file for an agreed schema update. Do not weaken the parser or accept arbitrary tool output.

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
C8_LIVE_RECONSTRUCTION_URL=http://127.0.0.1:3000 \
C8_LIVE_RECONSTRUCTION_PATH=/reconstruction \
C8_LIVE_RECONSTRUCTION_STORAGE_STATE=/tmp/c8-owner-storage-state.json \
pnpm exec playwright test --config tests/e2e/reconstruction/playwright.live.config.ts
```

Finally run the repository gate:

```sh
UV_CACHE_DIR=.cache/uv pnpm verify
git diff --check
```

The live commands must record whether database/API/storage/worker, FFmpeg, L3 geometry tools, browser, simulator, physical device, and Windows/NVIDIA were actually exercised. Skips and missing hardware remain `NOT RUN`.

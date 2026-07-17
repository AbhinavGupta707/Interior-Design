# C8 independent reconstruction acceptance

## Evidence classes

Every observation is exactly one of:

- `synthetic-reference`: deterministic, rights-cleared, self-contained reference behavior;
- `live-runtime`: an actual named tool/provider/hardware run with an exact tool-manifest hash; or
- `not-run`: no runtime claim; latency, memory, and tool-manifest hash must be null.

Reports with no attempted observations are `NOT_RUN`. Mixed synthetic/live inputs are `MIXED_EVIDENCE`, never silently promoted to live. All reports set `representativeAccuracyClaim: false`; a C8 code gate is not survey-grade or production-capacity evidence.

## Required dataset record

The evaluator rejects customer data, missing licence, missing dataset identifier, training permission other than denied, and a rights basis other than public-domain or licensed. Split is explicit (`development` or `holdout`). The lane fixture is visibly synthetic and public-domain; it is a reference model, not a camera, room, neural training, or provider run.

## Metrics and denominators

The reference evaluator reports:

| Metric                      | Definition                                                         |
| --------------------------- | ------------------------------------------------------------------ |
| Registered-frame coverage   | sum registered / sum input over attempted cases, millionths        |
| Failure rate                | failed plus abstained / attempted cases, millionths                |
| Severe-error rate           | severe errors / attempted cases, millionths                        |
| Partial/disconnected counts | explicit result status and component count; never hidden           |
| Scale counts                | exact `metric-validated`, `metric-estimated`, and `unknown` counts |
| Alignment residual          | p50/p90/p95/max micrometres only where recorded                    |
| Geometric error             | p50/p90/p95/max micrometres only where independent truth exists    |
| Latency                     | p50/p90/p95/max milliseconds for attempted observations            |
| Peak memory                 | p50/p90/p95/max bytes for attempted observations                   |

`not-run` cases remain in the total/not-run denominator and never contribute zero-valued successes. Validated metric scale without a residual is rejected. Geometric error without truth is rejected. Duplicate case IDs, invalid safe codes, negative/non-integer values, registered frames above inputs, completed results without component/scale diagnostics, and attempted results without a 64-hex tool-manifest hash are rejected.

## Independent suites

```sh
pnpm exec tsc -p tests/evaluation/reconstruction/tsconfig.json --noEmit
pnpm exec vitest run --config tests/evaluation/reconstruction/vitest.config.ts

pnpm exec tsc -p tests/security/reconstruction/tsconfig.json --noEmit
pnpm exec vitest run --config tests/security/reconstruction/vitest.config.ts

UV_CACHE_DIR=.cache/uv uv run pytest -q \
  services/inference-worker/test/reconstruction/nerfstudio \
  services/inference-worker/test/reconstruction/gsplat

pnpm exec tsc -p tests/e2e/reconstruction/tsconfig.json --noEmit
pnpm exec playwright test --config tests/e2e/reconstruction/playwright.config.ts
```

The security suite independently exercises tenant/project reference behavior, viewer mutation denial, rights withdrawal, training denial, path/URL/flag/shell fields, manifest depth/array limits, cancellation/retry fences, stale publication, telemetry redaction, output authority, and forbidden canonical/C5 coupling. Static tests also inspect the production adapter source for shell use, forbidden public storage fields, fixed commands, and authority strings.

The browser suite uses a local, network-isolated, visibly synthetic server and covers desktop, mobile, keyboard-only, owner/viewer, completed, partial, disconnected, unknown-scale, unavailable/error, offline, cancellation, replacement-attempt, and appearance-versus-geometry states. Passing it is presentation evidence only. The live L1/L2/L3 journey is opt-in and remains skipped until the orchestrator supplies the integrated URL and session state.

The XCUITest file similarly skips with an explicit `NOT RUN` message until C8-L2 registers its fixture producer and identifiers. Simulator presentation cannot prove camera permission prompts, sensor capture, RGB-D, interruption under real hardware pressure, background transfer, or physical-device accessibility.

## Acceptance rule

A reviewer may accept this lane when source checks and fixture suites pass, the live-runtime fields remain honestly classified, and integration gaps are named. Closing Windows/NVIDIA, physical iOS, representative accuracy, or integrated BFF/API/worker evidence requires the corresponding real run; no fixture substitution is permitted.

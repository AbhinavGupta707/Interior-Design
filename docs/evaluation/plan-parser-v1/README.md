# C6 plan-parser v1 independent evidence pack

## Evidence status

This pack evaluates the frozen `c6-plan-parser-input-v1` and `c6-plan-proposal-v1` boundary without implementing or importing producer or correction-UI code. Its checked fixtures are synthetic and creator-dedicated under CC0-1.0. Service processing is allowed only for local CI evaluation, security testing and UI acceptance; model training is denied on every fixture.

The reference baseline is deliberately failure-inclusive: one of ten declared in-box holdout plans abstains for low confidence. That abstention remains in the denominator, producing exactly 90% accepted-input coverage. Six of six hard negatives abstain. This is independent reference-harness evidence, not a parser-producer, API, database, live UI, customer-home or survey claim.

## Fixture inventory and isolation

The test-fixture source contains:

- two development/validation fixtures;
- ten in-box holdout SVG/PDF/PNG fixtures with independent straight-wall truth;
- six holdout hard negatives: reflected ceiling plan, section, curved freehand sketch, perspective JPEG, multi-level overlay and furniture-only sheet; and
- thirteen adversarial holdouts covering SVG DTD/entity/script/style/event/external resources, PDF JavaScript/launch/embedded file/external URI, raster pixel bomb/truncation/polyglot and prompt-like text.

Every fixture object carries its SHA-256, creator, origin, licence, right, allowed purpose, split, service-processing consent, training denial and exact synthetic tenant/project/asset/object-key scope. Unit tests recompute every hash and reject duplicate bytes or identifiers. Holdouts live only under `packages/test-fixtures/src/plans/holdout/`, are not exported from the fixture package, and a repository scan fails if parser, workflow or worker producer source imports them.

## Reproducible reference result

The independent fixture adapter and evaluator produce this result on the frozen holdout denominator:

| Measure                  |                       Reference result |                                        Frozen gate | Status                                 |
| ------------------------ | -------------------------------------: | -------------------------------------------------: | -------------------------------------- |
| In-box accepted coverage |                             9/10 = 90% |                                       at least 90% | passed                                 |
| Hard-negative abstention |                             6/6 = 100% |                                               100% | passed                                 |
| Severe errors            |                                      0 |                                                  0 | passed                                 |
| Cross-scope violations   |                                      0 |                                                  0 | passed                                 |
| Wall endpoint P90        |                                  35 mm |                                      at most 50 mm | passed                                 |
| Opening-centre P90       |                                  42 mm |                                      at most 75 mm | passed                                 |
| Calibration residual P90 |                                  14 mm |                                      at most 25 mm | passed                                 |
| Confidence ECE           |  0.12000000000000004 across 45 samples |              at most 0.15 with at least 20 samples | passed                                 |
| Observed wall time       | median 36 ms; P90 57 ms; maximum 60 ms |                                  maximum 30,000 ms | passed for this reference harness only |
| Observed CPU             |                median 24 ms; P90 38 ms |                                   observation only | not a production-scale claim           |
| Observed peak memory     |              median 33 MiB; P90 39 MiB |                                   observation only | not a production-scale claim           |
| Human correction time    |       no rights-approved human samples | 8-minute median / 15-minute P90 provisional target | **not measured**                       |

The report includes ten confidence bands and risk/coverage at confidence thresholds 0, 60, 75 and 90. At threshold 60 the reference sample has 80% coverage and zero observed error; at threshold 90 it has 40% coverage and zero observed error. These are synthetic sample observations, not population estimates.

The CLI emits the complete deterministic JSON report, including all 16 source hashes, distributions, gates, risk/coverage and promotion reasons:

```sh
node --import ./services/platform-api/node_modules/tsx/dist/loader.mjs tests/evaluation/plan-parsing/report-cli.ts
```

The report always marks promotion ineligible because an independent reference fixture adapter is not producer/live evidence and automated correction timing cannot establish human correction minutes.

## Exact verification commands

Run from the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @interior-design/test-fixtures typecheck
pnpm --filter @interior-design/test-fixtures test:unit
pnpm exec tsc -p tests/evaluation/plan-parsing/tsconfig.json --noEmit
pnpm exec vitest run --config tests/evaluation/plan-parsing/vitest.config.ts --reporter=verbose
pnpm exec tsc -p tests/security/plan-processing/tsconfig.json --noEmit
pnpm exec vitest run --config tests/security/plan-processing/vitest.config.ts --reporter=verbose
pnpm exec tsc -p tests/e2e/plan-processing/tsconfig.json --noEmit
pnpm exec playwright test --config tests/e2e/plan-processing/playwright.config.ts
pnpm exec playwright test --config tests/e2e/plan-processing/playwright.live.config.ts
pnpm format:check
git diff --check
```

The standalone Playwright command runs seven reference-harness journeys at 1440×960, 390×844 and keyboard-only desktop sizes. It covers valid overlay/calibration/correction/C5 handoff, viewer read-only behavior, explicit abstention/manual fallback, cancellation/retry/refresh and stale-head recovery. Every journey rejects unexpected console warnings/errors, page errors, failed requests, external network requests, HTTP failures and horizontal overflow. Passing it proves the acceptance harness, not the C6 producer or live web app.

The live Playwright config runs two tests that skip by name when `C6_LIVE_PLAN_URL` is unset. A skip is reported as `NOT RUN` and is never combined with the seven reference-harness passes.

## Producer/live opt-ins

Producer observations use the strict independent observation codec and remain off by default:

```sh
C6_PRODUCER_OBSERVATIONS=/absolute/path/to/producer-observations.json \
C6_PRODUCER_MANIFEST_SHA256=<64-lowercase-hex> \
pnpm exec vitest run --config tests/evaluation/plan-parsing/vitest.config.ts --reporter=verbose
```

Live unauthenticated disclosure smoke:

```sh
C6_LIVE_SECURITY_URL=http://127.0.0.1:3001 \
pnpm exec vitest run --config tests/security/plan-processing/vitest.config.ts --reporter=verbose
```

Live web smoke at desktop and mobile sizes:

```sh
C6_LIVE_PLAN_URL=http://127.0.0.1:3000 \
C6_LIVE_PLAN_PATH=/projects/<synthetic-project-id>/plan-import \
C6_LIVE_PLAN_STORAGE_STATE=/absolute/path/to/synthetic-session.json \
pnpm exec playwright test --config tests/e2e/plan-processing/playwright.live.config.ts
```

Opt-ins must use only synthetic seeded identities and sources. Tokens, signed URLs, object keys, source bytes, extracted text and parser stderr must not be placed in reports or command history.

## Limitations

- No C6 producer, API, database, workflow, inference worker or live correction UI existed in this isolated lane and none was edited.
- No paid provider, API key, outbound inference, cloud credential, GPU, customer plan, real address or human correction study was used.
- CPU and memory values describe a deterministic fixture adapter, not PDF/SVG/raster production processing capacity.
- The standalone HTML workspace is a QA acceptance oracle only. It cannot close the production-shaped browser gate.
- The PDF, SVG and raster cases are deliberately small synthetic attack and geometry examples; they do not establish accuracy on real homes or survey fitness.
- A producer/live test that is skipped contributes no evidence and blocks any claim that the corresponding live gate passed.

Promotion requirements are defined in [promotion-rules.md](./promotion-rules.md).

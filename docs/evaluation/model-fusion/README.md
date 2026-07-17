# C9 independent model-fusion acceptance

## Evidence status

This pack is producer-independent and visibly synthetic. It evaluates exact repository-created truth and a deterministic reference adapter. It does not import the C9 registration kernel, semantic fitter, platform API, spatial worker or web product. A static isolation test scans production roots and fails if a producer imports or identifies these C9 fixtures.

Passing this pack proves the evaluation, security and presentation boundaries only. It does **not** prove a live C9 producer, live API/database/worker composition, representative-home accuracy, survey fitness, physical RoomPlan capture, COLMAP/Open3D execution, GPU/CUDA execution, provider behavior or human correction economics.

## Rights and source manifest

Every fixture is generated in the repository, marked `visiblySynthetic: true`, creator-dedicated under CC0-1.0 and limited to local CI evaluation, security testing and UI acceptance. Service processing consent is true. Training use is independently fixed to `denied`. No customer data, address, image, video, captured room, device identifier, provider output, credential, local path, object key or signed URL is present.

Every plan, RoomPlan, reconstruction, measurement and attributable-assertion source has:

- a unique source and immutable reference ID;
- an exact source schema version and SHA-256;
- evidence, coordinate-frame and scale status;
- its own rights record; and
- exact integer transform truth in millimetres, microdegrees and parts per million.

Assertion-only sources are explicitly ineligible as single-source geometry baselines. One assertion-only fixture verifies honest abstention.

## Deterministic dataset

| Fixture                                | Sources                       | Condition                                                                | Required disposition   |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ | ---------------------- |
| `c9-synthetic-complementary-two-floor` | all five kinds                | complementary partial observations across two floors                     | meaningful improvement |
| `c9-synthetic-scale-level-drift`       | all five kinds                | RoomPlan/reconstruction scale drift, level drift and dimension conflict  | meaningful improvement |
| `c9-synthetic-missing-extra-outlier`   | all five kinds                | missing and extra geometry, topology conflict, outlier and occluded area | meaningful improvement |
| `c9-synthetic-disconnected-occluded`   | all five kinds                | two visible components and two regions that must remain unknown          | meaningful improvement |
| `c9-synthetic-degenerate-collinear`    | plan, RoomPlan, measurement   | rank-deficient collinear free-similarity anchors                         | honest abstention      |
| `c9-synthetic-reflection`              | plan, reconstruction, measure | orientation-reversing reconstruction                                     | honest abstention      |
| `c9-synthetic-assertion-only`          | two assertion sets            | insufficient distinct/evidence-establishing source kinds                 | honest abstention      |

Seven additional adversarial fixtures encode collinear anchors, reflection, non-finite injection, coordinate overflow, duplicate references, path injection and signed-URL injection. Security tests inject actual non-finite values at runtime; the committed fixture representation remains deterministic JSON-safe data.

Truth contains exact two-floor room dimensions, topology edges, supported coverage regions, source-to-project transforms, expected component count, required discrepancy kinds and occluded regions that must remain unknown. Source candidates deliberately contain scale/level drift, missing coverage, conflicting dimensions/topology, an unsupported extra shed, a transform outlier, a disconnected component, one abstention and one failure.

## Evaluator boundary

The adapter seam emits one observation per declared fixture. Each observation must carry the exact adapter ID/version, fixture manifest hash, every eligible single-source candidate, source reference hash and one fused candidate. The evaluator rejects:

- missing or duplicate eligible baselines;
- unknown/duplicate fixture observations;
- fixture/source hash substitution;
- rights or training-policy changes;
- non-integer, non-finite or over-budget observations;
- duplicate rooms, topology, coverage, unknown or discrepancy entries;
- invalid correction clocks and resource observations; and
- source/transform sets that do not exactly match the frozen fixture.

Missing fixture observations remain in the expected denominator. Failed and abstained single-source candidates remain in the eligible-source denominator. An observation cannot become a zero-valued success.

## Running the pack

From the repository root after a frozen install:

```sh
pnpm --filter @interior-design/test-fixtures typecheck
pnpm --filter @interior-design/test-fixtures test:unit

pnpm exec tsc -p tests/evaluation/model-fusion/tsconfig.json --noEmit
pnpm exec vitest run --config tests/evaluation/model-fusion/vitest.config.ts --reporter=verbose
node --import ./services/platform-api/node_modules/tsx/dist/loader.mjs \
  tests/evaluation/model-fusion/report-cli.ts

pnpm exec tsc -p tests/security/model-fusion/tsconfig.json --noEmit
pnpm exec vitest run --config tests/security/model-fusion/vitest.config.ts --reporter=verbose

pnpm exec tsc -p tests/e2e/model-fusion/tsconfig.json --noEmit
pnpm exec playwright test --config tests/e2e/model-fusion/playwright.config.ts

pnpm format:check
git diff --check
```

The Playwright command starts a network-isolated local mock. Nine Chromium journeys cover 1440×960 desktop, 390×844 mobile and keyboard-only desktop. They exercise create/progress/cancel/retry; full, partial, disconnected and abstained results; claims/residuals; all five decisions; stale/offline/error/viewer states; exact draft pinning; zero direct mutation; focus; overflow; and unexpected console, page, HTTP, request or external-network failures.

## Interpretation and limitations

The deterministic report may pass the lane acceptance rule while `promotion.eligible` remains false. Producer-live observations must be collected after C9 producers merge, using exact adapter/tool/config/source hashes and the same failure-inclusive schema. Live PostGIS/API/worker/browser evidence is outside this isolated lane.

Human correction time is **NOT MEASURED** because no rights-approved human study occurred. The reference adapter records automated action count and monotonic automated review duration only; those milliseconds must never be relabelled as human minutes.

Physical iPhone/iPad, RoomPlan accuracy, real C8 COLMAP/Open3D, neural/GPU/CUDA, representative properties, providers and human evidence remain **NOT RUN**. Synthetic fixtures cannot promote those gates.

See [metrics-and-promotion.md](./metrics-and-promotion.md) for exact formulas and [reference-result-2026-07-17.md](./reference-result-2026-07-17.md) for the current deterministic result.

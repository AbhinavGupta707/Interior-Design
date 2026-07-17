# C5 operation invariant evaluation

## Purpose and proof policy

This is the independent C5-L4 acceptance pack for `c5-model-operation-v1`. It deliberately has
three evidence tiers:

1. **Reference evidence** runs on the frozen C5 base with an independently implemented reducer and
   in-memory transactional branch model. It proves that the acceptance oracle and adversarial cases
   are executable; it does not prove the C5 producer.
2. **Mock rendered evidence** runs a standalone accessible editor harness at 1440×960, 390×844 and
   keyboard-only sizes. It proves the journeys and assertions are executable; it does not prove the
   integrated editor, BFF, API or database.
3. **Producer/live evidence** is explicitly opt-in after C5-L1/L2/L3 integration. A skipped test is
   `NOT RUN`, never a pass and never checkpoint evidence.

The lane was authored from exact base `c5223e56153efb9022821c285334574cac2af26a`. That base has
registered but intentionally empty `model-operations` and `editor-core` packages. No producer or
editor path was edited to manufacture a pass.

## Invariant and evidence matrix

| Frozen invariant                                                                                                                          | Executable reference/mock evidence                                                                                                                                      | Required producer/live evidence                                                                               | Status on isolated base                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Registry is exactly eight public v1 operations plus internal initialise/restore                                                           | `reference-reducer.test.ts` compares the full ten-type shared registry and reduces every public type                                                                    | Producer adapter publishes the same ordered public registry; live API previews all eight                      | **REFERENCE PASS**; producer/live **NOT RUN**             |
| Unknown versions/types, extra authority, non-integer/zero/out-of-range units, malformed IDs and unsafe collection/field paths fail closed | Schema/adversarial tables cover v2, delete, extra tenant, fractional/zero/overflow translation, path-like IDs, `__proto__` and `constructor`                            | Live API sends the same malformed bodies and requires `400` with no state change                              | **REFERENCE PASS**; live **NOT RUN**                      |
| Missing level/wall/space/host references and duplicate element/command IDs fail closed                                                    | Reference reducer checks global IDs and typed references; preview schema and reducer reject duplicate client IDs                                                        | Producer parity and live API/database checks after integration                                                | **REFERENCE PASS**; producer/live **NOT RUN**             |
| Reduction is pure and never mutates caller input                                                                                          | Every public operation and generated batch compares the frozen source before/after                                                                                      | Producer adapter parity repeats the same immutability checks                                                  | **REFERENCE PASS**; producer **NOT RUN**                  |
| Ordered reduction is deterministic; dependencies are never silently reordered                                                             | Level-then-wall succeeds, reversed order fails; a fixed-seed 50-operation batch equals one-by-one replay hash                                                           | Producer adapter and live API preview hashes                                                                  | **REFERENCE PASS**; producer/live **NOT RUN**             |
| Canonical replay reaches the pinned hash and altered history fails closed                                                                 | Reference store replays after each commit; ordinal gaps and altered commit hashes are rejected                                                                          | Live database/API history replay against stored hashes                                                        | **REFERENCE PASS**; live **NOT RUN**                      |
| Branches remain isolated by tenant/project/model/profile and exact source snapshot                                                        | Two branches from one source diverge independently; stable-ID comparison reports only the changed room                                                                  | Live API foreign/unknown parity and profile-specific branches                                                 | **REFERENCE PASS**; live **NOT RUN**                      |
| Restore creates new immutable history rather than rewriting a prior revision                                                              | Restore increments revision, persists a second snapshot/commit and records `snapshot.restore.v1`; replay returns source hash                                            | Live restore route plus operation/audit/database rows                                                         | **REFERENCE PASS**; live **NOT RUN**                      |
| Every commit persists exactly one snapshot                                                                                                | Eight sequential commits assert eight commit snapshots; restore retains the same cadence                                                                                | Live Postgres joins branch, commit and snapshot rows                                                          | **REFERENCE PASS**; live **NOT RUN**                      |
| Preview is non-mutating                                                                                                                   | Branch head, commit, snapshot, operation, audit and outbox evidence are identical before/after preview; only bounded preview metadata increases                         | Live database counts before/after preview                                                                     | **REFERENCE PASS**; live **NOT RUN**                      |
| Idempotent exact repeats have one effect; body/action/actor reuse conflicts                                                               | Branch replay returns one branch; changed body, action or actor returns `IDEMPOTENCY_CONFLICT`                                                                          | Live branch/commit repeat and changed-body `409`                                                              | **REFERENCE PASS**; live **NOT RUN**                      |
| Stale and racing commits never auto-merge                                                                                                 | Two actors preview the same head; exactly one commit succeeds and the loser receives current revision/hash plus four bounded recovery actions                           | Live concurrent HTTP commits require one success and one `409`                                                | **REFERENCE PASS**; live **NOT RUN**                      |
| Snapshot, operation, commit, audit, outbox and head update atomically                                                                     | Injected failures at snapshot, operations, audit and outbox leave all domain evidence unchanged                                                                         | Live Postgres proves all rows for one commit and immutable triggers inside rollback-only probes               | **REFERENCE PASS**; live **NOT RUN**                      |
| Outbox is bounded and contains no snapshot body                                                                                           | Reference outbox retains IDs/type/version/hash only                                                                                                                     | Live Postgres rejects `elements`/`coordinateSystem` in retained outbox rows                                   | **REFERENCE PASS**; live **NOT RUN**                      |
| Operation history is deterministic and cursor-paginated at maximum 100                                                                    | Three 50-operation commits produce pages 100 + 50; invalid/unsafe cursors and limit 101 fail                                                                            | Live API requests page 25 and rejects 101                                                                     | **REFERENCE PASS**; live **NOT RUN**                      |
| Viewer is read/history/compare only; foreign resources do not disclose existence                                                          | Reference role/tenant matrix denies mutation and uses one `NOT_FOUND` shape                                                                                             | Live owner/editor/viewer/foreign tokens exercise the same routes                                              | **REFERENCE PASS**; live **NOT RUN**                      |
| Integrated product has no raw snapshot amendment route                                                                                    | No producer claim is made from the isolated base                                                                                                                        | Live owner POST to the old snapshot route must return `404/405`; initialise/restore must appear as operations | **NOT RUN** until integration                             |
| Branch, wall move, opening insertion, rename, bounded undo/redo, warning/error preview and explicit commit are accessible                 | Standalone Playwright desktop journey exercises all states and warning acknowledgement/error blocking                                                                   | Integrated Playwright and in-app Browser repeat against the real BFF/API/database                             | **MOCK PASS**; integrated **NOT RUN**                     |
| Viewer, two-session conflict recovery, compare and restore are honest                                                                     | Mock journey preserves pending intent across a real HTTP `409`, then compares, reapplies, commits and removes viewer mutation controls                                  | Two authenticated live sessions plus stored revision/history/audit hashes                                     | **MOCK PASS**; integrated **NOT RUN**                     |
| Responsive and keyboard journeys have no page overflow or pointer-only dependency                                                         | Playwright runs 1440×960, exact 390×844 and keyboard-only numeric wall/opening/rename/undo/redo/commit                                                                  | Integrated Chrome/in-app Browser at both sizes                                                                | **MOCK PASS**; integrated **NOT RUN**                     |
| Console/network failures and framework/blank-page states are visible                                                                      | Mock runs assert page identity, meaningful DOM, console, failed requests, unexpected responses and horizontal overflow; only the expected conflict `409` is allowlisted | Integrated runs require no unexplained warning/error or broken request                                        | **MOCK PASS**; integrated **NOT RUN**                     |
| Representative reducer/editor work remains responsive without a scale claim                                                               | Reference model processes 200 ordered operations/10 commits under a loose 5 s local regression ceiling; Playwright interactions use normal action timeouts              | Record live preview/commit latency and rendered responsiveness after integration                              | **REFERENCE/MOCK PASS**; production scale **NOT CLAIMED** |

## Default runnable commands

These commands need no producer, provider, database, GPU or native hardware:

```sh
pnpm exec tsc -p tests/geometry/operations/tsconfig.json --noEmit
pnpm exec vitest run --config tests/geometry/operations/vitest.config.ts
pnpm exec tsc -p tests/integration/model-operations/tsconfig.json --noEmit
pnpm exec vitest run --config tests/integration/model-operations/vitest.config.ts
pnpm exec tsc -p tests/e2e/editor-operations/tsconfig.json --noEmit
pnpm exec playwright test --config tests/e2e/editor-operations/playwright.config.ts
git diff --check
```

Playwright writes screenshots, traces and results only below `/tmp`; no generated evidence is
committed. Its standalone page visibly says that mock results are not producer proof.

## Producer reducer conformance (opt-in)

The producer adapter must be an absolute ESM file path exporting `default` or `producerAdapter`:

```ts
interface ProducerAdapter {
  readonly operationTypes: readonly string[];
  reduce(
    snapshot: CanonicalHomeSnapshot,
    operations: readonly ModelOperationRequest[],
  ):
    | { readonly snapshot: CanonicalHomeSnapshot; readonly snapshotSha256: string }
    | Promise<{ readonly snapshot: CanonicalHomeSnapshot; readonly snapshotSha256: string }>;
}
```

Run only after C5-L1 integration:

```sh
C5_RUN_PRODUCER_INTEGRATION=1 \
C5_PRODUCER_ADAPTER_PATH=/absolute/path/to/c5-producer-adapter.mjs \
pnpm exec vitest run --config tests/geometry/operations/vitest.config.ts
```

The adapter is intentionally outside producer ownership. Missing enablement or adapter produces
named skips and no producer credit.

## Live authenticated API (opt-in)

Run only against a loopback C5 API seeded with the retained C4 synthetic snapshot. Required values
are `C5_LIVE_API_URL`, `C5_LIVE_PROJECT_ID`, `C5_LIVE_PROFILE`,
`C5_LIVE_SOURCE_SNAPSHOT_ID`, `C5_LIVE_SOURCE_SNAPSHOT_SHA256`, owner/editor/viewer tokens, and a
foreign project/token. Then set:

```sh
C5_RUN_LIVE_API=1 \
C5_LIVE_SOURCE_IS_C4_FIXTURE=1 \
pnpm exec vitest run --config tests/integration/model-operations/vitest.config.ts
```

Tokens belong only in the child environment. The suite never prints or persists them.

## Live Postgres atomicity and immutable-trigger probe (opt-in)

In addition to the live API variables, provide `C5_LIVE_DATABASE_URL` and the exact integrated table
mapping:

- `C5_DB_BRANCH_TABLE`
- `C5_DB_SNAPSHOT_TABLE`
- `C5_DB_COMMIT_TABLE`
- `C5_DB_OPERATION_TABLE`
- `C5_DB_AUDIT_TABLE`
- `C5_DB_OUTBOX_TABLE`
- `C5_DB_AUDIT_BRANCH_COLUMN`
- `C5_DB_OUTBOX_BRANCH_COLUMN`

Then run with `C5_RUN_LIVE_POSTGRES=1`. Identifiers are restricted to lower-case SQL identifiers.
Update/delete immutability probes always run inside transactions that roll back whether a trigger
blocks the statement or the test detects a missing trigger. A successful run proves one synthetic
commit has exactly one branch head/commit/snapshot, the expected ordered operations, audit and
outbox rows, bounded outbox content, and immutable operation/commit triggers.

## Integrated editor and Browser gate (opt-in)

`playwright.live.config.ts` never starts a mock server. Set `C5_LIVE_EDITOR_URL`,
`C5_LIVE_EDITOR_PATH`, and optionally `C5_LIVE_EDITOR_STORAGE_STATE`, then explicitly set
`C5_RUN_LIVE_EDITOR=1`:

```sh
C5_RUN_LIVE_EDITOR=1 \
C5_LIVE_EDITOR_URL=http://127.0.0.1:3000 \
C5_LIVE_EDITOR_PATH=/editor/<synthetic-project-id> \
pnpm exec playwright test --config tests/e2e/editor-operations/playwright.live.config.ts
```

The live Playwright file is a registration/accessibility smoke, not the complete user gate. After
L1-L3 integration, the orchestrator must repeat the desktop, mobile, keyboard, viewer and
two-session journeys against production-shaped BFF/API/Postgres state, then use the in-app Browser
to connect visible branch/revision/history/compare state to stored snapshot/operation/audit hashes
and inspect redacted API logs. Until those steps run, the corresponding matrix cells remain
`NOT RUN` regardless of reference or mock passes.

## Boundaries and limitations

- All fixtures are synthetic; the pack contains no customer, address, token or provider data.
- Reference canonical hashing and geometry validation reuse the accepted C4 kernel, while every C5
  operation reducer, branch transaction and replay model in this lane is independently implemented.
- The mock editor is not a claim about C5-L3 design fidelity or integrated behavior.
- Live table names are mapped after integration because the frozen contract defines semantics, not
  physical SQL identifiers. Requiring explicit mapping avoids guessing a schema and reporting a
  false pass.
- No Xcode, physical device, GPU, reconstruction, 3D or professional-certification gate applies to
  C5.

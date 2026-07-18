# C12-L4 design-option UX acceptance evidence

Date: 2026-07-18

Activation: `44fc5da` (frozen prelude `fbcd082`)

Lane: C12-L4, design-option UX and independent acceptance

## Evidence boundary

This pack validates the C12 web workspace and BFF against deterministic, creator-owned synthetic fixtures. The fixtures contain no customer data, provider calls, external keys, GPU work, training permission, or inferred interior facts. Browser observations below are **synthetic fixture presentation evidence**, not a live C12 backend result and not production-composed evidence.

The UI separately supports the `production-composed` label for responses assembled through the real authenticated BFF. No such backend was available to this isolated lane, so that classification was not exercised here.

## Automated acceptance results

| Surface                                     | Command                                                                                                               | Result                   | Evidence class                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| Web type safety                             | `pnpm --filter @interior-design/web typecheck`                                                                        | PASS                     | Static analysis                               |
| Web lint                                    | `pnpm --filter @interior-design/web lint`                                                                             | PASS                     | Static analysis                               |
| C12 web unit/BFF/semantics/recovery/client  | `pnpm --filter @interior-design/web exec vitest run test/design-options`                                              | PASS, 5 files / 23 tests | Synthetic fixtures                            |
| Independent evaluation/security/performance | `pnpm exec vitest run tests/evaluation/design-options tests/security/design-options tests/performance/design-options` | PASS, 3 files / 14 tests | Synthetic fixtures / static source inspection |
| E2E config type safety                      | `pnpm exec tsc -p tests/e2e/design-options/tsconfig.json --noEmit`                                                    | PASS                     | Static analysis                               |
| Cross-browser and responsive E2E            | `pnpm exec playwright test --config tests/e2e/design-options/playwright.config.ts`                                    | PASS, 12 tests           | Synthetic local BFF/backend fixtures          |

The Playwright pack covers authenticated owner confirmation, viewer read-only behavior, stale confirmation rejection, abstention, empty/error/cancel/retry recovery, exact computational scope, no canvas dependency, and page-level overflow at 390px. The configured engines are Chromium, Firefox, and WebKit at 1440×960 or 390×844 as applicable. It also asserts that confirmation changes neither existing nor as-built profiles.

After request/response size bounds, exact response-identity matching, and the upstream timeout were added to the BFF, the 18-test BFF/unit pack passed. A subsequent synthetic matrix run passed 11 tests; its first Chromium workflow remained in the valid loading state beyond the original 10-second cold-development-compile assertion window. The assertion window was raised to 20 seconds. A final matrix rerun was stopped at the orchestrator's request because the prior complete matrix, post-hardening unit pack, and independent browser observation were accepted as sufficient evidence. This is not production-backend evidence.

## In-app browser observation

The local app was composed with `C12_OPTION_EVIDENCE_CLASSIFICATION=synthetic-fixture` and the deterministic mock C12 service. A separately controlled Codex in-app browser completed local fixture sign-in and opened the design-option workspace.

- Desktop observed title: `Design options · Home Design Studio | Home Design Studio`
- Desktop observed heading: `Compare what actually changes`
- Desktop page-level horizontal overflow: `0px`
- Mobile requested viewport: `390×844`; observed document client width `375px` including browser scrollbar allocation
- Mobile page-level horizontal overflow: `0px`
- Canvas count: `0`
- Browser console errors: `0`
- Visible evidence label: `Synthetic fixture presentation`

Screenshots were stored as disposable local QA artifacts in `/tmp/c12-design-options-desktop.png` and `/tmp/c12-design-options-mobile.png`; they are intentionally not production evidence and are not committed.

## Security and semantics assertions

- The BFF accepts only the frozen eight C12 routes and validates UUID path segments, strict bodies, exact path/body pins, idempotency keys, upstream status, and upstream response schemas.
- Authentication is cookie-derived; request bodies cannot supply actor, role, tenant, or access tokens.
- Viewer confirmation is disabled in the UI and rejected by the server boundary. Foreign access is represented as safe not-found behavior.
- Upstream error detail is reduced to bounded safe copy. No raw private body, token, or secret is logged or returned.
- Narrative-only rewrites fail the independent-difference check. Accepted pairs differ in asset inventory, assignments, placements, materials, and typed operation semantics.
- Confirmation is explicit, uses the exact displayed source/job/option pins, and produces one isolated proposed branch. It cannot mutate existing or as-built state.

## Not run / not measured

| Evidence                                                                     | Status                | Reason                                                                    |
| ---------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------- |
| Live C12 backend or sibling-lane integration                                 | NOT RUN               | Isolated lane; no merged C12 provider/backend implementation was consumed |
| Production-composed option evidence                                          | NOT RUN               | No live C12 backend was available                                         |
| External model/provider quality                                              | NOT RUN               | No provider keys or paid services used                                    |
| Customer-data behavior                                                       | NOT RUN               | Customer data prohibited; synthetic fixtures only                         |
| GPU rendering or geometry-consistent media quality                           | NOT RUN               | UI is canvas-independent and no GPU/provider path was invoked             |
| Physical-device evidence                                                     | NOT RUN               | Browser desktop/mobile viewports only                                     |
| Professional review, regulatory, structural, cost, or availability certainty | NOT RUN / NOT CLAIMED | Requires accountable evidence and reviewer outside this lane              |
| Human-rated design quality                                                   | NOT RUN               | No human-quality study was performed                                      |

These unmeasured areas remain explicit limitations and must not be inferred from fixture or browser passes.

The repository-level production composition build is deferred to the root orchestrator after ordered merge and workspace dependency builds. This lane did not build or modify the unrelated `@interior-design/editor-core` package.

## Cancel/retry concurrency follow-up

Root's cross-lane audit found that the L3 cancel and retry routes require strict `{ "expectedVersion": integer }` request bodies. The L4 client and BFF originally sent no body. The follow-up binds each action to the exact `OptionJob` displayed by the workspace, forwards only its positive integer version, and rejects missing, additional, string, zero, negative, fractional, malformed, oversized, stale, or non-advancing transition data.

The 23-test web pack verifies exact client URLs/bodies/idempotency, strict bounded BFF parsing, path/project/job response identity, advancing versions, redacted 409 recovery, and explicit UI reload guidance. The independent 14-test pack includes hostile transition-body coverage. Rendered browser evidence was not rerun for this transport-only follow-up because starting Next would rewrite the explicitly excluded generated `apps/web/next-env.d.ts`; the earlier synthetic browser evidence remains unchanged and is not relabelled.

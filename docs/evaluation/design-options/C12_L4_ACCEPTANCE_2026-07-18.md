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

## Root integration closure

The ordered root merge wired the C11 accepted-brief handoff, exact brief-content hash, current committed source snapshot, production API composition, versioned creator-owned catalog, deterministic spatial worker, navigation, and C12 web workspace. This section supersedes the lane-only statements above where later root evidence exists; it does not relabel any synthetic observation.

| Gate                                                   | Result                                                                                                                                 | Evidence class                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Full repository `UV_CACHE_DIR=.cache/uv pnpm verify`   | PASS: format; 19-package lint/type/build; all default JS unit suites; Ruff; strict MyPy; Python 117 passed / 2 honest capability skips | Repository-wide local production build                                                      |
| Serialized C12 API suite with local PostgreSQL         | PASS: 11 files / 45 tests                                                                                                              | Live local PostgreSQL plus unit/contract                                                    |
| Clean C1–C12 database migration and production journey | PASS: 1 test from an empty disposable database                                                                                         | Production-composed Next BFF → listening API → deterministic worker → PostgreSQL → C5 → C10 |
| Independent evaluation/security/performance            | PASS: 3 files / 14 tests                                                                                                               | Synthetic/adversarial/static inspection                                                     |
| Chromium, Firefox and WebKit matrix                    | PASS: 12 tests in 1.1 minutes                                                                                                          | Synthetic local BFF/backend fixtures                                                        |
| Connected Chrome visible owner journey                 | PASS: sign-in, exact comparison, explicit acknowledgement, isolated confirmation, 390×844 responsive inspection                        | Synthetic fixture presentation only                                                         |

The clean production test created and accepted a real C11 brief, pinned its exact content hash and a committed existing snapshot, created a C12 job through the actual Next route handler over HTTP, ran the real deterministic planner and PostgreSQL repository, published two spatially/materially distinct furnishing/finish/light bundles, and confirmed both through the BFF into separate proposed branches. Same-key API replay returned the retained result. Generation created zero proposed snapshots/branches/commits; confirmation created two sibling branches and did not change the existing profile. One confirmed branch compiled through C10 into a valid embedded glTF 2.0 GLB (7,164 bytes, 6 nodes, 18 triangles) with a verified SHA-256 and no external URI.

The Codex in-app Browser was attempted twice but its runtime failed during bootstrap before a tab could be acquired (`Cannot redefine property: process`; an earlier partial bootstrap also lacked the browser agent). That is an unavailable-controller result, not browser evidence. The separately connected Chrome fallback completed the visible flow with zero console warnings/errors; the 390×844 document width stayed within the viewport. The final automated matrix then passed all 12 configured desktop/mobile cases across Chromium, Firefox and WebKit.

Still not measured: human-rated agency design quality, representative-household comprehension, real catalog availability/cost, GPU or provider render quality, physical-device behavior, and structural/regulatory/professional approval. These remain future checkpoint or accountable-human gates and are not implied by C12's computational validity.

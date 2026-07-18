# C11-L3 consultation UX acceptance record

- Date: 2026-07-18
- Immutable prelude: bd57878e0b5ac9f66c26a58f2dbbb406f8a5b3d6
- Evidence classification: deterministic synthetic fixture presentation plus production-composed local integration
- External providers and external network: disabled

## Outcome

The C11-L3 web lane provides an accessible, responsive agency workspace for a structured design brief, immutable reference board, local consultation, clarification, inspect-and-correct proposal review, explicit confirmation, brief acceptance, and professional-review boundaries.

The workspace also provides an explicit project-intake-to-consultation path when no C11 brief exists. GET never initializes a brief. An authorised owner/editor selects saved goals, must-change, must-keep, style and accessibility facts, explicitly reasserts them, and submits an expected-revision-0 update. Address data is excluded from the local workspace schema, rendered UI and request body. The request and entry IDs are deterministic RFC 9562 UUIDv8 values derived locally from SHA-256 over fixed-shape, namespaced JSON input. An unchanged retry reuses the exact body and idempotency key.

Corrected or selectively adopted assistant operations are direct user corrections, not atomic assistant-proposal confirmations. Add/replace entries are reattributed to the confirming actor with a correction timestamp. Inferred suggestions become preferences and observed-evidence labels become household assertions. The exact unedited path uses the frozen atomic confirmation endpoint without sending client-side operations. A corrected update closes the exact consultation; failed cleanup keeps the superseded proposal, private message and recovery identifiers visible until retry, while successful terminal/new-session boundaries clear raw message state.

## Contract and migration impact

- Shared C11 contracts: unchanged.
- Shared authentication/authorisation: unchanged.
- Migrations and migration registry: unchanged.
- Local web composition contract: supports brief null plus an address-free saved-intake seed only under the C11-L3 feature path.
- Same-origin BFF: browser mutations remain POST; the frozen upstream design-brief update is PUT. All other C11 upstream mutations remain POST.
- Central navigation, app shell and shared composition: unchanged. The route is intentionally not added to shared navigation by this lane.

## Accessibility basis and evidence

Implementation and evaluation were aligned with the W3C [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) and WAI [Understanding Success Criterion 4.1.3: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), accessed 2026-07-18.

The exercised surface includes named form controls, keyboard operation, visible focus, logical focus after session creation, focus retention after asynchronous proposal creation, error identification, error-prevention acknowledgement before initialization/patch/acceptance, read-only viewer controls, minimum 44-pixel primary action height in the narrow viewport, polite atomic status announcements that do not take focus, assertive alerts for action failures, reduced-motion handling, and status text that does not rely on colour alone.

Automated assertions and one visual inspection do not establish formal WCAG conformance. Screen-reader testing, assistive-technology interoperability, cognitive-accessibility review, representative disabled-user evaluation and a complete manual WCAG audit were NOT RUN.

## Fresh-server browser matrix

Playwright configuration defaults reuseExistingServer to false. Reuse is possible only when C11_REUSE_EXISTING_SERVERS=1 is set explicitly for local diagnosis. Before the final evidence run, the lane-owned Next and synthetic mock sessions on 127.0.0.1 ports 4330 and 4331 were stopped. The final command started fresh processes from the current worktree and Playwright stopped them after completion.

Final command:

    pnpm exec playwright test --config tests/e2e/brief-assistant/playwright.config.ts

Result: 13 passed in 1.8 minutes.

| Project                         | Engine and viewport                       | Scope                                                                                                                    | Result |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| chromium-desktop-1440x960       | Chromium, 1440 × 960                      | owner workflow, intake initialization, correction cleanup recovery, keyboard, hostile displayed text, full status matrix | Passed |
| firefox-desktop-1440x960        | Firefox, 1440 × 960                       | viewer read-only comprehension and full status matrix                                                                    | Passed |
| webkit-desktop-1440x960         | WebKit, 1440 × 960                        | viewer read-only comprehension and full status matrix                                                                    | Passed |
| chromium-mobile-390x844         | Chromium engine, 390 × 844                | responsive layout, target height, proposal flow, overflow/console/network checks                                         | Passed |
| firefox-mobile-viewport-390x844 | Firefox engine, 390 × 844 narrow viewport | responsive layout, target height, proposal flow, overflow/console/network checks                                         | Passed |
| webkit-mobile-390x844           | WebKit engine, 390 × 844                  | responsive layout, target height, proposal flow, overflow/console/network checks                                         | Passed |

The Firefox narrow run is a desktop Firefox engine at a bounded mobile-width viewport. It is not represented as a physical device or touch emulation.

Every browser flow asserts zero horizontal overflow, no unexpected origin, no unplanned console warning/error, no failed request except the explicitly asserted synthetic 503 cleanup interruption, and zero C4/C5/C9/C10 canonical mutation counters. Corrected-session close records the original pending proposal as rejected; unedited atomic confirmation remains the server-owned provenance path.

## Focused and repository gates

Environment setup:

- pnpm install --offline --lockfile=false was attempted first; two cached tarballs were unavailable.
- pnpm install --no-frozen-lockfile --lockfile=false then materialised workspace links/binaries and downloaded only the two missing packages.
- Root manifests and pnpm-lock.yaml were not edited or committed.

Verification results:

| Command                                                                           | Result                                                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| pnpm --filter @interior-design/web typecheck                                      | Passed                                                                                        |
| pnpm --filter @interior-design/web lint                                           | Passed after strict typed-lint corrections                                                    |
| pnpm --filter @interior-design/web test:unit                                      | Passed: 34 files, 126 tests                                                                   |
| pnpm exec vitest run tests/evaluation/brief-assistant                             | Passed: 1 file, 6 tests                                                                       |
| pnpm exec vitest run tests/security/brief-assistant                               | Passed: 1 file, 5 tests                                                                       |
| pnpm exec tsc -p tests/e2e/brief-assistant/tsconfig.json --noEmit                 | Passed                                                                                        |
| pnpm build                                                                        | Passed: 15 of 15 workspace builds; Turbo printed a non-fatal sandbox IO warning after success |
| pnpm --filter @interior-design/web build                                          | Passed after topological dependency outputs were materialised                                 |
| pnpm exec playwright test --config tests/e2e/brief-assistant/playwright.config.ts | Passed: 13 tests                                                                              |
| git diff --check                                                                  | Passed; no whitespace errors in the staged exclusive-path diff                                |

The first direct web build attempt failed because production package exports pointed to absent clean-worktree dist outputs. The topological repository build restored those ignored outputs, after which both the repository build and direct web production build passed.

## Visual evidence

- /tmp/c11-consultation-accepted-desktop.png — Chromium desktop accepted-brief capture, visually inspected.
- /tmp/c11-consultation-mobile.png — final WebKit 390 × 844 full-page capture, visually inspected.
- /tmp/c11-brief-assistant-playwright-results — transient traces/error contexts during test development; the final run passed.

The desktop full-page capture contains a known sticky-header stitching artefact from full-page screenshot composition. The normal viewport and interaction evidence showed intact content. Screenshots are synthetic-fixture artifacts and are not provider-quality, customer or producer-live evidence.

## Severe, error and security coverage

- loading, empty brief/reference board, viewer read-only, cancellation and restart;
- authentication expiry and safe sign-in recovery;
- stale brief revision and expired proposal;
- offline workspace, malformed workspace/proposal and retry;
- synthetic turn failure with redacted upstream diagnostics;
- interruption recovery using identifiers only, never raw message text;
- corrected-update cleanup failure, retained recovery, superseded proposal, exact-session retry and terminal private-state clearing;
- prompt-like displayed text treated as inert data;
- strict UUID project/session/proposal paths and exact allowlisted C11 routes;
- idempotency header/body match and deterministic revision-0 retry;
- address/token/role authority excluded from browser-controlled payloads;
- upstream response identity matching and hostile diagnostic redaction;
- zero canonical C4/C5/C9/C10 mutation instrumentation.

## Orchestrator production-composed integration

After the three isolated lanes were merged, the orchestrator completed the required producer-live local gate against disposable Postgres databases and the production C11 composition.

### Database, API and redaction evidence

- A clean C1-C11 migration chain applied successfully through `0011_design_briefs.sql`.
- The production integration test passed 1/1 against `c11_production_gate_20260718_0405`. It exercised owner, editor, viewer and foreign-tenant access; project and intake creation; deterministic revision-1 initialization and replay; local session/turn creation; unedited atomic confirmation and replay; direct user correction; exact cancellation; proposal rejection; acceptance; and optimistic-revision enforcement.
- Live structured logs were captured in-process and proved that both actor tokens, private consultation messages, the synthetic address marker and the synthetic accessibility marker were absent while redaction markers remained present.
- C4 snapshot and C5 commit counts and hashes were unchanged across the consultation workflow. C11 created only audited brief/session/proposal revisions; it did not mutate C4, C5, C9 or C10 state.

### Production-composed browser evidence

The production-composed Playwright command used the real Next same-origin BFF, real C11 API, deterministic local model gateway and disposable Postgres database `c11_live_bff_20260718_0350`:

    pnpm exec playwright test --config tests/e2e/brief-assistant/playwright.live.config.ts

Result: 3 passed in 35.3 seconds.

The owner journey signed in, created a project, saved a complete synthetic intake, initialized an address-free brief, ran a real local consultation, atomically confirmed the proposal and accepted revision 3. The viewer journey proved the accepted brief remained read-only. The mobile journey proved no horizontal overflow at 390 x 844. The resulting database contained one accepted revision-3 brief with nine entries, one session and one confirmed proposal, with zero C4 snapshots and zero C5 commits.

Visible Chrome extension verification then opened the same persisted project in the actual local app. It showed the accepted revision, `deterministic-local-v1`, external providers disabled, a backend-composed workspace, assistant-message provenance, four constraints, two household assertions, three preferences and explicit acceptance. DOM inspection found zero canonical mutations, no horizontal overflow and no console warning/error. The full-page capture was visually inspected:

- `/tmp/c11-brief-assistant-live-evidence/producer-live-owner-accepted.png`
- `/tmp/c11-brief-assistant-live-evidence/producer-live-viewer-mobile.png`
- `/tmp/c11-producer-live-chrome-accepted.png`

The in-app Browser controller was attempted first but failed during controller setup before acquiring a tab (`nameSession` state failure followed by `Cannot redefine property: process`). It is recorded as a controller limitation, not product evidence. The connected Chrome extension supplied the required visible-browser evidence without using customer data or an external provider.

### Integrated regression evidence

- `UV_CACHE_DIR=.cache/uv pnpm verify`: passed all 17 workspace format/lint/typecheck/unit/build pipelines, Ruff, strict MyPy and 117 Python tests with two correctly skipped optional COLMAP/Open3D runtime cases.
- Brief-assistant evaluation/security: 11/11 passed.
- Synthetic cross-browser consultation matrix: 13/13 passed across Chromium, Firefox and WebKit desktop/mobile, keyboard, viewer, correction, cancellation/recovery, hostile text and degraded states.
- iOS Simulator regression on Xcode 26.4 and iOS 26.4: 29 XCTest cases, 96 Swift Testing cases and 18 UI tests passed (143 logical cases total). This validates shared API/auth/navigation regressions only; it is not physical sensor evidence.
- `git diff --check`: passed.

## NOT RUN and limitations

- Real provider/model execution: NOT RUN; external capability is explicitly disabled.
- Customer data, customer addresses and customer media: NOT USED.
- Physical mobile devices, touch hardware, GPU, LiDAR and camera hardware: NOT RUN.
- Formal WCAG conformance assessment or assistive-technology certification: NOT RUN.
- Professional structural, regulatory, clinical-accessibility, cost or product-availability review: NOT RUN. The UI routes these questions and makes no such claims.
- Representative household study and agency design-quality scoring: NOT RUN.

## Producer-live integration gate disposition

The orchestrator completed the production-composed local journey using the real BFF, real C11 API and Postgres:

1. Create and save a C1 project intake whose brief does not yet exist.
2. Open C11 and prove GET performs no mutation and exposes only the selected address-free intake fields.
3. As owner and editor, explicitly initialize revision 1; prove expectedRevision 0, actor-bound user-stated provenance, exact SHA-256/UUIDv8 retry idempotency, upstream PUT and no address/token logging.
4. Reload the persisted real brief, create a deterministic-local session, submit a turn, inspect/correct or atomically confirm, close the exact session, and accept the brief.
5. Inject an ambiguous initialization response and a corrected-update cleanup interruption; prove exact retry behaviour, proposal rejection/supersession, recovery and private-message clearing.
6. Repeat the access matrix for owner, editor, viewer, foreign tenant, expired session, stale revision and expired proposal.
7. Capture C4/C5/C9/C10 canonical counts and canonical snapshot/content hashes before and after; all must remain unchanged. Only audited C11 brief revision operations may change.
8. Inspect server logs/traces for tenant isolation, idempotency replay, redaction, accountable actor attribution and absence of address, message or token leakage.

All eight requirements above passed through the combined production integration test, production-composed Playwright journey, connected Chrome inspection and structured-log assertions. C11 therefore has integrated local checkpoint evidence. The remaining NOT RUN items are external provider, hardware, formal conformance and human/professional evidence and are not relabelled as software evidence.

# C14.1 Homeowner Bridge Acceptance — 2026-08-23

## Acceptance position

C14.1 is software-complete for the first corrective web bridge covered by this
lane: ordinary project navigation reaches the homeowner journey, a persisted C9
draft is carried through a distinct C5 preview and explicit commit, and C10 scene
creation is gated on the exact committed current snapshot.

This is **not** completion of the whole homeowner slice. It does not validate a
real property, deployed service, reconstruction provider, GPU result, iOS
capture, RoomPlan, LiDAR, camera, background transfer, or physical-device
journey. The browser evidence is stateful synthetic fixture/mock evidence only.
C14.1 composes existing C1–C10 production paths and leaves C8 v2
acceptance-only; no C8 v2 production route was added or exercised.

Source reviewed: integrated production head
`94ecf6e4c172483b0ef6921c540d4f979f2b4ae4` on
`codex/homeowner-digital-twin-journey`.

## Independent acceptance coverage

| Contract behavior                                                                 | Independent evidence                                                                                                                                                                                                                                      | Result |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Normal navigation, not direct-route-only setup                                    | Playwright signs in through the normal local fixture UI, creates a project and follows its normal post-create redirect to `/home/{id}`; it then returns through Projects and uses **Resume home journey** for the integrated fixture project.             | Pass   |
| Owner/editor/viewer honesty                                                       | Owner and editor controls are visible where authorised. Viewer mutation controls are absent. Direct viewer POST attempts against the real C9, C5 and C10 web BFF routes return 403; the mock records three attempts and zero accepted mutations.          | Pass   |
| Exact persisted C9 draft preview                                                  | Browser and integration tests assert branch ID, expected branch revision, expected head hash and the exact operation array/client operation ID. The preview call body preserves the exact revision, hash and operations.                                  | Pass   |
| Zero C5 commit before confirmation                                                | Stateful mutation counters are checked after draft creation and again after preview. Both points have zero accepted C5 commits. Commit occurs only after the distinct **Confirm corrections and commit** action.                                          | Pass   |
| Blocking, expired, stale/conflict, forbidden, offline and unavailable fail closed | Four preview states, four commit states, browser-level offline abort and current-profile unavailability all retain branch revision 0/current pre-commit snapshot as applicable and create no scene.                                                       | Pass   |
| No C10 before an exact committed current snapshot                                 | C10 accepted-mutation count remains zero before commit. Production-function integration rejects a hash-mismatched current snapshot. Browser acceptance rejects scene creation when the committed snapshot is temporarily absent from the current profile. | Pass   |
| Only current existing-profile scene jobs count                                    | Integration state tests leave stale-snapshot and proposed-profile jobs non-current, while an existing-profile succeeded job with the current snapshot ID completes the twin stage and deep-links its exact job.                                           | Pass   |
| Partial C8/C9 availability                                                        | Independent integration and browser cases make only the proposal stage degraded while property, goals and evidence remain readable.                                                                                                                       | Pass   |
| Desktop and 390px semantics/layout                                                | Playwright runs at 1440×960 and 390×844. It checks six ordered stages, accessible links/buttons, keyboard focus, exact 390px document/body width, positive card bounds and no horizontal overflow.                                                        | Pass   |
| Privacy/C8-v2 boundary                                                            | Static security acceptance rejects C8-v2/Blackwell execution imports, raw locator/credential field names and console logging in the bridge sources.                                                                                                       | Pass   |

The stateful backend distinguishes `attempts` from `accepted` mutations.
This makes viewer-denial and failure-state assertions server-facing without
claiming that the fixture is a deployed API or live property.

## Commands actually run

The repository had no installed workspace dependencies in this isolated
worktree. The pinned package manager was restored without changing manifests or
the lockfile:

```powershell
corepack pnpm install --frozen-lockfile
```

Result: exit 0; pnpm 10.33.0; 282 packages installed from the frozen lockfile.

All three independent TypeScript configurations were compiled:

```powershell
corepack pnpm exec tsc -p tests/e2e/homeowner-journey/tsconfig.json --noEmit
corepack pnpm exec tsc -p tests/integration/homeowner-journey/tsconfig.json --noEmit
corepack pnpm exec tsc -p tests/security/homeowner-journey/tsconfig.json --noEmit
```

Result: three exit-0 configurations, zero diagnostics.

Focused production-function and security acceptance:

```powershell
corepack pnpm exec vitest run --config tests/integration/homeowner-journey/vitest.config.ts
corepack pnpm exec vitest run --config tests/security/homeowner-journey/vitest.config.ts
```

Result:

- integration: 1 file, 4 tests passed;
- security: 1 file, 3 tests passed.

Playwright 1.61.1 required its pinned local browser, which was absent on the
host. It was installed with:

```powershell
corepack pnpm exec playwright install chromium
```

Result: exit 0; Chrome for Testing 149.0.7827.55 / Playwright Chromium 1228,
headless shell 1228, FFmpeg 1011 and Winldd 1007 installed in Playwright's user
cache.

The final complete browser run used the repository's development export
condition because workspace package distributions were not prebuilt:

```powershell
$shimDirectory = Join-Path ([System.IO.Path]::GetTempPath()) 'c14-1-corepack-bin'
$env:PATH = "$shimDirectory;$env:PATH"
$env:NODE_OPTIONS = '--conditions=development'
pnpm exec playwright test --config tests/e2e/homeowner-journey/playwright.config.ts
```

Result: 14 passed, 0 failed, 1 worker, 57.0 seconds:

- 13 desktop 1440×960 cases;
- 1 mobile 390×844 case.

Relevant integrated web gates:

```powershell
$env:NODE_OPTIONS = '--conditions=development'
corepack pnpm --filter @interior-design/web lint
corepack pnpm --filter @interior-design/web typecheck
```

Result: lint exit 0; typecheck exit 0.

## Browser artifacts and visual review

The final green Playwright run generated:

- `C:\tmp\c14-1-homeowner-journey-evidence\desktop-explicit-handoff.png`
  (67,148 bytes);
- `C:\tmp\c14-1-homeowner-journey-evidence\mobile-390-home-journey.png`
  (186,106 bytes).

These are temporary host artifacts, not repository or live-service evidence.
Both were visually reviewed after the green run. The desktop image shows the
non-mutating preview, separate homeowner-confirmed commit card, exact committed
snapshot/hash and explicit scene result. The 390px full-page image shows a
visible keyboard skip-link focus state, readable single-column six-stage
layout, honest context warning and no clipped horizontal content.

The Browser-plugin in-app inspection was attempted twice against the healthy
local fixture servers. The browser-control kernel exited before any page action
because the managed Windows sandbox failed with
`timed out after 15000ms waiting for runner spawn_ready`. The same runner fault
also blocked the normal image-view helper, so the screenshots were loaded by a
read-only base64 display fallback for visual review. No in-app-browser result is
claimed.

## Failures encountered and resolved

- The first Playwright collection reached all 14 tests but could not launch
  because Chromium 1228 was absent. Installing the pinned test browser resolved
  the host dependency.
- Initial focused runs exposed three strict-locator/message mismatches in this
  lane's tests (duplicate Projects link, duplicate hash text, and production's
  generic server-expiry wording). The locators were scoped to accessible
  navigation/status regions and the expiry assertion was aligned with the
  actual production message. The final full run is green.
- Next dev changed generated `apps/web/next-env.d.ts` from the production
  route declaration to its dev route declaration. It was restored exactly to
  the lane base and is absent from the final diff.

## Product defects found (not repaired)

1. **Confirmation progress is not tied to the confirmed C9 handoff.**
   `journey-loader.ts` reduces every C5 branch to only its revision, and
   `journey-state.ts` marks the confirmation stage `confirmed` when any
   listed branch has `revision > 0`. A revision created by another C5 editing
   path or a non-current branch can therefore label the journey as
   homeowner-confirmed even when the explicit persisted C9 draft represented by
   this bridge was not the committing action. Exact evidence:
   `apps/web/src/features/homeowner-journey/journey-loader.ts:70-72` and
   `apps/web/src/features/homeowner-journey/journey-state.ts:355-370`.

2. **A server-reported expired preview is rendered as a generic branch
   conflict.** `editor-2d/api.ts` maps every HTTP 409 to `conflict` before
   the handoff panel sees the problem code. Consequently a
   `PREVIEW_EXPIRED` commit response displays “branch revision or head
   changed” instead of the panel's available “preview expired” recovery text.
   The action still fails closed with zero commit and zero scene, but the cause
   is less precise. Exact evidence:
   `apps/web/src/features/editor-2d/api.ts:60-65` and
   `apps/web/src/features/homeowner-journey/canonical-handoff-panel.tsx:36-49`.

No production repair was attempted because this lane owns acceptance and
handoff paths only.

## Contract, migration and hardware/provider impact

- Shared contract/OpenAPI/generated-client impact: none.
- Migration/registry impact: none.
- Production service, worker, route or C8-v2 execution impact: none.
- Provider/GPU state: no provider key, reconstruction provider or GPU execution
  used; all data is synthetic fixture state.
- Apple state: Xcode, Simulator, iPhone/iPad, camera, RoomPlan, LiDAR and
  background-transfer validation were **NOT RUN** on this Windows host. See
  `docs/runbooks/ios/C14_1_APPLE_HANDOFF.md`.

## Remaining boundary

C14.1 closes one corrective composition gap. It does not complete autonomous
multi-source reconstruction, physical capture validation, full design agency
workflow, implementation handoff, provider readiness, representative-home
quality, C8-v2 productionisation, or the remaining M1 homeowner experience.
Those claims remain outside this evidence.

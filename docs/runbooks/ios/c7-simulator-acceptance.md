# C7 Simulator and independent acceptance runbook

## Evidence boundary

Simulator and synthetic fixtures validate navigation, deterministic state handling, API contracts, offline/retry presentation, Dynamic Type and accessibility metadata. They do not validate camera permission system UI, LiDAR, RoomPlan output, tracking, world-space compatibility, relocalisation, thermal behaviour, physical background transfer or spatial accuracy.

Every report must label this evidence `Simulator / visibly synthetic / non-RoomPlan`.

## Runnable before producer merge

From the repository root:

```sh
pnpm exec tsc -p tests/mobile/capture/tsconfig.json
pnpm exec vitest run --config tests/mobile/capture/vitest.config.ts
pnpm exec tsc -p tests/security/capture/tsconfig.json
pnpm exec vitest run --config tests/security/capture/vitest.config.ts
pnpm exec tsc -p tests/evaluation/roomplan/tsconfig.json
pnpm exec vitest run --config tests/evaluation/roomplan/vitest.config.ts
```

The live API suite skips unless all `C7_LIVE_*` variables are deliberately supplied. That skip is expected in the independent run and is not live evidence.

## Orchestrator integration required

The L4 worker cannot edit `project.yml`, generated `.xcodeproj`, app composition or producer feature paths. After merging L1/L3/L2/L4 in the frozen order, the orchestrator must:

1. regenerate the Xcode project from unchanged declarative source membership;
2. wire the test-only C7 fixture protocol in non-production/debug UI-test mode;
3. expose the accessibility identifiers used by `C7AcceptanceUITests.swift`;
4. ensure production builds ignore/reject `C7_UI_TEST_MODE` and `C7_UI_TEST_SCENARIO`;
5. run the exact integrated commands below.

The fixture protocol needs project/brief loading states, all 21 local states, all nine server states, six exact RoomPlan instructions, interruption/relocalisation/restart, single-room and two-room structure review, incompatible-world-space abstention, offline/background reconciliation, expiry/forbidden/cancel/retry, and synthetic/provenance limitation copy.

## Post-merge Xcode checks

Regeneration stability is an orchestrator-owned gate because generated project files are outside this lane:

```sh
cd apps/ios-capture
xcodegen generate
git diff --exit-code -- project.yml HomeDesignCapture.xcodeproj
```

Run strict Simulator tests on an installed iOS 26.4 simulator, substituting only an actually listed device name:

```sh
C7_RUN_INTEGRATED_UI=1 xcodebuild test \
  -project apps/ios-capture/HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'platform=iOS Simulator,name=iPhone Air,OS=26.4' \
  -only-testing:HomeDesignCaptureUITests/C7AcceptanceUITests \
  -only-testing:HomeDesignCaptureUITests/C7GoldenContractUITests
```

Then run the complete scheme without `-only-testing`. Record executed, passed, failed and skipped counts separately. `C7_RUN_INTEGRATED_UI` must be visible to the test runner; if the C7 suite skips, the integrated UI gate is **NOT RUN**.

Generic no-signing compilation is separate evidence:

```sh
xcodebuild build \
  -project apps/ios-capture/HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO
```

## Accessibility and layout observations

Use Computer Use on the integrated Simulator app after automated tests:

- portrait and landscape at the smallest supported iPhone simulator;
- accessibility XXXL Dynamic Type, no clipped critical action and no horizontal scrolling;
- keyboard/focus order where an external keyboard is supported;
- meaningful labels/traits for capture status, guidance, progress and retry/cancel actions;
- unsupported/manual fallback reachable without camera hardware;
- visible `Simulator does not prove RoomPlan` and `Synthetic fixture` copy;
- distinct expiry, forbidden, offline, abstained, cancelled and safe-failure language.

Record screenshots outside source roots as run artifacts. Simulator inspection cannot be relabelled as physical VoiceOver or RoomPlan evidence.

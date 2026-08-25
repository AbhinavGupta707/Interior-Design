# C14.1 Apple Xcode acceptance — 2026-08-25

## Decision and evidence boundary

**PASS for the named Mac, Xcode project, SDK compilation and Simulator test
scope. PHYSICAL APPLE DEVICE GATES REMAIN NOT RUN.**

The checked-in iOS project was validated first at baseline
`5b719f9ab83616affc0eeb7de2ba73279bd93d5f` and again after the narrow native
evidence-continuity correction at
`cc7bc757a4d0cc323e51f299bfdb9cffc984ee5c`.

No Xcode/tool install or downgrade, signing change, credential commit, customer
evidence, physical iPhone/iPad, camera permission, RoomPlan session, LiDAR
observation or physical accuracy comparison occurred. The generic `iphoneos`
build used signing disabled and proves source/SDK compatibility only.

## Exact environment

| Item                            | Observed value                                              |
| ------------------------------- | ----------------------------------------------------------- |
| host                            | Mac mini (Macmini9,1), Apple M1, arm64, 8 cores, 16 GiB RAM |
| macOS                           | 26.5.2 (25F84)                                              |
| developer directory             | `/Applications/Xcode.app/Contents/Developer`                |
| Xcode                           | 26.4 (17E192)                                               |
| Swift                           | Apple Swift 6.3, `swiftlang-6.3.0.123.5`, driver 1.148.6    |
| project Swift mode              | Swift 6 with complete strict concurrency                    |
| XcodeGen                        | 2.45.4                                                      |
| SDK                             | iOS 26.4; iOS Simulator 26.4                                |
| Simulator runtime               | iOS 26.4 (23E244)                                           |
| primary Simulator               | iPhone Air, iOS 26.4, arm64                                 |
| additional smoke Simulator      | iPad Air 11-inch (M4), iOS 26.4, arm64                      |
| deployment/device families      | iOS 17.0; iPhone and iPad                                   |
| bundle identifier               | `com.homedesignstudio.capture`                              |
| package manager                 | pnpm 10.33.0                                                |
| connected physical Apple device | none                                                        |

Debug resolves to `http://127.0.0.1:4100`. Release resolves to the deliberate
placeholder `https://api.invalid`. The project uses automatic signing, but no
development team resolves. A local development identity was present; its
identity details are excluded from Git and do not establish install readiness.

## Safe synchronization and project reproducibility

The Mac-native checkout was clean before synchronization. `main` was fetched
and advanced with `git merge --ff-only origin/main`; the resulting baseline was
the exact required SHA. No reset, checkout-overwrite or discard command was
used.

With XcodeGen 2.45.4, the checked-in project hash before and after regeneration
was identical:

```text
87287d48739956a15358f78eab86ba68ea92d3ae668eb513083eb15a514770ce
```

Commands:

```sh
git status --short --branch
git fetch origin main
git rev-parse origin/main
git merge --ff-only origin/main
git rev-parse HEAD

cd apps/ios-capture
shasum -a 256 HomeDesignCapture.xcodeproj/project.pbxproj
xcodegen generate
shasum -a 256 HomeDesignCapture.xcodeproj/project.pbxproj
git diff -- HomeDesignCapture.xcodeproj/project.pbxproj
```

## Executed results

| Gate                                | Baseline result                               | Final result                                  | Evidence class                                 |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| XcodeGen regeneration               | identical project hash; no diff               | project inputs unchanged                      | deterministic project-generation evidence      |
| generic iOS Simulator build         | passed                                        | passed                                        | Mac/Simulator SDK compile                      |
| full iPhone Air scheme              | 143 logical tests passed; 0 failed; 0 skipped | 144 logical tests passed; 0 failed; 0 skipped | Simulator software evidence                    |
| Xcode device accounting             | 150 passed invocations                        | 151 passed invocations                        | includes parameterised-run accounting          |
| focused changed-path tests          | not applicable                                | 6/6 passed                                    | four flow-model tests plus two launch UI tests |
| focused iPad journey                | not applicable                                | 1/1 passed                                    | iPad Simulator UI evidence only                |
| generic arm64 `iphoneos` compile    | passed                                        | passed with 0 warnings/errors                 | physical-SDK compilation only                  |
| C7/C8 TypeScript contract typecheck | passed                                        | unchanged                                     | static shared-contract evidence                |
| C7/C8 Vitest contract suite         | 2 files / 15 tests passed                     | unchanged                                     | deterministic contract evidence                |
| `git diff --check`                  | passed                                        | passed                                        | source hygiene                                 |

The baseline 143 logical tests comprised 29 XCTest unit tests, 96 Swift Testing
cases across 15 suites and 18 UI tests. The final 144 comprised the same unit
and Swift Testing counts plus 19 UI tests.

## Exact final Xcode commands

`EVIDENCE_DIR` resolved to a dated directory outside the repository. The
private host path, signing identity and Simulator UUIDs are intentionally not
recorded in Git.

```sh
cd apps/ios-capture

xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'platform=iOS Simulator,name=iPhone Air,OS=latest' \
  -derivedDataPath "$EVIDENCE_DIR/FinalDerivedData" \
  -resultBundlePath "$EVIDENCE_DIR/results/C14_1-native-slice-focused-tests.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:HomeDesignCaptureTests/CaptureFlowModelTests \
  -only-testing:HomeDesignCaptureUITests/AppLaunchUITests \
  test

xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'platform=iOS Simulator,name=iPhone Air,OS=latest' \
  -derivedDataPath "$EVIDENCE_DIR/FinalDerivedData" \
  -resultBundlePath "$EVIDENCE_DIR/results/C14_1-final-simulator-tests.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  test

xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$EVIDENCE_DIR/FinalSimulatorBuildDerivedData" \
  -resultBundlePath "$EVIDENCE_DIR/results/C14_1-final-simulator-build.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  build

xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'generic/platform=iOS' \
  -sdk iphoneos \
  -derivedDataPath "$EVIDENCE_DIR/FinalDeviceBuildDerivedData" \
  -resultBundlePath "$EVIDENCE_DIR/results/C14_1-final-device-compile.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'platform=iOS Simulator,name=iPad Air 11-inch (M4),OS=latest' \
  -derivedDataPath "$EVIDENCE_DIR/iPadSmokeDerivedData" \
  -resultBundlePath "$EVIDENCE_DIR/results/C14_1-ipad-evidence-smoke.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  -only-testing:HomeDesignCaptureUITests/AppLaunchUITests/testUnsupportedJourneyReachesSecureEvidenceWorkspace \
  test
```

Shared contract commands:

```sh
pnpm exec tsc -p tests/mobile/capture/tsconfig.json --noEmit
pnpm exec vitest run --config tests/mobile/capture/vitest.config.ts
git diff --check
```

## Result-bundle integrity record

The external package retained the `.xcresult` bundles. The values below are
SHA-256 digests of the sorted relative-path per-file SHA-256 listing inside
each bundle; no result bundle is committed to Git.

| Bundle                                      | Aggregate SHA-256                                                  |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `C14_1-device-compile.xcresult`             | `71c6fb82230c00d1b4146f322874c1e6723e91a7c23fa41145553c6aeb96e993` |
| `C14_1-final-device-compile.xcresult`       | `bc0cf79d15ccc1969fff484747ac35b19d690988cf3d27edbbaedbc97052d983` |
| `C14_1-final-simulator-build.xcresult`      | `9a095bbc489f20186f19560b2b69feb85646d706b5a73650a7532db890a2f050` |
| `C14_1-final-simulator-tests.xcresult`      | `a60fdca27f8730e1ec26265108ebe7faceec81593a13b3ef3404f0ee2f436f42` |
| `C14_1-ipad-evidence-smoke.xcresult`        | `67f86464352494f2379cfa4b3c20a86a7a97957f809d94e742387f98bc169716` |
| `C14_1-native-slice-focused-tests.xcresult` | `dcda74fdf10f47d53d4957c36c43a159f261e99505e86c142210cb769edea0ce` |
| `C14_1-simulator-build.xcresult`            | `c466c880c25176c02abfb707a01938a070e4d54baa2de4d4c5712719ad53065d` |
| `C14_1-simulator-tests.xcresult`            | `0f5804381dca67b3536bcc4761c795b637283d876d65b3e9c5f44a10e2190978` |

## Visible Simulator evidence

The ordinary fixture route was visibly inspected through project selection,
unsupported eligibility, manual evidence and the C2 `Choose a file` workspace.
The UI labels the source `Local fixture · Synthetic evidence only` and states
that it is not RoomPlan or physical-device evidence. Synthetic C7 guidance and
C8 completion fixtures were also inspected with their fixture labels visible.

Expected local-backend connection refusal and Simulator background-session/XPC
diagnostics appeared when the corresponding services/capabilities were absent.
They did not fail the deterministic suites and are not evidence that real
background completion works.

## Open gates

The following are not accepted by this record:

- signed physical iPhone/iPad build, install, relaunch, archive or TestFlight;
- camera, RoomPlan, ARKit, LiDAR or depth behavior;
- physical interruption/relocalisation, thermal/system-pressure or accuracy;
- real API upload and process-terminated background-session completion;
- production authentication/token refresh and non-placeholder Release API;
- native C10 through C14 homeowner surfaces.

The complete capability classification is in
[C14_1_APPLE_NATIVE_CAPABILITY_AUDIT_2026-08-25.md](C14_1_APPLE_NATIVE_CAPABILITY_AUDIT_2026-08-25.md).

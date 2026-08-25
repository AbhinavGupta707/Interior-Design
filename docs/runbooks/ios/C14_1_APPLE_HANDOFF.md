# C14.1 Apple Capture Handoff

## Status and claim boundary

**NOT RUN — Windows/WSL host, 2026-08-23.**

This handoff was prepared from the checked-in iOS project, source, tests and
repository commands. No Xcode build, Simulator test, signed device build,
iPhone/iPad launch, camera prompt, RoomPlan session, LiDAR observation,
background transfer or interruption run was performed in C14.1-L2.

**Mac follow-up — 2026-08-25.** The named Xcode project, Simulator suites and
unsigned physical-SDK compile were subsequently run on a Mac at
`cc7bc757a4d0cc323e51f299bfdb9cffc984ee5c`. Those exact results are recorded in
[`C14_1_APPLE_XCODE_ACCEPTANCE_2026-08-25.md`](../../evaluation/homeowner-journey/C14_1_APPLE_XCODE_ACCEPTANCE_2026-08-25.md).
Real RoomPlan, physical LiDAR/accuracy, production authentication/environment,
process-terminated background transfer and native C10–C14 remain unaccepted.

Simulator evidence may validate app state and synthetic fixtures, but it cannot
close a camera, RoomPlan, LiDAR, AR tracking, background execution or physical
journey gate. A physical run must name the exact Apple device, iOS version and
Xcode build. C14.1 is the first corrective web bridge, not the complete
homeowner or capture slice.

## Repository location and frozen boundary

Run all commands below from:

```sh
cd apps/ios-capture
```

The reproducible project source is `project.yml`; the checked-in
`HomeDesignCapture.xcodeproj` may be used without regeneration. The project
targets iOS 17.0, Swift 6 with complete strict concurrency, and links
`AVFoundation.framework` and `RoomPlan.framework`.

Do not add a C8-v2 production path during this handoff. C8 v2 remains
acceptance-only. Captured appearance, photos, video, depth and RoomPlan output
remain immutable evidence or proposals; none becomes canonical dimensional
truth without the existing validation and commit boundaries.

## Mac prerequisites

- macOS host capable of running the repository's supported Xcode.
- Xcode 26.4 build `17E192`, or a compatible newer Xcode, selected with
  `xcode-select`.
- Xcode licence accepted and the required iOS 17-or-newer Simulator runtime
  installed.
- XcodeGen 2.45.4 when project regeneration is being checked
  (`brew install xcodegen`).
- Git checkout at the reviewed C14.1 integration head with no unrelated local
  modifications.
- Sufficient free space for DerivedData, result bundles, screenshots and device
  console exports.
- For a real staging API: an HTTPS endpoint with no embedded credentials.
  Tokens and signing material must stay out of the repository, xcconfig,
  schemes, Info.plist and process arguments.

Verify:

```sh
xcodebuild -version
xcode-select -p
xcrun simctl list runtimes
xcodegen --version
git status --short
```

Record the complete output in the handoff evidence package.

## iPhone/iPad prerequisites

- A named physical iPhone or iPad running iOS 17 or newer.
- For RoomPlan/LiDAR claims, a device for which
  `RoomCaptureSession.isSupported` is true; record model, capacity identifier
  if available, iOS build and UDID in a restricted engineering record.
- Device paired, trusted, Developer Mode enabled, unlocked during launch and
  visible to Xcode:

```sh
xcrun xctrace list devices
```

- A valid development team/provisioning setup for
  `com.homedesignstudio.capture` supplied locally. Do not commit signing
  changes.
- Camera access reset before permission cases. Use a test Apple account and
  synthetic/consented test room only; do not capture an uninvolved household or
  private material.
- Wi-Fi plus an independently controllable offline/poor-network path for
  upload recovery cases.
- A second camera-using app, Control Centre, lock button and incoming-call or
  equivalent interruption method available for interruption coverage.

## Reproducible project check

Regenerate only when XcodeGen 2.45.4 is available:

```sh
xcodegen generate --spec project.yml
git diff -- HomeDesignCapture.xcodeproj/project.pbxproj
```

Expected: the diff is empty. If it is not empty, retain the diff as a failure
artifact and do not commit it from the validation machine.

## Simulator build and automated tests

Build:

```sh
xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/DerivedData \
  -resultBundlePath .build/results/C14_1-simulator-build.xcresult \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Choose an installed destination:

```sh
xcrun simctl list devices available
```

Run the complete unit/UI scheme:

```sh
xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'platform=iOS Simulator,name=iPhone Air,OS=latest' \
  -derivedDataPath .build/DerivedData \
  -resultBundlePath .build/results/C14_1-simulator-tests.xcresult \
  CODE_SIGNING_ALLOWED=NO \
  test
```

Replace only the destination name if `iPhone Air` is unavailable. The scheme
discovers `HomeDesignCaptureTests` and `HomeDesignCaptureUITests`, including
the checked-in C7 RoomCapture/quality/sync and C8 media fixture suites.

With a Simulator booted, install and launch the built shell:

```sh
xcrun simctl install booted \
  .build/DerivedData/Build/Products/Debug-iphonesimulator/HomeDesignCapture.app
xcrun simctl launch --terminate-running-process \
  booted com.homedesignstudio.capture
```

Expected Simulator behavior: capability remains honestly unsupported for real
RoomPlan/camera capture and uses synthetic/manual fallback paths. Do not report
fixture UI scenarios as sensor or property evidence.

## Unsigned physical-SDK compile check

This checks the physical-iOS compilation branch but does not install or validate
hardware:

```sh
xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath .build/DeviceDerivedData \
  -resultBundlePath .build/results/C14_1-device-compile.xcresult \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Label the result “physical SDK compile only”.

## Signed physical-device build and test

After locally selecting the correct development team, substitute the connected
device UDID without committing project changes:

```sh
xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'platform=iOS,id=<DEVICE_UDID>' \
  -derivedDataPath .build/PhysicalDerivedData \
  -resultBundlePath .build/results/C14_1-physical-tests.xcresult \
  test
```

If the UI-test runner cannot cover a sensor transition, perform the manual case
below and record it separately. A successful signed build alone is not a
RoomPlan/LiDAR/camera result.

## Required physical cases

Use an obviously synthetic or consented test room. Start each case from a known
project and record timestamps so app, device and server evidence can be
correlated.

| ID  | Case and procedure                                                                                                                                                                                             | Expected fail-safe result                                                                                                                                                                                                                    | Required evidence                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A1  | **RoomPlan/LiDAR eligibility.** Run once on a supported LiDAR device and once on an unsupported device/Simulator.                                                                                              | Supported hardware offers the real capture path only after capability and camera checks. Unsupported hardware never starts a session and offers the manual plan/photo/measurement fallback.                                                  | Device model/iOS, capability screen, console excerpt and screenshot/video.                               |
| A2  | **Camera permission.** Test not-determined → allow, not-determined → deny, previously denied and restricted states.                                                                                            | Prompt appears only when appropriate. Denied/restricted states do not construct a capture session and provide Settings/manual recovery without claiming capture.                                                                             | Permission reset command/process, before/after screenshots and test log.                                 |
| A3  | **RoomPlan capture lifecycle.** Start, scan a simple room, finish, review and package. Include low-confidence or incomplete coverage.                                                                          | Source RoomPlan output stays immutable; normalized geometry carries coordinate system, integer units, confidence, producer/tool versions and source identifiers. Low-quality capture is surfaced and remains a proposal.                     | Screen recording, normalized manifest/hash, quality summary, room/object counts and xcresult/log.        |
| A4  | **LiDAR/camera truth separation.** Capture the same scene with appearance media and RoomPlan/depth available.                                                                                                  | Photos, video, depth and appearance never overwrite canonical dimensions. The UI labels source kind and confidence; no survey/structural/regulatory claim appears.                                                                           | Evidence manifest, visible labels and canonical-diff check showing no implicit mutation.                 |
| A5  | **Foreground interruption/relocalisation.** Trigger Control Centre, another camera app or an incoming-call equivalent during RoomPlan and camera capture; test both recoverable and restart-required outcomes. | The state machine records interruption, either relocalises explicitly or requires a clean restart. It never silently splices incompatible coordinate frames.                                                                                 | Continuous screen recording, interruption count/reason, state-transition log and post-recovery manifest. |
| A6  | **Background/lock.** Background and lock the device during capture, packaging and upload.                                                                                                                      | Live sensor capture pauses/stops honestly. Durable journal/upload state survives. Returning does not pretend a live sensor session resumed; it either resumes upload or requires a new capture session.                                      | Timestamps, lifecycle log, protected-journal state and before/after screenshots.                         |
| A7  | **Offline upload and process restart.** Disable networking after persisted parts exist, terminate/relaunch, restore network and resume.                                                                        | Immutable local artifacts and checksums persist; server reconciliation prevents duplicate accepted evidence. No broad credentials or signed storage locators are exposed.                                                                    | Network timeline, persisted checksum count, request IDs, server reconciliation log and final receipt.    |
| A8  | **Retry taxonomy.** Exercise retryable transport/processing failure and a terminal validation/rights failure.                                                                                                  | Retry is offered only for retryable failure and preserves idempotency. Terminal failure has no unsafe retry and never advances capture/reconstruction state.                                                                                 | Both UI states, retry/terminal codes, idempotency key/request ID and mutation count.                     |
| A9  | **Privacy and rights.** Inspect permission copy, rights/processing consent, training permission and local protection on a fresh install.                                                                       | Camera purpose matches Info.plist. Service processing/rights are explicit. Training permission is separate and denied by default. Protected files are unavailable under the intended lock state and secrets/addresses do not appear in logs. | Screenshots, redacted log scan, evidence receipt showing training denied and file-protection inspection. |
| A10 | **Provenance and project isolation.** Capture for project A, switch to project B, then upload/review both.                                                                                                     | Every artifact retains the exact project, capture session, producer version, source IDs, hashes and coordinate metadata. No artifact crosses projects or tenants.                                                                            | Two redacted manifests/receipts, hash listing and server-side project/tenant audit result.               |
| A11 | **Resource pressure and storage failure.** Induce low storage/thermal or the repository fixture equivalent, then attempt photo/video capture.                                                                  | Capture stops safely, incomplete bytes are not published, and recovery guidance is specific. Existing accepted evidence remains immutable.                                                                                                   | Device/storage state, alert screenshot, temporary-file cleanup evidence and journal state.               |
| A12 | **C14.1 handoff honesty.** After accepted evidence/reconstruction is available in the connected test environment, inspect the web journey through C9 draft, C5 preview/confirmation and C10 scene.             | Native capture does not bypass C2/C5/C9/C10 boundaries. No C5 commit occurs from iOS capture itself; the distinct web confirmation remains necessary.                                                                                        | Correlated source receipt, draft/preview pins, commit audit ID and C10 source snapshot ID/hash.          |

## Privacy and log review

Before sharing any artifact, search exported logs and result bundles for:

- access/refresh tokens, Authorization headers and signing material;
- raw storage object keys, signed URLs and broad worker credentials;
- full addresses or unrelated room imagery;
- unredacted device/user identifiers not required by the restricted test record.

Training permission must remain separate from service processing and default to
denied. Store device UDIDs, signing/team details and property-identifying data in
the restricted engineering record, not in the repository.

## Expected evidence package

Create a dated directory outside the repository, for example:

`C14_1-apple-acceptance-<UTC_TIMESTAMP>/`

Include:

- `ENVIRONMENT.md`: git SHA, macOS, Xcode version/build, XcodeGen version,
  selected SDK/runtime, device model and iOS build;
- `COMMANDS.txt`: exact commands, start/end times and exit codes;
- `*.xcresult`: simulator build/test, physical SDK compile and signed
  physical tests as actually run;
- `TEST-SUMMARY.md`: discovered/executed/passed/failed/skipped counts with
  reasons;
- `device-console-redacted.log` and relevant server trace/request IDs;
- screenshots and screen recordings named by case ID;
- redacted immutable evidence manifests, SHA-256 listings, producer/tool
  versions and coordinate-system/unit declarations;
- offline/retry journal and server-reconciliation evidence;
- privacy/redaction checklist;
- `LIMITATIONS.md`: every case not run, unsupported device/provider state and
  any unavailable artifact.

Hash the package:

```sh
find C14_1-apple-acceptance-<UTC_TIMESTAMP> -type f -print0 \
  | sort -z \
  | xargs -0 shasum -a 256 \
  > C14_1-apple-acceptance-<UTC_TIMESTAMP>/SHA256SUMS
```

Do not claim a case from a screenshot alone. Preserve the xcresult/log/manifest
needed to correlate the visible behavior with the exact source and operation.

## Stop conditions

Stop and report, without working around the boundary, if:

- project regeneration changes the checked-in pbxproj;
- camera or RoomPlan starts on an unsupported/denied device state;
- a session resumes after interruption without explicit relocalisation or
  restart;
- source bytes, checksums or project ownership change across retry;
- training becomes enabled implicitly;
- logs expose credentials, signed locators or raw identifying data;
- captured/generated media changes canonical dimensions without typed,
  authorised, validated and audited confirmation;
- a C10 job is built from anything other than the exact committed current
  existing-profile snapshot.

Record the failure and preserve the minimal redacted evidence. Do not reinterpret
an unavailable physical case as a passing Simulator or fixture result.

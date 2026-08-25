# C14.1 Apple native capability audit — 2026-08-25

## Audit position

The native iPhone/iPad target is a useful capture and evidence client, but it is
not yet the complete standalone homeowner product. The accepted native path can
load a local-development project, evaluate capture eligibility, collect typed
C2 file evidence and exercise deterministic C7/C8 fixture states. It cannot yet
take a homeowner from property setup through canonical confirmation, design,
specification, renders and handoff without the web application.

This record audits baseline `5b719f9ab83616affc0eeb7de2ba73279bd93d5f`
and the narrow Apple correction at
`cc7bc757a4d0cc323e51f299bfdb9cffc984ee5c`. The correction connects the
unsupported-device manual route to the existing secure C2 evidence workspace,
removes wording that implied completed physical C7 validation and adds focused
unit/UI coverage. It does not change backend, web, shared contracts, signing or
sensor implementation.

Evidence classification: **Mac/Xcode plus visibly synthetic Simulator
software evidence**. No customer property, address, room media, credential,
signing identity, device identifier or physical capture artifact is recorded
in Git.

## Ordinary homeowner-visible flow

On an ordinary Debug launch, the app requests a local C1 session and project
list from the configured API. If the local service is absent, it shows a
bounded error and offers a clearly labelled deterministic local fixture. A
homeowner can select a project, inspect capture eligibility and choose camera,
RoomPlan workspace or manual evidence routes according to the reported state.

At `cc7bc757`, unsupported devices and Simulator users can continue through:

```text
project selection
  -> capture eligibility
  -> unsupported/manual fallback
  -> manual evidence checklist
  -> secure C2 file evidence workspace
```

The final workspace supports rights-basis selection, service-processing
consent and a separate training decision. Nothing is uploaded until the user
chooses a file and confirms the required rights/processing state. Training
defaults to denied.

## Capability inventory

| Area                         | Source/shipping status                                                                                                   | Accepted evidence                                              | Boundary still open                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Launch and projects          | C1 local-session/project client; deterministic Debug fallback                                                            | unit/UI plus visible Simulator journey                         | production authentication and environment are absent                                                                 |
| England property setup       | no native UI/client                                                                                                      | none                                                           | C3 postcode/address candidate and manual-selection journey is required                                               |
| Renovation intake/brief      | no native surface                                                                                                        | none                                                           | C1 intake and C11 brief APIs are not exposed in iOS                                                                  |
| File evidence                | C2 workspace for plan, photograph, video and document evidence; typed rights/consent; multipart hashing/upload           | unit/UI and Simulator navigation                               | a real service/file transfer was not accepted in this Mac run                                                        |
| Capability/permission gating | runtime capability model and safe unsupported route                                                                      | unit and Simulator states                                      | physical permission prompts and supported-device state are not accepted                                              |
| RoomPlan/ARKit               | lower-level session, coordinator, surface, normalization, artifact and interruption/relocalisation implementation exists | synthetic/unit/Simulator states                                | shipping `AppRootView` injects `C7UnavailableCaptureLauncher`; no production launcher presents the live surface      |
| Camera                       | AVFoundation engine for device builds; synthetic engine on Simulator                                                     | compilation and synthetic UI/state tests                       | real camera, lens, depth, thermal and system-pressure behavior are not accepted                                      |
| C7 upload/recovery           | typed capture API, protected journal, checksum-bound multipart and reconciliation code                                   | unit/synthetic and shared contract tests                       | live device/API/background/relaunch continuity is not accepted                                                       |
| C2/C8 media upload           | immutable C2 asset upload with protected local receipts                                                                  | unit/synthetic and contract tests                              | iOS does not start the C8 reconstruction job after upload                                                            |
| Offline/recovery             | protected C7/C8 journals and Keychain-backed token store                                                                 | deterministic unit/Simulator recovery states                   | real network loss, termination and relaunch remain physical/integration work                                         |
| Background transfer          | C7 configures a background URLSession                                                                                    | static/unit evidence                                           | no application-lifecycle background-session completion bridge was found; process-terminated completion is unaccepted |
| Processing                   | capture/upload states exist                                                                                              | fixture states only                                            | C6/C8/C9 job creation, polling and proposal continuity are not wired end to end                                      |
| Twin review/correction       | no native homeowner editor                                                                                               | none                                                           | C4/C5 reads, preview and explicit commit are not exposed natively                                                    |
| Design options               | no native surface                                                                                                        | none                                                           | C11/C12 are backend/web capabilities only                                                                            |
| Materials/specification      | no native surface                                                                                                        | none                                                           | C13 is backend/web only                                                                                              |
| Scenes/renders/walkthrough   | no native homeowner surface                                                                                              | none                                                           | native C10 scene exploration and C14 render flows are unaccepted                                                     |
| Approval/handoff             | no native completion path                                                                                                | none                                                           | standalone product journey remains incomplete                                                                        |
| iPhone/iPad UI               | universal target for both device families                                                                                | full iPhone Simulator suite and focused iPad Simulator journey | no physical iPhone/iPad layout, accessibility or sensor run                                                          |
| Signing/release              | automatic signing setting; generic `iphoneos` compile passes with signing disabled                                       | physical-SDK compile only                                      | no team resolves, Release API is `https://api.invalid`, and no signed install/archive/TestFlight run exists          |

## Registration finding

The real RoomPlan path is unavailable because it is not registered into the
shipping application composition. The default root receives
`C7UnavailableCaptureLauncher`, and the audit found no concrete production
`C7CaptureLaunching` implementation that presents the existing capture
surface. Capability/permission debugging cannot close this gap until the
feature is actually registered. This is a composition finding, not physical
RoomPlan success or failure evidence.

## Standalone journey comparison

| Intended native stage   | Status on 2026-08-25                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| onboarding              | development-local identity only; production onboarding absent                                   |
| property setup          | absent                                                                                          |
| renovation brief        | absent                                                                                          |
| plan/evidence upload    | useful C2 slice implemented and reachable                                                       |
| RoomPlan/camera capture | implementation present in part; real RoomPlan unregistered and all physical behavior unaccepted |
| processing status       | partial upload/fixture states; reconstruction orchestration absent                              |
| twin review/correction  | absent                                                                                          |
| explicit confirmation   | absent                                                                                          |
| design options          | absent                                                                                          |
| materials/specification | absent                                                                                          |
| renders/walkthrough     | absent                                                                                          |
| approval/handoff        | absent                                                                                          |

## Accepted versus unaccepted

Accepted for the named Mac/toolchain only:

- deterministic Xcode project generation;
- generic Simulator and unsigned physical-SDK compilation;
- complete iPhone Simulator test scheme;
- focused iPad Simulator fallback-to-evidence journey;
- the manual fallback navigation correction;
- synthetic/unit state, contract, privacy and canonical-boundary behavior.

Explicitly unaccepted:

- real RoomPlan, ARKit, camera, LiDAR or depth capture;
- physical measurement accuracy, connected-room registration or survey claims;
- production authentication, token refresh and non-placeholder Release API;
- signed installation, archive, TestFlight or App Store readiness;
- process-terminated background transfer and relaunch completion;
- native C10 scene exploration, C11/C12 design, C13 specification and C14
  render/walkthrough/approval flows.

Exact environment, commands and counts are recorded in
[C14_1_APPLE_XCODE_ACCEPTANCE_2026-08-25.md](C14_1_APPLE_XCODE_ACCEPTANCE_2026-08-25.md).
Shared-system requirements are in
[C14_1_WINDOWS_BACKEND_HANDOFF.md](../../runbooks/ios/C14_1_WINDOWS_BACKEND_HANDOFF.md),
and the remaining field work is in
[C14_1_ONE_BEDROOM_PHYSICAL_DEVICE_PLAN.md](../../runbooks/ios/C14_1_ONE_BEDROOM_PHYSICAL_DEVICE_PLAN.md).

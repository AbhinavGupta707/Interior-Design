# Home Design Capture for iOS

Native SwiftUI homeowner app for protected sign-in and session recovery, authorised project
creation/selection, England renovation intake and property context, rights-aware evidence upload,
capture guidance, and the confirmed-twin-to-render design loop. The address and property dossier
remain context only: neither establishes interior geometry, boundaries, survey truth or planning
approval.

The app can take a new homeowner from cold launch to a fresh server-derived statement that their
setup is ready for capture or eligible to begin a later plan proposal. It does not run C6 plan
processing, production C8 reconstruction, C9 fusion or C4/C5 confirmation, so it cannot yet create
its own confirmed twin.

## Requirements

- macOS with Xcode 26.4 (build `17E192`) or a compatible newer Xcode
- XcodeGen (`brew install xcodegen`); version 2.45.4 was used for the checked-in project
- an installed iOS Simulator runtime for unit tests

The checked-in `HomeDesignCapture.xcodeproj` builds without regenerating it. `project.yml` is the reproducible source of project structure and build settings.

## Generate the Xcode project

From this directory:

```sh
xcodegen generate --spec project.yml
git diff -- HomeDesignCapture.xcodeproj/project.pbxproj
```

The second command should report no change after generation with the verified XcodeGen version.

## Build for the Simulator

```sh
xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Run unit tests

List available destinations, then use an installed device name:

```sh
xcrun simctl list devices available
xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -destination 'platform=iOS Simulator,name=iPhone Air,OS=latest' \
  -derivedDataPath .build/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  test
```

If that model is not installed, replace only the `name` value with one from `simctl`.

## Open the built shell

With a Simulator booted:

```sh
xcrun simctl install booted .build/DerivedData/Build/Products/Debug-iphonesimulator/HomeDesignCapture.app
xcrun simctl launch --terminate-running-process booted com.homedesignstudio.capture
```

The generic physical-iOS branch can be compile-checked without signing or claiming a field test:

```sh
xcodebuild \
  -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath .build/DeviceDerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Runtime configuration

Non-sensitive build configuration lives in `Configurations/*.xcconfig` and is exposed through these Info.plist keys:

| Build setting                 | Process override                          | Purpose                                   |
| ----------------------------- | ----------------------------------------- | ----------------------------------------- |
| `APP_ENVIRONMENT`             | `HOME_DESIGN_ENVIRONMENT`                 | `local`, `staging`, or `production`       |
| `API_BASE_URL`                | `HOME_DESIGN_API_BASE_URL`                | Platform API base URL                     |
| `OIDC_AUTHORIZATION_ENDPOINT` | `HOME_DESIGN_OIDC_AUTHORIZATION_ENDPOINT` | Provider HTTPS authorization endpoint     |
| `OIDC_TOKEN_ENDPOINT`         | `HOME_DESIGN_OIDC_TOKEN_ENDPOINT`         | Provider HTTPS token endpoint             |
| `OIDC_CLIENT_ID`              | `HOME_DESIGN_OIDC_CLIENT_ID`              | Public native-client identifier           |
| `OIDC_REDIRECT_URI`           | `HOME_DESIGN_OIDC_REDIRECT_URI`           | Exact registered callback URI             |
| `OIDC_SCOPES`                 | `HOME_DESIGN_OIDC_SCOPES`                 | Space-separated scopes including `openid` |

Debug builds default to the local platform API at `http://127.0.0.1:4100` and use the conspicuous
local-fixture identity endpoint. Staging and Release builds fail closed until all OIDC fields are
supplied. The checked-in Release values use deliberately non-resolving HTTPS placeholders. The
loader rejects malformed URLs, embedded credentials, non-HTTPS remote endpoints, non-loopback
plain HTTP, invalid scopes and any redirect other than
`com.homedesignstudio.capture.auth:/oauth/callback`.

This is an OAuth 2.1/OIDC public-client flow using Authorization Code + PKCE through
`ASWebAuthenticationSession`; no client secret belongs in the app. Access and refresh credentials
are stored in ThisDeviceOnly Keychain items. Do not place tokens, client secrets, signing
credentials, addresses or other customer data in the project, xcconfig files, schemes, Info.plist
or process arguments.

Cold launch validates recovered credentials against `GET /v1/session` before showing projects and
revalidates a protected last-project UUID against the fresh project list. Cached identity or
project values never confer membership. Offline cold launch stays locked; mutations are not queued
or inferred complete.

## Capability and physical-device limits

- `SystemCaptureCapabilityChecker` is the single current RoomPlan capability boundary.
- Simulator builds always return `simulatorUnsupported`; they never construct a capture session or claim camera, LiDAR, AR tracking, or RoomPlan support.
- A physical device is considered eligible only when `RoomCaptureSession.isSupported` is true.
- Existing C7/C8 code provides protected capture preparation, interruption/recovery and immutable
  C2 upload paths. The repository's Simulator checks prove only app behavior; they are not a
  physical-device, camera, background transfer, RoomPlan/LiDAR or production reconstruction claim.
- Manual plan/photo/video/document upload remains the honest route when native capture is
  unsupported or unavailable. A ready upload is source evidence, never canonical dimensional
  truth.

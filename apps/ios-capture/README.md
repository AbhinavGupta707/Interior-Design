# Home Design Capture for iOS

Native SwiftUI substrate for project selection and capture eligibility. C0 deliberately does not start a RoomPlan or ARKit session: the Simulator is useful for application-state tests only, and unsupported hardware is routed to a manual plan/photo/measurement workflow. Physical capture is owned by checkpoint C7.

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

| Build setting     | Process override           | Purpose                             |
| ----------------- | -------------------------- | ----------------------------------- |
| `APP_ENVIRONMENT` | `HOME_DESIGN_ENVIRONMENT`  | `local`, `staging`, or `production` |
| `API_BASE_URL`    | `HOME_DESIGN_API_BASE_URL` | Platform API base URL               |

Debug builds default to the local platform API at `http://127.0.0.1:4100`. Release builds use the deliberately non-resolving `https://api.invalid` placeholder until an integration environment supplies a real endpoint. The loader rejects malformed URLs, embedded credentials, non-HTTPS remote endpoints, and non-loopback plain HTTP.

Do not place access tokens, client secrets, signing credentials, or customer data in the project, xcconfig files, schemes, Info.plist, or process arguments. Authentication material belongs in the iOS Keychain once the identity integration is implemented.

## Capability and physical-device limits

- `SystemCaptureCapabilityChecker` is the single current RoomPlan capability boundary.
- Simulator builds always return `simulatorUnsupported`; they never construct a capture session or claim camera, LiDAR, AR tracking, or RoomPlan support.
- A physical device is considered eligible only when `RoomCaptureSession.isSupported` is true.
- C0 stops at an eligibility-confirmed placeholder even on supported hardware. Camera permission, RoomPlan/ARKit session lifecycle, interruption/relocalisation, capture quality, source packaging, and upload are C7 work.
- Simulator build/test evidence cannot close the C7 or C18 physical-device gates. Those gates require named supported LiDAR iPhone/iPad field runs with the device model and iOS version recorded.

The manual fallback is intentionally informational in C0. Evidence selection/upload is implemented in C2; this shell only provides an honest route for users whose device cannot perform RoomPlan capture.

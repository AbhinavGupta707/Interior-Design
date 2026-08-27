# C14.8 physical Apple-device capture handoff

## Gate state

**NOT RUN — no authorised physical iPhone or iPad was connected on 2026-08-26/27.**

The C14.8 Simulator journey proves navigation, disclosure, deterministic guidance fixtures and
state isolation only. It does not prove camera delivery, ARKit tracking, intrinsics, camera poses,
scene depth, RoomPlan, interruption behavior, protected relaunch, background transfer, thermal
behavior or representative-home usefulness.

Run this handoff against the exact final C14.8 PR head. Keep property media, device identifiers,
signing material, addresses and raw logs in approved restricted storage; Git may retain only
redacted aggregate results and non-identifying hashes.

## Required devices and minimum matrix

1. A non-LiDAR iPhone 12 (`iPhone13,2`) or another ordinary ARKit world-tracking iPhone. This is the
   mandatory baseline and must report `guided-rgb` with RGB keyframes, camera-to-world ARKit poses
   and native-raster intrinsics. Absence of depth and RoomPlan must not block acceptance.
2. A LiDAR-capable iPhone Pro or iPad Pro, if available. It must retain the same RGB baseline and may
   additionally report `guided-rgb-depth` or `guided-rgb-depth-roomplan`. Optional evidence must be
   absent, rather than invented, when runtime support or delivery is unavailable.
3. One supported iPad form factor only if the product intends to claim physical iPad usability.

For every run record the committed 40-character app SHA, Xcode build, app version/build, device
model class, iOS build and runtime capability declaration. Do not record UDID, serial number,
Apple ID or provisioning identifiers in Git.

## Build and preflight

```sh
git fetch origin
git checkout <exact-c14-8-pr-head>
git status --short --branch
cd apps/ios-capture
xcodegen generate
xcodebuild -project HomeDesignCapture.xcodeproj \
  -scheme HomeDesignCapture \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  build
```

Use a separately authorised signing team, non-production API and homeowner test account. Do not
commit signing or environment changes. Confirm current owner/editor membership and service-
processing consent; training use must remain denied. Remove or cover documents, screens, faces,
photographs, medicines and other sensitive material before capture.

## Capture journeys

Run one single-room journey and one small-apartment journey on the non-LiDAR phone. If a LiDAR
device is available, repeat the single-room journey with optional depth enabled and attach an
independently accepted RoomPlan package only through the existing C7 path.

For each room:

1. Enter guided capture from the ordinary homeowner hub and confirm the capability explanation
   matches runtime support.
2. Move slowly through all eight horizontal sectors and lower/middle/upper bands. Exercise one
   deliberately missing cell and one safely occluded cell; accept the incomplete package only if
   both remain explicit.
3. Exercise normal, fast-motion, low-light and bounded blur conditions without creating a trip
   hazard. Record whether advice changes while capture continues safely.
4. Mark structural evidence, fixed fittings, movable furniture, appearance and temporary clutter
   separately. Confirm no label creates dimensions or canonical geometry.
5. End and upload. Verify each C2 RGB asset hash, every optional depth artifact hash, the accepted
   envelope hash and its terminal `accepted` state. Explicitly start C8 and confirm the resulting
   job remains a proposal.

## Fail-safe matrix

| Case                     | Required action                                                | Required result                                                        |
| ------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Camera permission        | deny, then grant in Settings                                   | no session on denial; clear recovery; no false capability              |
| Short interruption       | Control Centre/background briefly                              | interruption is visible and a new independent segment begins           |
| Process relaunch         | terminate after a protected draft exists                       | protected scoped journal loads; a new relaunch segment begins          |
| Offline upload           | remove network after local package creation                    | completed receipts persist; missing parts resume idempotently          |
| Expired signed URL       | allow one upload signature to expire                           | reconcile server state and obtain a new bounded signing generation     |
| Project switch           | switch while load/upload is in flight                          | old draft and late response cannot appear or mutate in the new project |
| Role downgrade           | change owner/editor to viewer while active                     | capture/accept/reconstruction actions revoke immediately               |
| Rights/source change     | withdraw C7 rights or quarantine a C2 source before transition | envelope read/reconstruction fails closed; no C8 job is created        |
| Tracking loss            | low-feature view followed by recovery                          | limited tracking is retained; no silent segment registration           |
| Storage/thermal pressure | observe bounded natural warning or safe test condition         | honest degradation/stop; incomplete bytes are not published            |

## Evidence and verdict

Retain, outside Git, screen recordings, redacted console logs, request/trace IDs and the exact raw
hash chain. The Git evaluation update may record only:

- per-device capability tier and pass/fail/not-run rows;
- room/keyframe/depth/segment counts and aggregate coverage/quality warnings;
- envelope/C8 identifiers in redacted or hashed form;
- interruption, recovery, project/role/rights isolation outcomes; and
- privacy scan results proving no bearer token, signed URL, object key, address, raw image bytes,
  local path or device identifier leaked to logs or the protected journal.

Do not call C14.8 physically accepted until the ordinary non-LiDAR baseline passes. LiDAR success
cannot substitute for it. No result is survey, structural, regulatory, cost, availability or
professional evidence.

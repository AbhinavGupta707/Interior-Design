# C14.1 one-bedroom physical Apple device plan

## Gate status and scope

**NOT RUN — PHYSICAL ROOMPLAN/LIDAR/ACCURACY AND BACKGROUND GATES REMAIN OPEN.**

This plan is bounded to one England-based, one-floor, one-bedroom apartment
owned or controlled by the tester. It evaluates concept-grade consumer capture,
recovery and independent visible-span comparison. It is not a measured survey,
structural assessment, regulatory review, valuation or professional sign-off.

This plan supplements the general
[C7 physical-device field protocol](c7-physical-device-field-protocol.md) and
uses the controlled
[C7 release evidence template](c7-release-evidence-template.md). The general
F1–F6 gate remains authoritative; this document specifies the representative
apartment execution.

## Preconditions

- Use a LiDAR-capable iPhone or iPad for which
  `RoomCaptureSession.isSupported` returns true at runtime. Record exact model,
  iOS build, app build and capability result in the restricted evidence record,
  never in Git.
- Use a separately authorised signed build and approved non-production API.
  Supply team/signing/authentication configuration locally; do not commit it.
- Confirm the homeowner and all occupants/visitors consent and select an empty
  test window.
- Remove or cover letters, identity documents, family photographs, screens,
  medication and other personal/special-category information. Exclude
  neighbours, communal areas and exterior passers-by.
- Confirm evidence rights and service-processing consent before upload.
  Training permission remains denied unless separately, explicitly and
  revocably granted; it is never a condition of service.
- Start above 70% battery, close unrelated sensor apps and record available
  storage, network and thermal state. Do not create trip hazards for low-light
  or measurement cases.
- Prepare a laser measure (preferred) or steel tape, a floor sketch, numbered
  measurement sheet and safe endpoint markers.

## Independent reference measurements

Record instrument make/model, nominal tolerance, operator and timestamp.
Reference measurements are user assertions and remain separate from RoomPlan
output. Do not copy RoomPlan values into the reference sheet.

Measure at least:

1. clear living/kitchen length and width;
2. clear bedroom length and width;
3. hall/circulation length and width;
4. ceiling height in at least two rooms;
5. each principal door opening width and height;
6. representative window width, height and sill height;
7. at least two diagonals or independent cross-check spans; and
8. two fixed-feature offsets, such as kitchen run and bathroom doorway
   position.

For each span, record named endpoints, integer millimetres, a repeat reading,
instrument uncertainty and any obstruction. Retain a privacy-safe endpoint
photograph only when it materially disambiguates the measurement; hash and
store it as controlled immutable evidence outside Git.

## Scan sequence

1. Create/select the test project and confirm the intended property. Property
   context remains non-interior evidence.
2. Review privacy and scan guidance; choose the bounded one-floor/one-bedroom
   mode.
3. Begin in a distinctive, well-lit common area. Move slowly around the
   perimeter, showing each wall-floor junction and opening from more than one
   angle.
4. Capture living/kitchen, hall and bedroom through continuous overlap. Keep
   motion smooth and minimise moving people/doors, mirrors and transparent
   surfaces.
5. Pause at doorways to preserve overlap. Do not combine separately originated
   sessions unless compatible shared-world registration is proved.
6. Return to the start area before finishing to provide a relocalisation loop.
7. Review room/opening counts, coverage warnings, unknowns and reference
   measurement status. Reject incomplete/incompatible sessions rather than
   editing source evidence.
8. Finish, package and upload. Record immutable artifact hashes and verify the
   UI labels output as a proposal with no canonical commit.

Run three independent scans with the same apartment state where practical.
Reset between scans unless the named case is explicitly testing relocalisation
reuse.

## Physical interruption and recovery matrix

| Case                              | Action                                                                 | Expected fail-safe result                                                                 |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| camera permission                 | grant, deny, restricted and Settings recovery                          | session starts only after valid grant; otherwise clear fallback to C2 evidence            |
| short interruption                | briefly open Control Centre or background for about 10 seconds         | explicit pause/relocalise or restart; no silent coordinate jump                           |
| camera/system interruption        | use an approved camera/system interruption                             | bounded interruption state and safe resume/restart                                        |
| lock/background                   | lock briefly, then return                                              | protected state; resume only when compatible, otherwise restart                           |
| low texture/light                 | exercise one safe bounded degraded area                                | quality guidance/unknown coverage, never fabricated geometry                              |
| relocalisation success            | leave and return through captured overlap                              | explicit compatible-origin success                                                        |
| relocalisation failure            | return without sufficient overlap or after incompatible restart        | fail closed; incompatible frames are not merged                                           |
| network loss during upload        | disable network after durable package creation                         | protected journal and idempotent retry without duplicate artifact/job                     |
| process termination after package | terminate after durable package creation, relaunch and restore network | server reconciliation, missing-parts-only resume and one completion; no secret in journal |
| thermal/system/storage pressure   | observe only within safe normal operation                              | honest degraded/stop state; incomplete bytes are not published                            |

Do not force-terminate an unpersisted live sensor session and describe that as
upload recovery. Report live-capture recovery and post-package transfer
recovery separately.

## Accuracy comparison and reporting

For every matched reference span, compute absolute error in millimetres and
relative error percentage. Report median, 90th percentile and maximum error,
plus room/opening topology mismatches, missing/duplicate surfaces,
relocalisation outcomes and all exclusions. Retain every failed, abstained and
missing attempt in the denominator.

No threshold is predeclared as survey-grade. Initial runs establish an
empirical distribution only. A later product tolerance must be justified for
the consumer decision, device class and property conditions and must preserve
visible uncertainty.

## Required evidence

- exact release SHA, app build, device model class, iOS build and runtime
  support result in the restricted record;
- signed build/test result and redacted device console;
- screen recording for capture, interruption/relocalisation and recovery;
- immutable source/artifact/package/proposal hash chain;
- rights record and separate service/training states;
- independent measurement sheet and aggregate error report;
- upload request/trace identifiers and server reconciliation evidence;
- privacy/log scan proving no token, signed URL, object key, address, raw room
  media, world map or local path leaked;
- physical iPhone and physical iPad layout/accessibility observations where
  both product families are claimed.

Raw property media, measurements that locate the home, device identifiers,
signing details and provider locators stay in controlled storage, not Git.

## Cases remaining after the 2026-08-25 Mac acceptance

- supported and unsupported physical iPhone/iPad capability states;
- first camera grant, denial, restriction and Settings recovery;
- real RoomPlan one-room and connected one-floor apartment capture;
- real AVFoundation photo/video and depth delivery where supported;
- interruption, relocalisation success/failure and incompatible-origin restart;
- thermal, system-pressure, tracking and storage-pressure behavior;
- offline, background and process-terminated multipart recovery;
- production authentication/environment and signed install/relaunch;
- repeated independent laser/tape comparison;
- privacy deletion/withdrawal and training-denied persistence;
- physical VoiceOver, Dynamic Type and iPhone/iPad layout inspection.

Simulator navigation, generic `iphoneos` compilation and synthetic fixtures do
not close any item above.

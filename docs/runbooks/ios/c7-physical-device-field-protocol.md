# C7 physical-device RoomPlan field protocol

## Gate status at worker completion

**NOT RUN — C7/C18 RELEASE BLOCKER.**

On 17 July 2026, Xcode 26.4 (`17E192`) reported one Mac and nine iOS 26.4 Simulators through `xcrun xctrace list devices`. It reported no physical iPhone or iPad. The command was rerun with normal Xcode cache access after a sandboxed attempt failed to initialise Instruments caches. No fixture, Simulator result or generic build changes this status.

## Purpose and non-claims

This protocol produces field evidence for permission handling, one-room capture, connected-room structure capture, interruption recovery, RoomPlan guidance, resumable upload and source/proposal linkage. It does not establish survey accuracy, hidden construction, structural condition, regulatory compliance or professional approval.

Use only a supported physical LiDAR iPhone/iPad for which `RoomCaptureSession.isSupported` is true at runtime. Do not infer support from model name. Never use a Simulator/Mac Catalyst result for a field case.

## Safety, privacy and rights preflight

1. Use a controlled test property with explicit written capture/evaluation permission. Prefer an unoccupied test setting; remove people, documents, screens, keys and personal photographs.
2. Create a new server capture brief with service processing allowed for this evaluation purpose and training use denied. Record the rights-record identifier in the controlled evidence system, not Git.
3. Record device model identifier, OS version, app version/build, release Git SHA, contract versions and RoomPlan runtime support. Do not record serial number, advertising identifier, Apple ID, address, token, signed URL, object key or local path.
4. Confirm protected local storage and Keychain configuration. Confirm the build does not retain camera frames and excludes world maps from server packages/telemetry.
5. Prepare an independent laser/tape reference for named visible source entities. A user measurement remains a user assertion and does not become sensor truth.
6. Start a structured log capture with seeded non-secret canaries. Logs must use route templates/bounded codes and remain free of identifiers/raw artifacts/locators.

For every case, record `PASS`, `FAIL` or `NOT RUN` and a reason. Do not omit failed attempts.

## F1 — Camera permission denial

1. Reset camera permission for the test app using Settings or uninstall/reinstall.
2. Open the supported capture route and choose **Do not allow** at the real iOS camera prompt.
3. Verify no RoomPlan/AR session starts, no source artifact/session upload is created, denial guidance is accessible and plan/photo/manual fallback remains reachable.
4. Background/foreground once and relaunch. Verify denial state remains honest and retry routes through system settings or a fresh permission decision; the app must not fake authorisation.
5. Capture screenshot/video, timestamp and bounded app/API logs.

Pass requires all five observations on physical hardware. Injected/Simulator permission states do not count.

## F2 — One room

1. Create a fresh `single-room` brief and record its expiry/mode/rights hashes.
2. Capture one conventional room. Follow the exact RoomPlan instruction stream; do not suppress low-light/low-texture warnings.
3. Stop and review before packaging. Verify the room label, quality summary, reference measurement status and statement that classification confidence is not measurement accuracy.
4. Accept and upload. Record immutable artifact kinds, byte sizes and SHA-256 values in the controlled evidence report.
5. Verify one normalized artifact and one quality manifest, exact source hashes, no camera frames/world map and one proposal or explicit abstention.
6. If proposed, verify existing-state status, source mappings, findings/unknowns and no C5 preview/commit/canonical mutation.

## F3 — Two connected rooms and structure merge

1. Create a fresh `structure` brief with expected room count at least two.
2. Capture room A. Stop it while preserving the shared AR session/world origin; review and continue without restarting the coordinate space.
3. Move through the shared opening and capture connected room B. Preserve ordered room manifests.
4. Build/review the structure. Verify the UI identifies two rooms and one compatible shared world origin before acceptance.
5. Upload one captured-room JSON per room, exactly one captured-structure JSON, normalized/quality artifacts and optional USDZ with exact hashes.
6. If merge reports incompatible coordinates, record an `incompatible-world-space` abstention. Never force or relabel the rooms as one structure.

Pass requires an actual two-room `CapturedStructure` result on physical hardware plus server package/proposal or safe abstention evidence. Two synthetic room objects do not count.

## F4 — Interruption and relocalisation or safe restart

1. During an active structure capture, cause one safe interruption (lock/unlock, approved app switch or documented AR interruption) without endangering the operator.
2. Verify the app shows interrupted then bounded relocalising guidance and offers explicit restart.
3. Return to the mapped origin and attempt relocalisation within the product bound.
4. On success, continue and record relocalisation attempt/success counts. On failure, use **Safe restart** and verify previously incompatible rooms are cleared/not merged and the world-space generation changes.
5. Inspect the server package and telemetry: no local world map, raw JSON, token, URL or path may appear.

Either demonstrated relocalisation or demonstrated safe restart can satisfy the recovery branch, but the chosen result must be physical, attributable and failure-inclusive.

## F5 — Low-light and low-texture guidance

1. In a safe controlled room, reduce illumination enough for RoomPlan to emit `turn-on-light`; do not work in darkness or create a trip hazard.
2. Present a plain low-texture surface so the exact `low-texture` instruction is observable.
3. Verify exact instruction presentation is perceivable with VoiceOver, provides a safe corrective action and does not claim the count proves completeness/accuracy.
4. Restore safe lighting/texture and verify guidance updates. Record instruction counts in the quality manifest.

If the framework does not emit a required instruction during the controlled attempt, record `FAIL` or `NOT RUN` with reason; do not inject the instruction and call it physical evidence.

## F6 — Offline and resumable upload

1. Complete capture/review and begin upload with at least two parts in the test package where naturally produced; do not pad source evidence solely to manufacture size.
2. Disable network using the device control appropriate to the field environment. Verify offline/paused status while protected descriptors/checksums persist.
3. Background long enough for the app to enter its documented background state, then foreground. A terminated sensor session must not claim live resume.
4. Restore network. Verify the app first reconciles server-recorded part numbers/checksums, then uploads only missing parts.
5. Interrupt completion once in the controlled live harness. Verify retry is idempotent, conflicting replay fails and one immutable package results.
6. Record session/package/proposal IDs only in the controlled evidence system. Export a redacted hash chain: source SHA-256 list → package manifest SHA-256 → normalized input SHA-256 → converter manifest SHA-256 → proposal/package SHA-256.

Pass requires real device background/network behaviour and live API/object/persistence evidence. A reference multipart machine alone does not count.

## Closeout

1. Run the full evidence template and retain failures.
2. Verify source/proposal objects are immutable and the source bucket contains no camera frames.
3. Scan logs/crash/analytics output for seeded canaries, bearer fragments, query signatures, object-key prefixes, IDs, local paths, `worldMap`, raw JSON and Apple encodings.
4. Revoke the evaluation session/rights as planned and verify new worker lease/publication fails closed.
5. Store artifacts under approved retention/access policy. Commit only redacted aggregate results and hashes that cannot locate the source.

The field gate closes only when the release evidence is reviewed and all mandatory F1–F6 cases are `PASS`. Any `FAIL` or `NOT RUN` keeps the C7/C18 blocker open.

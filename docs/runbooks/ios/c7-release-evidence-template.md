# C7 native capture release evidence template

Do not pre-fill a pass. Copy this template into the controlled release evidence location for each candidate. Keep raw artifacts and sensitive locators outside Git.

## Candidate identity

| Field                                                  | Value            |
| ------------------------------------------------------ | ---------------- |
| Evidence record ID                                     |                  |
| Evidence date/time and timezone                        |                  |
| Operator/reviewer identities                           |                  |
| Release Git SHA                                        |                  |
| App version/build                                      |                  |
| iOS device model identifier (no serial/advertising ID) |                  |
| iOS version                                            |                  |
| `RoomCaptureSession.isSupported` result                |                  |
| C7 contract versions                                   |                  |
| API/worker/converter versions and manifest SHA-256     |                  |
| Rights record ID and permitted evaluation purpose      |                  |
| Service processing                                     | allowed / denied |
| Training use                                           | denied           |
| Physical hardware inventory evidence                   |                  |

## Automated evidence

| Gate                                  | Command/artifact | Executed | Passed | Failed | Skipped | Evidence link/hash |
| ------------------------------------- | ---------------- | -------: | -----: | -----: | ------: | ------------------ |
| mobile TypeScript conformance         |                  |          |        |        |         |                    |
| capture security reference            |                  |          |        |        |         |                    |
| RoomPlan evaluation                   |                  |          |        |        |         |                    |
| full `pnpm verify`                    |                  |          |        |        |         |                    |
| Xcode regeneration stability          |                  |          |        |        |         |                    |
| Simulator full scheme                 |                  |          |        |        |         |                    |
| integrated C7 XCUITest                |                  |          |        |        |         |                    |
| generic physical-iOS no-signing build |                  |          |        |        |         |                    |
| disposable C1–C7 migrations           |                  |          |        |        |         |                    |
| live API/storage/worker security      |                  |          |        |        |         |                    |
| live log canary/redaction scan        |                  |          |        |        |         |                    |

Label Simulator rows `non-RoomPlan`. A skipped integrated/live test is `NOT RUN`, not a pass.

## Physical field matrix

| Case                                             | Attempt IDs | Status (`PASS`/`FAIL`/`NOT RUN`) | Expected/observed result | Evidence link/hash | Failure/limitation |
| ------------------------------------------------ | ----------- | -------------------------------- | ------------------------ | ------------------ | ------------------ |
| F1 permission denial + fallback                  |             |                                  |                          |                    |                    |
| F2 one room                                      |             |                                  |                          |                    |                    |
| F3 two connected rooms / structure               |             |                                  |                          |                    |                    |
| F4 interruption + relocalisation or safe restart |             |                                  |                          |                    |                    |
| F5 low-light guidance                            |             |                                  |                          |                    |                    |
| F5 low-texture guidance                          |             |                                  |                          |                    |                    |
| F6 offline/background resumable upload           |             |                                  |                          |                    |                    |
| VoiceOver on physical device                     |             |                                  |                          |                    |                    |
| thermal/tracking observation                     |             |                                  |                          |                    |                    |

Never enter a fixture result as a physical attempt. Retain every failed/abstained/missing attempt in the evaluation denominator.

## Source and proposal linkage

| Link                                   | SHA-256 / version (redacted non-locating value only) |
| -------------------------------------- | ---------------------------------------------------- |
| each captured-room encoding            |                                                      |
| optional captured-room-data encoding   |                                                      |
| captured-structure encoding            |                                                      |
| normalized RoomPlan artifact           |                                                      |
| quality manifest                       |                                                      |
| optional USDZ                          |                                                      |
| package manifest                       |                                                      |
| normalized input consumed by converter |                                                      |
| converter manifest                     |                                                      |
| proposal or abstention record          |                                                      |
| canonical mutation count (must be 0)   |                                                      |

Confirm separately:

- [ ] Every artifact ID/kind/media type/byte size/hash matches upload and package records.
- [ ] Proposal/abstention links to the exact package and converter inputs.
- [ ] Source bucket objects are immutable.
- [ ] No camera frames or world map appear in the server package.
- [ ] No C5 preview/commit or canonical mutation was invoked.

## Security and privacy observations

- IDOR/disclosure-order result:
- rights withdrawal/cancellation/retry-fence result:
- duplicate/out-of-order/replay/expired URL/interrupted completion result:
- hostile JSON/media/resource-limit result:
- log canary scan command and result:
- tokens/URLs/object keys/local paths/raw payload/world maps found (must be none):
- retention/deletion action and owner:

## Release decision

| Decision item                     | Value                 |
| --------------------------------- | --------------------- |
| Physical field gate               | PASS / FAIL / NOT RUN |
| C7/C18 release blocker            | OPEN / CLOSED         |
| Evaluator promotion eligibility   | true / false          |
| Unresolved critical/high findings |                       |
| Approved limitations              |                       |
| Accountable reviewer and date     |                       |

The blocker may be marked `CLOSED` only when F1–F6, physical VoiceOver, live security/storage/worker evidence and the full integrated gates pass. Otherwise record `OPEN` with an owner and next action.

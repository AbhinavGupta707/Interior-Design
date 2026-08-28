# C14.10 physical capture-quality and resilience handoff

## Gate state

**NOT RUN — C14.10 has only software, compile and Simulator evidence.**

Run this handoff against the exact final non-draft C14.10 PR head. Keep raw property media,
addresses, people, device identifiers, signing material, credentials, signed URLs and detailed logs
in approved restricted storage. Git may contain only privacy-minimised aggregates and non-identifying
hashes.

This protocol cannot produce survey, structural, regulatory or professional evidence. It may
evaluate capture usefulness and proposal-only reconstruction quality. Any dimensional claim needs
separately rights-cleared ground truth and its own acceptance protocol.

## Required matrix

1. Mandatory ordinary non-LiDAR ARKit iPhone baseline. Repeat the accepted C14.8 room journey using
   C14.10 continuous automatic selection.
2. One rectangular room and one irregular or multi-zone room. Declare zones before capture and keep
   occluded/unresolved zones explicit.
3. Optional LiDAR-capable iPhone/iPad row, only if available. Record LiDAR, scene-depth and RoomPlan
   independently; none may substitute for the ordinary-phone baseline.
4. Record the exact 40-character PR head, Xcode/iOS builds, app version, device model class and
   declared runtime capabilities. Do not record UDID, serial number, Apple ID or provisioning data.

## Privacy and authority preflight

- Use an authorised non-production project and owner/editor account. Confirm current capture and
  source rights before each transition.
- Confirm service processing is granted only as required and training remains denied.
- Remove or cover faces, documents, screens, medicines and other sensitive material.
- Confirm Release contains neither the shared golden fixtures nor Debug scenario/fault-injector
  markers.
- Never bypass backend project, role, rights, C2/C7 source or envelope acceptance checks to create a
  fault. Use a safely controlled test account/project and preserve source bytes.

## Capture journeys

For each room, begin from the ordinary homeowner hub and use continuous automatic capture. Walk
slowly around room edges, keep the prior wall/corner visible, step sideways to create parallax, pass
through every connected zone and finish near the start. Verify:

- automatic keyframes remain at least two seconds apart and within 256 per room / 512 per envelope;
- blurred, badly exposed, fast-motion, tracking-limited, feature-poor, weak-overlap,
  low-translation, low-parallax and near-duplicate candidates are skipped with useful guidance;
- retained frames form connected useful routes with translation, overlap, parallax, feature,
  trajectory and loop-closure evidence;
- completing the direction/height grid while rotating in place does not mark the room ready;
- the rectangular room can close one route, while every non-occluded irregular/multi-zone area needs
  its own retained evidence;
- manual retention is an accessible fallback and observes the same quality gates; and
- unresolved areas and incomplete acceptance remain explicit without claiming accuracy.

Record aggregate retained/skipped counts and reason categories, segment counts, zone readiness,
trajectory span/travel, loop closures and the privacy-minimised envelope hash. Do not commit raw
frames, poses, room layout, identifiers or precise property telemetry.

## Safe resilience journeys

| Case                                     | Physical action                                                                                       | Required result                                                                                                  | Status    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| Real process termination                 | Terminate the app after retained evidence and relaunch                                                | Earlier bytes remain hash-identical; a new independent segment is persisted before capture restarts              | `NOT RUN` |
| Offline transfer                         | Disable networking after local retention and re-enable it                                             | No false acceptance or duplicates; protected receipts reconcile and remaining parts resume                       | `NOT RUN` |
| Expired authentication/capture authority | Expire or revoke the controlled test session                                                          | Mutation stops; reauthentication/current authority is required; retained evidence is not reassigned              | `NOT RUN` |
| Expired signed upload access             | Allow one controlled signed part URL to expire                                                        | Stale access is discarded and a bounded fresh generation is obtained after reconciliation                        | `NOT RUN` |
| Project switch                           | Switch projects while retention/submission is in flight                                               | Late results cannot appear in or mutate the new project                                                          | `NOT RUN` |
| Role/rights downgrade                    | Safely downgrade owner/editor or withdraw test-source rights in flight                                | Capture/submit/reconstruction actions fail closed; no C8 job or canonical mutation is created                    | `NOT RUN` |
| Resource pressure                        | Observe natural low-storage/thermal warnings or a safe controlled condition; do not endanger hardware | Optional depth and analysis degrade before capture stops; immutable RGB stays intact; incomplete state is honest | `NOT RUN` |

Do not deliberately overheat a device, exhaust its storage, corrupt media, disable operating-system
safety controls or claim exact thermal/storage thresholds from a natural observation.

## Proposal-only visual follow-up

After the capture and transfer are accepted under current authority, explicitly create only the
existing C8 proposal. Re-run the C14.9 isolated visual-quality benchmark using the privacy-preserving
handoff and compare registration, fragmentation, room continuity, surface completeness and consumer
presentation usefulness with the accepted C14.8 envelope. Keep every result proposal/evaluation-only.

Record runtime compatibility, repeatability and visual-quality verdicts separately. Do not infer
dimensions from ARKit poses, depth, appearance, splats, renders or visual improvement. If a segment
cannot be registered, retain it independently and report the abstention.

## Physical result record

| Row                                    | Result    |
| -------------------------------------- | --------- |
| Non-LiDAR rectangular capture          | `NOT RUN` |
| Non-LiDAR irregular/multi-zone capture | `NOT RUN` |
| Real termination/relaunch              | `NOT RUN` |
| Offline and authority transitions      | `NOT RUN` |
| Safe resource observation              | `NOT RUN` |
| Optional LiDAR/scene-depth/RoomPlan    | `NOT RUN` |
| VoiceOver field usability              | `NOT RUN` |
| C14.9 proposal visual-quality rerun    | `NOT RUN` |
| Rights-cleared dimensional evaluation  | `NOT RUN` |

The checkpoint may be called physically accepted only when both mandatory non-LiDAR room journeys
and every applicable safe-resilience row pass on the exact reviewed build. Optional sensor success
does not close a failed ordinary-phone row, and Simulator evidence never fills this table.

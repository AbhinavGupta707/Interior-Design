# C14.3 Mac/iPad Design Studio Handoff

## Status and decision boundary

**Native/device cases NOT RUN — shared C14.4 continuity contract accepted on Mac, 2026-08-26.**

No Xcode build, Simulator, signed device build, RoomPlan/LiDAR/camera capture, background transfer,
native C10–C14 flow or physical Apple-device case was run in C14.3. The repository's native client
currently covers setup/evidence/capture through C8 and does not implement a standalone C10–C14
design loop.

The two provisional shared gaps are now resolved by C14.4 implementation commit `aae3379` and the
pinned generated TypeScript/Swift contract. This does not satisfy any native UI, Xcode/Simulator,
physical-device, authentication-lifecycle, background-transfer, RoomPlan/LiDAR or camera case below.
C8 v1 remains authoritative; C8-v2 stays acceptance-only; reconstruction never becomes canonical
truth without C5 validation and commit.

## Authentication, scoping and mutation rules

- Platform paths below are under `/v1` and require a bearer token in `Authorization`. Web browser
  routes under `/api/c10` … `/api/c14` use the server-owned `hds_c1_session` cookie and must not be
  copied as native authentication design.
- Every request is tenant/project scoped on the server. Treat 401 as expired/invalid session, 403
  as forbidden role, 404 as absent or intentionally undisclosed foreign state, 409 as stale/conflict,
  422 as strict validation/semantic rejection and 503 as capability unavailable.
- Every mutation uses the contract schema. Mutations that accept `Idempotency-Key` require a UUID;
  where the body also carries an idempotency/client-message ID, it must equal the header.
- Cancel/retry bodies carry `expectedVersion`. C11 brief updates/acceptance, C12 confirmation, C13
  selection/substitution and C14 enhancement carry their contract-specific exact revision/hash/
  version pins. Never rebase or silently retry stale state on-device.
- Owner/editor may perform only their existing authorised actions. Viewer is read-only. Service or
  machine actors cannot confirm a C13 substitution.
- Persist only bounded typed records. Never persist bearer tokens in logs, source bytes in journey
  state, signed artifact URLs past their TTL, or raw address/provider payload as interior truth.

## Exact existing C10 routes

| Method | Route                                                         | Mobile purpose and pins                                                                               |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| POST   | `/v1/projects/:projectId/scene-jobs`                          | Create from exact server-readable committed snapshot reference; UUID idempotency header; returns 201. |
| GET    | `/v1/projects/:projectId/scene-jobs`                          | Restore project scene jobs.                                                                           |
| GET    | `/v1/projects/:projectId/scene-jobs/:sceneJobId`              | Poll exact version/state.                                                                             |
| POST   | `/v1/projects/:projectId/scene-jobs/:sceneJobId/cancel`       | `{ expectedVersion }` plus UUID idempotency header.                                                   |
| POST   | `/v1/projects/:projectId/scene-jobs/:sceneJobId/retry`        | Exact failed/cancelled version plus UUID idempotency header.                                          |
| GET    | `/v1/projects/:projectId/scene-jobs/:sceneJobId/scene`        | Immutable derived scene/manifest; read-only.                                                          |
| POST   | `/v1/projects/:projectId/scene-jobs/:sceneJobId/scene/access` | Fresh short-lived GLB access record; do not persist URL.                                              |

The scene manifest identifies mapped canonical element IDs, including camera elements, and remains
`derived-visualisation-only`. A DOM/screenshot fallback is not proof that native Metal/SceneKit/
RealityKit rendering succeeded.

## Exact existing C11 routes

| Method | Route                                                                                   | Mobile purpose and pins                                                   |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/v1/projects/:projectId/design-consultations`                                          | Create attributable session; header/body idempotency IDs must match; 201. |
| GET    | `/v1/projects/:projectId/design-consultations/:sessionId`                               | Restore a consultation session.                                           |
| POST   | `/v1/projects/:projectId/design-consultations/:sessionId/cancel`                        | Empty body plus UUID idempotency header.                                  |
| POST   | `/v1/projects/:projectId/design-consultations/:sessionId/turns`                         | Submit exact client message ID, header match; returns proposal with 201.  |
| GET    | `/v1/projects/:projectId/design-consultations/:sessionId/proposals/:proposalId`         | Restore exact AI/human brief proposal.                                    |
| POST   | `/v1/projects/:projectId/design-consultations/:sessionId/proposals/:proposalId/confirm` | Explicitly confirm exact proposal/revision with matching idempotency ID.  |
| GET    | `/v1/projects/:projectId/design-brief`                                                  | Read current brief; retain `x-interior-design-brief-content-sha256`.      |
| PUT    | `/v1/projects/:projectId/design-brief`                                                  | Strict update request with expected revision/idempotency fields.          |
| POST   | `/v1/projects/:projectId/design-brief/accept`                                           | Explicit acceptance of exact revision/hash; no geometry mutation.         |

Before C12, independently fetch the current existing C5 snapshot and branch list. Require a changed
branch head equal to current and, when the brief has a model reference, require exact model ID,
snapshot ID and SHA-256 equality.

## Exact existing C12 routes

| Method | Route                                                                              | Mobile purpose and pins                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/projects/:projectId/design-option-jobs`                                       | Accepted brief ID/revision/hash plus exact existing model ID/snapshot ID/hash/version; request at least two directions; UUID idempotency header; 201. |
| GET    | `/v1/projects/:projectId/design-option-jobs`                                       | Restore option jobs.                                                                                                                                  |
| GET    | `/v1/projects/:projectId/design-option-jobs/:jobId`                                | Poll exact version/state.                                                                                                                             |
| POST   | `/v1/projects/:projectId/design-option-jobs/:jobId/cancel`                         | `{ expectedVersion }` plus UUID idempotency header.                                                                                                   |
| POST   | `/v1/projects/:projectId/design-option-jobs/:jobId/retry`                          | Exact terminal version plus UUID idempotency header.                                                                                                  |
| GET    | `/v1/projects/:projectId/design-option-jobs/:jobId/options`                        | Restore bounded alternatives and confirmation status.                                                                                                 |
| GET    | `/v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId`              | Inspect one exact option.                                                                                                                             |
| GET    | `/v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId/confirmation` | Recover the unchanged exact server-issued `OptionConfirmation`; private/no-store; missing/foreign scope is hidden as 404.                             |
| POST   | `/v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId/confirm`      | Explicit proposed-only confirmation; header UUID must equal body idempotency key; 201 `OptionConfirmation`.                                           |

### C14.4 C12 resume decision

Use the exact confirmation GET above after restoring the confirmed option. The server scopes the
repository lookup by authenticated tenant plus project/job/option and returns the unchanged opaque
confirmation record required by C13. Web recovery v2 persists only job/comparison selection and
erases legacy locally retained confirmation records. A standalone native client must likewise treat
the server response as the only continuation authority and must not construct, rebase or cache a
substitute confirmation.

## Exact existing C13 routes

| Method | Route                                                                                      | Mobile purpose and pins                                                                                          |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/projects/:projectId/catalog/releases`                                                 | Published catalog releases.                                                                                      |
| GET    | `/v1/projects/:projectId/catalog/releases/:releaseId`                                      | Exact release/version/hash/status.                                                                               |
| GET    | `/v1/projects/:projectId/catalog/releases/:releaseId/assets`                               | Bounded assets for one release.                                                                                  |
| GET    | `/v1/projects/:projectId/catalog/releases/:releaseId/assets/:assetVersionId`               | Exact rights/version/material record.                                                                            |
| GET    | `/v1/projects/:projectId/catalog/artifacts/:artifactId`                                    | Fresh catalog artifact response; respect rights/expiry and do not persist signed access.                         |
| POST   | `/v1/projects/:projectId/specifications/from-c12-confirmation`                             | `{ confirmationId, catalogReleaseId, catalogReleaseSha256 }`; UUID idempotency header; 201.                      |
| GET    | `/v1/projects/:projectId/specifications`                                                   | Restore working specifications.                                                                                  |
| GET    | `/v1/projects/:projectId/specifications/:specificationId`                                  | Current exact revision.                                                                                          |
| GET    | `/v1/projects/:projectId/specifications/:specificationId/revisions`                        | Immutable revision history.                                                                                      |
| GET    | `/v1/projects/:projectId/specifications/:specificationId/schedule-lines`                   | Exact current schedule lines.                                                                                    |
| PUT    | `/v1/projects/:projectId/specifications/:specificationId/selection-board`                  | `expectedRevision` plus UUID idempotency header.                                                                 |
| POST   | `/v1/projects/:projectId/specifications/:specificationId/substitutions`                    | Exact element, expected specification/branch revisions and replacement asset; 201 preview.                       |
| GET    | `/v1/projects/:projectId/specifications/:specificationId/substitutions/:previewId`         | Restore unexpired exact preview.                                                                                 |
| POST   | `/v1/projects/:projectId/specifications/:specificationId/substitutions/:previewId/confirm` | Explicit exact candidate SHA/spec revision confirmation; UUID idempotency header; 201 and `Scene-Request-State`. |
| POST   | `/v1/projects/:projectId/specifications/:specificationId/revisions/:revision/scene-jobs`   | Retry the recorded exact C10 `sceneJobId`; returns 202.                                                          |

Price, availability, supplier, delivery, regulation and professional approval remain explicitly
`not-provided` unless a later accountable contract supplies them.

## Exact existing C14 routes

| Method | Route                                                                     | Mobile purpose and pins                                                                                                              |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/projects/:projectId/render-capabilities`                             | Raw authorised-host/provider/profile capability; private/no-store.                                                                   |
| GET    | `/v1/projects/:projectId/render-eligible-sources`                         | Current exact C10 scene/artifact/hash, optional C13 revision/catalog pins and mapped cameras; private/no-store; not a lease.         |
| POST   | `/v1/projects/:projectId/render-jobs`                                     | Exact scene job ID, camera ID, profile, lighting preset and paired optional specification ID/revision; UUID idempotency header; 201. |
| GET    | `/v1/projects/:projectId/render-jobs`                                     | Restore render jobs.                                                                                                                 |
| GET    | `/v1/projects/:projectId/render-jobs/:jobId`                              | Poll exact durable version/state.                                                                                                    |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/cancel`                       | `{ expectedVersion }` plus UUID idempotency header.                                                                                  |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/retry`                        | Exact terminal version plus UUID idempotency header.                                                                                 |
| GET    | `/v1/projects/:projectId/render-jobs/:jobId/result`                       | Immutable safe output manifest and artifact hashes.                                                                                  |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/artifacts/:artifactId/access` | Empty body; fresh access record. Verify role/type/length/SHA locally and discard URL.                                                |
| GET    | `/v1/projects/:projectId/render-jobs/:jobId/enhancement`                  | Optional child status/result; 404/not-requested must not hide safe output.                                                           |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/enhancement`                  | `{ expectedVersion }` plus UUID idempotency header; never mutates safe result.                                                       |

### C14.4 C14 capability decision

The platform capability response is intentionally host-focused:

```text
acceptingNewJobs, enhancementProvider, hardwareEvidence, profiles[]
```

Keep that raw response separate from `render-eligible-sources`. The new endpoint derives succeeded
scenes, exact artifact/manifest/snapshot hashes and mapped cameras from C10, and exact optional
specification/catalog hashes plus live referenced-rights state from C13. Web composes the two strict
responses only for presentation. The eligibility response is a current snapshot, never a lease:
C14 creation re-reads immutable GLB bytes, exact hashes and embedded C13 binding, rechecks rights,
verifies the mapped camera and resolves the requested frozen profile. Native must use the generated
Swift response rather than infer eligibility from render history or matching snapshot IDs.

## Required Mac and iPad cases

| ID  | Case                                                                                               | Required result/evidence                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Clean build and Simulator tests at the reviewed PR head.                                           | macOS/Xcode/runtime versions, exact git SHA, xcresult and zero uncommitted project regeneration.                                             |
| M2  | Inventory native routes/models through C8 and confirm no hidden C10–C14 client.                    | File/target inventory and explicit gap list; no web-cookie reuse.                                                                            |
| M3  | Validate bearer auth, owner/editor/viewer roles, 401 refresh and tenant/IDOR behavior for C10–C14. | Redacted request/status matrix and server audit IDs.                                                                                         |
| M4  | C12 cross-device/cold-install resume described above.                                              | Exact missing-confirmation evidence and proposed shared contract choice.                                                                     |
| M5  | C13 offline/expiry/withdrawal/stale-revision recovery.                                             | No silent rebase, duplicate mutation or commercial certainty claim.                                                                          |
| M6  | C13-created C10 scene cold reload and native scene capability/fallback.                            | Exact scene/spec/snapshot pins; distinguish interactive renderer from static/DOM fallback.                                                   |
| M7  | C14 raw capability and exact source discovery after cold reload.                                   | Raw payload, current web mismatch reproduction, recommended shared endpoint shape.                                                           |
| M8  | Render create/poll/retry/background interruption.                                                  | Stable idempotency IDs, expectedVersion conflict handling and persisted progress after process death.                                        |
| M9  | Safe artifact download under interruption/offline/expiry.                                          | Fresh access, local type/length/SHA verification, URL disposal and no token/locator logs.                                                    |
| M10 | Optional enhancement rejected/disabled/failed/succeeded.                                           | Safe result always remains visible and authoritative over the child product.                                                                 |
| M11 | Physical representative capture on a named LiDAR-capable iPad/iPhone.                              | Consented one-bedroom-apartment evidence, RoomPlan/depth/appearance separation, producer versions/hashes and no implicit canonical mutation. |
| M12 | End-to-end shared project from capture to confirmed twin and design outputs.                       | Correlated C2/C5/C8/C9/C10–C14 IDs/hashes, uncertainties, permissions and screenshots/recording.                                             |

M4 and M7 now have accepted shared software contracts and generated-client tests. Their native
cold-install/authenticated execution is still NOT RUN and must not be inferred from web, Swift unit
or platform integration evidence. M1–M3, M5–M6 and M8–M12 also remain NOT RUN.

## Evidence package and return handoff

Return a restricted package containing:

- exact branch/commit, macOS, Xcode, Simulator and physical-device/iOS versions;
- commands, start/end times, exit codes, xcresults and screenshots/recordings by case ID;
- redacted request/response schema/status samples for C10–C14;
- native C12 confirmation cold-resume using the frozen generated operation;
- C14 raw capability plus generated authoritative-source discovery after cold reload;
- offline/background/idempotency journals and local artifact SHA-256 checks;
- privacy/log scan proving no bearer token, signed locator, raw unrelated imagery/address or broad
  credential escaped; and
- limitations for every unrun device/provider/representative-home case.

Do not report Simulator fixtures as RoomPlan/LiDAR or representative-home evidence. Do not commit
signing, endpoint, token or device-identifier changes. Do not modify the frozen C14.4 continuity v1
surface without an explicitly authorised versioned successor.

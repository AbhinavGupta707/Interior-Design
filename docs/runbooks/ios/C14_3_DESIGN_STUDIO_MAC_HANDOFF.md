# C14.3 Mac/iPad Design Studio Handoff

## Status and decision boundary

**NOT RUN — Windows/Ubuntu WSL host, 2026-08-25.**

No Xcode build, Simulator, signed device build, RoomPlan/LiDAR/camera capture, background transfer,
native C10–C14 flow or physical Apple-device case was run in C14.3. The repository's native client
currently covers setup/evidence/capture through C8 and does not implement a standalone C10–C14
design loop.

This handoff is deliberately provisional. Do not edit/freeze shared contracts merely to mirror the
current web implementation. First verify the existing platform behavior on Mac/iPad and return the
evidence and recommendation to the primary orchestrator. C8 v1 remains authoritative; C8-v2 stays
acceptance-only; reconstruction never becomes canonical truth without C5 validation and commit.

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

| Method | Route                                                                         | Mobile purpose and pins                                                                                                                               |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/projects/:projectId/design-option-jobs`                                  | Accepted brief ID/revision/hash plus exact existing model ID/snapshot ID/hash/version; request at least two directions; UUID idempotency header; 201. |
| GET    | `/v1/projects/:projectId/design-option-jobs`                                  | Restore option jobs.                                                                                                                                  |
| GET    | `/v1/projects/:projectId/design-option-jobs/:jobId`                           | Poll exact version/state.                                                                                                                             |
| POST   | `/v1/projects/:projectId/design-option-jobs/:jobId/cancel`                    | `{ expectedVersion }` plus UUID idempotency header.                                                                                                   |
| POST   | `/v1/projects/:projectId/design-option-jobs/:jobId/retry`                     | Exact terminal version plus UUID idempotency header.                                                                                                  |
| GET    | `/v1/projects/:projectId/design-option-jobs/:jobId/options`                   | Restore bounded alternatives and confirmation status.                                                                                                 |
| GET    | `/v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId`         | Inspect one exact option.                                                                                                                             |
| POST   | `/v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId/confirm` | Explicit proposed-only confirmation; header UUID must equal body idempotency key; 201 `OptionConfirmation`.                                           |

### Provisional C12 resume decision

`OptionConfirmation.id` is returned only by the confirm POST. The list/get responses report that an
option is confirmed but do not return or locate the confirmation record, while C13 creation needs
that ID. The web client now retains up to four opaque confirmations for same-browser recovery, then
revalidates job/option/project status. That is not a cross-device contract.

On Mac, prove the failure from: confirm on client A → terminate/delete local state → sign in on
client B → attempt C13. Recommend one server-authoritative solution, without implementing it yet:

- a scoped read/list confirmation route; or
- a server-resolved “continue confirmed option” C13 command that accepts job/option plus exact pins.

The choice must preserve tenant isolation, immutable confirmation provenance, idempotency and stale
brief/model failure. It must not make browser storage authoritative.

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
| POST   | `/v1/projects/:projectId/render-jobs`                                     | Exact scene job ID, camera ID, profile, lighting preset and paired optional specification ID/revision; UUID idempotency header; 201. |
| GET    | `/v1/projects/:projectId/render-jobs`                                     | Restore render jobs.                                                                                                                 |
| GET    | `/v1/projects/:projectId/render-jobs/:jobId`                              | Poll exact durable version/state.                                                                                                    |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/cancel`                       | `{ expectedVersion }` plus UUID idempotency header.                                                                                  |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/retry`                        | Exact terminal version plus UUID idempotency header.                                                                                 |
| GET    | `/v1/projects/:projectId/render-jobs/:jobId/result`                       | Immutable safe output manifest and artifact hashes.                                                                                  |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/artifacts/:artifactId/access` | Empty body; fresh access record. Verify role/type/length/SHA locally and discard URL.                                                |
| GET    | `/v1/projects/:projectId/render-jobs/:jobId/enhancement`                  | Optional child status/result; 404/not-requested must not hide safe output.                                                           |
| POST   | `/v1/projects/:projectId/render-jobs/:jobId/enhancement`                  | `{ expectedVersion }` plus UUID idempotency header; never mutates safe result.                                                       |

### Provisional C14 capability decision

The platform capability response is intentionally host-focused:

```text
acceptingNewJobs, enhancementProvider, hardwareEvidence, profiles[]
```

The current web workspace expects a composed response containing renderer/provider presentation,
lighting presets, and exact eligible `sources[]` with scene, specification and camera choices. Its
BFF validates the raw platform payload directly against that richer schema, so host-live web use
currently fails closed. More importantly, C13's authoritative scene-job binding is server-held and
not exposed by list specifications; a client must not infer it merely from matching snapshot IDs.

On Mac, exercise raw C10/C13/C14 calls after C13 substitution confirmation and after a cold reload.
Recommend whether to:

- extend C14 capability with authoritative eligible source/camera/spec bindings; or
- add a separate scoped eligibility endpoint consumed by both clients.

The server must derive the binding, rights status and cameras from exact C10/C13 authority, and
revalidate them at C14 job creation. Do not add a web-only heuristic or freeze native DTOs first.

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

## Evidence package and return handoff

Return a restricted package containing:

- exact branch/commit, macOS, Xcode, Simulator and physical-device/iOS versions;
- commands, start/end times, exit codes, xcresults and screenshots/recordings by case ID;
- redacted request/response schema/status samples for C10–C14;
- C12 confirmation cold-resume reproduction;
- C14 raw capability and authoritative-source discovery reproduction;
- selected shared-contract recommendation with alternatives and trade-offs;
- offline/background/idempotency journals and local artifact SHA-256 checks;
- privacy/log scan proving no bearer token, signed locator, raw unrelated imagery/address or broad
  credential escaped; and
- limitations for every unrun device/provider/representative-home case.

Do not report Simulator fixtures as RoomPlan/LiDAR or representative-home evidence. Do not commit
signing, endpoint, token or device-identifier changes. Return the handoff before shared contracts,
generated clients or native C10–C14 models are frozen.

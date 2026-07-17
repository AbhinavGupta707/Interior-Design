# C7 code checkpoint evidence — 17 July 2026

## Decision

C7's code checkpoint is complete at product commit `d10416a` under the frozen contract's explicit external-hardware exception. The physical RoomPlan field gate is **NOT RUN**, evaluator promotion is false, DQ-020 is unresolved and the C7/C18 release blocker is **OPEN**. This record is not a RoomPlan, LiDAR, survey-accuracy or release-promotion claim.

Evidence classification: `Simulator / visibly synthetic / non-RoomPlan` plus live local Postgres and S3-compatible infrastructure using repository fixture identities and data. Service processing was limited to the named local verification purpose; training use remained denied. No customer evidence, address, paid provider, cloud key or GPU was used.

## Candidate identity

| Field                           | Value                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Evidence record ID              | `C7-CODE-2026-07-17-01`                                                                                 |
| Evidence date/time and timezone | 17 July 2026, Europe/London                                                                             |
| Operator/reviewer               | Codex root orchestrator; accountable human release review still required                                |
| Integrated product Git SHA      | `d10416a`                                                                                               |
| Frozen worker base              | `e438d8f`                                                                                               |
| Contract versions               | `c7-capture-session-v1`; `c7-capture-package-v1`; `c7-roomplan-normalized-v1`; `c7-capture-proposal-v1` |
| Simulator                       | iPhone Air, iOS 26.4, arm64                                                                             |
| Generic production build        | unsigned arm64 `Release-iphoneos`                                                                       |
| Physical device                 | none connected; model, iOS and `RoomCaptureSession.isSupported` unavailable                             |
| Physical rights record          | none because no physical capture occurred                                                               |

## Isolated implementation provenance

| Lane                   | Task                                   | Model / reasoning             | Worker SHA | Merge SHA |
| ---------------------- | -------------------------------------- | ----------------------------- | ---------- | --------- |
| RoomPlan/AR session    | `019f6f8b-500b-75a3-9705-1afc0f7310a2` | exact `gpt-5.6-sol` / `xhigh` | `ad3cfd0`  | `501d1be` |
| quality/sync/workspace | `019f6f8b-5005-7463-b083-49074ffaa2ba` | exact `gpt-5.6-sol` / `xhigh` | `db1cbb1`  | `2c7cdbb` |
| backend/converter      | `019f6f8b-4ffd-7730-aa47-fac87b4f16cd` | exact `gpt-5.6-sol` / `xhigh` | `39fe525`  | `69ad8ad` |
| mobile/field/security  | `019f6f8b-5000-7363-a7ba-5c3f35304833` | exact `gpt-5.6-sol` / `xhigh` | `8f8861f`  | `32925ae` |

The four lanes were merged in the frozen L1 → L3 → L2 → L4 order. Their ownership roots were disjoint. Product integration `d10416a` contains the debug/local-only presentation fixture and associated acceptance wiring.

## Automated and live evidence

| Gate                        | Result                                                           | Exact evidence boundary                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| full repository             | `UV_CACHE_DIR=.cache/uv pnpm verify` passed                      | Prettier; 14-package lint, strict typecheck, unit and production build graph; Ruff; MyPy; 12/12 Python                                                    |
| mobile conformance          | 15 passed, 0 failed, 0 skipped                                   | deterministic TypeScript fixture/state contract                                                                                                           |
| security reference          | 55 passed, 0 failed; four live-only cases separately passed 4/4  | deterministic upload/worker/API policy plus composed HTTP disclosure probes                                                                               |
| RoomPlan evaluation         | 7 passed, 0 failed, 0 skipped                                    | synthetic conformance only; physical accuracy is not evaluable                                                                                            |
| complete iOS scheme         | 124 reported cases / 131 invocations passed, 0 failed, 0 skipped | Simulator, prior native tests, C7 journeys and cross-language golden contract                                                                             |
| C7 integrated journeys      | nine methods passed, 0 failed, 0 skipped                         | capability/permission, every local/server state, guidance, interruption/restart, room/structure review, offline/background, retry/cancel and Dynamic Type |
| Xcode regeneration          | passed with no diff after product commit                         | `xcodegen generate --spec project.yml`                                                                                                                    |
| generic Release build       | passed                                                           | unsigned arm64 generic physical-iOS compile; no sensor execution                                                                                          |
| Release fixture exclusion   | passed                                                           | production binary contains no fixture environment key or presentation string                                                                              |
| live API/Postgres           | 2 passed, 0 failed, 0 skipped                                    | clean C1–C7 migrations, tenant/session/package scope, replay/conflict, cancellation, retry and immutable history                                          |
| live worker/Postgres        | 1 passed, 0 failed, 0 skipped                                    | stale lease, rights recheck, cancellation acknowledgement and single immutable publication                                                                |
| live S3-compatible storage  | 1 passed, 0 failed, 0 skipped                                    | real checksum-bound multipart upload, completion, signed read and byte equality                                                                           |
| live composed HTTP security | 4 passed, 0 failed, 0 skipped                                    | unauthenticated disclosure order, two-way tenant IDOR, viewer write denial and strict public request schema                                               |
| service-log redaction       | passed by observation                                            | request URLs redacted; authorization absent; only bounded codes, states, status, request/trace IDs and timing emitted                                     |

## Manual Simulator observations

Computer Use inspected the real Simulator window after the automated pack:

1. `state-structure-review` showed two rooms, shared-world-origin copy and a tappable “Accept structure” action; tapping transitioned visibly to `Packaging`.
2. `permission-denied` showed the limitation copy and a tappable “Use manual evidence” action; tapping transitioned visibly to `Manual Fallback`.

Both screens visibly said that the fixture is synthetic and the Simulator does not prove RoomPlan or LiDAR behavior. No credential, object key, signed URL, local source path, raw capture, world map or address appeared.

## Source, mutation and security conclusions

- Source descriptors and capture packages are checksum-bound and immutable; worker publication rehashes inputs and rechecks the exact tenant, project, capture session, package, rights and lease.
- The converter can publish only one immutable existing-state proposal or explicit abstention. C7 has no C5 preview/commit call and canonical mutation count remains exactly zero.
- Camera frames are not retained. An AR world map is local resume state only and is excluded from server packages, logs and analytics.
- Viewer access remains read-only. Cross-tenant identifiers produce the same bounded non-disclosing 404 shape, unauthenticated lookup returns 401 before existence disclosure, and request bodies cannot inject object keys or signed URLs.
- Cancellation, rights withdrawal and retry never reopen immutable source state; stale or substituted parts, packages, attempts and results fail closed.

## Physical field matrix and release status

| Required case                                      | Status    | Reason                             |
| -------------------------------------------------- | --------- | ---------------------------------- |
| F1 permission denial + fallback on physical device | `NOT RUN` | no supported iPhone/iPad connected |
| F2 one physical room                               | `NOT RUN` | no supported iPhone/iPad connected |
| F3 connected physical rooms / structure            | `NOT RUN` | no supported iPhone/iPad connected |
| F4 physical interruption/relocalisation or restart | `NOT RUN` | no supported iPhone/iPad connected |
| F5 physical low-light guidance                     | `NOT RUN` | no supported iPhone/iPad connected |
| F5 physical low-texture guidance                   | `NOT RUN` | no supported iPhone/iPad connected |
| F6 physical offline/background resume              | `NOT RUN` | no supported iPhone/iPad connected |
| physical VoiceOver                                 | `NOT RUN` | no supported iPhone/iPad connected |
| physical thermal/tracking observation              | `NOT RUN` | no supported iPhone/iPad connected |

The rights-controlled physical development split contains zero samples; the holdout split contains zero samples. Wall/opening accuracy, connected-room residuals, physical calibration and field resource behavior are therefore not evaluable. A future accountable field run must follow `docs/runbooks/ios/c7-physical-device-field-protocol.md`, preserve all failures and abstentions in the denominator, and copy `docs/runbooks/ios/c7-release-evidence-template.md` into the controlled evidence location.

| Decision item                         | Value                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| C7 code checkpoint                    | complete under external-hardware exception                                                                                    |
| physical field gate                   | `NOT RUN`                                                                                                                     |
| evaluator promotion eligible          | `false`                                                                                                                       |
| C7/C18 release blocker                | **OPEN**                                                                                                                      |
| unresolved critical/high code finding | none found in executed evidence                                                                                               |
| next action                           | acquire a rights-approved supported LiDAR iPhone/iPad and execute F1–F6 plus physical accessibility/thermal/tracking protocol |

# C5 Contract — Typed operations, branches, replay and 2D editor

## Status and outcome

- Checkpoint: C5
- Contract version: `c5-model-operation-v1`
- Frozen from: C4 ledger-close commit `48ce8a2`
- Outcome: an authorised user can create a branch from one exact C4 snapshot, preview and atomically commit typed operations, recover from conflicts, inspect/compare/replay history, and restore as a new immutable revision from an accessible 2D editor.
- Scope boundary: C5 edits canonical 2.5D information. It does not parse a plan (C6), capture/reconstruct/fuse spatial evidence (C7-C9), render 3D (C10), infer structure, approve regulations, issue professional information or accept arbitrary AI tool calls.

## Frozen operation and history semantics

1. The public v1 user registry is exactly `level.create.v1`, `wall.create.v1`, `wall.translate.v1`, `opening.insert.v1`, `space.create.v1`, `space.rename.v1`, `element.metadata.correct.v1` and `element.provenance.correct.v1`. Arbitrary JSON Patch, property paths, scripts, deletes, wall removal, topology repair, mesh edits and generic transforms are deferred.
2. `snapshot.initialize.v1` and `snapshot.restore.v1` are registered internal operations. C4's raw snapshot POST must not remain a parallel amendment path once C5 is composed: initial import is recorded as initialise, and every restore records its exact source. Existing C4-only tests may compose C4 independently, but the integrated product exposes typed mutation only.
3. A branch belongs to one tenant/project/model/profile and starts at revision `0` from one exact immutable snapshot ID and SHA-256. Branch names are display labels, not identifiers. Existing, proposed and as-built remain separate and cannot share or move heads.
4. Every accepted commit contains 1–50 ordered operations, increments the branch revision once, writes one immutable C4 snapshot, operation rows, commit, branch head, domain audit and outbox in one transaction. C5 persists a snapshot for every commit; later cadence optimisation must retain identical replay semantics.
5. Preview requires the expected revision and exact head hash, reduces operations in memory, runs canonical and geometry validation and returns an expiring preview tied to exact input/result hashes. It may persist bounded preview metadata but cannot change a branch, snapshot pointer, operation stream, domain audit or outbox.
6. Commit confirms an unexpired preview plus the same revision/head. A blocking finding, changed head, changed payload, expired preview or foreign preview fails closed with no partial effect. A successful commit cannot be confirmed twice except as an exact idempotent replay of the original response.
7. Branch create, preview, commit and restore require the established 8–128 character `Idempotency-Key`. Same actor/key/operation/body replays one result; a different actor, operation or body conflicts. Authorization and current membership are rechecked on every request.
8. Stale state returns `409 BRANCH_REVISION_CONFLICT` with the authorised branch's current revision/head hash and bounded recovery actions: reload, compare, discard local session or rebuild/repreview the same typed intent. The server never auto-merges geometry.
9. Undo/redo is local and bounded to the uncommitted editor session. Undo after commit is a compensating operation or restore, never deletion or mutation of history. Restore validates the named historical project/profile snapshot and creates a new commit/revision with `snapshot.restore.v1`.
10. Replay begins from the branch source snapshot, upcasts retained v1 operation envelopes and reproduces every commit snapshot hash. Unknown schema versions, missing operations, ordinal gaps, altered history or hash mismatches fail closed and are never repaired silently.
11. Comparison is by exact stable element ID and canonical element content. The bounded response reports added/modified/removed IDs and truncation explicitly; it does not claim geometric or professional equivalence.
12. Operation history and audit are cursor-paginated, newest or deterministic ordinal order as documented, maximum 100 records per page. Public records expose stable domain IDs/codes and actor IDs but never tokens, preview secrets, database locators, raw snapshots in logs or broad support access.

## Frozen editor semantics

- Render SVG from the exact canonical snapshot returned for the branch head; do not keep editor-only authoritative geometry. Rendering converts millimetres to view coordinates at the boundary and preserves stable element IDs.
- A level selector, pan/zoom, selection, focus-visible element list and structured inspector are required. Canvas-only or pointer-only completion is forbidden.
- Snapping is local-preview assistance with a frozen default grid of 50 mm and optional 10/25/50/100 mm choices. Submitted operations contain exact integer millimetres; the server does not trust client snapping.
- The first committed user slice must support selecting and translating one wall, inserting an opening, and renaming a space. Create level/wall/space and correction operations remain available through the inspector even if not all have direct-manipulation handles.
- The local session shows ordered pending commands, validation findings, known limitations, undo/redo, discard and explicit preview then commit. Findings identify severity, code and affected IDs; warnings require acknowledgement, errors block commit.
- Conflict recovery preserves the user's uncommitted intent in memory, announces the stale state, shows current head/revision, and offers reload/compare/reapply. It never implies that a stale commit succeeded.
- Owner/editor can preview/commit/restore; viewer can render, compare and inspect history but has no editable control. Keyboard-only users can complete rename and structured numeric wall/opening edits; focus and async status use appropriate live/alert semantics.
- Responsive acceptance covers 1440×960 and 390×844. The plan remains usable without horizontal page overflow; the inspector may stack below the plan on narrow screens. Reduced motion and minimum contrast are respected.

## Frozen shared API and permissions

Shared schemas live in `packages/contracts/src/c5.ts`. Frozen routes are:

| Method         | Route                                                                                | Permission / behavior                                             |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `GET` / `POST` | `/v1/projects/:projectId/models/:profile/branches`                                   | list readable branches / create from exact source snapshot        |
| `GET`          | `/v1/projects/:projectId/models/:profile/branches/:branchId`                         | retrieve one authorised branch head                               |
| `POST`         | `/v1/projects/:projectId/models/:profile/branches/:branchId/previews`                | owner/editor; non-mutating bounded preview                        |
| `POST`         | `/v1/projects/:projectId/models/:profile/branches/:branchId/commits`                 | owner/editor; confirm exact preview atomically                    |
| `GET`          | `/v1/projects/:projectId/models/:profile/branches/:branchId/operations`              | owner/editor/viewer; cursor-paginated history                     |
| `POST`         | `/v1/projects/:projectId/models/:profile/branches/:branchId/restores`                | owner/editor; restore named historical snapshot as a new revision |
| `GET`          | `/v1/projects/:projectId/models/:profile/branches/:branchId/compare/:targetBranchId` | owner/editor/viewer; bounded stable-ID head diff                  |

The orchestrator has frozen explicit actions for branch create/read/compare, preview/commit, restore, history and audit. Owner and editor may mutate; viewer receives only read/history/compare/audit. Cross-tenant decisions deny before resource disclosure. Machine actors may propose only through a separately authenticated internal policy boundary and cannot self-confirm; the public local C5 path is human-confirmed. Later AI checkpoints must reuse, not bypass, this registry.

## Frozen persistence and integration

- Migration allocation is exclusively `services/platform-api/migrations/0005_model_operations.sql`, registered after C4.
- Required tables cover branches, expiring previews, commits, append-only operation envelopes, operation idempotency, domain audit and transactional outbox. Tenant/project/model/profile/branch identity is present in every uniqueness constraint and query.
- Immutable-operation/commit/snapshot/audit triggers prevent update/delete. Branch heads use row locking plus revision/hash predicates. Preview cleanup may delete expired preview metadata only; it cannot delete domain history.
- Operation reducers are pure, deterministic and side-effect free. They clone a schema-valid C4 snapshot, check target/type/profile/reference invariants, apply exact integer changes, reparse the full canonical schema, run C4 geometry validation, canonicalise once and return a hashable result.
- Metadata/provenance correction accepts only the contract's enumerated collection/field pairs. Reducers additionally verify the field exists and its attributed value shape matches; unsupported pairs are typed errors rather than dynamic property access.
- Outbox rows contain bounded identifiers/type/version/hash data, never snapshot bodies or credentials. No external broker is required for C5; transactional production and deterministic polling behavior are tested locally.

## Adaptive isolated lanes

C5 retains four project-scoped Codex worktree tasks because reducer/persistence, policy/audit, interactive editor and independent concurrency evaluation are all substantial and have exclusive write boundaries. Every lane uses exact model `gpt-5.6-sol`; reasoning is adaptive per the user's policy.

| Lane                        | Model / reasoning       | Exclusive editable paths                                                                                                                                                                                                                                                                                                                                                                                                                      | Required output                                                                                                                                                                                    |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C5-L1 operation producer    | `gpt-5.6-sol` / `xhigh` | `packages/model-operations/src/**`, `packages/model-operations/test/**`, `services/platform-api/src/modules/models/operations/**`, `services/platform-api/src/c5.ts`, `services/platform-api/test/c5/**`, `services/platform-api/migrations/0005_model_operations.sql`, `docs/runbooks/development/c5-model-operations.md`; allocated minimal edits to `services/platform-api/src/app.ts`, C4 core mutation composition/tests and `README.md` | exact registry/reducers/upcaster, branch/preview/commit/restore/history/compare persistence and routes, initialise bridge, atomic audit/outbox, migration and clean/live API tests                 |
| C5-L2 model policy/audit    | `gpt-5.6-sol` / `xhigh` | `packages/authz/src/model/**`, `packages/authz/test/model/**`, `services/platform-api/src/modules/audit/**`, `services/platform-api/test/c5-policy/**`, `docs/threat-models/model-operations.md`                                                                                                                                                                                                                                              | branch/action/person/machine policy, immutable bounded audit projection, support visibility and negative tenant/role/preview-confirmation matrix                                                   |
| C5-L3 editor core/UI        | `gpt-5.6-sol` / `high`  | `packages/editor-core/src/**`, `packages/editor-core/test/**`, `apps/web/src/features/editor-2d/**`, `apps/web/src/app/editor/**`, `apps/web/src/app/api/c5/**`, `apps/web/test/editor-2d/**`, allocated edits to `apps/web/src/features/projects/projects-screen.tsx` and `apps/web/src/app/globals.css`                                                                                                                                     | SVG projection, level/selection/snap, structured inspector, pending-command reducer, undo/redo, preview/commit/conflict/viewer UX, BFF and responsive component tests against frozen contracts     |
| C5-L4 replay/concurrency QA | `gpt-5.6-sol` / `xhigh` | `tests/integration/model-operations/**`, `tests/geometry/operations/**`, `tests/e2e/editor-operations/**`, `docs/evaluation/operation-invariants.md`                                                                                                                                                                                                                                                                                          | independent reducer/reference/property sequences, repeated/reordered/racing live requests, branch isolation/restore/replay, Playwright desktop/mobile/keyboard/conflict tests and invariant matrix |

Merge order is L1, L2, L3, L4. Workers must not edit another lane, root/package manifests, the lockfile, shared contracts/core authz registry, migration registry, accepted checkpoint contract, `.github`, `.codex`, `AGENTS.md` or the ledger. The orchestrator alone reconciles integration after all workers finish.

## Required checkpoint gate

1. Frozen prelude and final `UV_CACHE_DIR=.cache/uv pnpm verify` pass formatting, every workspace lint/typecheck/unit suite and all production builds.
2. Registry contract/property tests cover every v1 operation, strict arguments, unknown versions, invalid IDs/units/references, explicit attribution and safe target paths.
3. Independent generated operation sequences prove deterministic reduction, replay/hash equivalence, branch isolation, restore-as-new-history, snapshot cadence and no input mutation.
4. A clean disposable PostGIS database applies C1-C5. Live tests prove preview non-mutation, exact replay, idempotency conflict/replay, stale/racing commits, transactional operation/snapshot/audit/outbox consistency, immutable triggers, pagination and tenant/role isolation.
5. Static and live route inventory proves no integrated raw snapshot amendment path. Direct attempts fail safely; initialise and restore appear as registered operation records.
6. Playwright runs desktop, 390×844 mobile and keyboard-only paths for branch create, wall move, opening insertion, room rename, pending undo/redo, preview warning/error, commit, viewer read-only, two-session conflict recovery, compare and restore. No console errors, broken requests or page overflow.
7. The in-app Browser drives the production-shaped web BFF against the real API/database and connects visible branch/revision/history/compare state to stored snapshot/operation/audit hashes. Log inspection proves URL/body/token/preview and internal-locator redaction.
8. No Xcode or GPU gate applies because C5 changes no native or rendering/reconstruction surface. Performance evidence records representative reducer/preview/commit latency and editor responsiveness without claiming production scale.
9. The ledger records task IDs, exact `gpt-5.6-sol` reasoning levels, worker/merge/product SHAs, test/property/browser/live-database counts, integration repairs, residual limitations and the final C5 SHA before C6 opens.

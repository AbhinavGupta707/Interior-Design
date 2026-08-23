# C14.2 Contract — Persisted homeowner setup and plan-to-twin continuity

## Authority, predecessor and outcome

- Checkpoint: C14.2, the next user-authorised corrective checkpoint after the reviewed C14.1 bridge.
- Immutable checkpoint predecessor: integration commit `dc772889d6b040abadb3c4e00c096ff370794f61`, containing both reviewed C14.1 lanes. The final product branch remains `codex/homeowner-digital-twin-journey`; C15 stays closed.
- Outcome: from normal project creation, a homeowner can confirm property context, persist renovation intent, upload rights-cleared evidence, explicitly initialise an honest unmeasured canonical workspace, take a ready plan through the existing C6 proposal/review/correction path, explicitly commit a validated current model and compile/explore that exact model through C10.
- Contract impact: no shared contract, OpenAPI/generated client, authz action, migration, registry, worker protocol or C8 v2 route change is authorised. The existing C3 property, C4/C5 typed initialization, C2 evidence, C6 plan, C5 operation and C10 scene contracts remain authoritative.

C14.2 closes executable continuity and provenance gaps. It does not make property/address data interior evidence, does not productionise C8 v2, and does not claim a representative property, deployed provider, survey, professional review, Xcode, RoomPlan, LiDAR or physical-device result.

## Discovery record and smallest valuable checkpoint

The integrated C14.1 bridge is software-accepted, but a new project still cannot complete the product journey without hidden setup:

1. The integrated platform API already owns a typed, authorised, geometry-validated, audited and idempotent one-time C5 initialization route at `POST /v1/projects/:projectId/models/:profile/snapshots`. It creates the first immutable snapshot, commit and `Main` branch atomically and rejects raw amendments.
2. The web C5 BFF and editor expose only current-snapshot reads, branches, previews, commits and restores. When no current snapshot exists the editor says to create/import one elsewhere, but no normal web path exists.
3. C6 and C9 therefore cannot obtain a branch on a genuinely new project without manual JSON, a seed harness or direct API setup.
4. C14.1 currently treats any branch revision above zero as confirmed correction progress. Integrated C5 initialization itself creates revision 1, so initialization can be mislabelled as proposal confirmation and can incorrectly unlock twin language.
5. HTTP 409 is mapped to a generic branch conflict before `PREVIEW_EXPIRED` is interpreted. The mutation fails closed, but recovery language is inaccurate.
6. Integrated C5 validates attribution structure but does not reject a `user-asserted.actorUserId` that differs from the authenticated mutation actor. The product BFF must never accept a raw initialization snapshot, and the platform service must fail closed on spoofed user attribution.
7. Property, intake and evidence already persist through authorised APIs. C2 already routes ready plans to C6 and ready photos/videos to production C8 v1. The smallest host-complete path uses a ready plan and the provider-free deterministic C6 parser; C8 v2 remains acceptance-only.

## Frozen product behavior

### Normal persisted path

- Normal project creation and resume enter `/home/:projectId`; acceptance must not start from a direct specialist route.
- The primary sequence remains property confirmation → renovation goals/evidence availability → rights-cleared evidence → honest model workspace → proposal/review → explicit canonical confirmation → exact twin.
- Manual property selection is a first-class provider-unavailable path. It identifies the project property only and retains `interiorKnowledgeStatus=unknown-without-evidence`.
- Intake and evidence completion derive only from persisted server state. Browser-local or fixture-only flags cannot advance a stage.
- A ready plan continues to C6. Photo/video may continue to production C8 v1 only when its existing capability/runtime is honestly available. No route may import or invoke `ml/reconstruction/windows-nvidia-v2`.

### One-time unmeasured workspace initialization

- Only `existing` may be initialized by this product adapter.
- The browser sends only an explicit bounded acknowledgement such as `{ confirmUnmeasuredInterior: true }` plus an idempotency key. It cannot submit a canonical snapshot, actor ID, property ID, dimensions, geometry or provenance body.
- The same-origin BFF reauthenticates, resolves the selected C3 property dossier and authenticated actor server-side, then constructs the strict existing-profile snapshot.
- Initialization requires a selected project property and owner/editor role. Missing property, viewer access, expired session, stale/already-initialized state or upstream unavailability fails closed with no inferred completion.
- IDs are deterministic for the actor/project/idempotency scope so a same-key replay produces the same canonical request. Different property or body under one key conflicts rather than silently changing attribution.
- The first snapshot contains exactly one placeholder level because the frozen C4 schema requires at least one level. The homeowner must explicitly acknowledge that the home has at least one level. Level existence is `user-asserted` by the authenticated actor; its name, elevation and storey height are attributed `unknown`.
- Walls, spaces, openings, stairs, surfaces, objects, furnishings, finishes, lights and cameras are empty. The global anchor is `not-established`. No coordinate, room, boundary, dimension or property-derived interior claim is fabricated.
- The snapshot links only the selected project `propertyId`; property address/provider observations do not become model evidence IDs. Known limitations state that the property context proves no interior and the placeholder is unmeasured/not reviewed.
- The existing integrated C5 route remains the only persistence authority and atomically records the initialization operation, current-profile pointer, branch, audit and outbox effects.

### Provenance actor binding

- Before integrated C5 initialization or operation preview reaches persistence, every nested known attribution with `state=user-asserted` must have `actorUserId` equal to the authenticated actor.
- A mismatch returns a bounded public error, creates no snapshot/preview/commit/audit/outbox effect and never echoes the submitted payload or foreign user ID.
- This check applies to initialization snapshots and public typed operations, including nested element/metadata/provenance/design bodies. Source-derived, fused, inferred, observed and explicit unknown attributions retain their existing evidence/confidence rules.
- Commit consumes the already stored exact preview; it must not rewrite attribution or bypass the check.

### Journey and error correctness

- Initialization revision 1 is setup, not proposal confirmation.
- The confirmation/twin stages count an explicit corrected current model only when a branch head is the current existing-profile snapshot, differs from its source snapshot and represents a post-initialization revision. A stale, non-current or initialization-only branch cannot mark confirmation.
- When the current existing snapshot is absent, the journey routes owner/editor to the explicit unmeasured-workspace acknowledgement before C6/C9 correction. Viewers see read-only unavailable guidance.
- C6 returns to the home journey and, when no branch exists, directs the user to the explicit workspace setup instead of an unspecified manual import.
- `PREVIEW_EXPIRED` and other expiry codes map to the existing expired recovery path before generic 409 conflict handling. Expiry, conflict, forbidden, offline and unavailable responses all retain zero unintended commit/scene effects.

## Isolated worktree plan

Three substantial lanes are frozen. L1 and L2 are separable and may run concurrently after this contract/ledger commit. L3 begins only after both production lanes are reviewed and integrated. Every lane uses exact `gpt-5.6-sol` with `xhigh` reasoning because the work crosses canonical mutation, provenance, authorization, concurrency and multi-surface state.

| Lane                                  | Model / reasoning       | Exclusive editable paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Required output                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C14.2-L1 attribution binding          | `gpt-5.6-sol` / `xhigh` | `services/platform-api/src/modules/models/operations/service.ts`; `services/platform-api/test/c5/routes.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | fail-closed authenticated-actor binding for initialization and typed previews; focused service/route tests proving zero repository call on spoofed attribution                                                     |
| C14.2-L2 persisted web setup          | `gpt-5.6-sol` / `xhigh` | `apps/web/src/app/api/c5/[...segments]/route.ts`; `apps/web/src/app/api/c5/_shared/home-workspace.ts`; `apps/web/src/features/editor-2d/api.ts`; `apps/web/src/features/editor-2d/editor-workspace.tsx`; `apps/web/test/editor-2d/**`; `apps/web/src/features/homeowner-journey/journey-loader.ts`; `apps/web/src/features/homeowner-journey/journey-state.ts`; `apps/web/src/features/homeowner-journey/homeowner-journey.tsx`; `apps/web/test/homeowner-journey/**`; `apps/web/src/features/plan-import/plan-import-workspace.tsx`; `apps/web/test/plan-import/**`; `apps/web/src/app/globals.css` | server-built deterministic unmeasured initialization, explicit accessible UI, honest journey gating/currentness, precise expiry wording, C6/home continuity and focused BFF/client/state/semantics tests           |
| C14.2-L3 persisted journey acceptance | `gpt-5.6-sol` / `xhigh` | `tests/e2e/homeowner-setup/**`; `tests/integration/homeowner-setup/**`; `tests/security/homeowner-setup/**`; `docs/evaluation/homeowner-journey/C14_2_PERSISTED_JOURNEY_ACCEPTANCE_2026-08-23.md`                                                                                                                                                                                                                                                                                                                                                                                                    | independent stateful browser/security/runtime seams proving normal navigation, no raw snapshot body, manual property/intake/evidence/setup/C6/C5/C10 progression, failure states and exact evidence classification |

Workers may read all predecessor code and documents. They must not edit root manifests/lockfiles, shared contracts/OpenAPI/generated clients, authz, migrations/registry, accepted ADRs/contracts, `.github/**`, `.codex/**`, either `AGENTS.md`, active/master plans or the orchestration ledger. The orchestrator owns task prompts, merge review/order, integration fixes, live services/browser evidence, documentation truth and final PR.

## Required gate

1. C14.1 remains green after integration. C14.2 focused platform/web tests, lint, typecheck and builds pass.
2. Platform tests prove spoofed user attribution is rejected before repository initialization/preview and no submitted payload appears in public errors/log assertions.
3. BFF tests prove strict acknowledgement-only input, server-side actor/property resolution, deterministic same-key body, existing-only profile, selected-property requirement, viewer denial, safe upstream validation and no raw provider/address/snapshot echo.
4. Web tests prove initialization-only revision does not confirm correction; only a current changed branch can do so. Expired/conflict/offline/denied/unavailable states are distinct and fail closed.
5. Browser acceptance starts with ordinary sign-in/project creation and uses the rendered property, intake, evidence and setup controls. No direct route, manual JSON, fixture-only completion flag or hidden canonical seed may substitute.
6. The host-live path uses disposable Postgres/PostGIS and object storage, the built platform API/web/spatial worker, a manual synthetic address and a creator-owned synthetic plan uploaded through the UI. The asset, consent, proposal, initialization, preview, commit and scene state must be persisted and server-authorised. It is local software acceptance, not real-property/deployment/provider evidence.
7. The counted plan path uses the existing deterministic C6 worker. C9 multi-source requires at least two eligible distinct source kinds; without physical C7 or a genuinely available production C8 v1 result, the C9 bridge remains software-complete but is not falsely counted as a live multi-source run.
8. C10 compiles only the exact committed current snapshot and the viewer retains its honest read-only/WebGL fallback.
9. Static/security review proves no C8 v2 production import/route, secret, signed URL, raw address/provider payload or source bytes are introduced into logs or journey responses.
10. Final `UV_CACHE_DIR=.cache/uv pnpm verify`, contract, integration, security, geometry, focused browser and `git diff --check` gates pass. Root placeholder commands that execute zero tasks are not evidence.
11. Windows/WSL results distinguish software-complete, host-live, synthetic-input, unavailable and externally deferred claims. The C14.1 Apple handoff remains authoritative; no Xcode/RoomPlan/LiDAR/device claim is made.
12. The ledger records exact task/worktree/worker/merge/product SHAs, commands/counts, local IDs/hashes, screenshots/artifacts, environment state, limitations and final PR.

## Terminal rule

C14.2 may close only after all three lanes are reviewed/integrated, the normal persisted local journey is host-validated as far as the available runtime permits, and documentation matches exact evidence. C15 remains closed. The final non-draft PR targets `main` and remains unmerged for independent review.

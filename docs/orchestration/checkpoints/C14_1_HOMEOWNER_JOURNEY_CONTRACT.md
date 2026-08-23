# C14.1 Contract — Homeowner reconstruction journey integration

## Authority, outcome and scope

- Checkpoint: C14.1, a user-authorised corrective integration checkpoint inserted after C14. C15 remains closed.
- Immutable predecessor: clean `main` commit `54886f570c3bb559490a50727e4c77ed00834b52`, which merged C8 v2 PR #2 as an acceptance-only sibling capability.
- Integration branch: `codex/homeowner-digital-twin-journey`.
- Outcome: a homeowner can move coherently from property selection and renovation intent through available evidence, a reconstruction/fusion proposal, explicit correction confirmation, and exploration of a digital twin compiled from the resulting committed canonical snapshot.
- Contract impact: no shared API, generated client, canonical schema, migration, authz action, inference route or worker protocol changes are authorised. Existing strict C1–C10 contracts are composed through the web BFFs and clients.

The governing product and safety rules remain both `AGENTS.md` files, the product and technical specifications, the active/master plans, accepted C1–C14 contracts and ADRs, and the orchestration ledger. This checkpoint improves the product journey and closes an integration gap; it does not increase the truth status of property context, source evidence, proposals, reconstructed geometry or appearance media.

## Discovery record and smallest valuable slice

The verified predecessor passes the complete provider-free repository gate, but the user journey is fragmented:

1. Projects expose twelve equal checkpoint links and a new project enters C1 intake directly; there is no primary next-action journey.
2. C1 already captures household needs, renovation goals, retained/changed items, accessibility needs and evidence availability, so opening C11 or adding a second goal model would duplicate the current core need.
3. C3 property selection is useful context but correctly does not establish an interior. C2 ready evidence does not consistently route plans to C6 and photos/videos to C8.
4. C9 produces an exact branch/revision/head-hash-pinned C5 operation draft, but the product only renders its JSON. It neither previews nor commits it.
5. C5 already provides the authorised, geometry-validated, audited, idempotent, optimistic-concurrency-controlled preview and explicit commit path. C5 commit advances the canonical profile pointer consumed by C10.
6. C10 already compiles only an exact persisted current profile snapshot and provides an honest WebGL/DOM fallback. It should be invoked only after a successful explicit C5 commit or for an already committed current snapshot.

The smallest valuable slice is therefore a guided web journey plus the missing explicit C9 → C5 → C10 handoff. No new reconstruction algorithm, broad planning intelligence, C15 video, MCP, provider or native capture implementation belongs in this checkpoint.

## Frozen product behavior

### Guided journey

- A project has one primary `Home journey` route and primary resume action. New projects enter that route. Specialist checkpoint workspaces remain available as secondary tools.
- The journey presents these stages in order: confirm property; explain goals and evidence availability; supply/review evidence; create or inspect reconstruction/fusion proposal; preview and explicitly confirm corrections; build/explore the committed digital twin.
- Progress is derived from existing server state. A route or request failure must degrade only the affected stage where safe; it must not fabricate completion or erase other readable state.
- Each stage has one honest state from `not started`, `needs attention`, `in progress`, `proposal ready`, `confirmed`, `unavailable` or `complete`, with a single primary next action.
- Viewer personas can inspect permitted state and the committed twin but cannot upload, start jobs, preview mutations, commit corrections or trigger scene compilation.
- Fixture/manual/provider-disabled and hardware-unavailable states remain visibly labelled. No synthetic or fixture journey is described as a real property, deployed provider or physical capture.

### Property, goal and evidence boundaries

- Address/property observations may identify or contextualise a home but never mark interior geometry as observed or confirmed.
- C1 intake remains the renovation-goal authority for this slice. No prose summary may silently become a canonical constraint or model fact.
- Evidence retains the C2 immutable source, rights, processing-consent, training-denied-by-default and provenance rules. A ready plan may continue to C6; ready photos/video may continue to C8; unavailable source kinds remain explicit.
- The iOS capture entry may be prepared or linked, but this Windows/WSL checkpoint may not claim Xcode, RoomPlan, LiDAR, ARKit, background transfer or physical-device validation.

### Proposal, correction and confirmation boundary

1. C6, C7, C8 and C9 outputs remain proposals. Creating or reviewing a proposal never changes a C4 profile or C5 branch.
2. The only new handoff accepts the exact persisted C9 operation draft and calls the existing C5 preview client with its `branchId`, `operations`, `expectedBranchRevision` and `expectedHeadSnapshotSha256`.
3. Preview findings, resulting snapshot hash, expiry and blocking status are visible. `hasBlockingFindings=true` disables confirmation. Preview failure changes no canonical state.
4. Commit requires a separate, explicit homeowner action after preview. It calls the existing C5 commit endpoint using the preview ID and unchanged revision/head pins. There is no auto-commit, background commit or C9-owned mutation.
5. Stale revision/head, expired preview, denied role, offline response or failed geometry validation fails closed and instructs the user to reload/rebuild the draft. The journey does not merge, rebase or retry a changed mutation silently.
6. Success shows the exact committed snapshot/revision and makes clear that the homeowner has confirmed this model version for exploration, not survey, structural, regulatory or professional truth.

### Digital-twin exploration boundary

- C10 compilation uses the current committed C4 profile returned by the existing workspace endpoint. A scene request is never built from a raw C9 proposal, preview result body, appearance artifact or client-supplied snapshot.
- Scene creation is an explicit action. Existing idempotency, server-side snapshot resolution, tenant checks, artifact validation and audit behavior remain authoritative.
- The viewer labels source profile/hash and unresolved limitations. WebGL failure uses the current C10 DOM/2D fallback and is not counted as interactive 3D evidence.
- C8 v2 remains acceptance-only: no API, queue, worker, web route or production routing may import or invoke it. Its Blackwell evidence may be named only as workstation acceptance, not product/representative-home readiness.

## Adaptive isolated worktree plan

Two substantial lanes are retained. The web implementation is one coupled interaction/state machine; splitting its screens would create shared-state and CSS conflicts. Independent end-to-end/security evaluation is separable and must not repair production code. Both lanes use exact `gpt-5.6-sol` with `xhigh` reasoning because they cross permission, canonical mutation, concurrency, privacy and multi-checkpoint integration boundaries.

| Lane                                     | Model / reasoning       | Exclusive editable paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Required output                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C14.1-L1 guided journey and safe handoff | `gpt-5.6-sol` / `xhigh` | `apps/web/src/app/home/**`; `apps/web/src/features/homeowner-journey/**`; `apps/web/test/homeowner-journey/**`; exact allocated files `apps/web/src/features/projects/projects-screen.tsx`, `apps/web/src/features/onboarding/intake-screen.tsx`, `apps/web/src/features/property/property-workspace.tsx`, `apps/web/src/features/evidence/evidence-workspace.tsx`, `apps/web/src/features/reconstruction/reconstruction-workspace.tsx`, `apps/web/src/features/discrepancy-review/fusion-workspace.tsx`, `apps/web/src/features/viewer-3d/viewer-workspace.tsx`, `apps/web/src/app/globals.css` | accessible project journey, honest stage derivation/degradation, primary navigation, exact C9→C5 preview/confirm/commit and post-commit C10 scene/viewer handoff, focused unit/semantics tests                                     |
| C14.1-L2 independent journey acceptance  | `gpt-5.6-sol` / `xhigh` | `tests/e2e/homeowner-journey/**`, `tests/integration/homeowner-journey/**`, `tests/security/homeowner-journey/**`, `docs/evaluation/homeowner-journey/**`, `docs/runbooks/ios/C14_1_APPLE_HANDOFF.md`                                                                                                                                                                                                                                                                                                                                                                                            | independent desktop/mobile browser journey and stateful mock/live-contract seams, no-mutation-before-confirmation assertions, owner/viewer/stale/offline/unavailable/privacy cases, evidence record and precise Mac/iPhone handoff |

Workers may read all predecessor code and contracts but must not edit root manifests/lockfiles, shared contracts/OpenAPI/generated clients, authz, services/workers, migrations/registry, accepted ADRs/contracts, `.github/**`, `.codex/**`, either `AGENTS.md`, the active/master plans or the ledger. The orchestrator owns task prompts, shared documentation, any root command registration, merge review, integration fixes and final evidence.

## Required checkpoint gate

1. The clean predecessor gate is recorded before activation. Final `UV_CACHE_DIR=.cache/uv pnpm verify` and `git diff --check` pass with no regression to existing C1–C14 suites.
2. Focused web tests prove deterministic stage derivation, partial failure/degraded states, owner/editor/viewer controls, safe status language and navigation from project creation through the journey.
3. Browser tests at desktop and 390-pixel mobile widths prove property → goals → evidence → proposal → C5 preview → explicit confirmation/commit → C10 scene/viewer progression. Fixture-backed browser results are labelled software acceptance, not real-property evidence.
4. Stateful assertions prove zero C5 commit before explicit confirmation, no commit with blocking findings, exact draft pins in preview, exact preview pins in commit, stale/expired/denied/offline fail-closed behavior and no C10 create before a committed current snapshot is available.
5. Existing C5/C9/C10 contract, service, integration, security and geometry tests remain authoritative for server-side permissions, tenant isolation, audit, idempotency, optimistic concurrency, immutable publication and geometry validation. Any combined live local run uses only synthetic evidence and is described accordingly.
6. Static/security review proves no source evidence, raw address/provider payload, signed URL, storage locator, credentials or C8 v2 execution path is introduced into the journey or logs.
7. Visible browser inspection records responsive layout, keyboard/focus behavior, loading/empty/degraded/interruption/error states, console/page errors and the honest C10 capability fallback. No canvas claim is made where WebGL is unavailable.
8. Windows/WSL may validate shared code, browser, API/runtime, Docker and an available accepted GPU evidence package. Xcode, RoomPlan, LiDAR and physical Apple validation remain externally deferred with exact setup, commands, cases and expected artifacts in the handoff.
9. The ledger records task IDs, worktree paths, worker/merge/product SHAs, commands/counts, screenshots or artifacts, host/provider/hardware state, integration repairs, limitations and final PR before checkpoint closure.

## Terminal rule

C14.1 may close only after both lanes are reviewed, integrated and host-validated on the dedicated integration branch. C15 remains closed. The final non-draft pull request targets `main` and must be left unmerged for independent review.

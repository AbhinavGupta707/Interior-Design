# C14.3 Contract — Homeowner design-studio continuity

## Authority, predecessor and outcome

- Checkpoint: C14.3, the smallest user-authorised product-integration checkpoint after C14.2. C15 remains closed.
- Immutable predecessor: clean, GitHub-synchronised `main` commit `5b719f9ab83616affc0eeb7de2ba73279bd93d5f`.
- Integration branch: `codex/homeowner-design-studio-journey`.
- First representative product target: an England-based, one-floor, one-bedroom apartment using creator-owned synthetic evidence for Windows/WSL software acceptance.
- Outcome: from the normal project journey, a homeowner with a confirmed exact-current existing twin can continue through a structured C11 consultation, compare and confirm C12 proposed design options, develop an exact C13 materials/specification record, explore the resulting proposed C10 scene and request geometry-safe C14 stills.
- Contract and migration impact: none. This checkpoint composes the accepted C10–C14 routes, contracts, permissions and persistence. It does not change shared schemas, OpenAPI/generated clients, authz actions, migrations, worker protocols, native iOS code or canonical mutation behavior.

This checkpoint closes web product continuity, not every M1 capability. C8 v2 remains acceptance-only; C8 v1 remains byte-for-byte preserved; C8/C9 outputs remain proposals until separately validated and committed through C5; C15 remains closed.

## Independent executable-product audit

The predecessor passes its complete repository gate and contains accepted C10, C11, C12, C13 and C14 control planes, but the homeowner product stops at the twin:

1. `/home/:projectId` loads persisted C1/C2/C3/C5/C6/C8/C9/C10 state only and declares the exact current C10 twin as the journey end.
2. C11–C14 are exposed as secondary specialist tools rather than a normal, ordered homeowner continuation. Their persisted states do not contribute to the primary next action.
3. C11 persists and accepts a structured preference/constraint brief. A new brief is not itself a geometry or canonical-model assertion and need not copy the twin, but C12 launch must resolve and revalidate the exact current existing snapshot alongside the accepted brief.
4. C12 already revalidates the accepted brief and exact source snapshot, creates alternatives, and confirms a selected option on a separate proposed branch. It does not mutate the existing twin.
5. C13 already binds a confirmed C12 option to an immutable specification/catalog release and can request an exact proposed C10 scene. C14 already accepts eligible exact C10/C13 sources and publishes geometry-safe still artifacts independently from optional enhancement.
6. Reload persistence, role enforcement, idempotency, stale pins, expiry, withdrawal and tenant isolation exist in the individual services but are not composed into one homeowner state machine.
7. Production C8 dispatch still invokes the accepted v1 worker. The C8-v2 sibling has an explicit fail-closed exposure boundary and `productionRoutingEnabled=false`.
8. C9 can acquire accepted C6, C7 and completed C8-v1 results. A reconstruction result alone is appearance/registration evidence rather than a second safe semantic geometry source; the current fitter correctly abstains when the minimum distinct semantic-source gate is not met.
9. The native iOS client covers project/setup/evidence/capture surfaces through C8, but has no standalone C10–C14 product flow or generated mobile client. The existing HTTP route inventory can be documented for Mac review, but this checkpoint may not invent or freeze native transport, offline, background, rendering or Swift-model assumptions.

## Frozen homeowner behavior

### One normal journey

- Projects retain one primary `Resume home journey` action. A confirmed twin extends that same route into a clearly separated `Design your home` phase; it does not send a homeowner to an unordered checkpoint menu.
- Design stages appear in this order: consultation and accepted brief → design-option generation/comparison/confirmation → materials and specification → proposed-scene exploration → geometry-safe stills.
- Persisted service state drives every stage after reload. URL presence, browser-local state, fixture flags or a previous screen visit cannot mark progress complete.
- Each design stage exposes one honest next action and distinguishes not started, in progress, needs attention, ready, confirmed/complete and unavailable/degraded states.
- Specialist workspaces remain reachable for diagnostics, but they are secondary to the normal homeowner journey.

### Exact-current twin gate

- The design phase unlocks only when the existing-profile current snapshot is also the head of a changed branch and differs from that branch's source snapshot, preserving the accepted C14.2 confirmation rule.
- Starting or resuming C11 does not mutate or copy geometry. C11 records homeowner intent, preferences, constraints, uncertainty and human/AI classification under its existing contract.
- C12 launch uses only an accepted current C11 brief plus the server-resolved exact current existing snapshot. Stale or changed current-snapshot pins fail closed and return the homeowner to the journey; no client-side rebasing or silent retry is allowed.
- A previously generated option remains tied to its recorded source snapshot. If the existing twin changes, the journey may show the old record for inspection but must not label it current or use it to advance the exact-current path.

### Design, specification, exploration and rendering boundaries

- C12 must present at least two completed alternatives for useful comparison before a homeowner confirms one. A terminal failed/abstained job remains visible and does not fabricate choice.
- Confirmation is explicit and creates or advances only the existing C12 proposed-design branch. Existing, proposed and as-built state remain distinct.
- C13 starts only from the exact persisted C12 confirmation. The specification retains catalog/version, uncertainty, substitution, withdrawal and expiry behavior and makes no fixed price, availability, delivery, regulatory or professional-certainty claim.
- C10 proposed exploration starts from the exact current C13-backed proposed snapshot. Its immutable scene, manifest and fallback remain read-only; the scene cannot become canonical dimensional truth.
- C14 starts only from an eligible exact C10 scene and its required C13 binding. Safe render outputs remain geometry-locked and versioned; optional enhancement remains separately labelled and cannot replace or mutate the safe bundle.
- C15 video, procurement transactions, contractor appointment and implementation-package compilation are outside this checkpoint.

### Roles, degraded state and evidence honesty

- Owner/editor roles may perform the mutations already authorised by C11–C14. Viewers may inspect permitted state and artifacts but cannot initialise/accept a brief, generate/confirm options, create/change a specification, create a scene or request/cancel/retry a render.
- Expired session, forbidden role, offline response, stale snapshot, withdrawn source/catalog right, missing provider/runtime and terminal job failures remain stage-specific and fail closed. Other readable stages remain visible.
- Acceptance fixtures are creator-owned and represent a synthetic England one-floor, one-bedroom apartment. They are software evidence only, not a real property, field survey, supplier quote, professional review, provider deployment, WebGL-canvas claim or physical Apple result.

## Single-session execution plan

The product web work and independent acceptance are sequential, not genuinely parallel: acceptance must consume the reviewed production state. Managed worktree creation was assessed after the initial freeze, but the Codex desktop project registry reported the correct WSL checkout as `isGitRepository=false` and rejected both direct managed-worktree creation and handoff before any implementation task or worktree began. `git worktree list --porcelain` continued to show only the primary checkout.

The checkpoint is therefore replanned, before implementation, to one primary `gpt-5.6-sol` / `xhigh` session. This avoids a same-checkout worker or raw unmanaged worktree. The primary session performs these bodies in order:

| Body                               | Editable paths                                                                                                                                                                                                                                                                                                                                                                    | Required output                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homeowner design-studio web        | `apps/web/src/features/homeowner-journey/**`; `apps/web/test/homeowner-journey/**`; exact required files under `apps/web/src/features/design-consultation/**`, `design-options/**`, `materials-products/**`, `viewer-3d/**`, `render-stills/**` and their matching `apps/web/test/**` paths; `apps/web/src/features/projects/projects-screen.tsx`; `apps/web/src/app/globals.css` | persisted C11–C14 journey loading/state/presentation, exact-current gating, normal cross-workspace handoffs, role/degraded/stale recovery and focused web tests        |
| Independent design-loop acceptance | `tests/e2e/homeowner-design-studio/**`; `tests/integration/homeowner-design-studio/**`; `tests/security/homeowner-design-studio/**`; `docs/evaluation/homeowner-journey/C14_3_DESIGN_STUDIO_ACCEPTANCE_2026-08-25.md`; `docs/runbooks/ios/C14_3_DESIGN_STUDIO_MAC_HANDOFF.md`                                                                                                     | desktop/mobile, API-seam, privacy/security and persisted-state acceptance; exact provisional Mac/mobile route inventory and physical-device cases without native edits |

Root manifests and lockfiles, shared contracts/OpenAPI/generated clients, services/workers, authz, migrations/registry, accepted ADRs/contracts, `.github/**`, `.codex/**`, native iOS paths and both `AGENTS.md` files remain read-only. The primary session owns contract/plan/ledger truth, implementation, review, repairs, live evidence, final gates, push, PR and cleanup.

## Required checkpoint gate

1. The exact predecessor branch/commit/remote/ruleset/check-run and clean-worktree verification remains recorded. The final branch stays based on the same authoritative history and preserves unrelated work.
2. Focused web tests prove exact-current twin gating, persisted C11–C14 stage derivation, at least two comparable C12 alternatives, explicit proposed-only confirmation, exact C13/C10/C14 pins, role restrictions and partial degraded-state preservation.
3. Stateful browser acceptance begins at normal project navigation and continues from a confirmed synthetic apartment twin through accepted brief, two useful design alternatives, selected option, materials/specification, proposed-scene exploration and geometry-safe still request/status/artifact review.
4. Assertions prove no C12 launch from an unaccepted brief or stale twin; no existing-profile mutation from option confirmation; no C13 launch without an exact confirmation; no proposed scene from a stale specification; and no C14 request from an ineligible scene/binding.
5. The counted software path uses existing deterministic/creator-owned adapters and honestly labels any inert render artifact. Exact Linux CPU Blender acceptance inherited from C14 may be referenced, but a new real Blender execution is not required unless the environment is explicitly configured and authorised.
6. Security/static review proves no C8-v2 invocation, C8-v1 modification, direct reconstruction-to-canonical promotion, source bytes, raw address/provider payload, signed storage locator, secret or unsafe log field was added.
7. C10 fallback/capability presentation is inspected. A DOM or screenshot fallback is not reported as successful interactive WebGL.
8. The provisional mobile handoff enumerates exact existing C10–C14 routes, authentication/role/idempotency/version-pin expectations, response/status needs and Mac/iPad test cases. It identifies unresolved native transport/offline/background/rendering assumptions and does not freeze shared API changes before the Mac audit.
9. Existing C1–C14.2 regressions remain green. Final `UV_CACHE_DIR=.cache/uv corepack pnpm verify`, focused integration/security/browser gates and `git diff --check` pass. Commands that run zero tasks do not count as evidence.
10. The ledger and evaluation record exact task/worktree/worker/integration/product SHAs, test counts, screenshots/artifacts, synthetic fixture classification, provider/hardware state, limitations and PR.

## Terminal rule

C14.3 may close only after both sequential bodies are implemented and reviewed, the complete Windows/WSL-testable design loop is rendered and statefully verified through normal navigation, documentation matches exact evidence and a non-draft PR targeting `main` is open for review. Shared mobile/backend changes are not part of this checkpoint and remain provisional pending the separate Mac/iPad audit. C15 remains closed and the PR must not be merged by this run.

## Closeout — 2026-08-25

C14.3 is closed for its frozen Windows/WSL web-continuity scope in non-draft PR
[#5](https://github.com/AbhinavGupta707/Interior-Design/pull/5), targeting `main` and left
unmerged. Product commit `9d88d1c`, acceptance commit `bd3f1d3`, review repair `408b809` and
evidence/handoff commit `2de820e` satisfy the sequential bodies.

Counted evidence: focused web 141/141; independent integration 4/4; security 4/4; final rendered
normal-navigation Chromium workflow 1/1; full repository verify with all 24 lint/typecheck/build
tasks, all 45 unit dependency tasks, web 227/227, Ruff/mypy clean and Python 157 passed/two optional
capability skips; `git diff --check` clean. The final screenshot is
`/tmp/c14-3-homeowner-design-studio-final.png`, 1440×3409, SHA-256
`6f549b673f454ac391f17e4e7a33ec85863f5ede99d4305cf04b1928616e9de0`.

The synthetic fixture proves software continuity only. Native Apple paths, shared contracts,
services, C8 v1 and C8-v2 are unchanged. Cross-device C12 confirmation recovery and
server-authoritative C14 eligible-source discovery remain provisional in the Mac handoff; no shared
assumption is frozen. C15 remains closed and no later checkpoint is open.

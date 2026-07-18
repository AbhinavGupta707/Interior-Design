# C12 Contract — Valid Design Options and Variant Engine

## Authority, predecessor and outcome

- Active plan: `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`.
- Continuation authority: `docs/orchestration/C11_C15_CONTINUATION.md`.
- Immutable predecessor: C11 ledger-close commit `0326a8b1bc51dce9a07a3c7b1cb2183b01654f24`.
- Outcome: an authorised household can generate at least two genuinely different, deterministic and inspectable furnishing/material/lighting options from one exact accepted brief and committed home, then explicitly confirm any option into its own replayable proposed C5 branch.
- Mutation boundary: generation is proposal-only. Only an owner/editor confirmation can seed an exact proposed clone when needed, create an isolated branch, preview and commit the option. C12 cannot mutate the existing or as-built profile, walls, openings, stairs, fixed objects or C11 brief data.

## Frozen shared contracts

The orchestrator-owned contract is `packages/contracts/src/c12.ts`:

- `c12-design-constraint-v1`;
- `c12-interior-asset-ref-v1`;
- `c12-option-job-v1`;
- `c12-design-option-v1` and `c12-design-option-set-v1`;
- `c12-operation-bundle-v1`;
- `c12-option-confirmation-v1`; and
- the exact eight-route `c12RouteContract`.

The C5 extension is `c12-design-element-operation-v1` with exactly three proposed-profile operations: `design.element.create.v1`, `design.element.replace.v1` and `design.element.remove.v1`. They may affect only furnishings, finishes and lights. Create/replace envelopes retain exact asset/version/content/metadata/placement-policy/rights hashes; the C12 option projection retains the complete matching `InteriorAssetRef`. Old C5 operations, schema identity and replay remain unchanged.

All job creation binds an accepted brief ID/revision/content hash and an exact committed existing or proposed model ID/profile/snapshot ID/version/hash. Client requests choose only a bounded option count and distinct design directions. The server derives the authoritative typed constraints from the accepted brief, canonical model, asset policy and system geometry policy; request bodies cannot assert that a hard constraint passed.

## Existing-to-proposed confirmation bridge

Generation constructs and validates a deterministic proposed working clone in memory without canonical mutation. Confirmation is one transaction-scoped, fenced bridge:

1. lock and revalidate project, job version, pending option, expiry, accepted brief and exact source snapshot;
2. recompute the operation bundle, constraint results, diversity/option-set hashes and candidate snapshot hash;
3. create or reuse the exact derived proposed base only if the current proposed profile is absent or already matches that base;
4. create one isolated C5 branch using deterministic sub-idempotency keys;
5. preview and commit the exact retained C12 design operations under the confirming human actor;
6. require the committed snapshot hash to equal the proposed candidate hash; and
7. record option state, confirmation, branch, preview, commit, audit/outbox and idempotency atomically.

Any stale brief/model/job/option, failed hard constraint, asset-binding mismatch, branch conflict or hash mismatch rolls back without a partial branch or commit. Same-key/same-body replay returns the original result; same-key/different-body conflicts. Confirming one option does not reject its siblings. Machine principals may produce bounded proposals but cannot confirm.

## Constraint, search and diversity rules

The local baseline is a pure deterministic template plus bounded-search engine. Inputs are stable-ID/hash sorted; coordinates and dimensions are integer millimetres, rotations are integer milli-degrees, scores are basis points, geometry predicates have no hidden epsilon and search ends by a versioned candidate-count limit rather than wall-clock time. The seed is derived only from frozen input/config hashes. `Date`, `Math.random`, thread-dependent ordering and narrative/image differences cannot influence geometry.

Hard constraints are limited to computational facts the software can prove: exact source pins, valid canonical geometry, proposed-profile scope, asset identity/rights/dimensions, complete footprint containment, furnishing/fixed-object/furnishing collision, explicit keep-out polygons, supplied circulation/clearance values, vertical fit, retained-element hashes, valid finish targets/faces and bounded operations. Unsupported or contradictory active hard requirements cause typed abstention; they never silently become preferences.

Objectives remain separate integer vectors: brief fit, circulation, conversation, daylight proximity proxy, edit distance, material coherence, retention and storage. Daylight is a proximity proxy, not a simulation. An option set contains only non-dominated candidates and a complete pairwise matrix over asset inventory, assignment, placement, material and operation-signature distance. Different UUIDs, prose, ordering or rendered pixels count as zero diversity.

Structural, regulatory, clinical-accessibility, fixed-cost, live-availability and professional-judgement requirements route to explicit review. “Valid” means that the frozen computational constraints passed; it is not professional approval.

## Generic asset and rights boundary

C12 uses only creator-owned synthetic `bounded-proxy` assets. Every reference has a stable asset/version ID, exact content/metadata/policy/rights hashes, integer geometry envelope, coordinate/forward-axis convention, allowed rotations, per-side clearance policy and separate permissions: service processing allowed, derivatives allowed, redistribution denied and training denied. It contains no price, stock, supplier, brand or remote executable locator. C13 may add richer catalog records only by conforming to this interface.

Primary-source decisions checked on 2026-07-18:

- [Khronos glTF 2.0.1](https://registry.khronos.org/glTF/) remains the current glTF 2.0 specification; glTF linear units are metres and its coordinate system is right-handed, so later C10/C13 asset compilation must use an explicit millimetre conversion and never infer scale.
- [Google OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver) is integer-based and the [official OR-Tools repository](https://github.com/google/or-tools) is Apache-2.0. It is not introduced in C12: the bounded TypeScript baseline is sufficient, easier to replay identically inside the current trust kernel and avoids making solver/runtime behavior a checkpoint dependency. A future solver must remain behind the same deterministic port and earn separate cross-platform evidence.

## Authorisation and privacy

The shared action registry adds:

- `design-option:job:create`, `design-option:job:read`, `design-option:job:cancel`, `design-option:job:retry`;
- `design-option:proposal:read`, `design-option:proposal:confirm`.

Owner/editor may execute every action. Viewer may read jobs/options only. Foreign-tenant lookup fails before disclosure. Machine principals have no confirmation route. Logs/metrics may contain safe codes, stages, counts, durations, versions and hashes; they must not contain raw brief statements, household/accessibility content, narratives, operations, asset payloads, tokens, lease credentials or identifiers beyond approved correlation/resource IDs.

## Persistence and migration

- Migration: `services/platform-api/migrations/0012_design_options.sql`.
- Registry owner: C12-L3, preallocated before launch.
- Required records: versioned jobs; leased/fenced attempts with heartbeat/reclaim; immutable option sets/options/bundles; mutable validated heads and append-only state events; idempotency effects; confirmations linked to exact branch/preview/commit/result; audit events and privacy-minimised outbox.
- Migration `0012` widens the C5 envelope type/schema check as a paired invariant: original types require `c5-model-operation-v1`; the three design-element types require `c12-design-element-operation-v1`. It never rewrites migration `0005` or weakens append-only history.
- State progression is queued → running stages (derive constraints, generate, validate, publish) → succeeded or abstained, with cancel-requested/cancelled/failed/retry paths. Publication is fenced by job version, attempt and lease token.

## Adaptive isolated lanes

Four lanes are retained. All use exact `gpt-5.6-sol` with `xhigh` reasoning because deterministic spatial search, collision/rights handling, transactional cross-domain confirmation and adversarial cross-surface evaluation are complex.

| Lane                                          | Exclusive editable paths                                                                                                                                                                                                                                | Required output                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C12-L1 deterministic constraint/layout engine | `packages/design-engine/**`                                                                                                                                                                                                                             | typed constraint derivation, rotated-footprint predicates, bounded search, Pareto/non-domination, diversity, canonical replay and severe/property tests             |
| C12-L2 generic assets/placement producer      | `packages/interior-assets/**`; `services/spatial-worker/src/asset-placement/**`; `services/spatial-worker/test/asset-placement/**`                                                                                                                      | creator-owned asset manifest, rights/hash validation, clearance-aware furnishing/finish/light placement, deterministic producer port and hostile/resource tests     |
| C12-L3 durable proposal/confirmation runtime  | `packages/model-operations/src/ai-tools/**`; `services/platform-api/src/modules/design-options/**`; `services/platform-api/test/c12/**`; `services/platform-api/migrations/0012_design_options.sql`; `docs/runbooks/development/c12-design-options.md`  | jobs/leases/retry/cancel/abstention, immutable proposals, exact transactional C5 bridge, tenant/idempotency/redaction tests and runbook                             |
| C12-L4 option UX/independent acceptance       | `apps/web/src/features/design-options/**`; `apps/web/src/app/design-options/**`; `apps/web/src/app/api/c12/**`; `apps/web/test/design-options/**`; `tests/{evaluation,security,e2e,performance}/design-options/**`; `docs/evaluation/design-options/**` | accessible option comparison, constraints/assumptions/objectives/trade-offs, explicit confirmation, viewer/mobile/keyboard/degraded states and independent evidence |

Merge order is L1 → L2 → L3 → L4. The orchestrator alone owns shared C5/C12 contracts and tests, the core model-operation registry/reducer/history extension, authz, migration registry, root/workspace manifests and lockfile, package scaffolds, central platform/spatial/web composition/navigation, accepted contract, ledger, `.github`, `.codex` and `AGENTS.md`.

## Exhaustive integration gate

C12 cannot close until all of the following pass:

1. full repository format/lint/typecheck/unit/build/Python verification and `git diff --check`;
2. strict schema/property/severe tests for concave containment, rotated rectangles, 1 mm collisions, clearance, keep-outs, retained elements, invalid finish targets, overflow, malformed/hostile asset data, resource ceilings and repeatable hashes;
3. deterministic Pareto and pairwise diversity evidence proving differences are operation/asset/placement/material based, with no dominated or narrative-only duplicate;
4. clean C1-C12 migration and live Postgres job/lease/reclaim/cancel/retry/abstain/publication/idempotency/tenant tests;
5. zero C4/C5 mutation before confirmation; at least two valid options confirmed into separate proposed branches, each replaying through C5 to its declared exact snapshot hash without changing the existing profile or sibling branch;
6. same-key replay, changed-body conflict, concurrent confirmation, expiry, stale brief/source/job, forged asset/ref/bundle, failed constraint and worker-malformation tests with no partial effect;
7. owner/editor/viewer/foreign-tenant coverage and explicit machine-confirmation denial;
8. at least one confirmed proposed branch compiles through C10 and validates as GLB with stable furnishing/finish/light IDs;
9. structured-log scan proving private brief, household/accessibility, narrative, operation, asset, token and lease content is absent;
10. production-composed Next BFF → API → real local worker → Postgres journey from accepted brief/exact committed home to distinct options and two explicit branch confirmations;
11. Playwright Chromium/Firefox/WebKit desktop/mobile, keyboard-only, viewer, loading/empty/offline/stale/error/cancel/retry/recovery, no-horizontal-overflow and no unexpected console/network failure;
12. in-app Browser visible journey attempt, with connected Chrome fallback recorded separately if the controller cannot acquire a tab; and
13. durable evaluation/ledger evidence, worker/merge/product SHAs, clean worktree and pushed `main`.

No GPU, Blender, external provider, physical device, customer data or paid service is required. Human design-quality, representative-household comprehension, professional review and physical-product validation remain explicitly `NOT MEASURED`/`NOT RUN` unless genuinely performed.

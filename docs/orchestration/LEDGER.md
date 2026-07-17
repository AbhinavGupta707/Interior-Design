# Orchestration Ledger

## Programme

- Active plan: `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`
- Integration branch: `main`
- Repository/project root: `/Users/abhinavgupta/Desktop/Interior Design`
- Remote: `https://github.com/AbhinavGupta707/Interior-Design.git`
- Worktree policy: project-scoped Codex worktree tasks only
- Worker runtime policy: explicit `gpt-5.6-sol` for every lane; `high` for bounded/straightforward work and `xhigh` for complex architecture, security, geometry, inference, concurrency, adversarial or integration-heavy work. Each checkpoint records the assignment before launch.
- Autonomous programme target: complete C1 through C10 sequentially; the immutable C1–C6 goal is followed immediately by a C7–C10 continuation goal
- Gate policy: no later checkpoint opens until code, contracts, security/data behavior, browser/UI/UX and applicable simulator/runtime evidence for the current checkpoint are integrated and recorded

## C0 — Repository and multi-surface delivery substrate

### Master activation and integration

- Status: complete on `main`; C1 not opened
- Contract: C0-v1
- Base commit: `652575f`
- Root/toolchain ownership: master/orchestrator
- Planned lanes: four

| Lane                    | Task/thread                            | Worker SHA | Merge SHA | State      | Exclusive paths                                                           |
| ----------------------- | -------------------------------------- | ---------- | --------- | ---------- | ------------------------------------------------------------------------- |
| C0-L1 platform/API      | `019f6d3d-1e35-7d61-978b-1983cffc422e` | `f054968`  | `bf2a522` | integrated | `services/platform-api/**`, `packages/config/**`                          |
| C0-L2 web/UI            | `019f6d3d-1e14-7fe0-9855-593be5018816` | `c9dc5a7`  | `31b4c34` | integrated | `apps/web/**`, `packages/ui/**`                                           |
| C0-L3 native iOS        | `019f6d3d-1e6b-75d3-bb0f-75c72eef9f6a` | `1b52ede`  | `0b00d7a` | integrated | `apps/ios-capture/**`                                                     |
| C0-L4 delivery/infra/QA | `019f6d3d-1e30-7952-831a-dc715e7d9ebe` | `09fa110`  | `bc5aa2d` | integrated | `infrastructure/**`, `tests/bootstrap/**`, `docs/runbooks/development/**` |

### Integrated gate evidence

- Frozen clean install succeeded with pnpm 10.33.0; `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, ESLint, TypeScript, 16 JavaScript unit tests, production builds, Ruff, mypy and pytest.
- The provider-free infrastructure contract passed 15 bootstrap tests and Terraform validation. The lane also proved live loopback-only PostGIS, four signed S3 lifecycle buckets and Temporal cluster health, then stopped the containers.
- XcodeGen regeneration was stable and the merged iOS app passed 13 tests on the iPhone Air iOS 26.4 Simulator. Simulator output remains explicitly non-RoomPlan evidence.
- The merged API and production web processes passed the cross-surface localhost smoke contract. C0-L2 separately verified desktop and mobile browser layouts, navigation/recovery, semantics, overflow and zero console errors.
- Integration caught and fixed two cross-lane defects: the root formatter now excludes native DerivedData, and the bootstrap smoke uses the rendered `Home Design Studio` identity.
- No paid provider, cloud resource, public deployment, real customer data, LiDAR claim or GPU claim was activated.

## C1 — Identity, project and home intake

### Master activation and integration

- Status: complete on `main`; C2 may open from the ledger-close commit
- Contract: `docs/orchestration/checkpoints/C1_CONTRACT.md`
- Base commit: `1c9d439`
- Product completion SHA: `46ab9f3`
- Planned lanes: three
- Provider policy: local fixture plus disabled provider-neutral OIDC port; no external key required
- Data policy: deterministic two-tenant synthetic fixtures only

| Lane                     | Task/thread                            | Worker SHA | Merge SHA | State      | Exclusive roots                                                                        |
| ------------------------ | -------------------------------------- | ---------- | --------- | ---------- | -------------------------------------------------------------------------------------- |
| C1-L1 backend            | `019f6d5a-efc2-7942-b990-799dce332350` | `1c8ae98`  | `ee1a67c` | integrated | platform identity/projects/intake modules, migration 0001, backend C1 tests/runbook    |
| C1-L2 authorisation      | `019f6d5a-eff0-7543-9814-88022bd61d82` | `5bf25a3`  | `af5f4da` | integrated | `packages/authz/**`, identity security tests and threat model                          |
| C1-L3 web/iOS onboarding | `019f6d5a-f288-7a53-b581-ff462d00b5d2` | `b705fd5`  | `fbed556` | integrated | allocated web onboarding/BFF/shell files, iOS project flow files, onboarding E2E tests |

### Integrated gate evidence

- `UV_CACHE_DIR=.cache/uv pnpm verify` passed twice on the integrated branch: formatting, six-package lint/typecheck, 59 JavaScript unit tests, production API/web builds, Ruff, strict mypy and pytest.
- The deny-by-default identity policy passed 69 security cases. Contract/API suites passed 13 non-database cases, and the real PostGIS migration/persistence/isolation/concurrency suite passed all 15 tests after the live browser run.
- The live database ended with exactly three synthetic memberships and zero project, intake or idempotency rows; the Compose service was stopped without deleting the reusable volume.
- Playwright passed six desktop/mobile journeys covering sign-in, project creation, structured save/edit/resume, stale-write protection, expired/forbidden/offline/retry states, keyboard navigation, overflow and console/network failures.
- A production web BFF was exercised against the real API in the in-app browser at desktop and 390×844 mobile sizes. The saved intake survived navigation/reload, canonical fixture identities remained consistent, there was no horizontal overflow and the console contained no warnings/errors. The primary browser-use connector had a local bootstrap incompatibility, so the installed in-app Browser controller supplied the visible evidence.
- XcodeGen added the C1 test source to the checked project deterministically. The iPhone Air iOS 26.4 Simulator passed 17 tests, then Computer Use verified the live SwiftUI project list, explicit Simulator limitation, capture-eligibility route and manual-evidence fallback. This is not physical RoomPlan evidence.
- Integration review caught and fixed the API `tsx watch` command ordering, complete stale-form locking, mismatched fixture aliases, evidence-label CSS specificity and the missing generated Xcode test reference. No provider key, real address, bearer-token output, localStorage credential, physical-capture claim or cloud deployment was introduced.

## C2 — Immutable multimodal evidence ingestion

### Master activation and integration

- Status: complete on `main`; C3 may open from the ledger-close commit
- Contract: `docs/orchestration/checkpoints/C2_CONTRACT.md` (`c2-ingest-v1`)
- Starting integration commit: `660086a`
- Frozen worker base commit: `e56dbd2`
- Product completion SHA: `0241d54`
- Planned lanes: four
- Provider policy: provider-free PostGIS plus loopback-only SeaweedFS; production storage is an inactive S3-compatible adapter
- Privacy policy: synthetic evidence only; processing consent required; training use defaults to denied

| Lane                            | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                |
| ------------------------------- | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ------------------------------------------------------------------------------ |
| C2-L1 asset/storage backend     | `019f6da8-7a0f-7dc2-9daa-adf15ad07c9e` | `gpt-5.6-sol` / `xhigh` | `b6d45f0`  | `f4f685c` | integrated | platform asset/storage modules, C2 composition/migration/tests and API runbook |
| C2-L2 hostile-media worker      | `019f6da8-79f1-7703-93ec-593ae0888872` | `gpt-5.6-sol` / `xhigh` | `4022369`  | `c142216` | integrated | spatial-worker source/tests and worker runbook                                 |
| C2-L3 cross-surface evidence UX | `019f6da8-7a09-7752-8eca-dc85651440ae` | `gpt-5.6-sol` / `high`  | `20be813`  | `83add54` | integrated | allocated web evidence/BFF/project/CSS and iOS evidence/flow/test paths        |
| C2-L4 adversarial QA            | `019f6da8-79f1-7703-93ec-595f674fca65` | `gpt-5.6-sol` / `xhigh` | `596ff92`  | `05f9c1b` | integrated | evidence security/integration/adversarial E2E fixtures and upload threat model |

### Integrated gate evidence

- The frozen prelude passed `UV_CACHE_DIR=.cache/uv pnpm verify`: formatting, seven-package lint/typecheck, 60 JavaScript unit tests, all production builds, Ruff, strict mypy and pytest. Shared C2 contracts added five focused rights, filename, multipart and internal-locator cases; the new spatial-worker workspace also built and passed its registration test.
- All four worktrees were verified clean at `e56dbd2`; each is a real project-scoped Codex task with the model/reasoning predeclared above.
- The integrated `UV_CACHE_DIR=.cache/uv pnpm verify` gate passed formatting, seven-package lint/typecheck, 115 JavaScript unit tests, API/worker/web production builds, Ruff, strict mypy and pytest. The API reported 29 passed and five provider-gated cases skipped in that provider-free unit invocation; contracts passed nine, worker 23 and web 20. All three independent evidence TypeScript configurations also compiled with no emit.
- The independent provider-free/static adversarial pack passed 21 cases with 27 named live-environment skips. Its four routed findings were resolved centrally: the video ceiling is 30 minutes everywhere, 100 MP is enforced across dimensions, resumable part numbers are part of the strict shared session, and hostile filenames remain display-only. The production worker static checks found no shell execution path and confirmed bounded subprocess output and temporary storage.
- Clean schema evidence used a disposable database: C1 bootstrap and C2 migration both applied from scratch, and the installed lease constraint requires owner, token and expiry together while forbidding stale lease fields in non-leased states. Live Postgres backend tests passed 2/2, live SeaweedFS multipart tests 1/1, and the adversarial database pack passed three cases with one deliberately unseeded stale-lease case skipped.
- A real loopback full-stack run proved signed multipart upload to SeaweedFS, one durable leased worker attempt, full checksum/signature verification, a `ready` asset, a fetchable metadata-stripped JPEG derivative and viewer denial (`403`) for original-source access. The separate live hostile-media/API harness passed 21 cases and skipped only the explicitly unseeded expired-session and isolated-log probes. Tokens were passed only through child environments and no signed URL or credential was persisted in the ledger.
- Playwright passed eight desktop/mobile evidence journeys after the integration fix that converts an awaited preview request into an explicit short-lived link, avoiding browser popup blocking. The matrix covers rights-first consent, default-denied training, local hashing, pause/reload/resume with reconciled server parts, offline/unsupported recovery, every safe processing status, viewer read-only behavior, responsive overflow and the preview target/relationship contract.
- The in-app browser exercised the production-shaped web BFF against the real local API at desktop and 390 px mobile widths. Project inventory, the real `ready` evidence row and a fresh preview link rendered with no console warnings/errors or horizontal overflow. The test used canonical `localhost` because Next development HMR rejects a mixed `127.0.0.1` origin.
- XcodeGen deterministically added the C2 sources/tests to the checked project. The iPhone Air iOS 26.4 Simulator passed 25 XCTest cases. Computer Use then verified the rendered SwiftUI project selection, explicit no-camera/LiDAR Simulator boundary, manual fallback, C2 source/rights/consent controls, default-denied training use, the real ready evidence inventory and opening its short-lived image preview in Simulator Safari.
- Integration review reconciled shared/API resume DTOs, worker/job states (`queued`/`leased`/`retryable`/`succeeded`/`failed`), lease-token fencing, rich append-only audit rows, technical metadata, exact local S3 credentials, bounded error codes, adversarial fixtures/harnesses, generated Xcode membership and the popup-safe preview interaction. Runbooks now describe the integrated contract and reproducible live harnesses.
- Honest residual limits: no malware-scanner daemon, physical iPhone/RoomPlan/background-relaunch evidence, production cloud/IAM/lifecycle proof, customer media or public deployment exists in C2. Expired-session cleanup, isolated log scanning and stale-lease reclamation remain separately seedable live probes; a skip is not counted as evidence. C2 validates and safely prepares evidence but does not infer geometry, reconstruct rooms or establish professional truth.

## C3 — Honest property and home dossier

### Master activation and integration

- Status: complete on `main`; C4 may open from the ledger-close commit
- Contract: `docs/orchestration/checkpoints/C3_CONTRACT.md` (`c3-property-v1`)
- Prelude commit: `f26179b`
- Frozen worker base commit: `c5880bd`
- Product completion SHA: `432f2fd`
- Planned lanes: two, selected adaptively for one producing backend and one consuming UX
- Provider policy: deterministic synthetic fixture plus manual entry; live address, EPC and planning providers remain disabled
- Data policy: no real address/query fixture, no raw provider payload, no inferred interior, model training denied

| Lane                           | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                                      |
| ------------------------------ | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| C3-L1 dossier backend/adapters | `019f6e0c-1fe7-7241-9d20-c369f5a64467` | `gpt-5.6-sol` / `xhigh` | `7892d86`  | `54da2ca` | integrated | property adapter, platform property module/C3 composition, migration, fixture, backend tests/runbook |
| C3-L2 dossier UX/comprehension | `019f6e0c-1fe7-7241-9d20-c38e30717a00` | `gpt-5.6-sol` / `high`  | `6641c88`  | `0decc88` | integrated | allocated web property/BFF/project/CSS, contract/E2E tests and comprehension evaluation              |

### Prelude gate evidence

- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, eight-package lint/typecheck, 144 JavaScript unit tests, all production builds, Ruff, strict mypy and pytest before activation.
- Focused hardening after review passed all 14 contract tests, 51 authorisation tests, contracts/adapter typechecks and `git diff --check`.
- Shared contracts preserve UPRNs as strings, keep provider-disabled/failure/no-match states distinct, require immutable source metadata and deny training use, constrain every non-unknown dossier item to a source, and reject cross-project/property source records.
- The two lane assignments and their exact `gpt-5.6-sol` reasoning levels were frozen before launch. L1 receives `xhigh` because it owns privacy, tenant isolation, idempotency, concurrency and immutable persistence; L2 receives `high` because it is a bounded consumer of the frozen contract with no provider or persistence authority.

### Integrated gate evidence

- Both worktrees completed cleanly from the frozen `c5880bd` base and were merged in the declared L1-then-L2 order. Their exclusive manifests were audited before merge: L1 touched only its 18 backend/adapter allocations and L2 only its 23 web/contract/E2E allocations.
- The first integrated verification correctly identified an incomplete workspace install rather than a code defect. A frozen lockfile install restored the missing workspace link without changing a manifest or lockfile. `UV_CACHE_DIR=.cache/uv pnpm verify` then passed formatting, eight-package lint/typecheck, 172 JavaScript unit tests, every production build, Ruff, strict mypy and pytest; seven provider/live-environment cases remained explicitly skipped in the provider-free unit invocation.
- The independent property contract passed four cases, and Playwright passed all 12 journeys at 1440×960 desktop and 390×844 mobile sizes. The matrix covers exact, ambiguous, expiry, no-match, manual, disabled, outage, offline, conflict, owner/viewer, keyboard, semantics, labels and overflow behavior.
- A clean disposable PostGIS database received C1, C2 and C3 migrations in sequence. The live C3 Postgres suite passed 2/2, proving same-key replay, different-key races, expiry/consumption, tenant isolation, immutable-history triggers, one-effect concurrency and the valid empty pre-selection source collection.
- The in-app browser exercised the real Next BFF and real API/database end to end. It created a fresh synthetic owner project, searched and selected `14 Example Mews`, loaded all five epistemic labels, explicit unknown interior, `not-reviewed` planning and immutable source permissions. Desktop and 390×844 mobile checks had no horizontal overflow or console warning/error. The alpha viewer had zero editable controls and could inspect provenance with model training explicitly denied.
- That real journey caught a cross-lane integration defect missed by mocked browser tests: the Postgres backend returned `404` for source records before a first property selection. The product completion commit `432f2fd` now returns the contractually valid empty collection, adds unit/live regressions and fixes the disposable-database runbook to use explicit loopback password authentication.
- API logs redacted every request URL throughout the live journey and emitted no address query, token or raw provider payload. Production still fails closed to the disabled adapter; fixture and injected-unavailable modes are rejected in production.
- Honest residual limits: C3 has no activated live address, UPRN, EPC, mapping or planning provider, no provider licence/privacy/retention approval, no customer data and no professional interior, structure, boundary or planning claim. Those are deliberate later-provider decisions, not C3 completion evidence.

## C4 — Canonical multi-level home model

### Master activation and integration

- Status: complete on `main`; C5 may open from the ledger-close commit
- Contract: `docs/orchestration/checkpoints/C4_CONTRACT.md` (`c4-canonical-home-v1`)
- Prelude commit: `0ade952`
- Frozen worker base commit: `918f393`
- Product completion SHA: `e1a7a60`
- Planned lanes: four, retained adaptively because provenance/canonicalisation, geometry/topology, persistence/concurrency and adversarial fixtures are independent substantial risks
- Coordinate policy: right-handed project-local `+X east`, `+Y north`, `+Z up`; authoritative local lengths are integer millimetres and angles integer milli-degrees
- Hash policy: RFC-8785-style UTF-8 canonical JSON and SHA-256; entity/reference collections sort deterministically while geometric point order is preserved
- State policy: existing, proposed and as-built are separate model profiles; unknowns remain explicit and no renderer fallback becomes a fact

| Lane                           | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                               |
| ------------------------------ | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ----------------------------------------------------------------------------- |
| C4-L1 domain/provenance        | `019f6e4e-38c1-7ad3-8b85-5b2947835230` | `gpt-5.6-sol` / `xhigh` | `ad377a2`  | `f012a9c` | integrated | domain-model/provenance source/tests and allocated coordinate/provenance ADRs |
| C4-L2 geometry/topology kernel | `019f6e4e-393d-7270-af7c-150b36a3a5cf` | `gpt-5.6-sol` / `xhigh` | `303b820`  | `eef7680` | integrated | geometry-kernel source/tests and allocated kernel ADR                         |
| C4-L3 persistence/API          | `019f6e4e-3a78-7d32-a215-f874d0535f8d` | `gpt-5.6-sol` / `xhigh` | `f3399e8`  | `376b01b` | integrated | canonical model API/module/C4 composition, migration, tests and runbook       |
| C4-L4 fixtures/evaluation      | `019f6e4e-3bea-79d2-ad7b-1e5b4701da63` | `gpt-5.6-sol` / `xhigh` | `578c275`  | `ea9dc7d` | integrated | model fixtures, independent geometry/canonical tests and evaluation document  |

### Prelude gate evidence

- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, 12-package lint/typecheck, 189 JavaScript unit tests, every production build, Ruff, strict mypy and pytest after adding the four C4 package registrations.
- Shared C4 contracts added five focused cases for explicit unknown values, profile separation, confidence/evidence requirements, cross-collection ID uniqueness and optimistic first-snapshot state. The explicit role/action matrix now passes 63 authorisation cases: owner/editor may create snapshots, viewer is read-only and every foreign-tenant action remains denied.
- Migration `0004_canonical_models.sql` is allocated exclusively to C4-L3 before launch. Package manifests, the lockfile, shared DTOs, authz, migration registry and this contract are frozen orchestrator-owned inputs.
- All four tasks receive `xhigh`: L1 owns cryptographic canonicalisation and provenance invariants; L2 owns adversarial integer geometry; L3 owns tenant isolation, idempotency and concurrent immutable persistence; L4 owns property/adversarial geometry and cross-process hash evaluation.

### Integrated gate evidence

- All four project-scoped worktrees completed cleanly from frozen base `918f393` and were merged in the declared L1, L2, L3, L4 order. Every worker used exact `gpt-5.6-sol` with `xhigh`; the lane manifests stayed within their exclusive roots and the orchestrator alone reconciled shared contracts and cross-lane behavior.
- The first integrated producer gate deliberately exposed 16/16 cross-lane incompatibilities: storey-relative wall heights, the stair run endpoint, independently named findings/locations, room-boundary topology and duplicate canonical encoders. The completion commit `e1a7a60` reconciles one domain codec, exact structured findings, closed-loop room comparison, fixtures, reference oracle, runbook and retained hashes rather than weakening the gate.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passed on the repaired integration: formatting, 12-package ESLint and strict TypeScript checks, 289 JavaScript tests, every production build, Ruff, strict mypy and pytest. Focused results include 20 shared-contract, 20 domain, 10 provenance, 17 geometry, 41 fixture, 63 authorisation and 49 API tests; nine API provider/environment cases remain explicit skips in the provider-free invocation.
- The mandatory independent canonical/geometry run with `C4_RUN_PRODUCER_INTEGRATION=1` passed 42/42 checks. It recomputed all three domain golden byte streams and SHA-256 values, validated three production geometry profiles and matched 13 adversarial fixtures against an independently maintained reference implementation. The retained existing/proposed/as-built hashes are `587ebdfa03235b2dbf0346e7558398636057e735a014fdb9ca08d696ad4dda6f`, `c13a92cbc6312dd08ab9dca4f2cd4dea82bdeedc9b5ab50171e7bb1ff69004b1` and `dc339d56d8a20a7bb4d23a1cc04b760fd1d675c06bf41e3b2dfdb91df6d233cc`.
- A disposable loopback PostGIS database applied migrations C1 through C4 in sequence. The live C4 database suite passed 2/2, proving same-key replay, different-body conflicts, optimistic concurrency, immutable historical rows/current pointers, exact JSONB hash/byte recomputation, trigger enforcement, profile separation and tenant/role isolation.
- A real loopback HTTP listener then passed an 18-assertion authenticated client journey: three local personas signed in, an owner created a project, invalid geometry returned a located `WALL_PATH_SELF_INTERSECTION` without persistence, valid creation and same-key replay returned one version-one record, all three lifecycle states appeared exactly once, a viewer read current/history but received `403` on mutation, the foreign tenant received `404`, and an unauthenticated request received `401`.
- Structured API logs showed only bounded codes, status, correlation IDs and the allowed finding code. Every request URL was `[REDACTED]`; no access token, idempotency key, snapshot body, project/model identifier, address, provider locator or credential appeared. C4 has no rendered user surface, so the contractually correct user gate is the public authenticated API journey rather than a fabricated browser or simulator check.
- Honest residual limits: C4 is a deterministic TypeScript 2.5D information/validation kernel, not a survey-grade solid model, mesh reconstruction, GPU renderer, structural analysis, regulatory approval, IFC authoring tool or professional certification. It stores synthetic fixtures only; typed editing begins in C5, inference in C6, physical capture/reconstruction in C7-C9 and glTF delivery in C10.

## C5 — Typed operations, branches, replay and 2D editor

### Master activation

- Status: complete on `main` with one recorded external Browser-runtime gate exception; C6 may open from the ledger-close commit
- Contract: `docs/orchestration/checkpoints/C5_CONTRACT.md` (`c5-model-operation-v1`)
- Prelude commit: `2ab2dfc`
- Frozen worker base commit: `c5223e5`
- Planned lanes: four, retained adaptively because reducer/persistence, policy/audit, interactive editor and independent replay/concurrency evaluation are all substantial and have exclusive write boundaries
- Mutation policy: the integrated product accepts canonical amendments only through the exact versioned registry; initialise and restore are internal typed operations, preview is non-mutating and committed history is append-only
- Concurrency policy: every preview/commit pins both branch revision and head SHA-256; no implicit geometry merge or history rewrite
- Editor policy: canonical-SVG projection, integer-millimetre commands, bounded local undo/redo, structured keyboard inspector and responsive conflict recovery

| Lane                        | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State  | Exclusive roots                                                                                             |
| --------------------------- | -------------------------------------- | ----------------------- | ---------- | --------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| C5-L1 operation producer    | `019f6e94-bf93-7073-a293-f52b9532d61f` | `gpt-5.6-sol` / `xhigh` | `0ee3112`  | `6cac7c4` | merged | model-operations package; operation API/composition/migration/tests/runbook; allocated C4 initialise bridge |
| C5-L2 model policy/audit    | `019f6e94-bf94-7fa0-8b52-5aab7bb8148e` | `gpt-5.6-sol` / `xhigh` | `07be7ab`  | `a7929b4` | merged | model policy/audit packages/modules/tests and threat model                                                  |
| C5-L3 editor core/UI        | `019f6e94-c07f-75b1-928d-096764545b21` | `gpt-5.6-sol` / `high`  | `b950ea3`  | `63f8e6f` | merged | editor-core, allocated web editor/BFF/project/CSS/component-test paths                                      |
| C5-L4 replay/concurrency QA | `019f6e94-c3da-7020-a58a-f39cf3825787` | `gpt-5.6-sol` / `xhigh` | `54ccf61`  | `6ef5956` | merged | independent operation integration/geometry/E2E suites and invariant evaluation                              |

### Prelude gate evidence

- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, 14-package lint/typecheck, 343 JavaScript tests, every production build, Ruff, strict mypy and pytest after registering the model-operations and editor-core packages.
- Shared C5 contracts pass six focused cases for the exact ten-type public/internal registry, dual revision/hash preconditions, duplicate command IDs, non-zero integer translation, enumerated safe metadata paths, pinned branch source and the eight frozen route names. The full contract package passes 26 cases.
- The explicit role/action matrix now passes 111 authorisation cases. Owner/editor may create/read/compare branches, preview/commit, restore and inspect history/audit; viewer is read/history/compare/audit only; every foreign-tenant action is denied before resource disclosure.
- Migration `0005_model_operations.sql` is allocated exclusively to C5-L1 in the migration registry before launch. Root/package manifests, lockfile, shared contracts/core authz registry, accepted checkpoint contract and ledger are orchestrator-owned and frozen for workers.
- Reasoning is adaptive and recorded before launch: L1 receives `xhigh` for reducers, transactional persistence, replay and concurrency; L2 receives `xhigh` for person/machine policy, tenant security and immutable audit; L3 receives `high` as a bounded consumer of frozen contracts; L4 receives `xhigh` for adversarial property, race, replay and cross-surface acceptance work.

### Integrated gate evidence

- All four project-scoped worktrees completed cleanly from frozen base `c5223e5` and were merged in the declared L1, L2, L3, L4 order. Every task used exact `gpt-5.6-sol`; L1/L2/L4 used `xhigh` and bounded editor consumer L3 used `high`. Worker and merge manifests remained within their exclusive roots; shared registries, fixtures, manifests and cross-lane adapters were reconciled only on `main`.
- Product integration commit `7b0c34f` connects the public model policy, real PostgreSQL audit projection, typed operation producer, editor/BFF and independent producer/live harness. Integration repairs added the editor persona, corrected exact-optional DTO mapping, projected multi-operation audit records, distinguished initialise/branch/commit/restore audit actions, preserved raw-amendment denial and changed handled `409/422` replies into an explicit result union so an expected stale race no longer emits Fastify's reply-already-sent internal error.
- Final `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, 14-package ESLint and strict TypeScript, 491 JavaScript unit tests, all 14 production builds, Ruff, strict mypy and pytest. Focused totals include 213 authz, 66 API, 40 web, 17 geometry-kernel, 13 producer reducer and 10 editor-core cases; ten provider/live API cases remain explicit skips only in the provider-free unit invocation.
- The independent C5 producer/reference run passed 17/17 with the root-owned adapter, including exact ordered registry and reducer/hash parity. The provider-free API/Postgres reference pack passed 15 checks with seven named live skips; no skip is counted as live evidence. The separate identity security pack passed 237/237 role, tenant and adversarial cases.
- A clean disposable PostGIS database applied C1-C5 and passed the C5 persistence suite, including exact idempotent replay/conflict, preview non-mutation, stale/racing commit behavior, atomic snapshot/commit/operation/audit/outbox counts, signed cursor pagination, member/support-redacted audit projection, deterministic replay, immutable triggers and tenant isolation. The final real loopback API/Postgres harness passed 22/22 across three suites with owner/editor/viewer/foreign sessions and did not print or persist tokens.
- The live race was repeated with the platform API at error-only log level after the handled-reply repair; all 22 checks passed and the server emitted no error record. Earlier structured debug evidence showed request URLs as `[REDACTED]` and no operation/snapshot bodies, preview IDs, tokens, idempotency keys or storage locators. The optimized Next 16 Turbopack build passed; local HMR now explicitly uses Next's supported Webpack mode with NodeNext `.js` to TypeScript extension aliases for source workspace packages.
- The independent mock Playwright pack passed 4/4 desktop, 390×844 mobile, keyboard-only/viewer and two-session conflict journeys with no unexpected console/network failures or horizontal overflow. It covered branch creation, wall translation, opening insertion, space rename, pending undo/redo, preview, commit, viewer read-only behavior, compare/restore and conflict recovery. Representative reference/editor runs remained below their deliberately loose five-second local regression ceiling; this is not a production-scale latency claim.
- Required gate exception: the in-app Browser first exposed the Next development-source resolution defect. After the packaging repair and successful production build, its runtime rejected further localhost navigation under its security policy and explicitly prohibited attempting the same outcome through another browser surface. Therefore the production-shaped visible BFF-to-real-API/database journey is recorded as **NOT RUN**, not a pass; the already completed mock Playwright and real API/PostGIS gates are separate evidence. Replay this single gate when a permitted in-app localhost Browser session is available.
- Repository tooling debt remains explicit: root aliases `pnpm dependency:boundaries` and `pnpm api:check` currently execute zero package tasks and are not counted as evidence. C5 has no iOS or GPU surface, so no simulator or GPU run was manufactured. C5 remains a deterministic typed 2.5D editor, not plan inference, physical capture/reconstruction, 3D rendering, structural/regulatory approval or professional certification; C6-C10 own those later capabilities.

## C6 — Floor-plan proposal, calibration and correction

### Master activation

- Status: active; all four isolated worktrees launched from `25721c5`
- Contract: `docs/orchestration/checkpoints/C6_CONTRACT.md` (`c6-plan-job-v1`, `c6-plan-parser-input-v1`, `c6-plan-proposal-v1`, `c6-plan-operation-draft-v1`)
- Prelude commit: `0baf74a`
- Planned lanes: four, retained adaptively because durable workflow/persistence, isolated parser execution, correction UX and independent rights/benchmark/security evaluation have clean exclusive ownership boundaries
- Parser policy: no paid provider, key, outbound inference call or GPU; securely normalized deterministic vector first, deterministic CPU raster fallback, stable adapter boundary for later evaluated models
- Mutation policy: parser output is an immutable proposal only; calibrated reviewed candidates become exact public C5 operations, and only C5 preview/commit may mutate canonical state
- Safety policy: unsupported, unsafe, source/rights mismatched, severe-invalid or low-confidence evidence abstains visibly; failures remain in benchmark denominators

| Lane                        | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State  | Exclusive roots                                                                                                                             |
| --------------------------- | -------------------------------------- | ----------------------- | ---------- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| C6-L1 processing workflow   | `019f6ef1-9e60-72b2-a3e3-c31c3499702c` | `gpt-5.6-sol` / `xhigh` | pending    | pending   | active | platform API plan-processing module/migration/tests; spatial-worker normalization/processing; development runbook and allocated composition |
| C6-L2 inference adapter     | `019f6ef1-9e63-7032-acbf-881986331a9e` | `gpt-5.6-sol` / `xhigh` | pending    | pending   | active | Python inference worker; provider-adapters plan-parser boundary/tests; inference runbook                                                    |
| C6-L3 correction UX         | `019f6ef1-9ff6-7853-8606-3d49295a5ba4` | `gpt-5.6-sol` / `high`  | pending    | pending   | active | web plan-import/overlay/BFF/component paths and narrowly allocated project/evidence/CSS integrations                                        |
| C6-L4 benchmark/security QA | `019f6ef1-a258-7ea3-8d1b-22a6c66364f7` | `gpt-5.6-sol` / `xhigh` | pending    | pending   | active | independent plan fixtures/rights splits, evaluation/security/E2E suites, parser evaluation and threat-model documents                       |

### Prelude gate evidence

- DQ-018 is resolved for v1: one C2-ready, rights-cleared plan page from vector PDF/SVG or raster PNG/JPEG, maximum 25 MiB/20 pages/20 megapixels, one straight-edged level, no external model/provider. PDF/SVG/raster normalization stays in the credential-free spatial boundary and text is untrusted label data, never tool policy.
- Shared C6 schemas freeze job/result states, exact route inventory, source/parser manifests, strict proposal/abstention union, integer candidate coordinates, source regions, 30-second/5 MiB parser limits, rational affine calibration with half-away-from-zero rounding, candidate decisions and 1-50 exact C5 operation drafts. Seven focused contract cases pass.
- Provisional failure-inclusive thresholds are frozen before implementation: at least 90% accepted coverage on declared in-box fixtures, 100% hard-negative abstention, zero severe errors, wall-endpoint/opening-centre/calibration P90 at 50/75/25 mm, and ECE at most 0.15 only with at least 20 samples. The 8/15-minute correction target remains `not-measured` until a rights-approved human study and cannot pass from automated timing.
- The explicit project action matrix now passes 255 authz unit cases and 321 standalone security cases. Owner/editor may create/read/cancel/retry/calibrate/draft; viewer can read jobs/proposals only; all foreign-tenant actions deny before disclosure. Machine confirmation remains forbidden by the C5 model policy.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, 14-package ESLint and strict TypeScript, 540 JavaScript unit tests, every production build, Ruff, strict mypy and pytest. Python discovery is pre-registered for the isolated inference worker without adding a runtime dependency or provider.
- Migration `0006_plan_processing.sql` is allocated exclusively to C6-L1 before launch. Package/root manifests, lockfiles, shared contracts/core authz registry, accepted checkpoint contract and ledger remain orchestrator-owned. Reasoning is adaptive and fixed before launch: L1/L2/L4 receive `xhigh`; bounded frozen-contract consumer L3 receives `high`.

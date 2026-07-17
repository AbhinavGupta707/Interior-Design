# Orchestration Ledger

## Programme

- Active plan: `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`
- Integration branch: `main`
- Repository/project root: `/Users/abhinavgupta/Desktop/Interior Design`
- Remote: `https://github.com/AbhinavGupta707/Interior-Design.git`
- Worktree policy: project-scoped Codex worktree tasks only
- Worker runtime policy: explicit `gpt-5.6-sol` for every lane; `high` for bounded/straightforward work and `xhigh` for complex architecture, security, geometry, inference, concurrency, adversarial or integration-heavy work. Each checkpoint records the assignment before launch.
- Autonomous execution boundary: C0-C9 are complete. The user subsequently authorised C10; C10 contract preflight is open and no C11 work may begin.
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

### Master activation and closure

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

- Status: complete on `main`; C7 may open from the ledger-close commit after product integration `84071a8`
- Contract: `docs/orchestration/checkpoints/C6_CONTRACT.md` (`c6-plan-job-v1`, `c6-plan-parser-input-v1`, `c6-plan-proposal-v1`, `c6-plan-operation-draft-v1`)
- Prelude commit: `0baf74a`
- Frozen worker base commit: `25721c5`
- Planned lanes: four, retained adaptively because durable workflow/persistence, isolated parser execution, correction UX and independent rights/benchmark/security evaluation have clean exclusive ownership boundaries
- Parser policy: no paid provider, key, outbound inference call or GPU; securely normalized deterministic vector first, deterministic CPU raster fallback, stable adapter boundary for later evaluated models
- Mutation policy: parser output is an immutable proposal only; calibrated reviewed candidates become exact public C5 operations, and only C5 preview/commit may mutate canonical state
- Safety policy: unsupported, unsafe, source/rights mismatched, severe-invalid or low-confidence evidence abstains visibly; failures remain in benchmark denominators

| Lane                        | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                                                                             |
| --------------------------- | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| C6-L1 processing workflow   | `019f6ef1-9e60-72b2-a3e3-c31c3499702c` | `gpt-5.6-sol` / `xhigh` | `f895289`  | `7c1e049` | integrated | platform API plan-processing module/migration/tests; spatial-worker normalization/processing; development runbook and allocated composition |
| C6-L2 inference adapter     | `019f6ef1-9e63-7032-acbf-881986331a9e` | `gpt-5.6-sol` / `xhigh` | `4b8eafa`  | `081f4af` | integrated | Python inference worker; provider-adapters plan-parser boundary/tests; inference runbook                                                    |
| C6-L3 correction UX         | `019f6ef1-9ff6-7853-8606-3d49295a5ba4` | `gpt-5.6-sol` / `high`  | `f405c04`  | `4d9dd51` | integrated | web plan-import/overlay/BFF/component paths and narrowly allocated project/evidence/CSS integrations                                        |
| C6-L4 benchmark/security QA | `019f6ef1-a258-7ea3-8d1b-22a6c66364f7` | `gpt-5.6-sol` / `xhigh` | `a1131db`  | `3803016` | integrated | independent plan fixtures/rights splits, evaluation/security/E2E suites, parser evaluation and threat-model documents                       |

### Prelude gate evidence

- DQ-018 is resolved for v1: one C2-ready, rights-cleared plan page from vector PDF/SVG or raster PNG/JPEG, maximum 25 MiB/20 pages/20 megapixels, one straight-edged level, no external model/provider. PDF/SVG/raster normalization stays in the credential-free spatial boundary and text is untrusted label data, never tool policy.
- Shared C6 schemas freeze job/result states, exact route inventory, source/parser manifests, strict proposal/abstention union, integer candidate coordinates, source regions, 30-second/5 MiB parser limits, rational affine calibration with half-away-from-zero rounding, candidate decisions and 1-50 exact C5 operation drafts. Seven focused contract cases pass.
- Provisional failure-inclusive thresholds are frozen before implementation: at least 90% accepted coverage on declared in-box fixtures, 100% hard-negative abstention, zero severe errors, wall-endpoint/opening-centre/calibration P90 at 50/75/25 mm, and ECE at most 0.15 only with at least 20 samples. The 8/15-minute correction target remains `not-measured` until a rights-approved human study and cannot pass from automated timing.
- The explicit project action matrix now passes 255 authz unit cases and 321 standalone security cases. Owner/editor may create/read/cancel/retry/calibrate/draft; viewer can read jobs/proposals only; all foreign-tenant actions deny before disclosure. Machine confirmation remains forbidden by the C5 model policy.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, 14-package ESLint and strict TypeScript, 540 JavaScript unit tests, every production build, Ruff, strict mypy and pytest. Python discovery is pre-registered for the isolated inference worker without adding a runtime dependency or provider.
- Migration `0006_plan_processing.sql` is allocated exclusively to C6-L1 before launch. Package/root manifests, lockfiles, shared contracts/core authz registry, accepted checkpoint contract and ledger remain orchestrator-owned. Reasoning is adaptive and fixed before launch: L1/L2/L4 receive `xhigh`; bounded frozen-contract consumer L3 receives `high`.

### Integration and acceptance evidence

- All four isolated project worktrees completed from the frozen base and merged in the declared L2, L1, L3, L4 integration order. Every task used exact `gpt-5.6-sol`; complex workflow, inference and security lanes used `xhigh`, while the bounded correction-UI consumer used `high`. Shared manifests, contract reconciliation and cross-lane repairs remained orchestrator-owned.
- Integration replaced the test fake in the production runner with the shell-free isolated Python adapter; exported the provider subpath; made the normalizer/version chain a required, exact parser input/output pin; aligned vector/raster normalized envelopes; registered migration `0006`; and made a missing rights record fail a live queue lease closed rather than leave work silently queued.
- The C5 handoff now preserves epistemic truth: accepted geometry is `source-derived`; corrected geometry is a current-user, `not-reviewed`, `user-asserted` claim linked to the exact asset; all fields changed by one correction share that attribution; unobserved wall base offsets stay unknown. Opening offsets use the server's midpoint projection and space boundaries are built as an ordered closed wall chain. The API rejects immutable drafts that violate any of those rules.
- UI integration removed repeated React keys and a mixed SVG title child that produced console warnings. The integrated workspace was inspected through the in-app Browser on desktop and at 390x844. The mobile document had `clientWidth=375` and `scrollWidth=375`; neither the clean page nor the completed commit emitted a browser warning/error.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, all 14 package lint/typecheck suites, every JavaScript unit suite and production build, Ruff, strict mypy and 12 Python tests. Focused evidence additionally passed 33 contract tests, 52 web tests, 75 platform API tests and 40 spatial-worker tests in the full run; environment-guarded suites were separately executed live instead of being counted from their default skips.
- The independent C6 evaluation pack passed five tests with one explicit producer-observation skip; the plan-processing security pack passed 51/51 including the live unauthenticated-disclosure probe. Live Postgres passed the platform API suite 1/1 and spatial-worker queue suite 1/1. Reference Playwright passed 7/7 across desktop, mobile, keyboard, viewer, abstention, recovery and conflict cases; integrated live Playwright passed 2/2 at 1440x960 and 390x844.
- The production-shaped synthetic harness passed twice against local PostGIS, S3-compatible storage, the live API, real vector normalization and the isolated Python process. The first mixed-decision run created and committed a seven-operation draft after accept/correct/exclude review. A fresh second project accepted all seven candidates, created a valid seven-operation C5 preview and committed revision 2, proving the accepted-opening offset path as well as full proposal-to-canonical integration.

### Evaluation, limitations and closure

- The retained reference evaluation reports 90% accepted coverage, 100% hard-negative abstention, zero severe or scope errors, wall-endpoint P90 35 mm, opening-centre P90 42 mm, calibration P90 14 mm, ECE 0.12 over 45 samples, wall-clock P90 57 ms, CPU peak 38% and memory peak 39%. These are deterministic synthetic/reference measurements, not customer-plan or production-capacity claims.
- Human correction time remains `NOT MEASURED`; the automated pack cannot satisfy the 8/15-minute human target. The baseline is promotion-ineligible until a rights-approved human study and representative plan set exist.
- No paid provider, API key, outbound inference call, GPU, customer plan, physical capture, survey-grade geometry, structure/fire/regulatory conclusion or training use is present. C6 handles one deliberately narrow straight-edged page and visibly abstains outside that box. Physical capture/reconstruction/fusion and 3D delivery remain owned by C7-C10.
- Integrated product SHA: `84071a8`. The ledger-close commit is the commit containing this completed record; C7 records that commit as its immutable predecessor before any new lane opens.

## C7 — Native iOS RoomPlan capture and secure sync

### Master activation

- Status: code checkpoint complete on `main` under the contract's explicit external-hardware exception; physical RoomPlan field evidence remains `NOT RUN` and the C7/C18 release blocker remains open
- Contract: `docs/orchestration/checkpoints/C7_CONTRACT.md` (`c7-capture-session-v1`, `c7-capture-package-v1`, `c7-roomplan-normalized-v1`, `c7-capture-proposal-v1`)
- Immutable predecessor: `96d0a72`
- Prelude commit: `f4c8182`
- Frozen worker base: `e438d8f`
- Planned lanes: four, retained adaptively because native RoomPlan/AR correctness, privacy-preserving background sync, durable backend/conversion and independent field/security evaluation are substantial independent risks with exclusive write boundaries
- Provider policy: no paid provider, cloud key, GPU or customer capture is required; local PostGIS/S3-compatible storage and visibly synthetic RoomPlan fixtures support deterministic gates
- Mutation policy: C7 preserves immutable Apple evidence and emits a bounded canonical-shaped proposal or explicit abstention; it cannot call C5 preview/commit or mutate canonical state
- Physical-device status at activation: `NOT RUN`; Xcode reports only the Mac and iOS Simulators, so DQ-020 and the named C7/C18 field-release blocker remain open

| Lane                         | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State  | Exclusive roots                                                                                                                        |
| ---------------------------- | -------------------------------------- | ----------------------- | ---------- | --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| C7-L1 RoomPlan/AR session    | `019f6f8b-500b-75a3-9705-1afc0f7310a2` | `gpt-5.6-sol` / `xhigh` | `ad3cfd0`  | `501d1be` | merged | native RoomCapture feature, AR platform adapter and C7 RoomCapture tests                                                               |
| C7-L2 quality/sync/workspace | `019f6f8b-5005-7463-b083-49074ffaa2ba` | `gpt-5.6-sol` / `xhigh` | `db1cbb1`  | `2c7cdbb` | merged | native capture quality/sync/workspace features, C7 QualitySync tests and three explicitly allocated app integration files              |
| C7-L3 backend/converter      | `019f6f8b-4ffd-7730-aa47-fac87b4f16cd` | `gpt-5.6-sol` / `xhigh` | `39fe525`  | `69ad8ad` | merged | platform capture module/C7 composition/migration/tests, spatial-worker RoomPlan converter/tests and native-capture development runbook |
| C7-L4 mobile/field/security  | `019f6f8b-5000-7363-a7ba-5c3f35304833` | `gpt-5.6-sol` / `xhigh` | `8f8861f`  | `32925ae` | merged | C7 XCUITests, mobile/security/evaluation packs, RoomPlan evaluation/threat model and iOS field/release runbooks                        |

### Prelude gate evidence

- Primary Apple RoomPlan, multi-room `StructureBuilder`, capture encoding, instruction, relocalisation, AR world-map and surface-shape documentation informed the frozen boundaries. Apple encodings and USDZ remain immutable evidence; a separately versioned, integer-normalized manifest provides bounded deterministic conversion without pretending classification confidence is dimensional accuracy.
- Shared TypeScript and Swift 6 contracts freeze exact capture/session/package/proposal versions, routes, rights, state transitions, identifiers, media kinds, multipart limits, cross-references, normalized integer units, device/quality metadata and proposal/abstention shapes. Seven focused C7 contract cases pass, and the full contract package passes 40/40.
- The central authorization registry and independent security fixture now include all seven C7 actions. The focused identity/security invocation passes 686 cases; owner/editor receive create/read/cancel/upload/finalize/retry authority while viewers remain read-only for sessions/proposals and all tenant mismatches fail closed.
- XcodeGen reproducibly registers the shared Swift contract tests and a real UI-test target. The iPhone Air iOS 26.4 Simulator passes 29/29 XCTest/XCUITest cases with zero failures or skips. An unsigned generic physical-iOS build also passes. Neither result is counted as LiDAR, RoomPlan, relocalisation or field evidence.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passes Prettier, all 14 package lint/typecheck suites, 638 JavaScript unit tests, all production builds, Ruff, strict mypy and 12 Python tests. The C7 prelude also passes `git diff --check`.
- Migration `0007_native_capture.sql` is reserved exclusively for C7-L3 before launch. Shared contracts/core authz, migration registry, package/root manifests, lockfiles, accepted checkpoint contract, generated Xcode project, `project.yml`, `.github`, `.codex`, `AGENTS.md` and this ledger remain orchestrator-owned.
- All four implementation lanes use exact `gpt-5.6-sol` with `xhigh` reasoning. This is an adaptive assignment, not a checkpoint-wide default: C7 has no bounded/mechanical lane once native sensor state, protected background transfer, tenant-safe geometry publication or adversarial field acceptance is included; later checkpoints may use `high` for genuinely bounded work.

### Integration and closure evidence

- The orchestrator merged in the frozen order L1 → L3 → L2 → L4, preserving every exclusive write boundary. L1 added the custom RoomPlan/AR session, safe interruption/restart and strict normalization; L3 added migration `0007`, tenant-safe capture APIs, immutable multipart packages and fenced deterministic conversion; L2 added protected local journals, quality/review states and reconciled background sync; L4 added independent mobile/security/evaluation packs, XCUITests, threat model and honest physical-device protocols.
- Product integration commit `d10416a` adds the only orchestrator-owned repair: a deterministic C7 presentation fixture compiled exclusively under `#if DEBUG` and enabled only for exact local opt-in. It initializes no RoomPlan, credentials, networking or persistence, labels itself visibly synthetic, exposes every frozen accessibility state/action, and makes the integrated journey pack mandatory instead of skippable. The test query was corrected to use exact identifiers across SwiftUI element types, and the transient relocalisation state remains observable for two seconds before deterministic fixture recovery.
- `xcodegen generate --spec project.yml` is stable after `d10416a`; regenerating the checked-in Xcode project produces no diff. `UV_CACHE_DIR=.cache/uv pnpm verify` passes formatting, all 14 package lint/typecheck/unit/build tasks, Ruff, strict mypy and 12 Python tests. The independent C7 packs pass 15/15 mobile tests, 55/55 deterministic security tests with four live-only cases separately executed, and 7/7 RoomPlan evaluation tests; every focused TypeScript configuration also typechecks.
- The complete iPhone Air / iOS 26.4 Simulator scheme passes 124 reported test cases / 131 XCTest invocations with zero failures and zero skips. This includes all nine integrated C7 journey methods, every prior native unit test, the app launch smoke test and three strict cross-language golden-contract cases. An unsigned generic arm64 Release build passes; binary inspection finds none of `C7_UI_TEST_MODE`, `C7_UI_TEST_SCENARIO` or fixture presentation copy, proving the debug protocol is compiled out of the production executable.
- Fresh disposable local databases pass the live API/Postgres suite 2/2 and worker rights/lease/publication-fencing suite 1/1. Real local S3-compatible checksum-bound multipart upload/readback passes 1/1. A fully composed loopback API with locally signed fixture sessions passes all four live unauthenticated-disclosure, cross-tenant IDOR, viewer-role and public-key/signed-URL confusion probes; bearer values never enter command output and request URLs/authorization remain redacted in service logs.
- Computer Use visually inspected and operated two Simulator journeys: two-room structure review → accept → packaging, and permission denied → manual evidence → fallback. Controls were tappable, layout remained readable and the synthetic/non-RoomPlan limitation copy stayed visible. These are `Simulator / visibly synthetic / non-RoomPlan` observations only.
- No connected physical iPhone/iPad was available. F1–F6, physical VoiceOver, real camera permission, LiDAR, RoomPlan output, tracking/relocalisation, thermal behavior, background transfer and accuracy distributions remain `NOT RUN`. The rights-controlled physical development and holdout splits remain empty, evaluator promotion remains false, DQ-020 remains unresolved and the C7/C18 release blocker remains **OPEN**. Under the user-authorized overnight continuation and the explicit C7 contract exception, this blocks release promotion but not opening C8's independent media-reconstruction work.
- Durable evidence record: `docs/evaluation/roomplan/c7-code-checkpoint-evidence-2026-07-17.md`. Integrated product SHA: `d10416a`. The ledger-close commit is the commit containing this completed record; C8 must record that commit as its immutable predecessor before any worker launches.

## C8 — Guided photo/video/RGB-D reconstruction

### Master activation and closure

- Status: code/integration checkpoint complete on `main` under the contract's explicit unavailable-hardware/runtime evidence boundary; C9 was not opened per the user's terminal instruction
- Contract: `docs/orchestration/checkpoints/C8_CONTRACT.md` (`c8-reconstruction-job-v1`, `c8-media-preparation-v1`, `c8-geometry-result-v1`, `c8-appearance-result-v1`, `c8-reconstruction-result-v1`)
- Immutable predecessor: `20f6c5f`
- Prelude commit: `bad15ee`
- Frozen worker base: `707ad0b`
- Product completion SHA: `babf083bdad2d299d90f4b8bd2e1c9e51f63350a`
- Planned lanes: four, retained adaptively because the durable API/status journey, native and hostile-media boundary, numerical geometry adapters and optional neural/GPU/adversarial evidence are substantial independent risks with exclusive write boundaries
- Provider policy: no paid provider, cloud key, customer media or training use is required; deterministic synthetic inputs, local PostGIS/S3-compatible storage and FFmpeg support the base gates
- Mutation policy: C8 preserves immutable media, publishes proposal-only geometry and optional non-dimensional appearance, and cannot call C5 or mutate canonical state; C9 owns fusion and discrepancy resolution
- Hardware status at activation: physical iOS camera/RGB-D and NVIDIA/CUDA dense/neural evidence are `NOT RUN`; this Apple M1 host has FFmpeg/ffprobe 8.1 but no COLMAP, Open3D, PyTorch, Blender or CUDA runtime

| Lane                             | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                                                                            |
| -------------------------------- | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| C8-L1 durable workflow/status UX | `019f700a-6630-76b1-a437-03bb6b32c341` | `gpt-5.6-sol` / `xhigh` | `5bd72f5`  | `c7639f7` | integrated | platform reconstruction module/C8 composition/migration/tests, isolated web reconstruction page/BFF/features/tests and development runbook |
| C8-L2 native capture/media prep  | `019f700a-667e-74c1-adb3-b7178db5fb80` | `gpt-5.6-sol` / `xhigh` | `9473ac7`  | `b9bbf19` | integrated | native MediaCapture/Camera features and tests, spatial-worker media-prep source/tests and named composition files                          |
| C8-L3 geometric reconstruction   | `019f700a-6633-7ce3-a9fb-6ac719c5750e` | `gpt-5.6-sol` / `xhigh` | `3cf9629`  | `6d3941a` | integrated | inference-worker common/COLMAP/Open3D reconstruction source and tests                                                                      |
| C8-L4 neural/GPU/independent QA  | `019f700a-662f-7ce1-9357-12d31ff644a6` | `gpt-5.6-sol` / `xhigh` | `4af266e`  | `79348e2` | integrated | Nerfstudio/gsplat adapters, GPU package, reconstruction evaluation/security/E2E/XCUITest evidence and documents                            |

### Prelude gate evidence

- Current primary COLMAP, Open3D, Nerfstudio, gsplat and FFmpeg documentation informed the CPU/CUDA boundary, non-contiguous-ID parsing, disconnected-model behavior, three-correspondence alignment, known-pose TSDF requirements, optional neural export and fixed-command media preparation boundaries recorded in the accepted contract.
- Shared TypeScript schemas freeze five versioned contracts, exact routes, rights, source/type/byte/frame/artifact budgets, job states, retry/result invariants, stripped-frame privacy state, tool/config/source hashes, geometry scale/alignment/components and the proposal-only versus non-dimensional authority split. Seven focused C8 cases pass; the full contract package passes 47/47.
- The central authorization registry and independent policy fixture now include all five C8 actions. The package authorization suite passes 327/327 and the identity/security pack passes 786/786: owner/editor may create/read/cancel/retry and read results; viewers are job/result read-only; every foreign-tenant action fails closed.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passes Prettier, all 14 package lint/typecheck suites, every JavaScript unit suite and production build, Ruff, strict mypy and 12 Python tests. Focused C8 contract/authz/security typechecks pass and `git diff --check` is clean.
- Migration `0008_reconstruction.sql` is reserved exclusively for C8-L1. Shared contracts/core authz, migration registry, package/root manifests, lockfiles, accepted checkpoint contract, generated Xcode project, shared project/navigation/composition, `.github`, `.codex`, `AGENTS.md` and this ledger remain orchestrator-owned except for the exact narrow integration files transferred in a lane task.
- All four implementation lanes use exact `gpt-5.6-sol` with `xhigh` reasoning. This is an adaptive per-lane assignment, not an automatic checkpoint default: durable tenant/concurrency boundaries, native sensors, hostile-media subprocesses, numerical geometry and CUDA/adversarial evaluation each require complex reasoning; later bounded lanes may use `high`.

### Integration and closure evidence

- The orchestrator merged in the frozen L3 → L2 → L1 → L4 order. L3 supplied strict COLMAP/Open3D geometry adapters and parsers; L2 supplied AVFoundation capture and bounded FFmpeg preparation; L1 supplied durable tenant-safe API/lease/publication and accessible web status; L4 supplied optional non-dimensional Nerfstudio/gsplat adapters plus independent evaluation/security/browser/native packs.
- The shared integration registers all four adapters through code-owned discovery, exposes bounded unavailable state, composes the spatial worker from exact database sources through real media preparation into a private path-bearing Python protocol, verifies artifact scope/hash/size, uploads with the narrow storage port and leaves final publication behind L1's atomic tenant/project/job/attempt/lease/cancellation/rights fence. No public route accepts a path, locator or private tool envelope; no C5/canonical mutation is reachable.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passes Prettier, all 14 package lint/typecheck suites, every JavaScript unit suite and production build, Ruff, strict mypy and 86 passed Python tests with two named unavailable-runtime skips. The spatial worker reports 84 passed with three live-only skips in the provider-free run; focused reconstruction Python passes 74 with two real-runtime skips.
- A disposable Postgres database passes the live platform C8 suite 8/8 and the composed spatial-worker source → rights → FFmpeg preparation → private worker → artifact → atomic result test 1/1. Idempotency, tenant isolation, lease reclaim/stale-token denial, cancellation at every stage, retry fencing, rights withdrawal, immutable publication and zero canonical mutation are covered.
- Actual local FFmpeg/ffprobe 8.1 processes visibly synthetic still/video inputs, strips metadata, samples deterministically and cleans temporary workspaces. Actual worker-host discovery invokes the private Python module and truthfully publishes a COLMAP-unavailable abstention on this Apple M1 host instead of fixture geometry.
- Independent evaluation passes 7/7 and reconstruction security passes 24/24. Synthetic Playwright passes six desktop/mobile/keyboard Chromium journeys. A separate producer-live run passes 2/2 through the real Next app, same-origin BFF, C1–C8 API, disposable Postgres and fixture identity: it signs in, creates a tenant project, loads the C8 workspace at desktop/mobile widths and verifies honest unavailable capability state, no eligible media, unchanged canonical state, no overflow/disclosure and no console/page/C8 request failure. The in-app Browser controller failed before tab acquisition, so that route remains explicitly `NOT RUN` and CLI Playwright is the documented fallback.
- The first integrated native run exposed five C8 XCUITest skips because the fixture producer had not been registered in the app. Closure stopped. The orchestrator added an exact Debug/local-only fixture and parser tests, regenerated Xcode, and the focused two unit plus five UI journeys then passed with zero skips. The final complete iOS scheme passed 143 reported cases / 150 XCTest invocations with zero failures and zero skips on iPhone Air / iOS 26.4 Simulator.
- An unsigned generic `arm64` Release build succeeds with the AVFoundation camera/depth paths. Binary inspection finds none of the C8 fixture environment keys or presentation copy, proving the acceptance protocol is compiled out of production.
- Physical camera/RGB-D, usable native depth/calibration/pose extraction, COLMAP/Open3D algorithms, CUDA dense reconstruction, Nerfstudio/gsplat runtime, Windows/NVIDIA capacity and representative geometric accuracy remain `NOT RUN`. The implementations and safe unavailable behavior are present, but synthetic executors and Simulator states are not relabelled as hardware/runtime evidence.
- Durable evidence: `docs/evaluation/reconstruction/c8-evidence-record-2026-07-17.md`. C9 was neither activated nor scaffolded; execution stops at the C8 ledger-close commit by explicit user instruction.

## C9 — Autonomous multi-source full-house fusion

### Master activation

- Status: complete on `main`; pause before C10 by explicit user instruction
- Contract: `docs/orchestration/checkpoints/C9_CONTRACT.md` (`c9-fusion-job-v1`, `c9-registration-result-v1`, `c9-full-house-proposal-v1`, `c9-discrepancy-v1`, `c9-operation-draft-v1`)
- Immutable predecessor/C8 ledger-close: `3e0bd2b06cc2a504076f93cc21f75062543f3ef4`
- Prelude commit: `8f27b17`
- Frozen worker base: `d2b4ba1bbef929bdc7255a4324ac34fd0aa409ef`
- Cross-lane producer integration SHA: `f778b15`
- Product completion SHA: `e0aa7c0`
- Planned lanes: four, retained adaptively because deterministic robust registration, semantic fitting, durable tenant-safe cross-surface orchestration and independent adversarial evaluation are substantial independent risks with exclusive write boundaries
- Worker runtime: every lane uses exact `gpt-5.6-sol` with `xhigh` reasoning. This is recorded before launch because numerical geometry, inference/topology, durable concurrency/security and failure-inclusive evaluation are all complex; no C9 lane is merely bounded/mechanical.
- Provider/data policy: no paid provider, cloud key, customer data or training use is required. Deterministic synthetic proposal fixtures, local PostGIS and existing local services supply the base gate.
- Mutation policy: C9 emits proposal-only geometry, explicit discrepancies, attributable decisions and a branch/revision/head-hash-pinned C5 operation draft. It cannot call C5 preview/commit, advance a branch or mutate a canonical snapshot.
- Hardware/runtime status at activation: no physical iPhone/iPad, COLMAP, Open3D, PyTorch, Blender, NVIDIA or CUDA is available. C7 physical RoomPlan and C8 real algorithm/GPU evidence remain `NOT RUN`; C9 fixtures cannot promote them.

| Lane                                             | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                                       |
| ------------------------------------------------ | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| C9-L1 registration/fusion kernel                 | `019f7194-9cdf-7593-8858-4c3e05e9fdb1` | `gpt-5.6-sol` / `xhigh` | `911432c`  | `3001427` | integrated | geometry-kernel registration/fusion source/tests and allocated package export                         |
| C9-L2 semantic fitting                           | `019f7194-9ce0-7d71-9580-81e57bd3518b` | `gpt-5.6-sol` / `xhigh` | `db9d900`  | `e5be7e5` | integrated | inference-worker scan-to-model source/tests                                                           |
| C9-L3 durable fusion/discrepancy product         | `019f7194-9ce0-7d71-9580-820951d80ade` | `gpt-5.6-sol` / `xhigh` | `caca6e4`  | `f53834e` | integrated | isolated platform/spatial/web fusion paths, migration 0009, tests/runbook and named composition files |
| C9-L4 independent evaluation/security/acceptance | `019f7194-9ce3-7c83-a8d3-d032c30bbe3d` | `gpt-5.6-sol` / `xhigh` | `a0fa61e`  | `523ec4b` | integrated | fusion fixtures, evaluation/security/E2E packs and evaluation/threat-model documents                  |

### Prelude gate evidence

- The preflight verified exact repository/project discovery, a clean/pushed C8 base, current toolchain/hardware/provider state and 28 GiB free after archiving 16 already-integrated C5-C8 worktree tasks. Only the primary worktree remains before C9 launch.
- Official Codex documentation confirmed project-scoped worktrees are detached, isolated task environments and thread heartbeat is the correct current-task continuity mechanism. The active 20-minute `interior-design-c9-c10-orchestration-guardrail` heartbeat prevents overlap/skips and must be deleted after C10 closure.
- Current Open3D multiway-registration guidance informed the explicit node/edge/uncertain-constraint/residual/pruning boundary. Registration is a deterministic constraint graph; it does not pairwise-average claims or silently discard disconnected sources.
- Shared schemas freeze five C9 versions, exact routes, source/anchor/discrepancy/decision/operation budgets, denied training use, immutable evidence/base references, terminal-state invariants, fixed-point transforms, residuals, explicit abstention and the proposal-only/C5-draft-only boundary. The contract package passes 54/54.
- Central authorization and the independent identity policy now include seven C9 actions. The package suite passes 369/369 and the independent policy file passes 529/529: owner/editor may create/read/cancel/retry/review/draft, viewer is job/proposal read-only and foreign-tenant access fails closed.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passes formatting, all 14 package lint/typecheck/unit/build suites, Ruff, strict mypy and 86 Python tests; two real COLMAP/Open3D runtime tests remain explicitly skipped because those runtimes are unavailable. `git diff --check` is clean.
- Migration `0009_model_fusion.sql` is reserved exclusively for C9-L3 in the orchestrator-owned migration registry. Shared contracts/core authz, manifests/lockfiles, accepted contract, registry, `.github`, `.codex`, `AGENTS.md` and this ledger remain read-only to workers except for exact transferred composition/export paths.

### Integration and closure evidence

- The four frozen worktrees merged in L1 → L2 → L3 → L4 order. Integration then composed `GeometryKernelRegistrationProducer` and the bounded real Python scan-to-model producer into the default C9 spatial-worker path. Exact C6 plan and C7 RoomPlan payloads now reach the production producers; C8 remains registered evidence but honestly abstains when its immutable result has no inline parametric semantic observations.
- Root review found and fixed two defects before closure. Real BFF-created plan and RoomPlan sources were source-local but the UI emitted no anchors, so production jobs could only abstain; the final workspace now requires three measured, integer, non-collinear source-to-project correspondences per source-local input and refuses guessed/invalid/collinear values. The semantic adapter now compares the exact base with the fused candidate and emits deterministic attributed `wall.translate.v1` operations for real wall-position conflicts without creating a false discrepancy for an aligned base.
- A disposable PostgreSQL 16 database applied C1-C9. The C9 schema suite passed 3/3. A separate production-path harness used the real C1/C4/C5/C6/C7/C8/C9 API composition, real Postgres repositories, real Next BFF, real C9 spatial worker, geometry kernel and bounded Python subprocess. Visibly synthetic C6+C7 inputs plus an exact base wall offset of 25 mm produced a seven-discrepancy partial proposal and an exact 25 mm `wall.translate.v1` draft.
- Final live Playwright passed 2/2 at 1440×960 and 390×844. The owner selected both immutable sources, supplied measured identity correspondences, created the durable job, reviewed the 25 mm conflict and created the branch-pinned draft. The viewer saw the proposal read-only. Both viewports had no horizontal overflow, secret-shaped output, console/page error or C9 request failure. Database assertions reported one canonical snapshot, branch revision zero, five terminal jobs/proposals accumulated across repeated diagnostic runs and three drafts: no C5 preview/commit or canonical mutation occurred.
- The focused C9 gates pass: web model-fusion 14/14, spatial-worker model-fusion 24/24 including real Python subprocess integration, independent evaluation 6/6, security 28/28, E2E TypeScript no-emit, synthetic Playwright 9/9 and production-path Playwright 2/2. The synthetic browser suite covers cancel/retry, full/partial/disconnected/abstained, every decision, stale/offline/error, viewer, keyboard and mobile states; it remains presentation evidence rather than producer-live evidence.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passes Prettier, every one of 14 package lint/typecheck/build pipelines, platform API 117 passed / 25 declared live-provider skips, spatial worker 96 passed / three declared live-database skips, web 74 passed, geometry kernel 43 passed, and Python 117 passed / two unavailable COLMAP/Open3D runtime skips. Ruff and strict mypy pass.
- Durable evidence: `docs/evaluation/model-fusion/c9-evidence-record-2026-07-17.md`. Physical RoomPlan accuracy, real C8 COLMAP/Open3D reconstruction, neural/GPU/CUDA execution, representative-home accuracy, cloud/provider behavior and human correction time remain explicitly `NOT RUN`. No key, paid service, customer data or training permission was used.
- At the time C9 closed, C10 was not activated and no C10 task or implementation code had been opened. The later C10 section records the user's subsequent continuation instruction.

## C10 — Deterministic scene and interactive walkthrough

### Master activation

- Status: three frozen implementation worktrees active from prelude commit `85714d9`
- Contract: `docs/orchestration/checkpoints/C10_CONTRACT.md` (`c10-scene-job-v1`, `c10-scene-manifest-v1`, `c10-scene-artifact-v1`)
- Immutable predecessor/C9 ledger-close: `77854a1726b40ba7ac7a05d26a39d881b7e38509`
- Planned lanes: three, retained adaptively because deterministic scene compilation, tenant-safe durable storage/workflow and browser 3D/performance acceptance are substantial independent risks with exclusive write boundaries
- Worker runtime: every lane uses exact `gpt-5.6-sol` with `xhigh` reasoning. Numerical geometry/specification, durable concurrency/security and cross-browser 3D/performance are complex; no C10 implementation lane is bounded enough for lower reasoning.
- Provider/data policy: no paid provider, cloud key, customer data, RoomPlan device, reconstruction runtime or GPU is required. Exact committed synthetic canonical homes, local Postgres/S3-compatible storage and browser software rendering provide the base gate.
- Mutation policy: C10 reads one exact committed C4 snapshot and publishes a content-addressed derived visualisation only. It cannot write C4 snapshots, call C5 preview/commit, resolve C9 discrepancies or raise the model's evidence/professional status.
- Hardware/runtime status at activation: physical RoomPlan, genuine C8 COLMAP/Open3D/neural/CUDA, representative-home accuracy and cloud delivery remain `NOT RUN`; these are upstream fidelity/release gates, not missing C10 architecture.

| Lane                                 | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State  | Exclusive roots                                                                                  |
| ------------------------------------ | -------------------------------------- | ----------------------- | ---------- | --------- | ------ | ------------------------------------------------------------------------------------------------ |
| C10-L1 scene compiler/runtime        | `019f723e-93ec-79d2-9b8d-d7c704ce49c6` | `gpt-5.6-sol` / `xhigh` | pending    | pending   | active | scene-compiler source/tests and isolated spatial-worker scene-compile source/tests               |
| C10-L2 durable scene backend/storage | `019f723e-93ed-7dd0-9e69-873e38544e74` | `gpt-5.6-sol` / `xhigh` | pending    | pending   | active | isolated platform scenes module/C10 composition/migration/tests and runbook                      |
| C10-L3 viewer/independent acceptance | `019f723e-93ed-7dd0-9e69-87165c5840e5` | `gpt-5.6-sol` / `xhigh` | pending    | pending   | active | isolated web viewer/BFF/tests plus viewer E2E/performance/security/evaluation/threat-model paths |

- Worktree paths: L1 `/Users/abhinavgupta/.codex/worktrees/9ca3/Interior Design`; L2 `/Users/abhinavgupta/.codex/worktrees/505a/Interior Design`; L3 `/Users/abhinavgupta/.codex/worktrees/0f60/Interior Design`.
- Provisioning client IDs: L1 `client-new-thread:ebee5379-2616-4028-aad9-f65e9516ad06`; L2 `client-new-thread:4469a026-6868-4fc1-b171-2a17e61bed7e`; L3 `client-new-thread:2d59bf64-7d9a-4703-8fdd-deb51c7977ae`.

### Prelude decisions and gate evidence

- Current Khronos glTF 2.0.1, official validator and React Three Fiber performance guidance freeze GLB 2.0, finite aligned little-endian buffers, right-handed metre output, explicit `[Xmm/1000, Zmm/1000, -Ymm/1000]` conversion, validator-clean publication, demand-driven rendering and bounded draw-call/resource behavior.
- Shared C10 contracts freeze exact-snapshot jobs, deterministic compiler configuration, derived-only authority, integer-millimetre bounds, stable one-owner element mappings, explicit omissions/findings, bounded artifact/count ceilings and loopback-only HTTP signed access. Five deny-by-default C10 actions are added before worker launch.
- Migration `0010_scenes.sql` is reserved exclusively for C10-L2. Root/package manifests, lockfile, shared contracts/core authz, registry, accepted contract and ledger remain orchestrator-owned after the prelude.
- Dependency versions were resolved from the current npm registry before freezing: Three.js `0.185.1`, React Three Fiber `9.6.1`, `@types/three` `0.185.1`, Earcut `3.2.3` and Khronos glTF Validator npm `2.0.0-dev.3.10`.

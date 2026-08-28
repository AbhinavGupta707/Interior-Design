# Orchestration Ledger

## Programme

- Active plan: `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`
- Integration branch: `codex/c14-10-native-capture-quality-resilience`
- Repository/project root: `/Users/abhinavgupta/Desktop/Interior Design` in the primary Mac checkout
- Remote: `https://github.com/AbhinavGupta707/Interior-Design.git`
- Worktree policy: project-scoped Codex worktree tasks only
- Worker runtime policy: explicit `gpt-5.6-sol` for every lane; `high` for bounded/straightforward work and `xhigh` for complex architecture, security, geometry, inference, concurrency, adversarial or integration-heavy work. Each checkpoint records the assignment before launch.
- Autonomous execution boundary: C0-C14 and corrective C14.1-C14.9 are complete. C14.10 is the
  single active checkpoint. Production reconstruction promotion, dimensional acceptance, live
  provider/deployment, new physical-device/hardware acceptance and C15/C16 remain closed; C8 v2
  remains acceptance-only.
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

- Status: complete on `main`; terminal checkpoint, no C11 authorised
- Contract: `docs/orchestration/checkpoints/C10_CONTRACT.md` (`c10-scene-job-v1`, `c10-scene-manifest-v1`, `c10-scene-artifact-v1`)
- Immutable predecessor/C9 ledger-close: `77854a1726b40ba7ac7a05d26a39d881b7e38509`
- Prelude commits: `85714d9`, `99a0c9a`, `30aadbe`
- Product completion SHA: `5f48cd05a25b57bcd2295fc62710d60c0803efe3`
- Planned lanes: three, retained adaptively because deterministic scene compilation, tenant-safe durable storage/workflow and browser 3D/performance acceptance are substantial independent risks with exclusive write boundaries
- Worker runtime: every lane uses exact `gpt-5.6-sol` with `xhigh` reasoning. Numerical geometry/specification, durable concurrency/security and cross-browser 3D/performance are complex; no C10 implementation lane is bounded enough for lower reasoning.
- Provider/data policy: no paid provider, cloud key, customer data, RoomPlan device, reconstruction runtime or GPU is required. Exact committed synthetic canonical homes, local Postgres/S3-compatible storage and browser software rendering provide the base gate.
- Mutation policy: C10 reads one exact committed C4 snapshot and publishes a content-addressed derived visualisation only. It cannot write C4 snapshots, call C5 preview/commit, resolve C9 discrepancies or raise the model's evidence/professional status.
- Hardware/runtime status at activation: physical RoomPlan, genuine C8 COLMAP/Open3D/neural/CUDA, representative-home accuracy and cloud delivery remain `NOT RUN`; these are upstream fidelity/release gates, not missing C10 architecture.

| Lane                                 | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                                  |
| ------------------------------------ | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ------------------------------------------------------------------------------------------------ |
| C10-L1 scene compiler/runtime        | `019f723e-93ec-79d2-9b8d-d7c704ce49c6` | `gpt-5.6-sol` / `xhigh` | `d107a88`  | `dced053` | integrated | scene-compiler source/tests and isolated spatial-worker scene-compile source/tests               |
| C10-L2 durable scene backend/storage | `019f723e-93ed-7dd0-9e69-873e38544e74` | `gpt-5.6-sol` / `xhigh` | `5133059`  | `081d490` | integrated | isolated platform scenes module/C10 composition/migration/tests and runbook                      |
| C10-L3 viewer/independent acceptance | `019f723e-93ed-7dd0-9e69-87165c5840e5` | `gpt-5.6-sol` / `xhigh` | `8caf731`  | `c295a8d` | integrated | isolated web viewer/BFF/tests plus viewer E2E/performance/security/evaluation/threat-model paths |

- Worktree paths: L1 `/Users/abhinavgupta/.codex/worktrees/9ca3/Interior Design`; L2 `/Users/abhinavgupta/.codex/worktrees/505a/Interior Design`; L3 `/Users/abhinavgupta/.codex/worktrees/0f60/Interior Design`.
- Provisioning client IDs: L1 `client-new-thread:ebee5379-2616-4028-aad9-f65e9516ad06`; L2 `client-new-thread:4469a026-6868-4fc1-b171-2a17e61bed7e`; L3 `client-new-thread:2d59bf64-7d9a-4703-8fdd-deb51c7977ae`.

### Prelude decisions and gate evidence

- Current Khronos glTF 2.0.1, official validator and React Three Fiber performance guidance freeze GLB 2.0, finite aligned little-endian buffers, right-handed metre output, explicit `[Xmm/1000, Zmm/1000, -Ymm/1000]` conversion, validator-clean publication, demand-driven rendering and bounded draw-call/resource behavior.
- Shared C10 contracts freeze exact-snapshot jobs, deterministic compiler configuration, derived-only authority, integer-millimetre bounds, stable one-owner element mappings, explicit omissions/findings, bounded artifact/count ceilings and loopback-only HTTP signed access. Five deny-by-default C10 actions are added before worker launch.
- Migration `0010_scenes.sql` is reserved exclusively for C10-L2. Root/package manifests, lockfile, shared contracts/core authz, registry, accepted contract and ledger remain orchestrator-owned after the prelude.
- Dependency versions were resolved from the current npm registry before freezing: Three.js `0.185.1`, React Three Fiber `9.6.1`, `@types/three` `0.185.1`, Earcut `3.2.3` and Khronos glTF Validator npm `2.0.0-dev.3.10`.

### Integration and closure evidence

- All three workers completed from the frozen prelude and merged in L1 → L2 → L3 order. Cross-lane integration then composed the real scene compiler with the durable API repository, exact snapshot verifier and S3-compatible object storage behind explicit environment activation.
- Root review aligned compiler/backend determinism identity, `canonicalElementId` verification and per-level node ownership; enforced BFF project identity; and repaired the production runner so an ordinary publication rejection becomes a fenced durable failure rather than a silently stranded `publishing` job.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, every package lint/typecheck/build pipeline and all default unit suites. Focused totals include scene compiler 24, platform API 134 passed / 28 declared environment skips, spatial worker 109 passed / three declared live skips, web 93, geometry 43 and Python 117 passed / two unavailable COLMAP/Open3D-runtime skips.
- Live PostgreSQL plus local S3-compatible API/storage tests passed 5/5. The separate production-composed gate used a real API, real `SceneCompilationRunner`, real compiler, exact committed two-level C4 snapshot, PostgreSQL and object storage; it passed 1/1 and produced a signed-download-verified 29,456-byte GLB (`730e0b6b20d1a5438d17b15a592d4fda52b8d15c41fd76e5b54411f98f817a7a`) containing 14 nodes, 9 meshes, 561 vertices, 281 triangles and 6 materials. Database counts remained one snapshot, one scene, zero branches and zero operation commits.
- Independent scene security passed 11/11. Browser semantics passed 5 with 2 actual-canvas skips across Chromium, Firefox and WebKit. The two desktop/mobile performance cases were skipped because the host reported a WebGL major caveat, so no numeric GPU claim is made. The in-app Browser failed before tab creation with `Cannot redefine property: process`; Playwright is the recorded fallback evidence.
- Physical RoomPlan, genuine C8 COLMAP/Open3D/neural/CUDA execution, actual hardware-GPU performance, representative-home accuracy, cloud-provider delivery and professional review remain exactly `NOT RUN`. They are release/field evidence and are not missing scene architecture. No paid service, key, customer data or training permission was used.
- Durable evidence: `docs/evaluation/viewer/C10_L3_ACCEPTANCE_2026-07-17.md`. C10 terminates the authorised programme; no C11 checkpoint is open.

## C11 — Interior-design brief and agency workspace

### Master activation

- Status: complete on `main`; C12 may open only from the pushed C11 ledger-close state
- Subsequent authority: user authorised sequential C11-C15 execution on 2026-07-18 after the accepted C10 closure; C10's terminal statement above remains a truthful record of its closure-time boundary
- Continuation control: `docs/orchestration/C11_C15_CONTINUATION.md`; C15 is terminal and C16 is not authorised
- Contract: `docs/orchestration/checkpoints/C11_CONTRACT.md` (`c11-design-brief-v1`, `c11-brief-revision-v1`, `c11-consultation-session-v1`, `c11-brief-patch-proposal-v1`, `c11-reference-board-v1`)
- Immutable predecessor: `2cfa04772493b8fd60446edf9dc75fced7b5557b`
- Prelude commit and frozen worker base: `bd57878e0b5ac9f66c26a58f2dbbb406f8a5b3d6`
- Product completion SHA: `00535909369884bc7f90881f8370540e63495e15`
- Planned lanes: three, retained adaptively because attributable revisioned brief persistence, adversarial bounded model tooling and independent cross-surface consultation acceptance have clean exclusive ownership boundaries
- Worker runtime: every lane uses exact `gpt-5.6-sol` with `xhigh` reasoning, recorded before launch because all three lanes include security, provenance, concurrency or adversarial integration work
- Provider/data policy: deterministic local adapter and synthetic rights-cleared fixtures only; every external LLM/media provider is disabled, no customer data or training permission is used and accessibility/health/household content is excluded from logs
- Mutation policy: C11 proposals are expiring typed brief patches only; explicit authorised confirmation and optimistic revision checks are mandatory, and no C4/C5/C9/C10 mutation is reachable

| Lane                              | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                             |
| --------------------------------- | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | ------------------------------------------------------------------------------------------- |
| C11-L1 brief domain/persistence   | `019f72a5-65cb-74a3-82f6-e04d25b0ee2e` | `gpt-5.6-sol` / `xhigh` | `1a3f901`  | `2694b07` | integrated | design-brief package; platform briefs module/tests; migration `0011`; runbook               |
| C11-L2 bounded design agent       | `019f72a5-65cb-74a3-82f6-e02407a22b8b` | `gpt-5.6-sol` / `xhigh` | `4521961`  | `8e7f2ab` | integrated | model-gateway package; platform design-agent module/tests; C11 threat model                 |
| C11-L3 consultation UX/acceptance | `019f72a5-65cf-7312-83a6-f02c032bf19d` | `gpt-5.6-sol` / `xhigh` | `8b4ebc3`  | `0a4c99b` | integrated | isolated consultation web/BFF/tests; brief-assistant evaluation/security/E2E/evidence paths |

- Worktree paths: L1 `/Users/abhinavgupta/.codex/worktrees/9874/Interior Design`; L2 `/Users/abhinavgupta/.codex/worktrees/be3d/Interior Design`; L3 `/Users/abhinavgupta/.codex/worktrees/5cae/Interior Design`.
- Provisioning client IDs: L1 `client-new-thread:b6b4fcbe-c004-46a0-b30e-1036ce7dc51c`; L2 `client-new-thread:91034c51-ccdb-4833-80fe-d134669b3572`; L3 `client-new-thread:7a148d92-af91-4ae7-b403-f3e41a7152d9`.

### Prelude decisions

- The active `08` plan now explicitly controls every conflicting historical scope/checkpoint statement. The historical post-M1 roadmap labels its reused C11-C19 identifiers non-executable, and stale product/architecture/agent briefs carry scope notices.
- DQ-021 is conservatively frozen for this continuation: no outbound provider. The exact local adapter manifest records `externalNetworkUsed: false`; professional, regulatory, structural, cost-certainty, clinical-accessibility and live-availability questions route to typed review.
- Shared C11 schemas freeze explicit preference/constraint/evidence/assertion/inference/conflict/unknown classification, attributable provenance, reference rights/hash linkage, bounded revisions/patches/sessions and exact routes. The authz registry freezes eight C11 actions before worker launch.
- Migration `0011_design_briefs.sql` is reserved exclusively for C11-L1. Shared contracts/authz, the migration registry, root/workspace manifests and lockfile, central platform/web composition, accepted contract and ledger remain orchestrator-owned.
- Preflight removed the only material future-runtime blocker before launch: Homebrew installed Blender 5.2.0 LTS and a real unsandboxed `--background --factory-startup` Eevee run produced a visually inspected 256×256 PNG (`0bae64fb860104596ef9f4a1ab68e176f3c6635fefe4aaf6fd322b1a2235ee20`). The sandboxed binary had crashed and is not counted; the host run is the evidence. FFmpeg/ffprobe 8.1, Xcode 26.4 and all Playwright engines remain available, while CUDA/NVIDIA and external media providers remain unavailable.
- Obsolete C9/C10 managed worktrees were archived; only the primary worktree remains. Obsolete C6 gate containers were stopped without deleting volumes, then the standard repository PostGIS/object-storage/Temporal stack started healthy and passed its complete healthcheck.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, all 15 package lint/typecheck/unit/build pipelines, Ruff, strict mypy and 117 Python tests with two explicitly unavailable COLMAP/Open3D runtime skips. The C11 shared contract passes 8 focused cases; the complete contract package passes 65 and authz passes 447, while the independent identity matrix passes 705. `git diff --check` is clean.

### Integration and closure evidence

- All three workers completed from exact frozen prelude `bd57878e` and were audited for parentage and exclusive-path ownership before merging L1 → L2 → L3. Root integration composed the deterministic brief kernel, Postgres repositories/source verifier, bounded local model gateway, C11 routes, readiness checks, local/production identity policy, navigation and central log redaction. The three archived Codex tasks removed their worktrees; stale Git worktree metadata was pruned after product commit.
- A clean disposable C1-C11 migration and production-composed integration passed 1/1 against real Postgres. It covered owner/editor/viewer/foreign access, project/intake initialization and replay, deterministic-local consultation, atomic confirm and replay, direct correction, exact cancel/rejection, acceptance, optimistic concurrency and actor attribution. Structured log assertions proved tokens, private messages, the address marker and accessibility marker were absent; C4 snapshot and C5 commit counts/hashes were unchanged.
- The real Next BFF → C11 API → deterministic gateway → Postgres Playwright journey passed 3/3 for owner acceptance, viewer read-only and 390 × 844 mobile behavior. The resulting accepted revision-3 brief had nine attributable entries, one session and one confirmed proposal, with zero C4 snapshots and zero C5 commits. The independent synthetic matrix passed 13/13 across Chromium, Firefox and WebKit desktop/mobile, keyboard, hostile-text, interruption/recovery and degraded states; brief evaluation/security passed 11/11.
- Connected Chrome extension verification visibly reopened the persisted accepted brief and found zero canonical mutations, no horizontal overflow, no console warnings/errors, explicit external-provider-disabled state and correct deterministic model/provenance labels. The in-app Browser controller failed before tab acquisition and remains a controller limitation rather than product evidence. Screenshots and the complete gate disposition are recorded in `docs/evaluation/brief-assistant/C11_L3_ACCEPTANCE_2026-07-18.md`.
- Xcode 26.4 / iOS 26.4 Simulator regression passed 29 XCTest, 96 Swift Testing and 18 UI cases (143 logical cases). `UV_CACHE_DIR=.cache/uv pnpm verify` then passed all 17 workspace format/lint/typecheck/unit/build pipelines, Ruff, strict mypy and 117 Python tests with two correctly skipped optional COLMAP/Open3D runtime cases. `git diff --check` passed.
- Real external model execution, customer data, physical mobile/sensor/LiDAR evidence, GPU/CUDA, formal WCAG certification, representative-household scoring and professional structural/regulatory/clinical/cost/availability review remain exactly `NOT RUN`. They were neither required nor relabelled for deterministic local C11 closure. No paid service, provider key, customer data or training permission was used.

## C12 — Valid design options and variant engine

### Master activation

- Status: complete and exhaustively verified on `main`; C13 may open only from the pushed C12 ledger-close state
- Contract: `docs/orchestration/checkpoints/C12_CONTRACT.md` (`c12-design-constraint-v1`, `c12-interior-asset-ref-v1`, `c12-option-job-v1`, `c12-design-option-v1`, `c12-operation-bundle-v1`, `c12-option-confirmation-v1`)
- Immutable predecessor/C11 ledger close: `0326a8b1bc51dce9a07a3c7b1cb2183b01654f24`
- Prelude commit and frozen worker base: `fbcd0829a1ae53771d5e57933bb3401986572d3a`
- Activation/lane commits: `44fc5da7eff7c8135803327592020eef70b1424d`, `fb28de089d2dfa63c9b092fdeaee731ff2833e2d`
- Root product composition SHA: `850495cc05fe6908bf38f38af6884ed7d86b0b4b`
- Product/evidence completion SHA: `9723f4ce1be6fbaa595045a315f328d96adae87b`
- Planned lanes: four, retained adaptively because deterministic spatial search, rights-bound placement, transactional cross-domain confirmation and independent adversarial cross-surface acceptance have exclusive ownership boundaries
- Worker runtime: every lane uses exact `gpt-5.6-sol` with `xhigh` reasoning, recorded before launch because all four lanes include numerical geometry, untrusted assets, concurrency/security or cross-surface integration
- Provider/data policy: creator-owned synthetic bounded-proxy assets and deterministic local execution only; no paid service, provider key, customer data, GPU or training permission is required
- Mutation policy: generation remains proposal-only; only an explicit owner/editor confirmation can atomically create/reuse an exact proposed base, create an isolated C5 branch and commit a hash-verified furnishing/finish/light bundle. Existing and as-built profiles remain immutable.

| Lane                                          | Task/thread                            | Model / reasoning       | Worker SHA               | Merge SHA                | State      | Exclusive roots                                                                                                     |
| --------------------------------------------- | -------------------------------------- | ----------------------- | ------------------------ | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| C12-L1 deterministic constraint/layout engine | `019f7338-3152-7fc3-b7b7-afd1c3ff799e` | `gpt-5.6-sol` / `xhigh` | `68bbb07`, fix `b497888` | `e4229d5`, fix `1c5c024` | integrated | `packages/design-engine/**`                                                                                         |
| C12-L2 generic assets/placement producer      | `019f7338-3179-70b1-a6b7-e248d2bcda47` | `gpt-5.6-sol` / `xhigh` | `6f75bae`                | `50db2cd`                | integrated | `packages/interior-assets/**`; isolated spatial-worker asset-placement source/tests                                 |
| C12-L3 durable proposal/confirmation runtime  | `019f7338-3167-7993-93e9-8e61fa13540c` | `gpt-5.6-sol` / `xhigh` | `b1bd050`                | `9bcf017`                | integrated | isolated model-operation AI tools, platform design-options module/tests, migration `0012` and runbook               |
| C12-L4 option UX/independent acceptance       | `019f7338-3167-7993-93e9-8e84222b53ee` | `gpt-5.6-sol` / `xhigh` | `d54d2f5`, fix `3a8c8b5` | `fec1269`                | integrated | isolated web design-options/BFF/tests plus design-options evaluation, security, E2E, performance and evidence paths |

- Worktree paths: L1 `/Users/abhinavgupta/.codex/worktrees/4483/Interior Design`; L2 `/Users/abhinavgupta/.codex/worktrees/06ba/Interior Design`; L3 `/Users/abhinavgupta/.codex/worktrees/bb16/Interior Design`; L4 `/Users/abhinavgupta/.codex/worktrees/3b52/Interior Design`.
- Provisioning client IDs: L1 `client-new-thread:3505ef09-df1d-4ef0-a427-5a74b656004a`; L2 `client-new-thread:649de8e5-f33f-408a-bbe5-8918227dfb30`; L3 `client-new-thread:398aa23b-5d5a-4b19-98c5-93eef54ba5b2`; L4 `client-new-thread:e9ab6d58-e674-4eab-b351-26fda53f8036`.

### Prelude decisions and gate evidence

- The server, not the client, derives authoritative constraints from the exact accepted C11 brief, committed existing/proposed source snapshot, generic asset policy and system geometry rules. A job pins every brief/model/version/content hash and creates only an in-memory proposed working clone until confirmation.
- The shared C5 extension has exactly three paired-version operations—create, replace and remove—for proposed furnishings, finishes and lights. Create/replace retain exact asset/version/content/metadata/policy/rights bindings. The core registry, upcaster and deterministic reducer accept the new paired envelope without changing legacy `c5-model-operation-v1` history or permitting existing/as-built mutation.
- Confirmation is frozen as one transaction-scoped and fenced operation: revalidate/lock all source heads, recompute option/bundle/constraint/candidate hashes, seed or reuse the exact proposed base, create an isolated branch, preview/commit, verify the committed snapshot hash and record confirmation/audit/idempotency atomically. Any mismatch rolls back without a partial branch.
- Hard constraints are limited to computationally provable integer geometry, exact source/asset/rights pins and bounded operation rules. Unsupported or contradictory requirements abstain; structural, regulatory, clinical-accessibility, cost, live-availability and professional judgement route to explicit review. Diversity is computed from asset/assignment/placement/material/operation signatures, never prose, UUIDs or rendered pixels.
- Current Khronos glTF 2.0.1 and official OR-Tools/CP-SAT materials were checked on 2026-07-18. C12 retains an explicit right-handed metre conversion boundary for later asset compilation but does not add OR-Tools: the pure bounded TypeScript baseline is easier to replay exactly and sufficient for this checkpoint. Any future solver must stay behind the same deterministic port.
- Migration `0012_design_options.sql` is preallocated exclusively to C12-L3. Shared contracts/authz, the migration registry, root/workspace manifests and lockfile, package scaffolds, core operation registry/reducer, central composition/navigation, accepted contract and ledger remain orchestrator-owned.
- Focused gates pass C12/C5 contracts and the full contract package 72/72, model-operation lint/typecheck/unit 15/15, authz 483/483 and the independent identity matrix. The complete `UV_CACHE_DIR=.cache/uv pnpm verify` passes formatting, all 19 workspace lint/typecheck/build pipelines, every default JavaScript unit suite, Ruff, strict mypy and Python 117 passed / two honestly skipped unavailable COLMAP/Open3D runtime cases. `git diff --check` is clean.
- No implementation task was launched before this activation record and exact model/reasoning assignment were committed and pushed. The orchestrator audited ancestry and exclusive path ownership, then merged L1 → L2 → L3 → L4 in the frozen order. C13 remains closed until the C12 ledger-close commit is pushed.

### Integration and closure evidence

- The ordered root integration composed the exact C11 accepted-brief content hash and committed existing-model handoff, production API/readiness surface, creator-owned versioned asset catalog, deterministic planner, environment-activated spatial-worker service, navigation and C12 comparison/confirmation workspace. Configuration rejects inconsistent C2/C10/C12 database aliases rather than silently splitting the worker.
- The production-composed journey passed both against the normal local database and a newly created empty C1–C12 database. It launched the built production Next server, drove a headless Chromium user through the real C11 workspace and exact `Generate two valid design options` handoff, traversed the authenticated Next BFF and listening API over HTTP, spawned the built `services/spatial-worker/dist/src/index.js` executable with C12 enabled, and waited for the durable PostgreSQL job through the public BFF.
- The executable worker published exactly two replayable, spatially or materially distinct furnishing/finish/light options. Generation created zero canonical mutations. Explicit confirmations produced two isolated sibling C5 branches and commits from one retained proposed base; same-key replay returned the original result, while the existing profile remained byte-equivalent. One non-head confirmed result compiled through C10 into an embedded glTF 2.0 GLB of 7,164 bytes, six nodes and 18 triangles with exact SHA-256, no external URI and stable furnishing, finish and light IDs retained in manifest, node, mesh, material and punctual-light metadata.
- Captured API, Next and spawned-worker process logs contained safe lifecycle events (`design-options.published`, `scene.compiled`) while excluding the injected private brief marker, bearer token, option summary, asset ID, operations, placements and lease-token fields. The serialized live-PostgreSQL C12 suite passed 12 files / 46 tests, including stale-source fencing, lease reclaim, cancellation/retry/abstention, concurrent sibling confirmation, idempotent replay, RLS activation and append-only rejection. Independent evaluation/security/performance passed 14/14.
- `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, all 19 workspace lint/typecheck/unit/build pipelines, Ruff, strict MyPy and Python 117 passed / two honest optional capability skips. The independent Playwright matrix passed all 12 Chromium, Firefox and WebKit desktop/mobile cases. Connected Chrome visibly passed synthetic sign-in, comparison, confirmation and 390×844 overflow/console inspection. The Codex in-app Browser controller failed before tab acquisition and is recorded as unavailable, not as evidence.
- No external provider, paid service, provider key, customer data, GPU/CUDA, physical-device/LiDAR, representative-household study, human-rated agency-design study or structural/regulatory/clinical/cost/availability professional review was exercised or claimed. Durable details and commands are recorded in `docs/evaluation/design-options/C12_L4_ACCEPTANCE_2026-07-18.md` and `docs/runbooks/development/c12-design-options.md`.

## C13 — Rights-aware catalog and room specification

### Master prelude

- Status: complete and exhaustively verified on `main`; C14 remains closed until this C13 ledger-close state is pushed
- Contract: `docs/orchestration/checkpoints/C13_CONTRACT.md` (`c13-catalog-artifact-v1`, `c13-catalog-rights-record-v1`, `c13-catalog-asset-version-v1`, `c13-catalog-release-v1`, `c13-specification-v1`, `c13-specification-revision-v1`, `c13-substitution-preview-v1`, `c13-substitution-confirmation-v1`)
- Immutable predecessor/C12 ledger close: `c8f266e68fdd31402d49a9f12b80b5af21644ae6`
- Prelude commit: `2a833ffc4d7ad17d8bc8692cc331b4aacb7aca9f`
- Frozen worker base/activation: `ab9498dc45c45de8f6a155227ab01a6fb0203a6b`
- Planned lanes: three, retained adaptively because hostile/right-sensitive asset ingestion, transactional C5/specification persistence with forced RLS, and independent cross-surface exact-version acceptance have clean exclusive ownership boundaries
- Worker runtime: every lane will use exact `gpt-5.6-sol` with `xhigh` reasoning. This is recorded before launch because all three lanes include untrusted artifacts/licensing, concurrency/security or cross-domain C5/C10/browser integration.
- Provider/data policy: creator-authored generic local assets and deterministic local workers only; no runtime URL ingestion, external provider, paid service, customer data, training permission, live price, supplier or availability source is activated
- Mutation policy: C13 projects one exact confirmed C12 option into immutable specification revisions. Previews are non-canonical and labelled bounded; only an explicit owner/editor confirmation may reuse `design.element.replace.v1` on the exact proposed branch, after which C10 may compile the committed result.

| Lane                           | Task/thread                            | Model / reasoning       | Worker SHA | Merge SHA | State      | Exclusive roots                                                                                          |
| ------------------------------ | -------------------------------------- | ----------------------- | ---------- | --------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| C13-L1 catalog pipeline        | `019f73ea-d766-7ab1-b710-e022028ced42` | `gpt-5.6-sol` / `xhigh` | `39051d5`  | `4f52ce9` | integrated | catalog package; isolated catalog worker/API/tests/security/runbook paths                                |
| C13-L2 specification domain    | `019f73ea-d765-7350-a7ff-1e4ff326dfd6` | `gpt-5.6-sol` / `xhigh` | `314a3e9`  | `5022143` | integrated | specification package; isolated specification API/tests; migration `0013`; security/runbook/threat paths |
| C13-L3 selection UX/acceptance | `019f73ea-d766-7ab1-b710-e04953fa3191` | `gpt-5.6-sol` / `xhigh` | `0f9918a`  | `d19b058` | integrated | isolated materials-products web/BFF/tests and specification evaluation/performance/E2E paths             |

- Worktree paths: L1 `/Users/abhinavgupta/.codex/worktrees/c9ff/Interior Design`; L2 `/Users/abhinavgupta/.codex/worktrees/0a74/Interior Design`; L3 `/Users/abhinavgupta/.codex/worktrees/cd11/Interior Design`.
- Provisioning client IDs: L1 `client-new-thread:f04178cc-e480-45c4-928b-6029b5d85e7b`; L2 `client-new-thread:b9a12174-b879-45bb-897e-a2af6c8d2500`; L3 `client-new-thread:91a5c60f-bb02-4cbf-9fde-5859b8d6a12f`.

### Prelude decisions

- C12 v1 remains immutable. C13 wraps all eight exact C12 starter references in richer catalog records and adds only creator-authored local alternatives. Catalog appearance/detail and C10 parametric canonical truth remain distinct.
- Shared contracts pin content-addressed GLB/PNG/licence/source artifacts, declared versus concluded SPDX expressions, independent grants/policies, integer scale/axis/pivot rules, immutable release/version identity, exact C12 confirmation provenance, one schedule-line truth and expiring substitution confirmation.
- Before confirmation the product may show C5 findings and a bounded catalog preview only. C10 is requested after atomic C5/specification commit and failure is a retriable derived-scene state, not a rollback or truth claim.
- Migration `0013_specifications.sql` is allocated exclusively to C13-L2. C13 tables must force RLS and prove tenant isolation through a non-owner/no-`BYPASSRLS` application role with transaction-local tenant context. Retrospective C1-C12 table-owner hardening remains an inherited dedicated-hardening risk rather than silent scope expansion.
- Catalog ingestion accepts repository-local artifacts only and enforces frozen byte/graph/texture/time/memory limits, official Khronos validation plus stricter URI/resource/geometry/rights rules, deterministic publication and no partial release head.
- Root owns shared contracts/authz/tests, migration registry, manifests/lockfile, central composition/navigation/C12-C13-C10 seams, accepted contract and ledger. The exact three `gpt-5.6-sol` / `xhigh` assignments and non-overlapping paths are frozen before task creation.
- The complete prelude `UV_CACHE_DIR=.cache/uv pnpm verify` passed all 21 workspace format/lint/typecheck/unit/build pipelines, Ruff, strict MyPy and Python 117 passed / two honest unavailable COLMAP/Open3D skips. C13 contracts passed 4 focused and 76 complete cases; authz passed 525 plus its independent identity matrix; `git diff --check` passed.
- Node 22.22.2/pnpm 10.33, local PostGIS/object storage/Temporal, Blender 5.2.0, FFmpeg 8.1 and every Playwright engine remain available. C13 needs none of Blender/GPU/provider/physical-device execution. Free disk was 18 GiB at preflight; C14 must re-check its greater-of-15-GiB-or-three-times-job estimate gate before opening.

### Completion evidence

- Product integration commit: `fd1f64108119b046677cc74b7f641ca8c8089d6d`. The orchestrator composed the durable catalog publisher/read API, immutable specification service, exact C12 → C13 → C5 → C10 bridge, contextual scene-cache identity, catalog metadata in validator-clean GLB, navigation/deep links and production worker activation. It also fixed stale revision selection, indistinguishable catalog-version controls, repeated substitution operation identity and local visible-browser hydration.
- A built production worker published 11 real creator-authored GLB/PNG/text assets to loopback S3 from a fresh C1-C13 database: release `bca5a238-9b84-535c-ac16-2baedcda8178`, manifest `967044cd15e2224093414638fa45fbc835ff32e021f561b953e013f23a48ff87`, first `replayed:false`, exact second run `replayed:true`. Independently downloaded manifest/model bytes matched their SHA-256 values; Khronos validator 2.0.0-dev.3.10 reported zero errors and zero warnings.
- The visible in-app Browser completed the real owner journey on project `066d4993-faeb-46fa-ad8b-956b6db9c341`: exact C12 confirmation → revisioned specification → bounded preview → explicit substitution confirmation → C10 job `d296fc0d-34c0-4b5d-8f24-ef96dd50f785` → checksum/semantic-verified interactive GLB. Current specification revision 5 is pinned by hash `e35dc7a1674632d5083d9531bcfe20d16b7e82cffa90677d9c1e882461795c5b`; stable furnishing ID and exact catalog/rights metadata survived compilation.
- The visible fixture contains one furnishing, so finish/light were not fabricated into it. Explicit production-kernel tests now preview/reduce furnishing, finish and light through C5 while preserving stable identity and kind, and C10 verifies all three metadata bindings. The final live database shows existing branch source=head at revision 1, all C13-driven commits only on proposed, no as-built profile, and immutable C12 source/confirmation rows.
- Fresh migration and constrained-role C13 PostgreSQL suites passed 4/4 with forced RLS, tenant isolation, append-only records, generic foreign-key failure, replay, rollback and one-winner concurrency. The real contextual C10/Postgres/S3 regression passed 3/3. Catalog/specification security, severe-input, withdrawal, expiry, stale, idempotency, concurrency and crash-before-head cases pass.
- Playwright passed 18/18 across Chromium 149.0.7827.55, Firefox 151.0 and WebKit 26.5 on desktop/mobile, including keyboard, owner/editor/viewer/foreign, missing/stale/offline/session/service/interruption/retry states, no overflow and no unexpected console/page/network failure. A built-API hostile-marker probe showed `url:"[REDACTED]"` and none of its query, bearer, note, object-key or signed-URL markers in structured process logs.
- Final `UV_CACHE_DIR=.cache/uv pnpm verify` passed 21/21 lint, 21/21 typecheck, 39/39 JavaScript unit tasks, 21/21 builds, Ruff, strict MyPy and Python 117 passed / two honest unavailable COLMAP/Open3D skips. `pnpm test:contract`, `pnpm test:integration`, `pnpm test:security`, `pnpm test:geometry` and `git diff --check` passed. The two catalogue real-validator concurrency tests use an explicit 20-second bound and complete in about 5-7 seconds under full-suite load.
- Durable acceptance: `docs/evaluation/specification/C13_INTEGRATION_ACCEPTANCE_2026-07-18.md`. It records exact IDs/hashes, browser matrix, commands, non-evidence and inherited risks. Root `dependency:boundaries` and `api:check` still execute zero tasks and are explicitly not counted as evidence.
- No GPU, Blender, Xcode, physical device, provider key, paid service, customer/third-party asset, price, supplier, stock, delivery, cost, finish-quantity, structural/regulatory or professional-certainty evidence is claimed. C13 output remains creator-owned generic catalog plus parametric/bounded scene truth; catalog/vendor appearance fidelity belongs to later rendering work.

## C14 — Reproducible geometry-safe still rendering

### Master activation

- Status: **C14 closed** after the 2026-08-12 Session B authorised-host acceptance and real production publication; the exact accepted Linux CPU profile is complete, unconfigured GPU profiles remain unavailable, and C15 remains closed.
- Contract: `docs/orchestration/checkpoints/C14_CONTRACT.md` (`c14-render-scene-manifest-v1`, `c14-render-job-v1`, `c14-render-artifact-v1`, `c14-render-output-manifest-v1`, `c14-enhancement-result-v1`, `c14-geometry-guard-v1`).
- Immutable predecessor/C13 ledger close: `ad161f4478c83f295f5cebcc5b3a8b622df31dab`.
- Prelude commit: `8a5f483a4bced91eae25c8ff9d3ae652ea8f2ee9`.
- Planned lanes: four, completed and integrated. Deterministic scene construction, durable fenced render execution, optional enhancement isolation and independent browser/image evaluation retained exclusive non-overlapping ownership.
- Worker runtime: exact `gpt-5.6-sol` / `xhigh` for all four lanes, as frozen before launch. The common immutable worker base is pushed commit `4253c06e4018362cf90222c29fbda025b7957a41`.
- Resumption preflight: clean `main`/`origin/main` at `4253c06e4018362cf90222c29fbda025b7957a41`; approximately 85 GiB is free on the Data volume; no unrelated repository changes are present.
- L1 render-scene builder: client `2df695a8-0b8c-40ef-898a-c39185430458`; task `019f7779-7ea7-75c3-8e93-32d09c08ae4e`; worktree `/Users/abhinavgupta/.codex/worktrees/3d48/Interior Design`; worker `874f8f310c11e8498ffa5f3f3483a63b56c3a724`; merge `0c0c460`; exclusive ownership `packages/render-scene/**` and `docs/runbooks/development/c14-render-scene.md`; integrated and focused gates passed.
- L2 durable render control-plane: client `6bbf457e-087a-43ad-b905-ab54624ca72d`; task `019f7779-7e77-7180-b1ef-6b0e2b016df2`; worktree `/Users/abhinavgupta/.codex/worktrees/57b2/Interior Design`; worker `93c13c767ae4a4301f86de706645695012c83898`; merge `fb396c8326d8a51d2955ae72d396179e74dc9549`; exclusive ownership covered the frozen renderer worker, render-stills platform/spatial modules and tests, migration `0014`, security suite, runbook and threat model; integrated.
- L3 enhancement boundary: client `bc1aa881-3589-44a0-be0b-54e25892e172`; task `019f7779-7e7e-7ef2-9c36-db506bb6a257`; worktree `/Users/abhinavgupta/.codex/worktrees/b669/Interior Design`; worker `83dbe82bf5a2e3ead6da20c65a323862cfd44684`; merge `0240f1e398f1340d88a726b4de77efaf593d9f62`; exclusive ownership covered `image_enhancement`, its tests/security suite, runbook and threat model; integrated.
- L4 render UX/evaluation: client `bc6b9f25-f4a7-4916-8392-893f17fceb14`; task `019f7779-7e97-7383-ae03-2bab940278aa`; worktree `/Users/abhinavgupta/.codex/worktrees/c2df/Interior Design`; worker `aedb7cc4daad7835c2d0208009b5646aa4cb4110`; merge `9c5914fa991da4d279790d2d25aa22435e6a6f40`; exclusive ownership covered render evaluation, render-stills web/BFF, E2E/evaluation/performance/security tests and evaluation docs; integrated.
- Guardrail: the activation-time task heartbeat `interior-design-c14-orchestration-guardrail` allowed only the current verified checkpoint, could not open a later checkpoint early and explicitly prohibited Blender on this Mac.
- Current user constraint: no further Blender execution on this Mac. Earlier preflight capability/tiny-probe observations are not C14 acceptance evidence. Worker prompts will prohibit Blender invocation on this host; subprocess control can use inert fake executables only.
- Honest checkpoint state: the code/control-plane may become `implementation-ready / hardware-gate-deferred`; a real geometry-safe Blender render/pass bundle still requires an authorised render host. On 2026-07-19 the user explicitly revised the sequential rule: after every locally available C14 gate is merged, exhaustively verified and documented, C15 may open with the renderer-hardware gate retained as deferred evidence; C16 may open only after C15 closes under the same honest rule.

### Frozen prelude decisions and evidence

- The API will server-resolve one succeeded C10 scene and exact C13 specification/catalog binding. C14 must verify the authoritative C13 records and the matching `asset.extras.c13SpecificationBinding` embedded in the immutable GLB; request-body hashes and the strict C10 manifest alone are insufficient.
- `packages/render-scene` is a declarative, non-executable boundary. The shared contract freezes source/camera/material/light/profile/segmentation schemas, safe job states, non-circular artifact/result manifests and separately terminal enhancement jobs.
- A safe bundle requires lossless PNG, multilayer OpenEXR, depth, normal and segmentation outputs. Optional enhancement can never delay, replace or mutate it, and C14 makes no unsupported millimetre-depth claim from enhanced PNG pixels.
- Disk admission uses reservation semantics: `unreservedFree >= max(15 GiB + estimated job bytes, 3 × estimated job bytes)`. The preflight archived completed C13 worktrees and reclaimed only reproducible repository/Homebrew caches. It deliberately left an unrelated eMed worktree, global pnpm/model/runtime caches and all user data untouched.
- The initial pause occurred at approximately 20 GiB free and 96% utilisation. The user then authorised conservative cleanup of regenerable pnpm/UV/npm/NPX/pip/CocoaPods/Trivy caches; active dependencies/environments, model caches, Codex runtimes, Playwright browsers, Docker volumes/images, other worktrees and user data were preserved. Resumption preflight reports approximately 85 GiB free.
- Root scaffolds and registers `packages/render-scene`, `packages/render-evaluation` and `workers/blender-renderer`, with exact shared package ownership ready for isolated lanes. C14 authz grants owner/editor create/read/cancel/retry/artifact access and viewer read/artifact access only.
- Verified without Blender after the user's hold: C14 contracts/typecheck and all 80 contract tests passed; authz typecheck plus independent identity matrix and 555 tests passed; all three scaffold packages built; Prettier and `git diff --check` passed.
- Four worktrees may now activate within the frozen ownership boundaries. No renderer, provider, GPU, browser or end-to-end artifact evidence is claimed by the prelude, and no worker may invoke Blender on this Mac.

### 2026-08-11 Session A integration and local closure

- Session authority: one primary `gpt-5.6-sol` / `xhigh` integration session under `docs/orchestration/checkpoints/C14_CLOSEOUT_EXECUTION_PLAN.md`. No new worktree or parallel implementation lane was opened. Starting `main` was `7f4280273e0dd1c86e434e1555cbe6baafbcbf69`, 21 commits ahead of `origin/main`; all 21 commits and all untracked/user-owned files were preserved without reset, rebase, discard or overwrite.
- Product integration: project navigation now exposes `Geometry-safe stills`; executable C14 API composition resolves exact C10 scene bytes plus current C13 specification/catalog/rights bindings; disabled configuration constructs no worker; enabled configuration requires the full absolute executable/script and build/host/acceptance pin set. A valid C13 substitution may retain its immutable C12 source-confirmation snapshot only when the origin model matches; all current revision/model/C10 pins still match exactly.
- Verification registration: `pnpm test:c14` now runs source-only render-scene, inert renderer, API, worker, web, evaluation, performance, render-job/render-stills security, enhancement Python, six standalone TypeScript checks, a disposable C1-C14 integration, 13 API seam tests and three dependency-boundary tests. Generated `dist/test/**` output is excluded; `api:check` and `dependency:boundaries` no longer succeed with zero work.
- Disposable services: isolated Compose project `interior-design-c14-closeout-20260811`, Postgres 18.4 and SeaweedFS 4.29; final databases `c14_closeout_final_api_20260811` and `c14_closeout_final_control_20260811`; both applied exactly migrations 0001-0014. Existing Docker projects/volumes remained untouched, and only this disposable project/its volumes are removed after evidence capture.
- Live control-plane result: exact scene job `1f69aaa2-b1b1-44bb-b048-fee4ab24f65f`, GLB SHA-256 `ad0abe02303cf32dc45c60a6a82a7291d4831bcf79a65e2c2653052a9c3ec8b9`, render job `433ab4c0-bed5-4fd0-9e7e-7c9b780452b8`, result `63cd9dc8-73c1-4d04-8b41-5fe546082db7`, output manifest SHA-256 `ba876d4a9d006b90cd172c77388224d2df18d2add07223c0c32f185861588ed2`, five content-addressed artifacts, seven audit events and two outbox events. `FrozenInertRenderer` generated only 64×64 synthetic PNG/EXR fixtures. All five were re-downloaded through freshly brokered access and checked by exact hash/size/type/signature. This is control-plane evidence, not Blender/Cycles/CPU/GPU/render-pass evidence.
- Live/security behavior: the focused Postgres tests plus full chain covered non-owner forced RLS, tenant/role/IDOR denial, append-only records, exact replay/changed-body conflict, concurrent single-winner claims, stale lease/cancel/retry, disk reservations, fenced immutable publication, access expiry/binding, structured-log redaction and unchanged canonical model mutation counts. The full-chain target passed twice consecutively on an exact complete-migration database and again from brand-new final databases.
- Repeatability closure: a final same-database replay exposed the older focused PostgreSQL suite blindly reapplying migration 0014. The suite now applies migrations only to an empty disposable database, otherwise requires exactly 0001-0014, and defensively cleans fixed-name probe roles after partial setup. Focused PostgreSQL passed 8/8 and the complete live `pnpm test:c14` gate then passed again on the same API/control databases and S3 scope (API 26/26; full chain 1/1).
- Repository gates: `UV_CACHE_DIR=.cache/uv pnpm verify` passed formatting, lint, 24/24 workspace typechecks, unit suites, 24/24 builds, Ruff, mypy on 90 Python source files and pytest 130 passed/two capability skips. Live `pnpm test:c14` passed (render-scene 15, renderer 13, API 26, spatial 6, web 9, evaluation package 8, standalone evaluation/performance/security 18, enhancement/security 22, live chain 1, API seam 13, boundary 3). `pnpm test:contract` and `pnpm test:integration` each passed spatial 147/three skips and API 233/51 skips; security 921/921; geometry 43/43. The legacy skips are unavailable-service package cases and are not substituted for the separately passing live C14 gate.
- Browser gates: root onboarding Playwright 6/6 on Chromium desktop/mobile; C14 22/22 across Chromium, Firefox and WebKit desktop/mobile plus final Chromium workflow 1/1. Screenshot `/tmp/c14-render-stills-playwright-evidence/chromium-desktop-inert-workflow.png` is visibly fixture/deferred-labelled. The Codex in-app Browser controller failed at bootstrap (`Cannot redefine property: process`) before creating a tab and is explicitly `NOT RUN` evidence, not a hidden product failure.
- Non-evidence and deferred gate: no Blender executable/version/probe/test/acceptance script was invoked on this Mac. The ignored 2026-07-22 local bundle was not used. No GPU/Metal/CUDA/OptiX, external enhancement provider, model download, physical device, customer data, representative-home review or production deployment was run. Real Blender/Cycles/pass/performance evidence requires Session B on an explicitly authorised host at the exact pushed Session A commit.
- Durable record: `docs/evaluation/render-stills/C14_INTEGRATED_CLOSEOUT_2026-08-11.md`; C14 remains **implementation-ready / hardware-gate-deferred**. C15 was not opened.

### 2026-08-12 Session B authorised-host acceptance and C14 closure

- Authority and source: one primary gpt-5.6-sol / xhigh agent on codex/c14-windows-acceptance, required base dab5580f9a476eeb33aeea66ae98c872706a156c. Implementation fixes dbb227c904df5394720779a08d437234415df0b3 and 1e9b7e227e6d96e4b65842dde8191f97fb97a54d were committed and pushed before the final counted run. The clean counted source was exactly 1e9b7e227e6d96e4b65842dde8191f97fb97a54d.
- Determinism repair: retained visually identical outputs differed only in volatile PNG Date/RenderTime/Cycles timing text chunks and EXR Date/RenderTime strings. c14-render-container-normalization-v1 removes or freezes only those fields while preserving PNG IDAT and EXR pixel/offset payloads. Acceptance now fails closed on every replay mismatch, records primary/replay hashes and carries complete independent validation plus OCIO attestation. Root tsx, exact-palette segmentation and production renderer composition were also repaired.
- Phase 1: authorised Linux Blender 5.2.0 LTS build fbe6228777e7, executable 83e8261eace07a5337f71b52d156c1eece1a6ba913403cc6406182ae58bacf27, renderer 1cdaf63c4d6c1911c4f697ab38e88abfaaf8ebd0ac725958e94582953bf30a17, inspector cb6fcba0be4181c6b96e575c86155880d5e262eac7aa2a31b9ed6d000d8656f3, OCIO 47a7d83e79c1d21f49ba6c505efe311da723471688c614b5c366e1da7eb8ea3a. CPU Cycles smoke 64x64/one sample and primary/replay 256x256/16 samples passed. All five primary artifact hashes exactly matched replay; acceptance evidence hash d1313de0438d9b35666aa088a95ff77f132f4d0f086f826a86ed6781a16d77a5.
- Phase 2: disposable loopback Postgres/PostGIS and SeaweedFS ran the real registered API -> composed spatial worker -> IsolatedStillRenderer -> accepted Blender -> object-store path. Focused PostgreSQL passed 8/8 and the live production case passed 1/1 without mandatory skips. Render job 2a2e3fc7-fec6-46b0-81b5-86495a90ea55, result ee445fed-f660-4c2b-8958-c950cc59949d; all five artifacts were freshly downloaded twice through distinct opaque URLs and independently re-hashed/decoded/inspected. Production evidence hash 6300078b32ff8bdc25dfeaa66eccaa96f23f4912740962621937c08678a22710. Canonical model state was unchanged.
- Final gates: environment-enabled pnpm test:c14 passed with zero mandatory skips; UV_CACHE_DIR=.cache/uv pnpm verify, contract, integration, security 921/921, geometry 43/43, onboarding Playwright 6/6 and C14 Playwright 22/22 across Chromium/Firefox/WebKit desktop/mobile passed. The only verify skips remain two unrelated unavailable COLMAP/Open3D capabilities.
- Closure boundary: C14 is closed only for the exact pinned Linux CPU profile. CUDA, OptiX, GPU, Metal, native Windows Blender, Blender MCP, enhancement providers and production deployment remain unavailable/unclaimed. FrozenInertRenderer remains labelled test-only evidence and was not used for production publication. No merge or PR was created; C15 was not opened.
- Durable record: docs/evaluation/render-stills/C14_AUTHORISED_HOST_ACCEPTANCE_2026-08-12.md.

## C8 v2 — RTX 5080 Blackwell modernisation correction

- Status: **acceptance-only workstation correction merged** to clean `main` by PR #2 at `54886f570c3bb559490a50727e4c77ed00834b52`.
  C15 remains closed. Physical iOS and representative-home field gates remain independently deferred-not-run.
- Authority: authorised base c48c60ee8f179603670207642e31c56eba84b315;
  counted RTX 5080 implementation
  ebf6cb173b73cc75e7b983f90a9d867a4f13f5e0; exact complete software-gate
  commit 170202c. The ledger closeout is the documentation-only commit
  containing this block.
- Runtime: one primary gpt-5.6-sol / xhigh session; no delegated agent,
  orchestration workflow, or additional worktree. WSL-native Git, pnpm, uv,
  Docker, and gh on the ext4 checkout were authoritative.
- Frozen predecessor: the complete ml/reconstruction/windows-nvidia/** v1 tree
  is byte-for-byte unchanged from the authorised base and remains **NOT RUN**.
  v2 is a sibling package.
- Accepted stack: Ubuntu 24.04 containers; CUDA 13.2.51; Python 3.12.3;
  PyTorch 2.13.0+cu132; gsplat 1.5.3; Open3D 0.19.0; official COLMAP 4.1.1
  commit a0d785fba74b2664f31edc4a29026a8b27c00f67; compute 12.0; project
  probe native sm_120; Windows driver 595.79 on an RTX 5080.
- Immutable selected images: COLMAP
  975133bb324122e74baec3a6cee14989792ab0413f5229cb9a37f3107ca635f0;
  Open3D f18141bb0bd07e275a552413b2ca34072f9f5b53607234f23333c747342835e7;
  appearance d950e62af89e1da2b9770468e8991d266e5bc4199c46a0c052c06b06b79349ae.
- Compatibility: CUDA 13.0.88 and 13.2.51 both compiled/executed native sm_120
  kernels and completed real PyTorch/Open3D/gsplat work. CUDA 13.2 was selected.
  Upstream COLMAP/Open3D PTX-JIT paths are recorded separately from the native
  project probe; gsplat contains 20 native sm_120 cubins.
- COLMAP selection: the retained deterministic 10-view/557-track generator is
  creator-owned and replayable. Selected sparse uses CPU seed 0/one thread for
  repeatability; selected CUDA dense produced 20 depth plus 20 normal maps and
  strict-payload PLYs with 46,856 and 46,859 vertices. Sparse registered 10/10
  with 3,362 points and 20,366 observations in both runs.
- Official comparison: COLMAP 3.13 commit
  0b31f98133b470eae62811b557dc2bcff1e4f9a5 registered 10/10 and produced
  20 depth/20 normal maps with 1,728,000 positive depth samples, but strict PLY
  parsing found zero fused vertices after geometric, photometric, relaxed, and
  fresh-workspace attempts. Its dense verdict remains **partial**.
- Open3D boundary: two CUDA tensor workloads produced checksum 8,386,560.0;
  the separate legacy-cpu known-pose TSDF workloads each produced 2,160
  vertices and 4,134 triangles. No GPU TSDF or physical scale claim is made.
- Appearance boundary: two project-owned direct-gsplat runs completed 24
  optimizer steps, exported six strict-payload ASCII PLY vertices, and differed
  by only 0.0000029672 dB held-out PSNR. Appearance remains experimental,
  non-dimensional, and acceptance-only.
- Exposure: v2 has no reconstruction worker/API/queue/UI route.
  C8_V2_ACCEPTANCE_ONLY is a fail-closed guard requiring
  productionRoutingEnabled=false; it is not a production enablement flag.
- Verdicts: selected workstation runtime, COLMAP sparse, COLMAP dense, Open3D
  TSDF, direct gsplat, and repeatability **passed**. Physical capture and
  representative accuracy are **deferred-not-run**. The 3.13 comparison remains
  independently partial.
- Durable evidence:
  docs/evaluation/reconstruction/C8_V2_BLACKWELL_ACCEPTANCE_2026-08-19.md and
  docs/evaluation/reconstruction/c8-v2-blackwell-evidence-2026-08-19.json.
  The v3 canonical evidence SHA-256 is
  fa57d18a7a2fb2017c56cb8b85349c3a663c0add3cb5b23c63372d87724ff8ff;
  the raw runner record SHA-256 is
  72a95697e88fae80c93c624a152d63859f43f4bb4a67f6183ab187e576a986e5.
- Exact software gates on 170202c: pnpm verify passed Prettier, 24/24 lint,
  24/24 typecheck, 45/45 unit task groups, 24/24 builds, Ruff, strict mypy on
  105 files, and pytest 157 passed/two honest capability skips. Contract and
  integration suites passed; security passed 921/921. A fresh isolated
  PostgreSQL C8 suite passed 8/8. All three Dockerfiles passed docker build
  --check with no warnings.
- Review gates: typed v3 round-trip, package-manifest coverage, strict
  ASCII/little-endian/big-endian PLY payload tests, timeout/permission/cleanup
  tests, git diff --check, v1 byte diff, file-mode, forbidden manifest/workflow,
  C15, secret-pattern, machine-path, and complete branch-diff reviews passed.
- Cleanup: 11 exact C8 temporary paths, 17 C8 image tags, two isolated
  PostgreSQL test projects and volumes, and one failed stdin helper were
  removed. Final counts are zero C8 temp paths, containers, tags, volumes,
  networks, or helper processes; the primary checkout is the only worktree. No
  global Docker prune, host CUDA/driver install, or unrelated deletion occurred.
- Merge record: PR #2 was merged only as the acceptance-only workstation package and evidence contract. It is not a production reconstruction, representative-home, metric-accuracy, or field acceptance.
- Remaining limits: no physical iOS/LiDAR/RoomPlan/ARKit pose, relocalisation,
  interruption, thermal, background-transfer, representative-home, multi-room,
  real-capture, metric-scale, survey comparison, customer/phone/provider data,
  paid/cloud provider, external model key, production deployment, or
  professional review evidence. C15 was not opened.

## C14.1 — Homeowner reconstruction journey integration

### Master activation

- Status: closed as the first corrective bridge at integration commit `dc77288`; it is not completion of the overall homeowner slice.
- Authority: user instruction dated 2026-08-23 to prioritise the next core homeowner slice over C15, MCPs or speculative planning intelligence and to leave the final PR unmerged.
- Contract: `docs/orchestration/checkpoints/C14_1_HOMEOWNER_JOURNEY_CONTRACT.md`.
- Verified predecessor: clean `main` and `origin/main` at `54886f570c3bb559490a50727e4c77ed00834b52`; PR #2 is present only as the C8 v2 acceptance package.
- Integration branch: `codex/homeowner-digital-twin-journey`.
- Planned lanes: two. Both are exact `gpt-5.6-sol` / `xhigh` and are recorded before launch.
- Contract/migration impact: none. C1–C10 contracts, server-side permissions, C5 canonical mutation and C10 exact-snapshot compilation remain authoritative.

| Lane                                     | Task/thread                            | Worktree                                               | Model / reasoning       | State      | Exclusive roots                                                                                                              |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------ | ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| C14.1-L1 guided journey and safe handoff | `01a02fc5-56b7-7f92-b574-dd710063fe23` | `C:/Users/abhin/.codex/worktrees/8478/interior-design` | `gpt-5.6-sol` / `xhigh` | integrated | allocated web home-journey, project/intake/property/evidence/reconstruction/fusion/viewer screens, CSS and focused web tests |
| C14.1-L2 independent journey acceptance  | `01a02fec-b1c8-70b1-b70c-9afa227af272` | `C:/Users/abhin/.codex/worktrees/a263/interior-design` | `gpt-5.6-sol` / `xhigh` | integrated | isolated homeowner-journey E2E/integration/security/evaluation and Apple handoff paths                                       |

### Discovery and prelude evidence

- The primary WSL checkout was the only registered worktree. The branch was clean and exactly matched both requested and remote SHA before activation.
- The clean predecessor `pnpm verify` gate passed Prettier, all 24 workspace lint/typecheck/build tasks, 45 unit task groups, Ruff, strict mypy and pytest 157 passed with two honest unavailable COLMAP/Open3D capability skips.
- Code audit proved the smallest missing slice is orchestration, not a new inference domain: project navigation is fragmented; C1 already owns core renovation goals; C9 only renders its exact C5 draft; C5 commit already advances the canonical profile pointer; C10 already resolves that exact current committed snapshot.
- The frozen mutation chain is C9 persisted proposal/draft → C5 preview → separate explicit confirmation → C5 commit → explicit C10 scene compilation. Preview blocking, stale, expired, denied or offline states change no canonical model.
- Host preflight: WSL2 Linux 6.6 is authoritative; Node 22.22.2, pnpm 10.33.0, uv 0.11.16, Docker 29.5.3 and gh 2.92.0 are available. `nvidia-smi` is exposed through WSL. `xcodebuild` is absent, so Xcode/RoomPlan/LiDAR/physical Apple validation is not available on this host.
- No real address, representative property, customer media, paid/cloud provider, production deployment or physical capture is activated. C8 v2 remains acceptance-only with no API/queue/worker/UI route and production routing disabled.

### L1 integration record

- Task `01a02fc5-56b7-7f92-b574-dd710063fe23` completed in the managed Windows worktree with worker commit `25eddb32cbf77f04c25ddd6a0e9488224579747b`; the worktree-only executable-bit projection was neutralised with `extensions.worktreeConfig` plus `core.filemode=false` and no content was discarded.
- Orchestrator path/diff review found no shared-contract, migration, backend, manifest, lockfile, C8 v2 or automatic-mutation change. The commit was cherry-picked as integration commit `6845961`.
- Review removed two test-environment labels from production UI: the journey no longer calls itself fixture-backed and property guidance says provider/manual rather than fixture/manual. The repair is `de68b0d`.
- Focused homeowner-journey tests, web ESLint and web TypeScript checks passed after integration. The bridge retains distinct persisted C9 draft, exact C5 preview, explicit C5 commit and explicit C10 scene actions.
- Per the user continuation instruction, C14.1 is the first corrective bridge checkpoint, not completion of the overall homeowner slice. After L2 acceptance the orchestrator must reassess and open minimal persisted setup/evidence checkpoints wherever executable gaps remain.

### L2 acceptance and bridge closure

- Task `01a02fec-b1c8-70b1-b70c-9afa227af272` completed with worker commit `9fb9678addec72cd69a7a440b76097e358135729`. Orchestrator path/content review found 12 authorised files, no production, contract, migration, manifest, lockfile or C8 v2 change; it was integrated as `dc77288`.
- The managed Windows lane passed TypeScript for all three suites, integration 4/4, security 3/3 and Playwright 14/14; web lint/typecheck and lane formatting passed. The in-app browser controller failed before page action with a managed runner `spawn_ready` timeout and is not claimed.
- The primary WSL checkout independently reran all three TypeScript configurations, integration 4/4, security 3/3 and Playwright 14/14 in 60 seconds across 1440×960 and 390×844.
- Durable evidence: `docs/evaluation/homeowner-journey/C14_1_BRIDGE_ACCEPTANCE_2026-08-23.md` and `docs/runbooks/ios/C14_1_APPLE_HANDOFF.md`. All browser state is explicitly synthetic fixture/mock evidence; Xcode, Simulator, camera, RoomPlan, LiDAR, background transfer and physical device remain NOT RUN.
- Independent acceptance found two production defects without repairing them: any branch revision above zero is treated as confirmed even though initialization creates revision 1, and `PREVIEW_EXPIRED` is rendered as a generic conflict. Discovery also proved the web has no normal first-model initialization path and integrated C5 does not bind nested user assertions to the authenticated actor.
- C14.1 closes only the guided C9 → C5 → C10 bridge. C14.2 is opened for the persisted property/intake/evidence/unmeasured-model/C6/C5/C10 product path and provenance repair.

### Frozen terminal rule

- C14.1 is closed at `dc77288`. C14.2 must be reviewed, integrated and host-validated before the final non-draft PR. C15 remains closed and the final PR must not be merged by this run.

## C14.2 — Persisted homeowner setup and plan-to-twin continuity

### Master activation

- Status: closed; all three lanes are reviewed and integrated, with exact host-live and rendered acceptance evidence recorded below.
- Contract: `docs/orchestration/checkpoints/C14_2_PERSISTED_HOMEOWNER_SETUP_CONTRACT.md`.
- Immutable checkpoint predecessor: `dc77288` on `codex/homeowner-digital-twin-journey`.
- Outcome: normal product controls persist property, intake, evidence, explicit unmeasured initialization, C6 correction, C5 confirmation and exact C10 exploration without manual JSON, direct-route-only navigation, fixture-only completion or hidden canonical setup.
- Contract/migration impact: none. Integrated C5 already owns the typed one-time initialization operation and migration. C14.2 adds a same-origin product adapter, provenance enforcement and tests only.
- Runtime: every lane is exact `gpt-5.6-sol` / `xhigh`. L1 and L2 may run concurrently; L3 starts after their reviewed integration.

| Lane                                  | Task/thread                            | Worktree                                               | Model / reasoning       | State      | Exclusive roots                                                                  |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------ | ----------------------- | ---------- | -------------------------------------------------------------------------------- |
| C14.2-L1 attribution binding          | `01a0301b-bf5b-71e0-b286-2fafb588f06b` | `C:/Users/abhin/.codex/worktrees/5b2c/interior-design` | `gpt-5.6-sol` / `xhigh` | integrated | exact integrated C5 operation service and focused route test files               |
| C14.2-L2 persisted web setup          | `01a0301b-bf5b-72a1-a91f-a93f1b4dd499` | `C:/Users/abhin/.codex/worktrees/ca9b/interior-design` | `gpt-5.6-sol` / `xhigh` | integrated | exact C5 BFF/editor, homeowner journey, C6 continuity, CSS and focused web tests |
| C14.2-L3 persisted journey acceptance | `01a03087-5fcf-7311-88cc-7a18ce9ae13f` | `C:/Users/abhin/.codex/worktrees/8a48/interior-design` | `gpt-5.6-sol` / `xhigh` | integrated | isolated homeowner-setup E2E/integration/security/evaluation paths               |

### Discovery and boundary

- Integrated C5 already creates the first snapshot, initial commit and `Main` branch atomically and rejects later raw snapshots. The missing executable path is web product composition, not a new canonical contract.
- The first product snapshot is one explicitly acknowledged placeholder level with unknown name/elevation/height, no other elements, no global anchor and two visible limitations. Selected C3 property identity is linkage only and supplies no model evidence or interior geometry.
- The BFF accepts acknowledgement only, resolves actor and property server-side and deterministically derives IDs from the idempotency scope. The platform rejects every nested `user-asserted` actor mismatch before initialization or preview.
- Initialization-only revision 1 cannot satisfy correction confirmation. Confirmation requires a changed branch head that is the exact current existing snapshot.
- The counted host-live route uses the provider-free deterministic C6 plan parser. C9 needs two eligible distinct source kinds and remains software-complete rather than falsely live if C7/production-C8 sources are unavailable. C8 v2 remains acceptance-only.
- Local fixture authentication may authorise a real disposable database run, but it is reported as local authentication. Persisted API/database/object-store/worker state, not the persona fixture, must drive journey completion. Synthetic input is never real-property evidence.

### Reviewed integration record

- C14.2-L1 worker commit `616a1770200aa052466c189d62ae01a7c928ec29` was reviewed and integrated as `6dd78a8`. The primary checkout passed 17 focused C5 route tests plus platform API lint, typecheck and build.
- C14.2-L2 worker commit `486d9fbde9149181831a0623faafea67536137e8` was reviewed and integrated as `030e294`. The primary checkout passed 45 focused web tests across 11 files plus web lint, typecheck and build.
- Orchestrator review repaired malformed patch insertions, exact C6 navigation copy, journey setup-state coverage, action-specific sanitisation, exact snapshot response validation, reload-safe idempotency and exact-current/expiry gating before integration.
- C14.2-L3 is authorised from integrated revision `030e294` with exact `gpt-5.6-sol` / `xhigh` and the already frozen isolated acceptance roots.

### Frozen terminal rule

- The orchestrator owns task prompts, review, merge order, integration repair, live service/browser evidence, final repository gates, documentation, push and PR. C14.2 may close only with exact evidence; C15 remains closed and the PR remains unmerged.

### Closeout and exact evidence — 2026-08-24

- The authoritative L3 replacement task was `01a03087-5fcf-7311-88cc-7a18ce9ae13f` at `C:/Users/abhin/.codex/worktrees/8a48/interior-design`, exact `gpt-5.6-sol` / `xhigh`. It could not resume after the usage interruption, so the orchestrator preserved its ten owned uncommitted files as recovery worker commit `eb8b3f6e3dbc45a9fef9477110b8b5e720848c64` and integrated them as `ea5d0f77ce11add5e049eb4f9c57e93eb8b85736` without discarding work.
- The stale duplicate task `01a03070-7dfc-7c13-b684-9fa80c879e97` at `6919cea` was neither resumed nor merged.
- L1 worker `616a1770200aa052466c189d62ae01a7c928ec29` was reviewed/integrated as `6dd78a86e75c36fdcf3dc7949b36156fbe31a56c`. L2 worker `486d9fbde9149181831a0623faafea67536137e8` was reviewed/integrated as `030e294a84b830ddd4b85880b1aba7804cb0e422`.
- Host-live production repair/evidence is `076901d42e5fa381ed0f04d003061e4b00c56ba8`; `fac7fe661602fe8c3937de36c19ea10a7b8aad12` is formatting-only and passed the full repository gate. Reviewed L3 acceptance repair is `49faeb2869c9b4e3d9622c3bd1075112d37881bf`, durable evaluation is `7f77329f47384526ec5eda43c1822f87a13ca75c`, and the final product/evidence integration revision is `dd225fa6b3d8baa7340f8236162bfa2860d4add0`.
- The durable evaluation record is `docs/evaluation/homeowner-journey/C14_2_PERSISTED_JOURNEY_ACCEPTANCE_2026-08-23.md`.

#### Exact acceptance gates

- C14.2: all three TypeScript configurations passed; integration 4/4; security 4/4; rendered normal-navigation Playwright 1/1 at 1440×960. The journey begins at normal sign-in and an empty project list, creates the project through visible controls, then persists property, intake, evidence rights/consent, an explicit unmeasured model, C6 proposal/calibration/draft, distinct C5 preview/commit and the exact current C10 scene.
- The observed mutation order is `project.create`, `property.manual`, `intake.persist`, `evidence.upload-start`, `evidence.ready`, `model.acknowledged-setup`, `c6.proposal`, `c6.calibration`, `c6.draft`, `c5.preview`, `c5.commit`, `c10.scene`; C8 v2 invocation count is zero.
- C14.1 regression: all three TypeScript configurations passed; integration 4/4; security 3/3; Playwright 14/14 across desktop, mobile, roles, expiry, degraded and fail-closed states.
- Repository-wide `UV_CACHE_DIR=.cache/uv corepack pnpm verify` passed at `dd225fa6b3d8baa7340f8236162bfa2860d4add0`: Prettier; 24/24 lint; 24/24 typecheck; 45/45 JavaScript unit task groups; 24/24 builds; Ruff; mypy over 105 source files; pytest 157 passed and 2 capability skips. The exact documentation head is gated again before push.
- `git diff --check` passed. Shared contracts/generated clients, migrations, registries, manifests and lockfiles are unchanged.

#### Host-live persistence and hashes

- Local database `homeowner_journey_20260823`; project `9731c398-70c2-4dd5-a3ab-6474153a1795`; branch `98fb6b22-4dd6-474f-a63c-0607720c0f9a`; source snapshot `83f7446f-04ce-4781-a1a8-ae59ea14c75b`; exact current revision-2 snapshot `b68e48e9-9a09-40cd-ad27-6c4efde47d52`, SHA-256 `4b0938c61747fcfed87d913671b410c4cc62b3046f9e60f36cc840a013703d23`.
- Source asset `2cf910c8-6679-4776-9a9d-e3dd569d52fe`; owned 162-byte SVG; SHA-256 `c8eb8a219afc1ebca6c24aa9fb2900614b530bb96824f057461829aa0ac077a5`; object key `sources/66883b22-2e7d-488f-b434-58349ada10f1`; service processing true and training denied.
- Preview size 704 bytes, SHA-256 `a72035ba5985ba6986d2d6804ee44af6077703e884d4e8b799778e558af8927e`; commit job `bd196964-a7d7-457d-b20b-7cd1e2816b28`; scene `7d1c62b3-285d-44f6-b907-ce0b25945f4e`; GLB size 1,856 bytes, SHA-256 `886534b9e719a19c3e5b27cad0eedbb1d97391a2dacebd1eb2173534869a45f1`; manifest SHA-256 `ce98e9a1a195f9248fd77f12259fe19a70a99ab8ea622792dcb5db7dbd99cd9b`.
- The database query found zero C8 reconstruction jobs and zero C9 fusion jobs for the clean project.

#### Rendered evidence and fallback

- Host-live home screenshot `/tmp/c14-clean-home-final.png`: 1440×2258, 534,860 bytes, SHA-256 `8b4c7996f659da140524e6e093d3c4f02fc09580966b36a369bb583ada4c0714`.
- Host-live viewer screenshot `/tmp/c14-clean-viewer.png`: 1440×2006, 217,800 bytes, SHA-256 `cd4227d2cc06ada74c2f7d4723017c99338c20b373f1340bc7dda818287079ba`.
- Deterministic acceptance home screenshot `/tmp/c14-2-persisted-home.png`: 1440×2258, 534,510 bytes, SHA-256 `652a484e4440d1640a9837f2e016a446e345f02ed135872f080cb0febd202906`.
- Deterministic acceptance viewer screenshot `/tmp/c14-2-persisted-viewer.png`: 1440×1930, 193,302 bytes, SHA-256 `c79b495faef028923f988476746dbf418a02a47ead3e32c3f8a6035070c0ae5b`.
- The in-app browser failed before navigation with Windows sandbox `helper_unknown_error`. The pinned repository Playwright/Chromium runner was the controlled fallback and enforced console/page/browser health, scoped UI controls and screenshot assertions. No in-app-browser success or WebGL-canvas visual claim is made.

#### Honest completion boundary

- Software-complete and Windows-host-validated: persisted server-authorised setup; immutable evidence attribution and consent; proposal-only unmeasured initialization; deterministic C6 plan proposal; canonical C5 preview/commit; exact-current C10 scene exploration; authentication/role/expiry/degraded/error behavior; zero silent C8 routing.
- Experimental: C8 v2 remains acceptance-only and is not a production homeowner route. Reconstruction/fusion output remains a proposal until explicitly corrected and accepted through C5.
- Externally deferred: deployed provider and worker evidence; representative property evidence; a real C8 or C9 run; WebGL canvas rendering; Xcode; RoomPlan; LiDAR; and physical Apple-device validation.

## C14.3 — Homeowner design-studio continuity

### Master activation — 2026-08-25

- Status: **closed for the Windows/WSL web continuity checkpoint** in non-draft PR
  [#5](https://github.com/AbhinavGupta707/Interior-Design/pull/5), left unmerged. Shared
  mobile/backend decisions remain provisional pending the Mac/iPad audit. C15 remains closed.
- Contract: `docs/orchestration/checkpoints/C14_3_HOMEOWNER_DESIGN_STUDIO_CONTRACT.md`.
- Verified predecessor: primary Ubuntu WSL checkout on clean `main` at `5b719f9ab83616affc0eeb7de2ba73279bd93d5f`; after an explicit `git fetch --prune origin`, local and `origin/main` are 0/0 and exact. Integration branch: `codex/homeowner-design-studio-journey`.
- GitHub state: public repository default branch `main`; active ruleset `21470129` (`Protect main with CI`) blocks deletion/non-fast-forward updates, requires pull requests, resolved review threads and strict up-to-date checks. The exact predecessor has successful `JavaScript quality and build`, `Python quality and tests`, `Portable contract and security gates` and `Bootstrap contract` checks.
- Clean predecessor gate: `UV_CACHE_DIR=.cache/uv corepack pnpm verify` passed Prettier, 24/24 lint, 24/24 typecheck, 45 JavaScript unit task groups, 24/24 builds, Ruff, strict mypy over 105 source files and pytest 157 passed/two honest unavailable COLMAP/Open3D capability skips.
- Product audit: normal homeowner navigation ends at the exact-current C10 twin; C11–C14 are secondary specialist tools whose persisted states do not drive the next action. The accepted control planes already provide the required strict operations, so the checkpoint is web continuity plus independent acceptance rather than a new backend or inference domain.
- Reconstruction audit: production C8 dispatch remains the frozen v1 composition. C8-v2 remains a sibling acceptance package with fail-closed exposure and `productionRoutingEnabled=false`; no route/queue/worker/UI productionises it. C9 can acquire completed v1 reconstruction results but correctly abstains without the required independent semantic source diversity. Neither output is promoted directly to canonical truth.
- Mobile audit: native iOS currently reaches project/setup/evidence/capture through C8 but has no standalone C10–C14 flow or generated mobile client. C14.3 will record an exact provisional HTTP/API handoff for Mac review; it will not edit native iOS or freeze shared mobile/backend assumptions.
- Contract/migration impact: none authorised. Shared contracts, OpenAPI/generated clients, authz, migrations, worker protocols, C8 v1/v2 and native iOS paths are read-only.
- Initial orchestration assessment identified web implementation and independent acceptance as separable bodies, but they were sequential rather than parallel because acceptance consumes the reviewed product state.
- Managed-worktree launch failed before implementation: the Codex desktop project registry reported saved WSL project `0656bfea-3712-44ef-b91b-82336aade10c` as `isGitRepository=false`, while WSL Git continued to prove the checkout valid. Direct worktree creation failed repository validation; a staging handoff and same-directory fork handoff each failed with `source thread workspace is not a git repository`.
- Staging task `01a03a73-039c-75e2-a070-b0ac12b5bd4f` replied ready only and made no edits. Same-directory fork `01a03a73-9d4d-7b90-a233-57d70e904ac2` performed no child implementation turn. Both were archived. The asynchronous worktree-fork request produced no registered thread or Git worktree.
- Exact post-failure verification: `git worktree list --porcelain` lists only `/home/abhinav/code/interior-design` on `codex/homeowner-design-studio-journey` at prelude `15e0d159f9a22493c0ee664dfc6f75b64e2e5bc7`; the worktree is clean.
- Replan, frozen before implementation: one primary `gpt-5.6-sol` / `xhigh` session owns the checkpoint. It completes the homeowner design-studio web body, reviews it, then implements independent acceptance/evidence and the provisional Mac handoff. No shared-checkout worker or raw unmanaged worktree is used.

### Frozen terminal rule

- C14.3 closes only after both sequential bodies are implemented/reviewed, normal-navigation Windows/WSL browser acceptance proves the exact persisted design loop, final repository gates pass, documentation matches the evidence and a non-draft PR targeting `main` is open and left unmerged.
- Creator-owned synthetic apartment fixtures are software evidence, not a representative property, provider deployment, survey, professional review, WebGL-canvas or physical-device result. Mac/iPad validation and shared mobile decisions remain separately pending. C15 remains closed.

### Closeout — 2026-08-25

- Single-session revisions: contract freeze `15e0d159`; replan `b74ed40`; product integration
  `9d88d1c`; independent browser/integration/security acceptance `bd3f1d3`; full-gate lint review
  repair `408b809`; durable evaluation/Mac handoff `2de820e`. No implementation subagent or child
  worktree was created, merged or used.
- Homeowner result: the primary `/home/:projectId` route now has two phases and twelve persisted
  stages. After the exact confirmed existing C10 twin, the owner can accept C11 intent, generate and
  compare two exact C12 options, confirm one only into proposed state, create/evolve a C13
  specification, inspect its exact proposed C10 scene and request/review a C14 safe still.
- Exact gating: C11 checks the changed exact-current C5 branch and current snapshot; C12 pins the
  accepted brief plus model/snapshot/hash/version; stale jobs do not advance; C13 retains its exact
  C12 confirmation; proposed C10 matches current C13 snapshot ID/hash; C14 links the paired exact
  scene/specification. Persisted server records, not visits or URL presence, drive progress.
- Recovery/roles: same-browser C12 continuation retains at most four strict opaque server-issued
  confirmations in an 8,000-character project-scoped envelope and revalidates them before C13.
  Viewer progress remains readable but mutation actions remain unavailable. Stage-specific
  unavailable/degraded state does not erase other readable progress.
- Browser acceptance: creator-owned synthetic England one-floor/one-bedroom fixture; normal
  `/projects` navigation; exact mutation order C11 accept → C12 confirm → C13 create → substitution
  preview/confirm → C14 create; proposed C10 DOM fallback; safe and segmentation PNG bytes verified
  in-browser; no C8-v2 request; no unexpected console error. Final Playwright 1/1 passed at
  1440×960. Screenshot `/tmp/c14-3-homeowner-design-studio-final.png`, 1440×3409, 890,389 bytes,
  SHA-256 `6f549b673f454ac391f17e4e7a33ec85863f5ede99d4305cf04b1928616e9de0`, visually
  inspected in the Codex app.
- Focused gates: web 34 files/141 tests; integration 4/4; security 4/4; three focused TypeScript
  configs exit 0; `git diff --check` clean. The exact branch diff from the authoritative predecessor
  changes zero `apps/ios-capture/**`, `services/**` or `packages/contracts/**` files.
- Full gate: `TEMP=/tmp TMP=/tmp TMPDIR=/tmp UV_CACHE_DIR=.cache/uv corepack pnpm verify` passed
  all 24 lint, 24 typecheck, 45 unit dependency and 24 build tasks; web 227/227; spatial worker
  150 passed/3 database capability skips; Ruff and mypy clean; Python 157 passed/2 optional
  capability skips. The initial `TMPDIR`-only Turbo run failed before web test collection because
  WSL inherited Windows `TEMP/TMP`; pinning all three WSL-native variables resolved it.
- Audit boundary: C8 v1 and all production routing are unchanged; C8-v2 still fails closed as
  acceptance-only; C9 still requires independent semantic-source diversity and never promotes a
  reconstruction result directly. C15 remains closed.
- Provisional shared gaps: C12 exposes the C13-required confirmation ID only in the confirm response,
  preventing server-authoritative cold/cross-device continuation; raw platform C14 capability lacks
  the exact C10/C13/camera binding expected by the web workspace, and the authoritative scene
  binding is not externally discoverable after reload. These are documented, not guessed around,
  in `docs/runbooks/ios/C14_3_DESIGN_STUDIO_MAC_HANDOFF.md`; no shared/native contract is frozen.
- Durable evaluation:
  `docs/evaluation/homeowner-journey/C14_3_DESIGN_STUDIO_ACCEPTANCE_2026-08-25.md`.
- Review vehicle: non-draft PR
  [#5](https://github.com/AbhinavGupta707/Interior-Design/pull/5) targets `main` and is deliberately
  left unmerged. No later checkpoint is opened by this closeout.

## C14.4 — Cross-device design-studio continuity

### Master activation — 2026-08-26

- Activation status: opened from the exact predecessor below; terminal status is complete in the
  closeout section. C15 remains closed.
- Authority: user instruction dated 2026-08-26 to close only the two documented C14.3
  cross-device gaps before any native UI, physical-device, C8/C9 production, provider/hardware or
  C15 work.
- Contract: `docs/orchestration/checkpoints/C14_4_CROSS_DEVICE_CONTINUITY_CONTRACT.md`.
- Verified predecessor: clean local `main` fast-forwarded to exact requested and remote commit
  `e38b32783a08e026d31a8424210b429730393a79` after `git fetch --prune origin`.
- Integration branch: `codex/c14-cross-device-continuity`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Contract impact: two additive project-scoped GET routes, strict shared schemas and a pinned
  OpenAPI 3.1.2 source with deterministic TypeScript/Swift clients.
- Migration impact: none.

### Implementation audit and parallelism decision

- C12 persistence already retains one confirmation per tenant/project/job/option and C13 requires
  its opaque ID, but no read route exists. C14 already resolves exact C10 bytes/hashes, embedded
  C13 binding, live catalog rights and frozen profiles at job creation, but exposes no current
  source/camera/specification discovery surface.
- The existing C14 capability route is deliberately host-only. The web BFF currently parses it as
  a richer workspace schema and therefore fails closed on a live platform response.
- `packages/api-contracts/openapi/README.md` is a placeholder; no existing generated client can be
  extended. Native iOS currently has no standalone C10–C14 client or UI.
- The mandatory parallelism gate is not satisfied. Both reads share orchestrator-owned contracts,
  one OpenAPI/generated-client package, platform composition and web consumers; acceptance is
  sequential. Splitting them creates overlapping ownership and contract drift without shortening
  the critical path.
- No task, subagent or worktree was spawned. Historical registered worktrees predate this session
  and remain untouched. Any later spawn requires a newly recorded independent scope, exclusive
  paths, base, model and reasoning before launch.

### Frozen implementation sequence

1. Shared schemas, route constants, OpenAPI source, deterministic TypeScript/Swift generation and
   drift tests.
2. Tenant-scoped C12 repository/service/route/BFF recovery using the existing read action.
3. C14 discovery derived from succeeded C10 scenes, mapped cameras and authoritative C13 binding/
   rights, with creation-time exact-byte/binding revalidation preserved.
4. Web composition and local-authority removal; focused contract, integration, PostgreSQL,
   security and regression gates.
5. Swift package compile/test, complete repository gates, durable evidence, push and non-draft PR.

### Frozen terminal rule

- C14.4 closes only after both routes are consumed through generated contracts, cross-tenant and
  malformed/stale inputs fail closed, exact pins and provenance remain intact, complete gates pass,
  evidence is recorded and a non-draft PR targeting `main` is open and left unmerged.
- Native C10–C14 UI, C15, physical-device evidence, C8/C9 production work, representative-home
  evidence and provider/render-hardware acceptance remain explicitly excluded.

### Closeout — 2026-08-26

- Status: complete in non-draft PR
  [#7](https://github.com/AbhinavGupta707/Interior-Design/pull/7), targeting `main`. The independent
  review supersedes only the earlier leave-unmerged disposition and authorises normal merge after
  exact-head required checks pass. C15 remains closed.
- Revisions: contract freeze `aa3eb2f`; executable implementation `aae3379`; durable acceptance and
  predecessor-handoff correction `fa6611a`; independently reviewed baseline
  `5ecd850e242c36442fa415c0349f817692a3c5c4`; material correction
  `7b4eef258c203479815991445212590fe5633775`.
- C12 result: the unchanged persisted `c12-option-confirmation-v1` is readable only by exact
  authenticated tenant/project/job/option scope under `design-option:proposal:read`. Missing and
  foreign records are hidden as `404`; web recovery v2 stores no confirmation and migrates legacy
  envelopes by erasing that local authority. Invalid, oversized and cross-project recovery records
  are also removed rather than retained.
- C14 result: `c14-render-eligible-sources-v1` is derived from succeeded authoritative C10 scenes,
  exact artifact/manifest/snapshot hashes, mapped cameras and exact current C13 binding/catalog
  rights. Discovery now rereads and validates the immutable GLB and optional embedded binding, so
  malformed bytes and missing/mismatched bound authority fail before advertisement. Raw host
  capability remains separate. Render creation independently repeats mapped-camera, GLB/hash,
  embedded-binding, live-rights and frozen-profile checks, so discovery is never a lease.
- Generated contract: OpenAPI `3.1.2` SHA-256
  `c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508`; generator
  `interior-design-continuity-generator-1.0.1`; deterministic strict TypeScript and Swift 6 outputs.
  Existing version pins are unchanged, no dependency was added and `pnpm-lock.yaml` did not change.
- Independent-review evidence: focused review 16 files/92 passed/2 unavailable-service skips;
  contracts 15/86; full platform 54 files/254 passed/51 unavailable-service skips; web 57/230;
  live PostgreSQL C12 1/2; live C14 platform 6/35 plus full C1-C14 control plane 1/1; Swift build and
  3 tests. Earlier Playwright evidence remains C12 12, C14 22 and integrated journey 1.
- Full gate: `UV_CACHE_DIR=/tmp/c14-4-review-uv-cache CI=1 corepack pnpm verify` exited 0 with all
  24 lint, 24 typecheck, 45 unit dependency and 24 build tasks passing; Ruff and mypy were clean;
  Python passed 157 with 2 optional capability skips. Generated drift and `git diff --check`
  passed.
- Orchestration: one `gpt-5.6-sol` / `xhigh` primary session. The recorded mandatory parallelism
  gate was unsatisfied because both reads share one contract/generator/platform/web critical path;
  no task, subagent or worktree was spawned and historical worktrees were untouched. The later
  independent review also used one `gpt-5.6-sol` / `xhigh` session and no worktree or subagent.
- Contract impact: two additive project-scoped GET routes plus strict shared/OpenAPI/generated
  clients. Migration impact: none. Existing C12, C10 and C13 persistence remains authoritative.
- Durable evidence:
  `docs/evaluation/homeowner-journey/C14_4_CROSS_DEVICE_CONTINUITY_ACCEPTANCE_2026-08-26.md`.
- Explicitly not run/opened: native C10–C14 UI, Xcode/Simulator/physical Apple device, camera,
  RoomPlan/LiDAR, C8/C9 production, provider/render hardware, representative home and C15.

## C14.5 — Standalone iOS homeowner design loop

### Activation — 2026-08-26

- Status: open for implementation; no later checkpoint is authorised.
- Contract: `docs/orchestration/checkpoints/C14_5_STANDALONE_IOS_HOMEOWNER_CONTRACT.md`.
- Native audit:
  `docs/evaluation/homeowner-journey/C14_5_NATIVE_APP_AUDIT_2026-08-26.md`.
- Frozen base: clean `main` at `0f4018befecda80488b9fa72e2116f621a9ef57c`.
- Integration branch: `codex/c14-native-homeowner-studio`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning because the work couples native
  architecture, authenticated state recovery, cross-device exact pins, optimistic mutations,
  artifact verification, accessibility and cross-form-factor integration.
- Contract/migration/dependency impact: no backend or shared contract, no migration and no root
  dependency/lockfile change. The C14.4 generated Swift package is consumed unchanged.

### Audit and scope correction

- The existing app is capture-first: project selection routes directly to device capture
  eligibility. C2 evidence, C7 RoomPlan and C8 photo/video upload are real native branches, but no
  native C10-C14 surface exists.
- The requested target is an adaptive homeowner hub. Capture becomes one optional branch; design
  becomes another branch enabled only by fresh server-authoritative prerequisites.
- Complete native independence is not claimed. Before C14.5, native can list but not create a
  project; has no C1 intake or C3 property workflow; cannot start/review C6 plan, C8 reconstruction
  or C9 fusion; and cannot initialize/preview/commit C5 state. It cannot independently produce a
  confirmed twin.
- C14.5 includes authorised native project creation as the honest hub entry, but leaves intake,
  property, C4-C9 proposal/confirmation and production C8/C9 as the precisely recorded next native
  gap.
- The design gate requires a changed C5 branch whose head is the exact current existing snapshot
  and differs from its source, plus a succeeded exact C10 scene. Local recovery never satisfies it.

### Baseline evidence and orchestration decision

- Required documents, current iOS architecture and relevant C1-C14 platform/web journey authority
  were audited before freeze.
- XcodeGen regeneration from `apps/ios-capture/project.yml` was byte-stable.
- The unmodified app built successfully with Xcode 26.4, Swift 6 strict concurrency, generic
  `iOS Simulator`, isolated DerivedData and signing disabled.
- The mandatory parallelism gate is unsatisfied: app root/navigation, shared bearer transport,
  server-derived prerequisite state, C14.4 generated client, recovery and C10-C14 screens share the
  same target and critical path. No task, subagent or worktree was spawned; historical worktrees
  remain untouched.
- Baseline build is not rendered Simulator, physical-device, RoomPlan/LiDAR, representative-home,
  production C8/C9, provider/render-hardware or C15 evidence.

### Closeout — 2026-08-26

- Status: complete in non-draft PR
  [#8](https://github.com/AbhinavGupta707/Interior-Design/pull/8), targeting `main`. No later
  checkpoint is opened.
- Revisions: contract/audit freeze `e1f72b5`; native implementation `79186d6`; degraded-state
  hardening `ca415f9`; independent review began at exact PR head
  `5d25370c5348d90bc306e363f839e853f2ad92a7` and material corrections are `1d83fc5`.
- Product result: project selection now opens an adaptive homeowner hub. An authorised homeowner
  can create or continue a server project, enter C2/C7/C8 evidence/capture as an optional branch,
  and enter C10-C14 only after fresh server reads prove the exact confirmed twin. The design studio
  covers pinned C10 exploration, attributable/revisioned C11 brief, persisted C12 option generation,
  comparison and generated-client confirmation recovery, C13 specification/material decisions, and
  C14 authoritative eligibility, submission, polling, fresh result access and verified viewing.
- Authority result: project creation uses the server action, bounded typed decoding, one bearer
  invalidation/retry and a pending idempotency key reused after uncertain failure. Design entry
  requires the exact current C4 snapshot, a changed C5 branch whose head matches it but not its
  immutable source, and a succeeded C10 scene pinned to the same snapshot ID/hash. Server role,
  action checks, optimistic revisions, audit/provenance and exact pins remain authoritative;
  viewer is read-only.
- Recovery result: cold launch/cross-device continuation reloads the server. The protected local
  envelope is capped at 4096 bytes and contains only safe presentation metadata; it cannot enable
  design or mutation. Offline cold launch remains locked. A later outage may retain only a last
  verified in-memory workspace for the same project as explicitly stale/read-only until a fresh
  reload succeeds. Project switching clears prior state, cancels in-flight work and rejects late
  old-project results or errors.
- Artifact result: native result viewing refreshes signed access and then enforces origin, expiry,
  response length, 64 MiB cap, MIME, byte count, SHA-256, PNG signature and decoded dimensions
  through an ephemeral/no-cache streaming session before displaying the image.
- Generated contract: the unchanged C14.4 Swift package is linked locally. OpenAPI `3.1.2` SHA-256
  `c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508`, generator
  `interior-design-continuity-generator-1.0.1`; regeneration produced zero drift. No backend/shared
  contract, migration, generated output, root manifest or lockfile changed.
- Independent review correction: stable exact-operation idempotency now spans C11-C14 mutations;
  newest-first specification/render list semantics are respected; C12 option and C13 source
  confirmation pins are cross-checked against the exact current brief, snapshot, job, option,
  result snapshot and proposed branch; cross-project async state cannot leak. No backend/shared
  contract, generated client, migration, dependency or lockfile changed.
- Native gates: XcodeGen was byte-stable; generated Swift tests 3/3; native unit tests 141/141;
  C14.5 UI acceptance 3/3 on iPhone Air and 3/3 on iPad Pro 13-inch (M5), both iOS 26.4; generic
  Simulator Debug/Release builds and Xcode analysis passed; Release scans found no C7/C8/C14.5
  fixture flags, scenario labels, fixture homeowner text or fixture-view symbols.
- Repository/security gates: focused homeowner-design-studio integration 4/4 and security 4/4;
  `pnpm test:c14` passed all locally available source/control-plane gates, with the unavailable live
  C1-C14 production control-plane test skipped; full `pnpm verify` passed 24 lint, 24 typecheck, 45
  unit dependency and 24 build tasks, Ruff/mypy, and Python 157 with 2 optional-runtime skips.
- Durable evidence:
  `docs/evaluation/homeowner-journey/C14_5_NATIVE_HOMEOWNER_ACCEPTANCE_2026-08-26.md`, including six
  retained iPhone/iPad Simulator captures.
- Precise next native gap: production OIDC sign-in plus C1 structured intake, C3 property context,
  C6/C8 proposal jobs, C9 reconciliation and C4/C5 initialise/branch/preview/explicit-commit. Until
  those stages exist natively, iOS cannot independently produce the confirmed twin and the whole
  app is not described as standalone.
- Explicitly not accepted or claimed: physical-device/camera, RoomPlan/LiDAR, representative-home,
  production C8/C9, provider enhancement, render GPU/hardware/host, interactive native 3D, survey,
  structural/regulatory/cost/availability/professional approval or C15 evidence.
- Orchestration: one primary `gpt-5.6-sol` / `xhigh` session. The recorded mandatory parallelism
  gate was unsatisfied; no task, subagent or worktree was spawned and historical worktrees were
  untouched.

## C14.6 — Native homeowner onboarding and proposal readiness

### Activation — 2026-08-26

- Status: open for implementation; no later checkpoint is authorised.
- Authority: user instruction dated 2026-08-26 to audit the actual remaining web dependencies and
  implement the smallest native cold-launch-to-capture/proposal-readiness checkpoint from exact
  clean `main` at `4d12e9ce16c0a94b741051f1f50cff8cef2afd0b`.
- Contract:
  `docs/orchestration/checkpoints/C14_6_NATIVE_HOMEOWNER_READINESS_CONTRACT.md`.
- Native/web dependency audit:
  `docs/evaluation/homeowner-journey/C14_6_NATIVE_WEB_DEPENDENCY_AUDIT_2026-08-26.md`.
- Frozen base: clean `main` at `4d12e9ce16c0a94b741051f1f50cff8cef2afd0b`.
- Integration branch: `codex/c14-6-native-homeowner-readiness`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning because the work couples OAuth
  PKCE, Keychain recovery, server membership, optimistic C1/C3 mutations, project-switch isolation,
  privacy, accessibility and cross-form-factor SwiftUI state.
- Contract/migration/dependency impact: no backend/shared contract, OpenAPI/generated-client,
  database migration, root manifest or lockfile change. Apple `AuthenticationServices` is the only
  new system-framework link.

### Audit and frozen scope

- C1 already verifies configured OIDC bearer tokens, reloads server membership and exposes exact
  session/project/intake routes. C3 already exposes strict resolve/select/dossier/source routes with
  fixture, disabled, unavailable, no-match, ambiguous and manual states. C2 evidence upload and
  rights/consent are already native.
- The missing product code is one native composition: non-local Authorization Code + PKCE,
  protected refresh recovery, fresh session validation, last-project revalidation, C1 intake, C3
  England property context and a fresh C2-driven readiness summary.
- No shared client generation is necessary. The existing generated Swift package remains narrowly
  authoritative for C12/C14; the app already consumes frozen C1/C2 payloads through strict native
  DTOs and can do the same for C3 without widening a shared contract.
- A fresh ready plan may be labelled eligible to begin later C6 processing. This checkpoint does
  not start/calibrate/review C6, construct a C8 source manifest, run C9, initialise C4 or preview/
  commit C5. Onboarding readiness never satisfies the C14.5 exact confirmed-twin gate.
- England address/postcode, UPRN and source context remain non-geometric. Manual fallback invents
  no identifier, coordinate, provider observation, EPC, planning fact or interior.

### Baseline and orchestration decision

- Both repository instruction files, required plans, ledger, C14.5 audit/contract/acceptance,
  current native journeys and relevant C1-C9 web/backend contracts were read before freeze.
- XcodeGen 2.45.4 regeneration was byte-stable; the tracked project SHA-256 remained
  `d9992c3d461b584e152ca0f91a752b09699bc131c590bfb8bbd401fbefc56507`.
- Xcode 26.4 (`17E192`) is installed. The sandboxed initial `simctl` preflight could not connect to
  CoreSimulatorService and is recorded as not-run evidence pending the required authorised
  Simulator gate.
- The mandatory parallelism gate is unsatisfied. Authentication/session state, Keychain token
  recovery, app-root navigation, project restoration, intake/property composition, evidence
  readiness and UI tests share one native target and state graph. No task, subagent or worktree is
  spawned; historical worktrees remain untouched.
- Baseline audit is not live OIDC/property-provider/deployment, physical-device, RoomPlan/LiDAR,
  production C6/C8/C9, confirmed-twin, provider/render-hardware or C15 evidence.

### Completion — 2026-08-26

- Status: complete on `codex/c14-6-native-homeowner-readiness`; no later checkpoint is authorised.
  Contract/audit freeze is `6e8dfc8`; native implementation is
  `0e3ab58266dd21e877944433a64f9651ff23e810`; independent-review correction is
  `dfcdb31c671925e86ca9c17b08b23188af5910e7`, and durable acceptance is recorded below.
- Product result: a new homeowner can progress natively from cold launch through protected
  production-shaped sign-in/session recovery, authorised project create/select/relaunch,
  revisioned renovation intake, England address/property context, C2 rights/consent and evidence
  upload, and fresh capture/proposal-readiness guidance. The website is no longer required for that
  slice.
- Authentication result: non-local configuration uses provider-neutral Authorization Code + PKCE
  through `ASWebAuthenticationSession`, exact HTTPS endpoints and callback URI, no client secret,
  and ThisDeviceOnly Keychain credentials. Cold launch requires `GET /v1/session`; a `401` permits
  one refresh/retry. Invalid provider configuration fails closed. Local fixture identity remains
  conspicuous and Debug-only in effect.
- Project/recovery result: a bounded protected cache holds only the last project UUID. Fresh project
  listing must revalidate membership before restoration. Sign-out/project switch clears all scoped
  models, invalidates request identities and rejects or compensating-erases late persistence,
  inventory, transfer, preview, mutation and selection results. Same-project role changes are
  reapplied, and a downgrade immediately revokes stale mutation authority.
- C1/C3 result: native intake keeps exact optimistic versions and stable pending idempotency. England
  resolution distinguishes exact/ambiguous/no-match/disabled/unavailable/expired/stale states and
  offers a manual user-asserted fallback. Dossier items keep epistemic/source/licence labels and
  `planningStatus: not-reviewed`; address context never establishes interior geometry.
- C2/readiness result: existing immutable resumable uploads preserve rights, explicit service
  processing and default-denied training consent. Fresh saved intake plus selected property define
  onboarding readiness; only a fresh `ready` consented plan may be called eligible to begin later
  C6. No proposal, reconstruction, fusion, C4/C5 confirmation or confirmed twin is inferred.
- Contract/dependency impact: no backend/shared schema, OpenAPI/generated-client, database migration,
  root manifest, lockfile or third-party dependency changed. Apple `AuthenticationServices` is the
  only new framework link. Generated C14.4 TypeScript/Swift outputs remained byte-stable and the
  Swift package passed 3/3.
- Native gates: XcodeGen was byte-stable at final project SHA-256
  `3b5a8346332757bc9190a293503e73cf5c5574356e8a009c35da4b666efa875a`; the locally signed
  full native suite passed 174 logical tests/181 device invocations with zero failures/skips;
  affected tests passed 32/32. C14.6 UI acceptance passed 6/6 on iPhone Air and 6/6 on iPad Pro
  13-inch (M5), both iOS 26.4. Generic Debug/Release Simulator builds, unsigned generic iOS Release
  compilation and Release analysis passed; fixture-exclusion scans found no C14.6 flags, fixture
  property text or fixture-view symbol.
- Repository/security gates: focused C1-C3 passed 27; focused contracts/authorisation/evidence passed
  586 with 2 optional-provider skips; C14.5 integration/security regressions passed 4/4 and 4/4;
  `pnpm test:c14` passed every locally available suite with 8 API capability and 1 disposable
  production-control-plane skips; full `pnpm verify` passed 24 lint, 24 typecheck, 45 unit dependency
  and 24 build tasks, Ruff/mypy, and Python 157 with 2 optional-runtime skips.
- Durable evidence:
  `docs/evaluation/homeowner-journey/C14_6_NATIVE_HOMEOWNER_READINESS_ACCEPTANCE_2026-08-26.md`,
  including retained iPhone/iPad Simulator captures and exact result-bundle references.
- Explicitly not accepted or claimed: live OIDC/address/EPC/planning/mapping provider or deployment;
  remote token revocation; physical-device/camera/background transfer/RoomPlan/LiDAR;
  representative-home; production C6/C8/C9; C4/C5 confirmation; confirmed-twin creation;
  provider/render hardware; survey/structure/boundary/regulatory/cost/availability/professional
  certainty; or C15.
- Independent review: exact PR head `66f3a4250949e30d74de9d1d867b4931a75fbc21` was inspected
  against the C14.6 contract, acceptance, repository instructions and governing plans before the
  correction revision. The primary `gpt-5.6-sol` / `xhigh` reviewer independently validated every
  material finding and retained correction/final-acceptance authority. One Luna/medium evidence
  mapper and one Terra/high contract reviewer performed bounded read-only work in the same checkout;
  no separate task or worktree was created.
- Final claim boundary: native homeowner onboarding and proposal readiness only. Confirmed twin,
  physical-device acceptance, live provider/deployment and production C6/C8/C9 remain unaccepted.

## C14.7 — Native confirmed-twin integration

### Activation — 2026-08-26

- Status: open for implementation; no later checkpoint is authorised.
- Authority: user instruction dated 2026-08-26 to complete the remaining native software path in
  one self-contained `gpt-5.6-sol` / `xhigh` session without subagents, tasks or worktrees.
- Contract: `docs/orchestration/checkpoints/C14_7_NATIVE_CONFIRMED_TWIN_INTEGRATION_CONTRACT.md`.
- Audit:
  `docs/evaluation/homeowner-journey/C14_7_NATIVE_PROPOSAL_TO_TWIN_AUDIT_2026-08-26.md`.
- Frozen base: `main` at `f97f61dc0139dc68fd47469bc700e84313ae9764`; the pre-existing
  user-owned root `AGENTS.md` modification is preserved untouched and excluded from this checkpoint.
- Integration branch: `codex/c14-7-native-confirmed-twin-integration`.
- Contract impact: additive acknowledgement-only C5 safe-initialization and read-only C9 eligible-
  source discovery routes. Existing C4-C10 contracts remain exact; no migration, generated-client,
  root manifest or lockfile change is authorised.
- Runtime/ownership: one primary Sol/xhigh session owns contract freeze, platform authority,
  coupled native state/navigation, tests, independent final review and closeout. User prohibition on
  delegation is controlling; no subagent, separate task or worktree is used.
- Initial claim boundary: software and Simulator evidence only. No physical-device,
  representative-home, production provider, real CUDA/C8/C9, render-hardware or C15 acceptance.

### Software acceptance — 2026-08-26

- Status: closed for the terminal native software path. Non-draft PR
  [#10](https://github.com/AbhinavGupta707/Interior-Design/pull/10) is the `main` integration
  vehicle. No later checkpoint is open.
- Independently reviewed correction:
  `fd404f17cdaa44006af4d6463da9b04385948309`; the root `AGENTS.md` user modification remains
  excluded and untouched.
- Durable acceptance:
  `docs/evaluation/homeowner-journey/C14_7_NATIVE_CONFIRMED_TWIN_ACCEPTANCE_2026-08-26.md` with
  retained iPhone/iPad Simulator captures under
  `docs/evaluation/homeowner-journey/artifacts/c14-7-native/`.
- Accepted authority path: platform-owned acknowledgement-only unknown-home initialization and
  rights-filtered/reverified C9 source discovery; native explicit C6/C8/C9 proposal review,
  correction and discrepancy decisions; exact C5 preview/confirmation/commit; matching persisted
  C10 success; fresh C14.5 revalidation and entry into the existing C11-C14 design loop.
- Recovery/isolation acceptance: project and role changes, branch changes, cancellation, stale
  responses, offline/relaunch and cold recovery discard mutation intent and cannot grant authority.
  C8 appearance remains non-dimensional and no proposal/source/decision is silently selected.
- Gate summary: focused contract/platform/web/integration selections passed; live repository
  PostgreSQL C4-C10 passed 18 tests; `test:contract`, `test:integration`, 921 security tests, full
  `pnpm verify`, C14/API/boundary checks and generated-client drift passed; 183 native unit tests
  passed; C14.7 UI passed 3/3 on both iPhone Air and iPad Pro 13-inch (M5) Simulators; affected
  C14.5/C14.6 UI regressions passed; XcodeGen was byte-stable; Debug/Release Simulator, unsigned
  physical-target Release compilation, Release analysis and release-fixture exclusion passed.
- Host/provider truth: `supabase start` was unavailable because repository PostgreSQL already held
  the configured port; the live repository database was used and retained. No production identity,
  property, C6/C8/C9, CUDA, deployment or render provider was configured or accepted.
- Explicitly not accepted or claimed: physical-device/camera/background transfer/RoomPlan/LiDAR,
  representative-home, production provider or real CUDA/C8/C9 execution, render hardware,
  structural/regulatory/cost/availability/professional certainty or C15.

### Independent PR review — 2026-08-26

- Frozen review input: PR #10 head `058bf45cb1ddc2659c1b660e9425c4f1e14032a5` against exact
  base `f97f61dc0139dc68fd47469bc700e84313ae9764`.
- Runtime: primary `gpt-5.6-sol` / `xhigh` reviewer; one Luna/medium read-only evidence mapper for
  native invalidation/Release-fixture evidence; one Terra/high read-only contract reviewer for the
  authority chain and bounded arithmetic. Both were context-minimal and shared-checkout only. No
  separate task or worktree was created; Sol retained materiality, corrections and final gates.
- Material corrections: deterministic retry-stable operation/claim identity and frozen retry body;
  bounded coordinate/calibration/fusion arithmetic; explicit job selection; cancellation-safe
  compile polling; pending-key invalidation on project/sign-out/reset/role downgrade; exact C10
  snapshot pins; calibration/proposal identity checks; and dependency-consistent C5 operations that
  cannot silently mix corrected and accepted host/boundary geometry.
- Local review gates: full repository verify, contract, integration, security, C14, API and boundary
  gates passed; generated clients had no drift; focused C14.7 native unit tests passed 10/10; final-
  code C14.7 UI passed 3/3 on iPhone 17 Pro Max and the adaptive-layout test passed on iPad (A16);
  Release Simulator and unsigned physical-target builds, Release analysis and exact fixture-
  exclusion scan passed.
- Merge rule: all four named GitHub `ci.yml` checks must succeed on the exact final PR head; earlier
  green runs do not transfer. Only then may PR #10 merge and disposable branch resources be removed.

## C14.8 — Device-neutral mobile capture foundation

### Activation and contract freeze — 2026-08-26

- Authority: user instruction dated 2026-08-26 to build one cohesive camera-first/LiDAR-optional
  mobile capture checkpoint, one branch and one non-draft PR from latest clean `origin/main`, without
  merging it.
- Immutable predecessor: `f41123f75bad8f70770a499a78638f2f1fb06d84`; `origin/main` was fetched
  before branch creation and matched exactly. The user-owned root `AGENTS.md` modification remains
  present, untouched and excluded from all checkpoint commits.
- Integration branch: `codex/c14-8-device-neutral-mobile-capture`.
- Runtime/ownership: one primary `gpt-5.6-sol` / `xhigh` session is the sole implementation writer
  and completion authority. Two early read-only audit processes were stopped immediately when the
  user refined the protocol; they produced no accepted evidence or implementation. No worktree,
  separate task or parallel implementation lane exists. At most one Terra/high same-checkout,
  read-only final audit is permitted on an exact frozen head if materially useful.
- Audit result: C7 is RoomPlan/LiDAR-specific and deliberately retains no camera frames; C8 already
  provides immutable C2 RGB media but lacks synchronized ARKit camera evidence and uses synthetic
  viewpoint advancement; C14.7 already consumes C8 only as proposal state. The smallest coherent
  boundary keeps C2 RGB assets, extends C7 transport only for optional depth, adds immutable
  `capture-envelope-v1`, and explicitly creates the existing C8 job only after server revalidation.
- Frozen contract: `docs/orchestration/checkpoints/C14_8_DEVICE_NEUTRAL_MOBILE_CAPTURE_CONTRACT.md`.
  Migration allocation is `0015_device_neutral_capture_envelopes.sql`. Existing C4-C10 authority,
  C7 RoomPlan proposal conversion and C8 production adapter selection remain unchanged.
- Initial claim boundary: software and Simulator evidence only unless an authorised physical device
  is actually connected and usable. No physical camera/ARKit/depth/RoomPlan, representative-home,
  production reconstruction, Windows/RTX 5080, provider, structural, regulatory, cost or
  professional acceptance is inferred from fixtures or compilation.

### Independent final review and software PR — 2026-08-27

- Status: non-draft PR [#11](https://github.com/AbhinavGupta707/Interior-Design/pull/11) is open as
  the single C14.8 integration vehicle. It is not merged, and no later checkpoint is open.
- Frozen review input: `179336aa123e9285c770c212579c6f22902eceb2` against exact base
  `f41123f75bad8f70770a499a78638f2f1fb06d84`. One permitted Terra/high same-checkout reviewer was
  read-only and inspected contract, privacy/consent, authorization, immutable evidence, optional
  depth/RoomPlan binding, state isolation, Release fixtures and evidence claims. Sol/xhigh retained
  sole implementation, materiality, correction and completion authority.
- Review outcome: one material operational finding. `0015_device_neutral_capture_envelopes` was
  required by composed readiness but absent from the established documented C7 admin lifecycle.
  Correction `581c3580699f74d1150192c43384c785244975e0` adds an explicit ordered composed command,
  applies `0007` and `0015` atomically after the separate C8 prerequisite, updates both platform and
  physical-device runbooks, and tests the lifecycle. No other material finding remained.
- Software gates: full repository verification passed all 24 JavaScript/TypeScript tasks plus
  Ruff/mypy and Python 157/2 optional-runtime skips; platform contract tests passed 264 with 52
  unavailable-service skips; spatial contracts passed 150 with 3 skips; authorization passed 921;
  API seams passed 21; dependency boundaries passed 3; generated clients were byte-stable. The
  final native source passed 196 logical tests/203 invocations, the guided Simulator UI passed 1/1,
  and Simulator Release, unsigned generic-iOS Release, Release analysis and fixture exclusion
  passed.
- Hardware/provider truth: final device inventory contained only the Mac and iOS 26.4 Simulators.
  Physical camera/ARKit/depth/RoomPlan and the Windows/RTX 5080 candidate benchmark remain `NOT RUN`.
  Live C14.8 PostgreSQL remained unavailable locally and is an explicit physical/software handoff
  gate; no experimental reconstruction candidate entered production.
- Final synchronization rule: all four named GitHub `ci.yml` jobs must succeed on the exact final
  closeout head before the checkpoint may be reported complete. Earlier green checks do not
  transfer. PR #11 must not be merged by this session.
- The user-owned root `AGENTS.md` modification remains present, untouched and excluded from every
  checkpoint commit.

### Independent merge review — 2026-08-27

- Authority: the user's later instruction supersedes only the earlier leave-unmerged disposition.
  Primary `gpt-5.6-sol` / `xhigh` owns materiality, corrections, final verification, merge and
  cleanup. The exact frozen input was PR #11 head
  `91581c3d7e90850e0cc5a7d752359639b0ff0fc5` against base
  `f41123f75bad8f70770a499a78638f2f1fb06d84`. No worktree or separate task was used.
- Delegation gate: one context-minimal Terra/high same-checkout read-only audit inspected only the
  native C14.8 diff and relevant tests. It made no edit, ran only `git diff --check`, and reported no
  confirmed material native defect. Sol independently inspected the highest-risk native, contract,
  persistence, rights, replay, C8-proposal, migration and evidence paths.
- Correction `dcf1b4f` closes three material defects: the mandatory RGB-keyframe capability must
  match a retained keyframe source; acceptance replay must revalidate current rights and source
  visibility; and an existing linked C8 job cannot silently replay a changed reconstruction
  appearance request. No canonical, operation, fusion, scene, design or render authority changed.
- Disposable PostgreSQL 16.14 under `/private/tmp/interior-design-pr11-pg.gO0yZE` closed the prior
  live-database gap. A brand-new applicable C1-C8 plus `0015` database passed 2/2 C14.8 cases with
  real accepted-envelope persistence, append-only enforcement, current-rights replay denial,
  viewer-mutation denial, owner attribution, same-tenant viewer read, foreign-tenant hiding and zero
  canonical snapshots for the tested projects. A second database applied exact-base migrations
  `0001`-`0014`, upgraded via `migrate-c14-8` to all `0001`-`0015` markers and passed an idempotent
  lifecycle rerun. Docker/Supabase's earlier `EOF` is historical, not a remaining gate.
- Final local regression before evidence closeout: `pnpm verify` passed all 24 lint, typecheck and
  build tasks, shared contracts 93/93, platform 264 plus the separate live 2/2, spatial 150/3
  optional-runtime skips, Python 157/2 skips, authorization 921/921, C14, API 21/21 and dependency
  boundary 3/3 gates. XcodeGen remained byte-stable at
  `6ef49f967fd7de51b5b35da57461b90ac9914031c0fc7352cfd4121cd927914a`; the complete native unit
  target re-passed 196 logical tests / 203 device invocations, and unsigned Release Simulator plus
  generic-iOS products contained none of the C14.8 fixture scenario/view/engine/key/text.
- Merge rule: the final evidence commit becomes the reviewed PR head. All four named GitHub
  `ci.yml` checks must be successful on that exact SHA before normal merge. Earlier green checks do
  not transfer. After merge, synchronize clean `main`, preserve the user-owned `AGENTS.md` change
  and remove only disposable review infrastructure and merged branch refs.
- Still outside review: no physical Apple-device camera, RGB delivery, ARKit pose/intrinsics,
  interruption/background/relaunch, scene depth, RoomPlan, thermal, accessibility or
  representative-home acceptance; no Windows/RTX 5080 candidate run or production promotion.

## C14.9 — Capture Envelope export and software benchmark

### Activation and contract freeze — 2026-08-27

- Authority: user instruction dated 2026-08-27 after normal merge of corrected PR #11 at
  `9009e0444c8ea15ae2f7f2bb7abc82b338955165`.
- Frozen base: clean synchronized `origin/main` at that exact commit.
- Integration branch: `codex/c14-9-capture-benchmark`.
- Runtime/ownership: one primary `gpt-5.6-sol` / `xhigh` session; no subagent, implementation lane,
  separate task or worktree. One non-draft PR will be opened and left unmerged.
- Contract: `docs/orchestration/checkpoints/C14_9_CAPTURE_ENVELOPE_BENCHMARK_CONTRACT.md`.
- Boundary: additive owner/editor-only C7 raw-artifact export access and package metadata read;
  secure exporter/verifier; deterministic selection, baseline adapters, quarantined experimental
  registry, common metrics/repeatability/resources and offline non-production routing evaluator.
  No migration, root lock, generated client, native, canonical, production C8 or C9 change.
- Candidate licence truth: VGGT is registered but blocked on agreement and a visible exact weight
  hash; MASt3R is CC BY-NC-SA 4.0 evaluation-only; Video Depth Anything Small is Apache-2.0 and its
  actual weight-bearing revision is `273d090f2ce17df50c2872d82c8322c45da5b4dd`.
- Initial claim boundary: software and synthetic/public fixture executability only. No real Capture
  Envelope, physical Apple-device, representative-home, physical accuracy, production promotion or
  canonical mutation is accepted or claimed.

### Independent review, correction and RTX closeout - 2026-08-27

- Review authority: user instruction to review PR #12 at exact original head
  `5c8b38626d263cec38068ba59dbd2686974caf00` against merged C14.8
  `9009e0444c8ea15ae2f7f2bb7abc82b338955165`, complete the correction, require all four named
  exact-head checks, merge normally, synchronize main and remove only disposable PR resources.
- Review runtime/ownership: one `gpt-5.6-sol` / `xhigh` primary session in the authoritative WSL
  checkout; no worktree, subagent, separate task or parallel implementation lane.
- Original commits: `224ce5a` contract, `19583c2` implementation and `5c8b386` evidence.
  Independent material correction commit:
  `8d7ad379ae6def20f6fd95d4455f74bce8623708`.
- Corrected platform boundary: owner/editor-only `capture:artifact:export`; package reads and
  artifact signing are tenant/project scoped and fail closed on current rights/state. Cross-session
  RoomPlan access locks and revalidates the actual source session before proving exact accepted
  envelope/package/manifest/artifact hashes. Audit metadata contains neither URL nor object key.
  No migration, generated client, root lock, canonical mutation, C8 production or C9 change.
- Corrected evaluation boundary: HTTPS/no-redirect/no-disclosure exporter; private canonical
  hard-link/symlink/special-file/schema/hash/source-binding verifier; recomputed keyframe-only
  per-segment/cohort selection; explicit ARKit camera-to-world to OpenCV/COLMAP world-to-camera
  convention conversion; exact depth denominators; same-model COLMAP camera/image/point gsplat
  input; strict 16-run/failure/resource collector; fail-closed exact-clean experimental gates; and
  an isolated fixed-geometry C14.9 gsplat entrypoint that preserves the accepted C8 backward/Adam
  trainer while removing CUDA backward from the C14.9 repeatability path.
- Reported lint finding: exact
  `corepack pnpm --filter @interior-design/platform-api lint` passes on both base and original
  head. `services/platform-api/src/modules/render-stills/authorities.ts:239` is unchanged and
  predates C14.9, but there is no reproducible failure to classify as inherited. It was not edited.
- Independently rebuilt images: COLMAP
  `sha256:1c40cdfda95d53c8ea28e795060359ba0ed9e2288cd1d8fa48a9c554d7a97a14`, Open3D
  `sha256:264a375b0a0a2be25fdf62a314cd8f48bf4bae83c646eb7b99d8d8ba22539cdc`, gsplat
  `sha256:fa3da4146f2931ae380e578028e97fbde99bd8aea6d54c3a5381b56a88aa9f6a`. Host:
  RTX 5080, driver 595.79, compute 12.0, 17,094,934,528 bytes; Docker 29.5.3; WSL kernel
  `6.6.87.2-microsoft-standard-WSL2`.
- Corrected fixture authority: envelope
  `f7c851e9a52f392a104386624c67c81ea2fe26806b6ed2d81b86009447ed0ea7`, selection
  `2973570b705c1b97e2dd0d906bc018cb4f9bf0e50bb57f9eddcc18ca8d931b48`, policy
  `3725095a6aaad5967bcaa9e52b406fdac5b2bb41567f2dee17aab1eb20a7512c`, host inventory
  `5e23cb2b9a841b463f152ad48922a2e7907f99030af19bfc59c9d9efd2d1acb6`, strict common record
  `b35f5e9018271bd9fd46a1fee72c0f3655624ef5b7d4812f98b332fa87a42fd5`.
- Common-record result: 8 selected candidate/cohort scopes, 16/16 fresh runs, 6 typed experimental
  abstentions, zero missing/partial/failed/isolation/resource violations and all 8 repeatability
  scopes passed. Normal/inclusive COLMAP registered 9/9 and 10/10; corrected ARKit-prior ran twice
  in both cohorts; Open3D exact depth bound 9/9 and 10/10 with zero non-finite values. The isolated
  C14.9 gsplat adapter produced exact two-run PSNR and PLY equality in both cohorts: 5.571419496 dB /
  `47de64ba8cf6367b4f94fe78edf72c23f5ca7779284e0a7997e02eb4d7ba9619` normal and
  5.603565881 dB / `2a1e4ac384f62cbe4def8b62a9a744618749104ed049b599664cc8889c438151`
  inclusive. Its lower fixed-geometry PSNR has no quality or accuracy verdict. The earlier 0.01258
  dB author failure and independently reproduced 0.013296, 0.018874 and 0.014199 dB gradient-path
  failures are reported outside the selected final denominator; none changed the 0.01 dB threshold.
- Experimental freeze remains: VGGT agreement/visible-weight-hash blocked; MASt3R
  CC BY-NC-SA 4.0 evaluation-only and lock/image blocked; Video Depth Anything Small Apache-2.0,
  pickle-isolated and lock/image blocked. No candidate dependency/image/runtime/output was
  installed, run or promoted.
- Pre-push correction gates: platform lint/typecheck; 9 focused capture routes; 10 benchmark and
  adversarial-verifier tests; Ruff/mypy; package-manifest coverage; focused formatting; and the
  complete isolated RTX matrix above. Full `corepack pnpm verify` passed formatting, 24/24 lint,
  24/24 typecheck, 45/45 unit-test tasks, 24/24 builds, Ruff and mypy across 114 Python source files,
  and 157 passed / 2 skipped Python tests. All four named exact-head GitHub checks remain mandatory
  before merge.
- Durable evidence:
  `docs/evaluation/reconstruction/C14_9_CAPTURE_BENCHMARK_SOFTWARE_ACCEPTANCE_2026-08-27.md`;
  physical handoff:
  `docs/runbooks/development/C14_9_CAPTURE_ENVELOPE_BENCHMARK.md`.
- Still `NOT RUN` / prohibited: a real accepted physical Capture Envelope and private transfer,
  physical device/intrinsics/orientation/pose/depth/RoomPlan review, representative or physical
  accuracy, production routing/promotion and canonical dimensional mutation. The first physical run
  requires current tenant/project/actor rights on the envelope and every RoomPlan source, both
  cohorts for every independent segment, two fresh runs for every selected candidate, retained
  failure/resource evidence and separately rights-cleared ground truth for any accuracy claim.

## C14.8 physical non-LiDAR acceptance follow-up — 2026-08-27

- Authority: the user's physical-device instruction after C14.9 merged. The repository was
  synchronized to clean `origin/main` at
  `da017f6259cada36a59a6b906459c6514386c279`; branch
  `codex/c14-8-physical-device-acceptance` preserves the user-owned root `AGENTS.md` modification
  exactly and excludes it from every commit. One `gpt-5.6-sol` / `high` primary owns planning,
  implementation, physical guidance, final verification and closeout; no subagent, worktree task or
  implementation lane was used. Disposable clean Git worktrees were used only by the official
  exporter to satisfy its exact-source check.
- Independent PR review authority: a separate `gpt-5.6-sol` / `xhigh` primary froze exact original
  PR head `0ef5955f01bcc49c372fce02314dc4602e832053` against exact base
  `da017f6259cada36a59a6b906459c6514386c279`. One bounded same-checkout Terra/high reviewer worked
  read-only; no separate task or worktree was created. Sol independently validated its finding,
  made the sole source correction in `62a1fc26cd0581e7edd6d59824c3b7ee5d012d25`, and retained final
  verification, merge and cleanup authority.
- Integration vehicle: non-draft PR
  [#13](https://github.com/AbhinavGupta707/Interior-Design/pull/13) targets `main`. It may merge
  normally only after every named GitHub check passes on its exact final reviewed head; green checks
  from `0ef5955f01bcc49c372fce02314dc4602e832053` do not transfer to the corrected head.
- Signing/privacy boundary: one iPhone 12 on iOS 26.6 was temporarily development-signed and
  installed with the user's Personal Team. Account, team, device, provisioning, credential,
  endpoint and machine-specific Xcode values remain outside Git. A disposable private CA, local
  API/database/object storage/worker and LAN TLS gateway were used. Raw room media, source UUIDs,
  signed URLs, bearer credentials, alias salt and the private transfer path remain outside Git,
  GitHub, committed evidence and screenshots.
- Physical truth: one studio room, 26 retained RGB keyframes and 26 exact ARKit camera samples,
  native-raster pinhole intrinsics, camera-to-world poses, two explicitly independent coordinate
  segments and one safe interruption/recovery. Accepted coverage is 22 observed, one occluded and
  one missing of 24 cells. Runtime is `physical-device`; quality tier is `guided-rgb`; all retained
  tracking is normal. Scene depth and RoomPlan capability are false and there are zero depth and
  RoomPlan sources. This is not LiDAR, depth or RoomPlan evidence.
- Acceptance authority: canonical Capture Envelope SHA-256
  `093e9f6259429ab28281ba60032fd6b3592f299eb90b4353103ffe7c11c48cd9`; protected-journal SHA-256
  `a7c64f6c37282026ea87587ded6a07bed8a56de7c626e5dd09687b914711e722`; installed corrected app
  code SHA-256 `8858aa94d927deaede58b4d0a0e05913113d54a975a6d6f1c0e0ca5ac9183990`.
  All 26 immutable C2 sources completed checksum-bound resumable transfer and exact server
  acceptance under current owner rights, service processing granted and training denied.
- Proposal-only truth: the explicit C8 action queued one authenticated reconstruction proposal.
  After the worker lease heartbeat kept attempt 2 fenced throughout media preparation, it terminated
  with immutable typed abstention `RECONSTRUCTION_PRIVACY_REVIEW_REQUIRED`. No geometry, appearance,
  C4/C5 operation, canonical snapshot, dimension or production authority was published.
- Same-checkpoint corrections: development Info override naming; frozen capture timeline retry;
  microsecond wire canonicalisation; UUID casing at native/contract/route boundaries; protected
  journal persistence; app-container re-homing; exact asset reconciliation; background upload races;
  bounded fresh signed-part URLs; FFmpeg discovery timeout; reconstruction heartbeat/fencing; C14.9
  optional room `story`; expiring export-access replay; and a brittle C14.6 Simulator switch hit
  target. Source heads are `7e5c6b58c31922708bd8c3814cd4a095f2fdfde8`,
  `5ff39f122d1329347173c3e95245715a154e380b` and package-integrity head
  `b89d6e24df1270c44acecc830cfc6a278021d137`; no migration, production-signing, TLS,
  authorization, consent-default, canonical or production-routing boundary was weakened.
- Independent-review correction: background sessions requested system relaunch events but had no
  application lifecycle completion bridge and retained task context only in memory. The correction
  adds an app-owned C2/C7 coordinator, fixed session identities, protected and bounded non-secret
  task/completion recovery, and safe relaunch reattachment. Only 2xx results with a bounded valid
  ETag are recoverable; expired/403 authority is discarded. Tests use separate recovery-store
  instances to represent process relaunch and prove that signed/fresh URLs and authorization data
  are absent from durable state.
- Physical-evidence decision: no recapture was required because the review correction does not
  change captured bytes, request bytes/headers, multipart identity, server authorization or
  validation, canonical envelope bytes, the accepted envelope hash or export-manifest hash. The
  recorded app hash remains the binary actually used for the accepted physical journey. Background
  process termination/relaunch is post-capture software evidence only and remains outside the
  physical matrix.
- Verification: complete `pnpm verify` passed formatting, 24/24 lint, 24/24 typecheck, 45/45 unit
  tasks and 24/24 builds; contracts 95/95, platform 266 with 53 optional-service skips and spatial
  worker 153 with 3 optional-runtime skips; Ruff/mypy passed and Python passed 157/2 skips. The
  focused C14.9 evaluator suite passes 9/9. Native unit evidence remains 196 logical tests / 203
  invocations; the final corrected native UI source passes 32/32 on the iPhone 17 Pro Max
  Simulator, iOS 26.4, with zero failures or skips.
- Post-review native verification: the complete unit target passes 209 tests (104 XCTest plus 105
  Swift Testing) with zero failures; focused relaunch recovery passes after the final lifecycle and
  protection adjustment; XcodeGen is byte-stable at
  `48e49c6693020cd1518cec9d03ef1f0a0dae9111fd88266b34af34a557ae9f4c`; and the unsigned generic-iOS
  Release build and Release analysis pass. Repository-wide exact-head truth remains delegated to
  the four required GitHub checks before merge.
- Private C14.9 handoff: the official exporter reauthorized and downloaded all 26 originals from an
  exact clean source checkout, then passed offline verification. Export-manifest SHA-256 is
  `e3aeaed3925640c25f35e252f84b358efdcbdc424ff39cef781a69416504db74`. The private transfer root is
  intentionally reported only to the user. Windows/RTX 5080 candidate execution remains `NOT RUN`;
  begin it only after this correction PR merges, Windows synchronizes to the exact merged head and
  the runbook's disk/RAM/VRAM/image/right checks pass.
- Private-package protection review: before repository review, the complete authoritative export
  was copied to durable local non-cloud private storage without deleting the source. The official
  head-matched offline verifier passed the durable copy at Capture Envelope SHA-256
  `093e9f6259429ab28281ba60032fd6b3592f299eb90b4353103ffe7c11c48cd9` and the manifest hash above.
  It contains exactly 28 protected regular files, no links and no special files; the authoritative
  source was retained unchanged. Neither private location is recorded in Git or shared output, and
  neither copy is a disposable PR resource.
- Residual limits: one room/device only; one missing and one occluded coverage cell; independent
  segments not registered; no survey scale, physical dimensions, ground truth, accuracy,
  deny/grant/offline/process-termination/role-withdrawal/storage/thermal/accessibility matrix,
  second journey or Windows resource/repeatability metrics. Structural, regulatory, cost,
  availability and professional certainty remain unclaimed.

## C14.9 physical Capture Envelope non-accuracy benchmark - 2026-08-28

- Authority: user instruction after reviewed PR #13 merged at
  `30b0417eb2249038f8f686a5337fdca0d47e3028`, with reviewed source
  `5254049964c0b226fef820d84de590266a4bf863`. One `gpt-5.6-sol` / `high` primary session used the
  authoritative WSL checkout and one sequential private-data/GPU lane; no subagent or worktree.
- Transfer/privacy: the complete export moved Mac-to-WSL-ext4 over fingerprint-pinned encrypted
  SSH. Temporary Remote Login was disabled and the LAN port closed after verification. The export
  has exactly 28 mode-`0600` regular files and four mode-`0700` directories, with no links or
  special files. Raw media, geometry, logs, identifiers and private paths remain outside Git,
  GitHub, CI and Windows-mounted storage.
- Private authority: the pre-authorized envelope/manifest and frozen selection, policy,
  corrected-host-inventory and final-strict-record digests were reverified after cleanup. The
  envelope and manifest evidence identifiers were already committed by the reviewed C14.8 handoff;
  the latter four values, raw authority, source identifiers and private paths remain only in
  restrictive WSL evidence.
- Host/images: RTX 5080, driver 595.79, compute 12.0, 16,303 MiB VRAM; Docker 29.5.3; WSL kernel
  `6.6.87.2-microsoft-standard-WSL2`. Exact images are COLMAP
  `sha256:68be6852c13de3573a79fb049ee2116937ba424cbd29b56583dc6a58617364f6`, Open3D
  `sha256:141f6039bd347a21728df4c72c28c255b91bd8d7acf833d557027f0f21b2114f`, and corrected gsplat
  `sha256:93add58cb6b3ee7df927a47e98af0ed1d7d9fbac8607edea6de92d96a14e70d0`.
- Matrix: 6 selected scopes, 22 typed abstained scopes, 12/12 supplied fresh runs, zero
  missing/partial/failed/isolation/resource violations and six passing repeatability scopes.
  Unconstrained COLMAP repeats exactly at 20/25 registered, 6,706 points and 1.003727 px;
  ARKit-prior repeats exactly at 25/25, 7,370 points and 1.637097 px; fixed-geometry gsplat repeats
  exactly at 5.841315879702146 dB held-out PSNR. Visual coherence has no quality floor.
- Abstentions: the one-view interrupted segment remained independent and ineligible. Exact bound
  depth is absent, so Open3D abstained in all four segment/cohort scopes. RoomPlan is absent. VGGT,
  MASt3R and Video Depth Anything remained blocked at frozen licence/weight/source/lock/image gates;
  no experimental package ran.
- Resources: maximum observed run values were 4,488,240,824 bytes host/container memory,
  1,292,894,208 bytes task VRAM, 1,833,271,566 bytes scratch and 1,560.368453 seconds. No baseline
  ceiling was exceeded.
- Recoverable correction: the runbook's `/c14/export` container alias conflicted with the physical
  root-name verifier. The narrow explicit-alias correction plus regression test is frozen at
  `0fb9943b18856e8719d595cea3ac1cd092c0e18b`; default verification remains strict. The corrected
  gsplat image was rebuilt before affected reruns. Because unconstrained COLMAP covered only 20/25
  selected images, final gsplat runs used each corresponding same-run 25/25 ARKit-prior model;
  validation was not weakened and no run/cohort/segment was mixed. Four original alias failures
  and four superseded model-completeness failures remain retained outside the final denominator.
- Verdict: runtime `pass`. The immutable machine record retains physical compatibility
  `requires-review`; independent review accepts only this one envelope's export, isolated runtime
  and repeatability evidence. Dimensional accuracy is `NOT RUN`, representative accuracy is
  `NOT RUN` and production promotion is prohibited. Durable redacted
  evidence is
  `docs/evaluation/reconstruction/C14_9_CAPTURE_BENCHMARK_PHYSICAL_NON_ACCURACY_2026-08-28.md`.
- Independent PR review inspected the retained private authority and outputs without publishing
  them. It accepts only the one-envelope runtime/repeatability result. The reconstruction is sparse,
  fragmented, not established as a recognisable complete room, incomplete and unsuitable for
  consumer digital-twin presentation or routing. Visual quality did not pass and no quality floor,
  accuracy, completeness or production claim is created from the runtime pass.

## C14.9 PR #14 independent review closeout - 2026-08-28

- Authority: exact submitted head `80d859860641fdb8f900a60e5a8c01b5a9ef748b` against exact base
  `30b0417eb2249038f8f686a5337fdca0d47e3028`, reviewed in the single authoritative checkout. One
  `gpt-5.6-sol` / `xhigh` primary retained correction, verification, merge and cleanup authority;
  one bounded read-only `gpt-5.6-terra` / `high` correctness reviewer was used, with no task or worktree.
- Corrections: commit `7663ef5eaa92c2b90885474c71c887078ce11fb0` fixes the gsplat image
  digest, failure denominators, privacy wording, stale execution-plan state and the missing explicit
  visual-quality/consumer-digital-twin verdict without changing runtime acceptance.
- Local gates: 14 focused Python evidence tests passed; complete `pnpm verify` passed all JavaScript
  quality/build tasks plus Ruff, mypy and 157 Python tests with two expected skips; Prettier and
  `git diff --check` passed. Normal merge remains gated on all four named GitHub checks on the final
  reviewed SHA.

## C14.10 — Native capture quality and resilience

### Activation and contract freeze — 2026-08-28

- Authority: user instruction to synchronize the Mac checkout to clean `origin/main`, preserve the
  existing user-owned root `AGENTS.md` change untouched, use one `gpt-5.6-sol` / `xhigh` session and
  open one cohesive native capture-quality/resilience checkpoint without subagents or worktrees.
- Synchronization: fetched `origin/main` and fast-forwarded local `main` to exact
  `97352b7027476aa48461aea3788d1e02d3268b56`. The root `AGENTS.md` SHA-256 remained byte-identical
  at `6a8dd3f230ce5f9bab435e4ac242467597f2e861ff5ff71f94852e5cc21f9533` and stays excluded from every
  checkpoint commit.
- Integration branch: `codex/c14-10-native-capture-quality-resilience`.
- Runtime/ownership: one primary `gpt-5.6-sol` / `xhigh` session owns contract freeze, native/shared
  implementation, fault injection, verification, evidence and PR closeout. No subagent, worktree,
  separate task or parallel lane is authorised.
- Frozen contract:
  `docs/orchestration/checkpoints/C14_10_NATIVE_CAPTURE_QUALITY_RESILIENCE_CONTRACT.md`.
- Material basis: C14.8 physically accepted 26 RGB/ARKit keyframes and 22/24 observed grid cells,
  but C14.9 registered only 20/25 unconstrained views and found the retained reconstruction sparse,
  fragmented and unsuitable for consumer presentation. Direction/height coverage is therefore
  demoted to secondary guidance; connected spatial evidence drives readiness.
- Contract/migration boundary: additive backward-compatible `capture-envelope-v1` quality fields and
  shared language-neutral fixtures only. No migration, OpenAPI/generated client, root manifest or
  lockfile, platform authority, canonical, C8 production, C9 or reconstruction-promotion change.
- Initial claim boundary: software/Simulator policy and state evidence only. Physical process faults,
  thermal/storage behavior, camera/ARKit, depth, LiDAR, RoomPlan, dimensions, representative-home
  accuracy and reconstruction visual quality remain `NOT RUN` until the recorded physical handoff.

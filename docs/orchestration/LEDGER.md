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

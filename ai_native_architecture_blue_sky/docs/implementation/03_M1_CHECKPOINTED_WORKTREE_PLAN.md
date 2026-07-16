# Archived Foundation-Only M1 Worktree Plan

> **Status: superseded on 2026-07-17.** The user expanded M1 to include native iOS capture, photo/video reconstruction, autonomous multi-source full-house fusion, an interior-design agency workflow, design variants, photoreal stills, authoritative and AI-enhanced video, decision tools and implementation handoff. The single active plan is `08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`. This file is preserved only as historical rationale for the narrower trust-kernel plan and must not be used to launch new worktrees.

## 1. Purpose

This is the execution plan for M1: Property + Evidence + Canonical Model + Deterministic Walkthrough. It follows a sequential-checkpoint, parallel-lane orchestration model:

- a checkpoint is a verifiable product outcome, not a component milestone;
- the orchestrator freezes shared contracts and file boundaries before spawning workers;
- two to four Codex worktree tasks implement independent lanes in parallel;
- one worker exclusively owns every editable file during the checkpoint;
- the orchestrator merges in dependency order, reviews the combined system and patches integration gaps in the master session; and
- no later checkpoint starts until the current checkpoint is merged, tested and documented.

This document plans the worktree sessions. It does not authorise starting them before the repository and P0 decisions exist. It defines **one M1 implementation programme with eleven sequential implementation checkpoints, C0 through C10 inclusive**. D0 is a separate non-code validation gate, not a twelfth checkpoint.

## 2. Current baseline and activation constraint

At the latest verification point:

- `/Users/abhinavgupta/Desktop/Interior Design` is not a Git repository;
- `ai_native_architecture_blue_sky` is a directory of Markdown/JSON research material, not a ZIP and not a codebase;
- the empty remote `https://github.com/AbhinavGupta707/Interior-Design.git` exists, but neither candidate local root has been initialised or linked;
- no branch, commit, project registration or worktree exists; and
- the corpus must be preserved as user-owned source material.

Therefore **C0A Repository Activation is master-only**. Worktrees cannot be created safely from a directory without a committed base.

## 3. Orchestrator protocol

### 3.1 Baseline inspection before every checkpoint

Run and record:

```bash
git status --short --branch
git branch --show-current
git log --oneline --decorate -5
git worktree list --porcelain
```

Also record:

- baseline commit SHA;
- unresolved working-tree changes and owner;
- current checkpoint acceptance state;
- running project-scoped worktree task IDs;
- branch/path/base SHA for each lane; and
- relevant tool/runtime versions.

Never discard or overwrite unrelated user changes. If an overlapping dirty file cannot be assigned safely, stop that lane and resolve ownership with the user.

### 3.2 Project-scoped worktree creation

After C0A:

1. discover/confirm the repository as a Codex project;
2. create a dedicated Codex worktree task for each approved lane using the project-scoped thread/worktree workflow;
3. record returned thread/client-thread ID, branch, worktree path and base SHA in the master-owned ledger;
4. send the exact lane prompt and contract version;
5. monitor by task state and final evidence rather than continuously editing worker trees; and
6. merge only completed, reviewed branches.

Do not substitute hidden subagents, manually created anonymous worktree directories or several workers editing the primary checkout. If the required project/thread worktree capability is unavailable, diagnose registration/discovery/activation first and pause parallel execution rather than improvising a conflicting workflow.

### 3.3 Master-owned files

No worker may edit these unless a checkpoint explicitly transfers a single named file to one lane:

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
turbo.json
tsconfig*.json
.nvmrc / .node-version / tool version files
pyproject.toml / uv.lock at repository root
.github/**
.codex/**
AGENTS.md
CODEOWNERS
infrastructure/environments/** shared environment compositions
packages/api-contracts/openapi/**
packages/api-contracts/generated/**
services/platform-api/migrations/_registry.*
docs/adr/accepted/**
docs/orchestration/**
CHANGELOG.md / release manifests
```

The orchestrator also owns dependency additions. Workers submit an exact dependency request with reason, version/range and affected package; the orchestrator applies and commits manifests/lockfile before or between lane merges.

### 3.4 Shared-contract freeze

Before spawning each checkpoint, the orchestrator commits a small integration prelude containing:

- accepted requirement IDs and acceptance cases;
- OpenAPI/schema changes and regenerated clients;
- package skeletons and imports;
- exact migration filenames/sequence allocated to a single producer lane;
- job/event/tool schema versions;
- test fixtures/interfaces needed by multiple lanes;
- dependency/lockfile updates; and
- feature flags disabled by default.

Workers do not revise that contract. A discovered change becomes a written contract-change request. The orchestrator either:

- patches/finalises it before workers continue;
- defers it to the next checkpoint; or
- stops and respawns affected lanes from a new base if the change invalidates parallel work.

### 3.5 Worker prompt contract

Every lane prompt contains:

```text
Checkpoint and lane:
Product outcome:
Base commit and contract version:
Owned paths (exclusive):
Allowed read-only dependencies:
Forbidden/shared paths:
Required interfaces/fixtures:
Implementation tasks:
Acceptance requirements:
Verification commands:
Required final evidence:
Known non-goals:
Escalation rule for shared changes:
```

The worker must return:

- concise implementation summary;
- changed-file list;
- tests/commands and results;
- screenshots/artifacts only where the lane requires them;
- assumptions, limitations and follow-ups;
- commit SHA(s); and
- explicit confirmation that forbidden files were untouched.

### 3.6 Integration and merge order

Default dependency order:

1. schema/persistence/domain producer;
2. policy/backend/worker consumers;
3. frontend consumers;
4. QA/docs/evaluation consumers; and
5. master integration fixes, generated artifacts, lockfile/CI and release evidence.

For every branch the orchestrator:

1. checks the branch base and commit history;
2. inspects `git diff --stat` and full diff against the recorded base;
3. rejects edits outside ownership before merge;
4. runs lane verification on the branch if needed;
5. merges non-interactively into the primary branch;
6. runs the combined checkpoint suite;
7. reviews security, data semantics, failure paths and UX across lane seams;
8. updates ADRs/ledger/release notes in the primary checkout; and
9. closes/archives worktree tasks only after evidence is retained.

If a merge exposes a contract gap, the orchestrator patches it in the master session. Do not ask one worker to take over another worker's files late in the checkpoint.

### 3.7 Standard quality commands

C0 establishes stable scripts; later checkpoints should use these names:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:geometry
pnpm test:security
pnpm test:e2e
pnpm build
pnpm api:check
pnpm dependency:boundaries
uv run ruff check .
uv run mypy .
uv run pytest
```

Not every lane runs every command, but the integrated checkpoint does. Commands that need services use a documented local stack and deterministic fixtures.

### 3.8 Predefined adaptive lane allocation

Lane count follows dependency and file ownership, not a fixed template. The planned count is frozen with the checkpoint contract. It may change only before workers launch, or after all affected workers are stopped and a written replan records the new boundaries; the orchestrator must never add a mid-flight worker to files already owned by another lane.

| Gate/checkpoint | Count | Why this is the minimum conflict-safe split |
|---|---:|---|
| D0 | 0 code worktrees | founder/product/operations validation; no implementation branch is produced |
| C0 | 3 | API and web are independent product substrates; infrastructure, QA and devex share the delivery contract and are one lane |
| C1 | 3 | identity persistence, policy/security and onboarding journeys have separate paths and frozen interfaces |
| C2 | 4 | asset backend, hostile-file worker, upload UX and adversarial integration tests are distinct risk surfaces |
| C3 | 2 | provider orchestration belongs with the backend producer; status-language QA belongs with the dossier consumer |
| C4 | 4 | domain/provenance, geometry kernel, persistence/API and adversarial fixtures must be reviewed independently |
| C5 | 4 | operation producer, policy/audit, editor and replay/concurrency evaluation have clean ownership boundaries |
| C6 | 4 | workflow, inference adapter, correction UX and benchmark/security can use a frozen proposal contract |
| C7 | 3 | compiler and scene backend are producers; viewer and viewer-specific QA share the frozen scene fixture/profile |
| C8 | 3 | provenance backend, status/version UX and export package/integrated QA are coherent ownership groups |
| C9 | 4 | provider gateway, policy/tool runtime, proposal UX and adversarial evaluation require independent controls |
| C10 | 3 | security/privacy, observability/recovery and acceptance/support/release are independent release workstreams |

The total of 37 planned code lanes is a staffing/orchestration shape, not a duration estimate: only the lanes within the active checkpoint run concurrently, with a maximum of four.

## D0 — Paid concierge validation gate (outside C0–C10)

### Meaning and outcome

“Paid concierge” means offering 8–12 qualified households a bounded property-evidence and correctable-model service, taking a real fee or meaningful deposit, and manually doing parts of plan interpretation, modelling and correction behind a thin prototype. The purpose is to observe the true inputs, labour, uncertainty, professional reuse and payment behaviour before automating them. It is not a separate application, a customer-support workstream or an implementation checkpoint.

D0 can run alongside C0–C3 after minimum participant terms, privacy handling and evidence-rights procedures are approved. D0 must close before C4 opens, because its outcome determines whether substantial geometry investment should proceed, narrow or pivot.

### Decisions before D0 starts

- DQ-003/DQ-004: primary customer trigger, one launch geography and accepted property box;
- DQ-005: deliverable, fee/deposit, refund/complaint path, turnaround and explicit exclusions;
- DQ-006/DQ-007: named operator/professional reviewers, capacity and experiment budget;
- DQ-013/DQ-022/DQ-024: participant terms, evidence rights, privacy handling and claims language; and
- predeclared recruitment, payment, correction-minute, severe-error, professional-reuse and next-step conversion thresholds.

### Required evidence and gate decision

Retain a de-identified case ledger covering qualification, price/deposit paid, source/evidence rights, input quality, manual minutes by activity, unresolved unknowns, severe errors, professional reuse-versus-redraw, status comprehension, next-step intent and complaints/refunds. Conclude with one recorded outcome: proceed to C4, narrow/pivot the property/customer box, or stop geometry investment. D0 creates no code worktrees.

## 4. C0 — Repository and delivery substrate

### Outcome

A clean clone can install from lockfiles, start the local stack, run a health/API contract test, render the authenticated product shell with fixtures and execute the base CI suite. Architecture boundaries and orchestration controls are enforceable.

### Decisions before C0A

- DQ-001/DQ-008: choose the local repository root, confirm corpus placement and authorise initial commit/push/worktree creation;
- confirm `main` as the integration branch and whether commits must be signed;
- accept or revise M1 exclusions (DQ-009), monorepo stack, AWS London default and initial cloud/spend guardrails;
- choose CI provider/environment strategy and required status checks; and
- define Temporal spike success/fallback criteria before C0 closes (DQ-015).

### C0A master-only activation

1. Confirm `ai_native_architecture_blue_sky` as the repository root and decide whether to keep the complete dossier in it.
2. Initialise Git, choose `main`, link the verified empty GitHub remote, configure safe ignore/attribute files and make a signed/attributable baseline commit where available.
3. Create the monorepo skeleton and empty package/service directories.
4. Pin Node 24 LTS, package manager, Python and infrastructure tooling.
5. Create root manifests, lockfiles, task scripts, lint/type/test configs and local service composition.
6. Add `CODEOWNERS`, expanded root `AGENTS.md`, contribution/commit conventions and secret-handling rules.
7. Create master-owned `docs/orchestration/LEDGER.md` and accepted C0 ADRs.
8. Create a synthetic fixture policy and confirm no customer data enters the baseline.
9. Verify a clean install/build/test from the primary checkout.
10. Register/discover the project and verify the Codex worktree creation path before opening lanes.

### Frozen C0 contract

- health/error/trace response schema;
- web-to-API client stub;
- package boundaries and import aliases;
- standard scripts above;
- local ports and environment-variable schema (names only, no secrets);
- UI tokens/base layout contract; and
- initial observability field/redaction convention.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Required evidence |
|---|---|---|---|
| C0-L1 API substrate | `services/platform-api/src/**`, `services/platform-api/test/**` | Fastify composition, config validation, health/readiness, error envelope, request/trace IDs, graceful shutdown and unit tests | health and invalid-config tests; no root edits |
| C0-L2 web substrate | `apps/web/src/**`, `packages/ui/src/**` | accessible shell, route/error/loading boundaries, design tokens/components, API health fixture, responsive baseline | component tests and desktop/narrow screenshots or Playwright traces |
| C0-L3 delivery infrastructure + QA/devex | `infrastructure/modules/network/**`, `infrastructure/modules/compute/**`, `infrastructure/modules/database/**`, `infrastructure/modules/storage/**`, `tests/contract/bootstrap/**`, `tests/integration/bootstrap/**`, `docs/runbooks/development/**`, `docs/adr/proposals/c0-*.md` | non-deploying IaC modules, tagging/naming/encryption defaults, contract smoke, local-stack runbook, failure troubleshooting and boundary cases | IaC format/validate plus clean-run transcript; no environment deployment or root edits |

### Merge order

L1 and L3, then L2, then master-owned generated contract/CI wiring.

### Exit gate

- clean clone bootstrap documented and reproduced;
- no secrets or absolute developer paths in committed config;
- web/API build and health contract pass;
- dependency boundary check fails on a deliberate test violation;
- IaC validates without applying production resources;
- project/worktree discovery is proven; and
- ledger contains baseline and worker metadata.

## 5. C1 — Tenant-safe account and project shell

### Outcome

A user can authenticate in the selected fixture/OIDC environment, create or enter an organisation and project, and only authorised actors can read or mutate that project.

### Decisions before contract freeze

- DQ-010: select the OIDC provider or explicitly remain fixture-only for this checkpoint;
- decide consumer account versus organisation-first onboarding and the future professional-organisation boundary;
- decide required MFA/passkey/session lifetime and whether pilot support impersonation is prohibited or time-bounded; and
- name the server-owned roles, permissions and audit retention policy.

### Master contract freeze

- select OIDC provider/fixture mode and session strategy;
- define actor/organisation/project/grant schemas and permission names;
- freeze identity/project OpenAPI and generated clients;
- allocate `0001_identity_projects.sql` exclusively to L1;
- add package dependencies/lockfile; and
- provide deterministic actors/tenants for negative tests.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C1-L1 identity/project producer | `services/platform-api/src/modules/identity/**`, `services/platform-api/src/modules/projects/**`, `services/platform-api/migrations/0001_identity_projects.sql` | OIDC subject mapping, org/project persistence, membership APIs, idempotent project creation, audit context | schema/migration/integration tests; exact migration only |
| C1-L2 authorisation + identity security | `packages/authz/src/**`, `packages/authz/test/**`, `tests/security/identity/**`, `docs/threat-models/identity.md` | permission vocabulary, deny-by-default policy evaluator, support-access primitive, cross-tenant IDOR/session/role-downgrade cases and threat model | positive/negative policy matrix proves no cross-tenant read/write and serialises safe denial reasons |
| C1-L3 onboarding + contract/e2e | `apps/web/src/features/auth/**`, `apps/web/src/features/onboarding/**`, `apps/web/src/features/projects/**`, `tests/contract/identity/**`, `tests/e2e/onboarding/**` | sign-in/session states, org/project creation/selection, forbidden/not-found distinction, accessible forms, duplicate-idempotency and full onboarding journey | component/contract/e2e tests against frozen contract, including expiry and failure paths |

### Merge order

L1, L2, L3, then master integrates policy middleware and generated clients.

### Exit gate

- two-tenant e2e fixture proves isolation;
- repeated create with same idempotency key has one effect;
- all mutations carry actor/project/trace audit context;
- session expiry and unauthorised UX are usable; and
- no identity-provider role is trusted as direct model authority.

## 6. C2 — Rights-aware immutable evidence ingestion

### Outcome

An authorised user can affirm rights, upload a supported plan, see validation/quarantine state and retain an immutable source object with hash and provenance. Hostile/unsupported inputs fail safely.

### Decisions before contract freeze

- DQ-013: approve the rights affirmation, takedown path and separate default-deny training consent;
- choose M1 file types, per-file/project limits, encrypted-PDF behaviour and upload-resume scope;
- DQ-014: set source/derived/quarantine retention and decide whether Object Lock remains disabled for pilot; and
- name malware/content scanning, sandbox/network-egress and deletion-evidence requirements.

### Master contract freeze

- EvidenceAsset, RightsAssertion, DerivedRepresentation and Job status schemas;
- upload limits and supported M1 types;
- S3/quarantine/source path policy and signed-upload contract;
- exact `0002_evidence_assets.sql` allocation to L1;
- job envelope v1 and generated clients;
- synthetic benign/malformed/oversized fixtures; and
- required processor dependencies/images.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C2-L1 asset backend | `services/platform-api/src/modules/assets/**`, `services/platform-api/migrations/0002_evidence_assets.sql`, `packages/provider-adapters/src/object-store/**` | rights assertion, create/finalise upload, hash/status/provenance, scoped signed URLs, retention state, audit/outbox | idempotency, authz and storage adapter integration tests |
| C2-L2 secure ingest worker | `services/spatial-worker/src/ingest/**`, `services/spatial-worker/test/ingest/**` | MIME/signature checks, limits, quarantine, malware/content adapter, sandboxed PDF/image inspection and preview manifest | malformed/bomb/encrypted/timeout fixtures fail without secrets/network |
| C2-L3 evidence UX | `apps/web/src/features/evidence/**` | rights language, upload/progress/resume/error states, evidence inventory, status/limitations and accessible file flow | browser component tests including failed/quarantined input |
| C2-L4 upload security QA | `tests/security/uploads/**`, `tests/integration/assets/**`, `tests/e2e/evidence/**`, `docs/threat-models/uploads.md` | content-type mismatch, path/key guessing, signed URL expiry, cross-tenant access, retry/duplicate and deletion/retention cases | adversarial suite and threat-model sign-off |

### Merge order

L1, L2, L3, L4. Master connects outbox/workflow and applies bucket policies in environment compositions.

### Exit gate

- original and derived objects are distinct and versioned;
- asset content hash and rights/terms version are visible in API/provenance;
- hostile processing has no broad credentials or outbound network;
- upload retry cannot create multiple authoritative assets;
- cross-tenant/source URL tests pass; and
- training permission is absent/default-deny.

## 7. C3 — Property identity and honest dossier

### Outcome

A user resolves a property through a deterministic or licensed adapter and sees facts, estimates and unknowns without any claim of exact internal geometry.

### Decisions before contract freeze

- DQ-004/DQ-011: choose launch geography and decide fixture-only versus one licensed live address/property adapter;
- approve permitted search/display/storage/attribution/caching behaviour from signed provider terms;
- define ambiguity, outage and manual-entry fallbacks; and
- approve the exact status vocabulary and comprehension threshold for fact, estimate, assertion and unknown.

### Master contract freeze

- PropertyIdentity, ProviderObservation and AttributedValue profile;
- search/select/resolve/dossier APIs and ambiguity/error codes;
- adapter capability/licence metadata interface;
- exact `0003_property_identity.sql` allocation to L1;
- provider fixture cases: exact, ambiguous, partial, missing floor/height, provider outage; and
- UI copy/status vocabulary.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C3-L1 property backend + adapter | `services/platform-api/src/modules/property/**`, `services/platform-api/migrations/0003_property_identity.sql`, `packages/provider-adapters/src/property/**`, `packages/test-fixtures/src/property/**` | search orchestration, explicit selection, observation retention, asserted correction, dossier projection, deterministic fixture adapter and contract-shaped provider spike | ambiguity/provider-version/adapter contract tests, including outage and known missing/incorrect fields |
| C3-L2 dossier UX + integrated QA | `apps/web/src/features/property/**`, `tests/contract/property/**`, `tests/integration/property/**`, `tests/e2e/property-dossier/**`, `docs/evaluation/property-status-language.md` | search/ambiguity/dossier UX, source/estimate/unknown labelling, outage/manual fallback, contract/failure/e2e cases and comprehension protocol | accessibility/comprehension evidence; branded-language assertions; no exact-interior claim |

### Merge order

L1, then L2; master makes the provider procurement decision separately from fixture readiness and runs the live-adapter integration gate only when licensed.

### Exit gate

- ambiguous address cannot silently resolve;
- provider record/version/licence-purpose metadata is retained;
- missing or known-unreliable fields remain unknown/qualified;
- manual correction is a new assertion with provenance;
- adapter outage produces a useful degraded state; and
- no external provider is required for local/CI success.

## 8. C4 — Canonical 2.5D model and validation kernel

### Outcome

The system can create, serialise, validate and display a simple multi-level residential model with explicit units/CRS/provenance, stable IDs and deterministic hash.

### Decisions before contract freeze

- confirm D0's proceed/narrow/pivot outcome and the resulting supported property/model box;
- DQ-016: choose the geometry library/kernel approach after licence, correctness and performance spikes;
- DQ-017: freeze stable IDs, canonical JSON, ordering/hash inputs and schema evolution; and
- approve integer units, local CRS/orientation, tolerances, finding severities and the golden/adversarial fixture catalogue.

### Master contract freeze

- canonical schema profile v1 and sample JSON;
- units, local CRS, orientation and tolerance policy;
- stable ID and canonical serialisation/hash rules;
- geometry-kernel interface and finding severity vocabulary;
- exact `0004_canonical_models.sql` allocation to L3;
- golden synthetic models and invalid/adversarial case catalogue; and
- accepted ADRs 002/003/009.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C4-L1 domain/provenance | `packages/domain-model/src/model/**`, `packages/domain-model/test/model/**`, `packages/provenance/src/**`, `packages/provenance/test/**` | schemas/value objects, attributed values, model/profile validation, canonical serialisation inputs | schema round-trip and unknown/provenance tests |
| C4-L2 geometry kernel | `packages/geometry-kernel/src/**`, `packages/geometry-kernel/test/**` | integer primitives, tolerance/snap, polygon/wall/opening/room rules, findings, deterministic operations | property-based and adversarial geometry tests |
| C4-L3 model persistence/API | `services/platform-api/src/modules/models/core/**`, `services/platform-api/migrations/0004_canonical_models.sql` | create/read snapshot, content hash, object references and project authz; no operation stream yet | DB/API integration and duplicate-hash behaviour |
| C4-L4 fixtures/evaluation | `packages/test-fixtures/src/models/**`, `tests/geometry/canonical/**`, `docs/evaluation/canonical-model-v1.md` | representative valid/invalid houses, invariant matrix, hash/replay fixtures | fixtures exercise every v1 element/finding class |

### Merge order

L1, L2, L3, L4. Master runs cross-package round-trip, freezes canonical schema v1 and regenerates clients.

### Exit gate

- integer units and CRS are required, not implied;
- canonical serialisation/hash is stable across repeated processes;
- invalid topology produces located typed findings;
- missing values remain unknown and round-trip;
- source/model records are distinguishable; and
- representative fixtures pass property-based tests without platform UI.

## 9. C5 — Typed operations, branches, replay and 2D editor foundation

### Outcome

An authorised user can create a branch, preview and commit typed model operations with optimistic concurrency, replay them deterministically, compare heads and restore by a new version. A 2D editor renders and edits through those operations.

### Decisions before contract freeze

- approve the exact v1 operation registry and which operations are intentionally deferred;
- choose branch creation, commit grouping, local undo/redo and restore-as-new-version semantics;
- freeze optimistic-concurrency/idempotency behaviour, snapshot cadence and replay/upcaster policy; and
- approve editor accessibility, snapping/tolerance and conflict-recovery acceptance cases.

### Master contract freeze

- operation registry v1: create level/wall/opening/space label, move wall, insert opening, rename room and metadata/provenance correction;
- preview/commit/conflict/idempotency APIs;
- branch/version/operation/reducer interfaces;
- exact `0005_model_operations.sql` allocation to L1;
- editor command/client event interface; and
- generated client/mocks and concurrency fixtures.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C5-L1 operation producer | `packages/model-operations/src/**`, `packages/model-operations/test/**`, `services/platform-api/src/modules/models/operations/**`, `services/platform-api/migrations/0005_model_operations.sql` | registry, reducers/upcaster v1, branch persistence, preview/commit transaction, snapshot cadence, outbox | deterministic replay, conflict and idempotency tests |
| C5-L2 model policy/audit | `packages/authz/src/model/**`, `packages/authz/test/model/**`, `services/platform-api/src/modules/audit/**` | operation permissions, machine/person actor conditions, audit records, support visibility | role/branch/action negative matrix |
| C5-L3 editor core/UI | `packages/editor-core/src/**`, `packages/editor-core/test/**`, `apps/web/src/features/editor-2d/**` | SVG projection, selection/snap, accessible inspector, local preview session, undo/redo before commit, conflict recovery UX | component tests against frozen mocks; keyboard path |
| C5-L4 replay/concurrency QA | `tests/integration/model-operations/**`, `tests/geometry/operations/**`, `tests/e2e/editor-operations/**`, `docs/evaluation/operation-invariants.md` | repeated/reordered/concurrent requests, replay after snapshot, branch isolation, restore-as-new-version | property/concurrency suite proves no lost update/history rewrite |

### Merge order

L1, L2, L3, L4; master connects live generated client and patches integration conflicts.

### Exit gate

- all canonical mutation routes pass through the registry;
- preview does not mutate state;
- stale expected revision returns recoverable conflict;
- repeated idempotency key has one domain effect;
- replay yields the pinned snapshot hash;
- branch comparison/restore preserves history; and
- every editor action is possible through typed commands and an accessible inspector.

## 10. C6 — Plan proposal, calibration and correction

### Outcome

A rights-cleared uploaded plan can produce a typed proposal or abstention; a user can calibrate, overlay, correct and commit it while the system measures correction effort and residual uncertainty.

### Decisions before contract freeze

- DQ-018: choose the exact vector/raster input box and deterministic baseline versus external/internal inference path;
- approve evaluation-data rights, train/validation/holdout separation and parser/model/version manifest;
- predeclare accepted-input, geometry-accuracy, severe-error, abstention and median/P90 correction-minute thresholds; and
- set processing time/resource limits, calibration evidence rules and the conditions that force abstention.

### Master contract freeze

- plan job/proposal/abstention schema v1;
- parser adapter contract and fixture baseline;
- calibration and source-to-model transform representation;
- proposal-to-operation mapping;
- benchmark split and data-rights manifest format;
- UI workflow/status/copy; and
- processing resource/time limits.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C6-L1 processing workflow | `services/platform-api/src/modules/plan-processing/**`, `services/spatial-worker/src/plan-processing/**`, `services/spatial-worker/test/plan-processing/**` | job/activity flow, vector extraction baseline, calibration transform, proposal storage, cancellation/retry/abstention | crash/retry has one result; no raw file in workflow history |
| C6-L2 inference adapter | `services/inference-worker/**`, `packages/provider-adapters/src/plan-parser/**` | Python service/CLI contract, deterministic mock, raster baseline or evaluated model adapter, structured confidence/unknown output | Ruff/type/pytest plus schema/timeout/invalid-output tests |
| C6-L3 correction UX | `apps/web/src/features/plan-import/**`, `apps/web/src/features/editor-2d/plan-overlay/**` | source/proposal overlay, opacity/alignment, known-length calibration, correction checklist, unresolved unknowns, commit review | full mocked journey; unsupported input/abstention UX |
| C6-L4 benchmark/security | `tests/evaluation/plan-parsing/**`, `tests/security/plan-processing/**`, `docs/evaluation/plan-parser-v1/**`, `packages/test-fixtures/src/plans/**` | rights manifest, holdout/golden metrics, hard negatives, resource/prompt/content attacks, correction instrumentation validation | denominator includes failures; reproducible benchmark report |

### Merge order

L2 adapter contract/baseline, L1 workflow, L3, L4; master records parser version and benchmark decision.

### Exit gate

- vector-first and deterministic mock path work without GPU;
- unsupported/low-confidence input abstains visibly;
- scale evidence and transform are retained;
- every accepted correction becomes typed operations;
- raw source and proposal remain inspectable;
- benchmark reports accepted-input rate, accuracy and severe errors alongside correction minutes; and
- no fixture lacks a documented right to test/use.

## 11. C7 — Deterministic scene compiler and walkthrough

### Outcome

The exact committed snapshot compiles into a validated GLB and a user can inspect it in a performant browser walkthrough with element identity and provenance links.

### Decisions before contract freeze

- DQ-019: freeze supported browsers/devices and whether mobile web 3D is supported or explicitly degraded to 2D;
- set representative house/scene profiles, GLB size/load/FPS/memory budgets and named test hardware;
- approve material/texture limits, deterministic hash policy and cache invalidation inputs; and
- decide required orbit/walk, touch/keyboard and accessibility/degraded-mode behaviour.

### Master contract freeze

- scene graph/manifest v1;
- compiler input/output and cache-key contract;
- target device/house performance fixtures and budgets;
- GLB profile and material/texture limits;
- scene API/job/status and signed access schema; and
- generated viewer fixture.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C7-L1 compiler producer | `packages/scene-compiler/src/**`, `packages/scene-compiler/test/**`, `services/spatial-worker/src/scene-compile/**` | wall/opening/level mesh generation, scene manifest, GLB output, element mapping, bounds/counts/hashes | deterministic byte/semantic hash policy, golden geometry and glTF validator |
| C7-L2 scene backend | `services/platform-api/src/modules/scenes/**`, `packages/provider-adapters/src/scene-storage/**` | request/status/access/cache, snapshot/compiler version pinning, audit/outbox and expiring URL | authz/idempotency/cache integration tests |
| C7-L3 viewer + scene acceptance | `apps/web/src/features/viewer-3d/**`, `tests/geometry/scene-compiler/**`, `tests/e2e/walkthrough/**`, `tests/performance/viewer/**`, `docs/evaluation/scene-profile-v1.md` | lazy Three/R3F route, orbit/walk, level visibility, selection/inspector, degraded path, disposal/touch/keyboard plus bounds, browser, performance and visual acceptance | no blank-canvas failure; component/e2e/validator results and budgets on named hardware |

### Merge order

L1, L2, L3; master verifies a scene from a live committed model rather than a fixture only.

### Exit gate

- scene manifest pins snapshot and compiler versions;
- repeated compile has documented deterministic result/cache behaviour;
- GLB validates and bounds/element map match canonical fixtures;
- 2D and 3D select the same stable element IDs;
- viewer failure degrades to usable 2D/status experience; and
- representative scene meets recorded size/load/FPS budgets.

## 12. C8 — Provenance, version comparison and export

### Outcome

A user can understand why model values exist, compare/restore versions and export a reproducible, authorised package containing canonical JSON, GLB and a source/tool/limitation manifest.

### Decisions before contract freeze

- freeze the verification/status vocabulary and who may assign each status for which purpose;
- approve version-diff granularity, restore confirmation and “existing/proposed/as-built” presentation;
- choose export profile, package contents, expiry/retention, download audit and reproducibility promise; and
- predeclare user-comprehension/accessibility thresholds for status, source and limitation language.

### Master contract freeze

- provenance projection and verification-status vocabulary;
- version diff schema;
- export profile/manifest v1 and retention policy;
- exact `0006_reviews_exports.sql` allocation to L1 or L3, never both;
- export permission/audit event; and
- UX copy for “current”, “proposed”, “verified” and “issued”.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C8-L1 provenance backend | `services/platform-api/src/modules/provenance/**`, `services/platform-api/src/modules/reviews/**`, `services/platform-api/migrations/0006_reviews_exports.sql`, `packages/provenance/src/projections/**` | element/value/operation/source lineage, review decision scaffold without professional issue, version diff projection | exact-source and permission tests; verification cannot be machine-issued |
| C8-L2 compare/provenance UX | `apps/web/src/features/provenance/**`, `apps/web/src/features/version-compare/**` | evidence chain, uncertainty/status, operation timeline, model diff and restore confirmation | comprehension/accessibility tests and no history-overwrite UX |
| C8-L3 export producer + integrated QA | `services/platform-api/src/modules/exports/**`, `services/spatial-worker/src/export/**`, `packages/provider-adapters/src/export-storage/**`, `tests/e2e/provenance-export/**`, `tests/contract/exports/**`, `tests/security/exports/**`, `docs/evaluation/status-comprehension.md` | async authorised canonical JSON/GLB/manifest package, hashing, expiry/download audit, source-to-export, replay/restore, keyboard/reader and comprehension protocol | package reproduction/cross-tenant tests plus export traceability and status-language acceptance evidence |

### Merge order

L1, L3, L2; master runs the combined end-to-end suite and reviews all external claims and export labels.

### Exit gate

- every export points to exact source/model/compiler versions and limitations;
- unauthorised/expired downloads fail without leaking existence;
- version restore creates a new auditable head;
- machine output cannot acquire human verification/issue status;
- users can identify at least the tested status distinctions at the predeclared threshold; and
- generated artifacts can be reproduced or intentionally versioned.

## 13. C9 — Bounded AI proposal layer

### Outcome

A user can describe one of the supported editing intents and receive an explainable, typed, non-mutating proposal that is revalidated and explicitly confirmed before commit. Prompt/document injection and unsupported requests fail safely.

### Decisions before contract freeze

- DQ-021: approve provider/model by data class, region, retention/training terms, cost ceiling and fallback;
- approve the exact supported intent/tool registry and evidence/context fields that may enter the model gateway;
- set high-risk confirmation, proposal expiry, stale-revision and unsupported-intent rules; and
- predeclare functional, injection/exfiltration, permission, cost and provider-regression release thresholds.

### Master contract freeze

- supported intent and registered tool list;
- model gateway request/response and retention policy;
- provider data classifications and approved routing;
- prompt/template/model/tool registry versions;
- confirmation/risk policy;
- evaluation set and release thresholds; and
- feature flag disabled outside evaluation users.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C9-L1 model gateway | `services/platform-api/src/modules/model-gateway/**`, `packages/provider-adapters/src/foundation-models/**` | provider abstraction, version/policy registry, cost/latency telemetry, bounded authorised context, structured output and safe fallback | provider mock, timeout, malformed output and no-retention routing tests |
| C9-L2 tool policy/runtime | `packages/model-operations/src/ai-tools/**`, `packages/authz/src/ai/**`, `services/platform-api/src/modules/ai-proposals/**` | schema registry, argument/policy/domain validation, preview, proposal expiry and confirmation linkage | model cannot bypass expected revision/permissions/geometry rules |
| C9-L3 proposal UX | `apps/web/src/features/ai-proposal/**` | intent input, assumptions/evidence, typed impact preview, edit/accept/reject, stale proposal and abstention UX | supported/unsupported/error/keyboard journeys |
| C9-L4 adversarial evaluation | `tests/evaluation/ai-tools/**`, `tests/security/prompt-injection/**`, `docs/evaluation/model-gateway-v1.md` | tool accuracy, units, injections, exfiltration, permission attacks, hallucinated tool/version, provider regression and cost | predeclared pass threshold; failures retained, not cherry-picked |

### Merge order

L1, L2, L3, L4; master decides whether the feature flag may enter pilot.

### Exit gate

- AI has no direct database/object-store mutation credential;
- untrusted evidence text cannot redefine system/tool policy;
- only registered schema-valid tools can be proposed;
- all state changes re-check authz, revision and domain constraints after confirmation;
- model/provider changes are pinned and evaluated;
- unsupported intent abstains; and
- user rejection/edit/acceptance is measured separately from training consent.

## 14. C10 — Controlled-pilot hardening and release

### Outcome

The complete M1 journey is secure, recoverable, observable and usable by controlled external pilot participants, with support, privacy, incident and evidence procedures exercised.

### Decisions before contract freeze

- DQ-022–DQ-027: approve DPIA/roles, analytics, terms/claims, support access, RPO/RTO and independent security-review scope;
- name pilot cohort/count, supported devices/browsers, support hours and incident/escalation owners;
- set SLOs, capacity/spend limits, severity/blocker policy and rollback/forward-fix triggers; and
- name legal/privacy/security/product/operations go/no-go approvers and evidence each must sign.

### Master contract freeze

- production data classification/DPIA inputs and retention schedule;
- pilot SLOs, alert thresholds and support hours;
- RTO/RPO proposal and backup/restore scenario;
- supported browser/device matrix;
- pilot terms/claims/limitations and escalation contacts;
- release candidate SHA/image/model/compiler versions; and
- no open critical/high release blocker policy.

### Parallel lanes

| Lane | Exclusive paths | Tasks | Acceptance |
|---|---|---|---|
| C10-L1 security/privacy hardening | `tests/security/release/**`, `docs/threat-models/release.md`, `docs/runbooks/privacy/**`, `docs/runbooks/incident/**` | threat-model closeout, DPIA/records inputs, security tests, incident/tabletop and pen-test remediation tracking | no unresolved critical/high; legal/privacy owner signs pending decisions |
| C10-L2 observability/recovery | `packages/telemetry/src/release/**`, `infrastructure/modules/observability/**`, `infrastructure/modules/recovery/**`, `docs/runbooks/operations/**` | SLO dashboards/alerts, safe logs, backup/restore, workflow/provider failure, rollback/forward-fix and capacity drills | staging restore evidence and alert/runbook correlation |
| C10-L3 user acceptance + support/release | `tests/e2e/release/**`, `tests/performance/release/**`, `docs/evaluation/pilot-uat/**`, `docs/runbooks/support/**`, `docs/product/pilot/**`, `docs/release/candidate/**` | browser/device/accessibility/performance and interrupted-state journeys plus onboarding, limitations, complaint/escalation, operator playbook, release checklist and pilot pack | named browser/device results and an independent support/release dry run by a non-implementer |

### Merge order

L1 and L2, then L3; master owns CI/environment/release manifest changes and final go/no-go.

### Exit gate

- release candidate passes all standard suites and production-like synthetic journey;
- staging point-in-time/object restoration and workflow recovery are demonstrated;
- privacy/professional/consumer claim review is complete;
- support can locate a trace, model version, source and operation without broad data access;
- pilot participants receive explicit scope/limitation/data terms;
- operator can handle ambiguity/abstention/correction/complaint; and
- go/no-go record identifies residual risk, owner, expiry/review date and rollback trigger.

## 15. Cross-checkpoint release traceability

Maintain a master matrix linking:

```text
requirement ID
-> domain/API schema version
-> implementation modules
-> automated test IDs
-> manual/UAT scenario
-> security/privacy/professional control
-> release evidence
```

Every checkpoint updates the matrix in the primary checkout after merges. A test count alone is not traceability.

## 16. Checkpoint failure handling

A checkpoint is not complete when:

- a lane is still running or has unreviewed changes;
- the combined suite fails even if every lane suite passed;
- the acceptance scenario works only with a private fixture or manual database edit;
- a worker edited forbidden/shared files;
- the OpenAPI/generated client or migration registry drifts;
- a limitation is hidden in a worker note rather than the product/runbook;
- security/privacy/professional review is deferred without an owner/gate; or
- the orchestrator cannot reproduce the result from the primary branch.

If a lane fails, preserve its evidence, decide whether to patch in master, respawn a narrower lane from the current base or defer the capability. Do not merge partially understood code simply to keep the schedule.

## 17. Completion handoff for M1

The final orchestration report must state factually:

- final branch and commit SHA;
- all checkpoint/task IDs and merged branch SHAs;
- deployed environment/release identifiers if authorised;
- implemented M1 capabilities and explicit exclusions;
- automated/manual/browser/device/security/recovery test results;
- evaluation dataset rights/version and model/compiler/provider versions;
- open risks and owners;
- controlled-pilot conditions; and
- exact next gate for iOS capture or architect-assisted design.

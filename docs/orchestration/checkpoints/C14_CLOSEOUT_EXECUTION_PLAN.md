# C14 Close-out Execution Plan

**Prepared:** 2026-08-11
**Checkpoint:** C14 — Reproducible geometry-safe still rendering
**Execution model:** one local integration session, followed by one authorised-render-host session
**Recommended worker model:** `gpt-5.6-sol` with `xhigh` reasoning

## 1. Authority and purpose

This document is an operational handoff for closing the already-open C14 checkpoint. It does not
replace, weaken, or amend the accepted requirements.

Authority order:

1. `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`
2. `docs/orchestration/checkpoints/C14_CONTRACT.md`
3. `docs/orchestration/C11_C15_CONTINUATION.md`
4. `docs/orchestration/LEDGER.md`
5. this close-out execution plan

The target state after the local session is:

`implementation-ready / hardware-gate-deferred`

The target state after the authorised-host session is:

`renderer-hardware-complete`, provided every accepted C14 gate passes and the evidence is durable.

The C14 contract remains the requirements source of truth. The ledger remains the durable status
record and must be updated only after the corresponding verification actually succeeds.

## 2. Current baseline to preserve

At the time this plan was prepared:

- `main` is 21 commits ahead of `origin/main` at `7f4280273e0dd1c86e434e1555cbe6baafbcbf69`;
- the C14 implementation spans render-scene construction, durable jobs, Blender isolation,
  enhancement isolation, API/worker composition, immutable artifact access, and render UX;
- `docs/PROJECT_BLUE_SKY_AND_CURRENT_STATE_AUDIT.md` is untracked and user-owned;
- `tests/integration/render-stills/` is untracked and user-owned;
- `docs/evaluation/render-stills/artifacts/` is ignored local output and is not accepted evidence;
- the local Docker daemon is not running;
- the Mac is under an explicit no-Blender hold, including probes and acceptance runs; and
- the ledger still records C14 as active and has not absorbed the later local commits.

The close-out session must not reset, rebase, discard, overwrite, or silently omit any of these
changes. Generated build output is not source evidence.

## 3. Execution decision

Do not start parallel worktree lanes for the known close-out scope. The original four C14 lanes have
already produced and integrated their substantial implementation. The remaining work is a tightly
coupled orchestrator-owned integration pass across root verification, navigation, live acceptance,
documentation, and the ledger.

Reconsider worktree orchestration only if current live verification exposes at least two substantial,
independent implementation defects with non-overlapping ownership—for example, a durable Postgres
concurrency defect and an unrelated renderer-validation defect. Small fixes, test repairs, and
cross-surface integration stay in the primary session.

The authorised-host run is sequential rather than parallel: it must use the exact final commit from
the local close-out. It is not a reason to create parallel worktrees.

## 4. Session A — local integration close-out

### Objective

Close every locally available C14 gate without invoking Blender on this Mac, push a clean integrated
commit, and record the honest state as `implementation-ready / hardware-gate-deferred`.

### Required work

1. **Protect and reconcile the baseline**
   - Record branch, HEAD, remote divergence, dirty files, disk state, Docker state, and tool versions.
   - Preserve and deliberately classify the untracked audit and render integration test.
   - Treat the ignored 2026-07-22 local Blender bundle as non-evidence.
   - Do not invoke a Blender executable, version command, probe, renderer, or acceptance script.

2. **Repair deterministic quality gates**
   - Fix all Prettier failures, including the untracked audit if it will remain in the worktree.
   - Remove the C14 forbidden non-null assertion without weakening sorted/unique validation.
   - Fix the five Blender-Python Ruff violations.
   - Give the Blender-only Python imports an explicit, narrow mypy boundary and fix the real tuple
     return-type error; do not globally disable strict typing.
   - Fix the onboarding keyboard test so it reflects the actual persona order and remains an
     accessibility assertion.
   - Prevent focused source tests from accidentally collecting generated `dist/test/**` copies.

3. **Make C14 verification repeatable**
   - Register or document one repeatable C14 command that runs source-only render-scene, renderer,
     API, worker, enhancement, evaluation, performance, security, and integration typechecks/tests.
   - Ensure standalone `tests/security/render-jobs/**`, `tests/security/render-stills/**`, and
     `tests/security/image-enhancement/**` are not silently omitted by normal close-out verification.
   - Make `api:check` and `dependency:boundaries` execute meaningful C14 checks, or add an explicit
     accepted equivalent whose scope and limitations are recorded. Zero-task success is not evidence.

4. **Finish root-owned product integration**
   - Add the project-navigation link to `/render-stills/:projectId`.
   - Verify executable API composition resolves exact C10 scene bytes and exact C13 bindings.
   - Verify the worker remains absent when disabled and requires exact authorised-host pins when
     enabled.
   - Update the C14 runbook where it still describes the already-composed product as uncomposed.

5. **Split local control-plane evidence from renderer evidence**
   - Track and repair `tests/integration/render-stills/`.
   - Correct the EXR inspector path.
   - Remove hard-coded Mac Blender paths and host fingerprints from the portable acceptance flow.
   - Provide a local disposable Postgres/S3 C1-to-C14 control-plane journey using a clearly labelled
     inert/frozen renderer boundary. It may prove source resolution, queues, fencing, publication,
     access, and UI behavior, but must not be described as a Blender render.
   - Keep real Blender execution behind a separate explicit authorised-host gate.

6. **Run fresh local infrastructure evidence**
   - Start the existing local dependency stack after Docker is available.
   - Use a disposable database and object-store scope.
   - Apply migrations C1 through C14 from empty state.
   - Run non-owner forced-RLS, tenant/role/IDOR, append-only, idempotency, concurrency, stale lease,
     cancel/retry/crash, disk reservation, immutable publication, and artifact-access cases.
   - Run the production-composed C13-backed C10 scene to C14 control-plane journey without Blender.

7. **Run the complete local acceptance matrix**
   - `UV_CACHE_DIR=.cache/uv pnpm verify`
   - contract, integration, security, geometry, API, and dependency-boundary checks
   - `git diff --check`
   - C14 focused TypeScript and Python suites
   - root onboarding E2E
   - C14 Chromium/Firefox/WebKit desktop/mobile/keyboard Playwright matrix
   - visible in-app Browser production-composed journey when the controller is available
   - structured-log redaction and post-download artifact verification

8. **Create durable close-out evidence**
   - Update `docs/evaluation/render-stills/C14_L4_EVALUATION.md` or add one clearly named integrated
     C14 acceptance record with exact commands, counts, skips, IDs, hashes, screenshots, and SHAs.
   - Update the development runbooks and the project audit to match the verified tree.
   - Update `docs/orchestration/LEDGER.md` with all four lane outcomes, later integration commits,
     local gates, non-evidence, provider/hardware state, and the deferred item.
   - Commit and push a clean `main`.

### Session A terminal condition

Session A succeeds only when every locally available gate is green, the integrated commit is pushed,
the primary worktree is clean, and the ledger says:

`C14 implementation-ready / hardware-gate-deferred`

Do not mark C14 renderer-hardware-complete. Do not open C15 as part of this close-out unless the user
separately requests continuation after reviewing the C14 handoff.

## 5. Session B — authorised render-host acceptance

### Prerequisites

- The host is explicitly authorised by the user for C14 Blender execution.
- The host checks out the exact pushed Session A commit.
- It has the required Blender/OpenImageIO/runtime dependencies and sufficient reserved disk.
- No customer data, provider key, paid service, or external enhancement is used.
- The operator records the host class without exposing private host identity or credentials.

### Required work

1. Verify executable, Blender build, renderer script, EXR inspector, OCIO, profile, and host hashes.
2. Run the bounded smoke profile, primary Cycles profile, and same-host clean replay.
3. Produce and validate geometry-safe PNG, multilayer EXR, depth EXR, normal EXR, and segmentation PNG.
4. Verify hashes, byte lengths, magic, dimensions, finite EXR pixels/channels, Cryptomatte/object
   membership, palette membership, protected C10 objects/bounds, camera, materials, and lights.
5. Run the production API/worker/object-store journey using the exact C13-backed C10 source.
6. Download every published artifact through fresh opaque access and revalidate it independently.
7. Compare the clean replay at the exact contract scope. If same-host artifact bytes differ, do not
   claim exact-byte reproducibility; diagnose and either fix the deterministic encoding or formally
   narrow the claim through an authorised contract decision before closure.
8. Record wall/resource bounds, process isolation, safe logs, output hashes, manifest hashes, and the
   explicit host-authorisation record in a tracked evaluation summary. Raw media may remain outside
   Git if its durable location and content hashes are recorded.
9. Update the ledger and push the final clean closure commit only after all gates pass.

### Session B terminal condition

C14 may be marked `renderer-hardware-complete` only when the accepted real-render gate and every
deferred validation are satisfied. If the run discovers a code defect, return the fix to the primary
integration workflow, rerun Session A's affected gates, push a new exact commit, and repeat host
acceptance against that commit.

## 6. Hardened handoff report contract

Each session must report:

- starting and final branch/commit SHA;
- changed files and why;
- contract, schema, migration, API, and dependency impact;
- exact verification commands with pass/fail/skip counts;
- disposable database/object-store and browser evidence;
- screenshots and artifact/evidence paths where required;
- provider, Docker, Blender, GPU, and physical-hardware state;
- explicit `NOT RUN` items and why;
- limitations, risks, and any remaining owner/action;
- whether the worktree is clean and whether the final commit was pushed.

## 7. Copy-ready kickoff prompt for Session A

```text
Complete the local C14 close-out for this repository in one primary integration session.

Use gpt-5.6-sol with Extra high (xhigh) reasoning. Read and follow, in order:
1. the root AGENTS.md and ai_native_architecture_blue_sky/AGENTS.md;
2. ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md;
3. ai_native_architecture_blue_sky/docs/implementation/00_MASTER_IMPLEMENTATION_PLAN.md;
4. docs/orchestration/checkpoints/C14_CONTRACT.md;
5. docs/orchestration/C11_C15_CONTINUATION.md;
6. docs/orchestration/LEDGER.md; and
7. docs/orchestration/checkpoints/C14_CLOSEOUT_EXECUTION_PLAN.md.

This is the orchestrator-owned integration close-out, not a new checkpoint and not a request to open
parallel worktrees. Start from the current repository state. Preserve the 21 local commits and all
untracked/user-owned files. Do not reset, rebase, discard, or overwrite them.

Absolutely do not invoke Blender on this Mac—not even a version command, capability probe, test, or
acceptance script. Real Blender acceptance remains deferred to an explicitly authorised host.

Execute all of Session A in C14_CLOSEOUT_EXECUTION_PLAN.md: repair quality/test-discovery gates,
register meaningful C14 verification, add missing navigation, track and split the local full-chain
control-plane test from the real-render gate, start disposable local Postgres/S3 once Docker is
available, run fresh C1-C14 migrations and live security/concurrency/publication checks, run the full
repository and browser matrices, and produce durable evaluation plus ledger evidence.

Use clearly labelled inert/frozen renderer evidence locally. Never relabel it as Blender or
photoreal-render evidence. The required final state for this session is exactly:
implementation-ready / hardware-gate-deferred.

Own the task through verification, integration, documentation, commit, and push. Do not open C15.
If a genuinely substantial independent defect makes worktree orchestration beneficial, stop before
launching workers and report the proposed non-overlapping lanes; otherwise keep the close-out in this
one primary session.

At handoff, provide every item in the hardened report contract, including exact commands/counts,
current hardware/provider state, limitations, final commit SHA, push status, and clean-worktree state.
```

## 8. Copy-ready kickoff prompt for Session B

```text
Run the authorised-host C14 renderer acceptance against the exact pushed commit produced by the C14
local close-out. Use gpt-5.6-sol with Extra high (xhigh) reasoning.

First read the repository AGENTS.md files, the active M1 plan, C14_CONTRACT.md,
C11_C15_CONTINUATION.md, LEDGER.md, C14_CLOSEOUT_EXECUTION_PLAN.md, and the final Session A handoff.
Confirm and record the exact commit SHA and explicit user authorisation for Blender on this host
before invoking Blender. If either is absent, stop without running a probe.

Execute Session B in C14_CLOSEOUT_EXECUTION_PLAN.md: verify all executable/build/script/OCIO/profile
pins, run smoke/primary/same-host replay, validate all five required artifact roles and protected
geometry, run the exact C13-backed C10-to-C14 production API/worker/object-store journey, independently
download and verify artifacts, and record privacy-minimised durable evidence.

Do not use customer data, external enhancement, provider keys, or paid services. Do not claim exact
byte reproducibility if any same-host artifact bytes differ. If a source change is required, return
the fix to integration, rerun the affected local gates, push a new exact commit, then restart host
acceptance from that commit.

Only mark C14 renderer-hardware-complete after every accepted gate passes. Update the evaluation and
ledger, commit, push, and provide the complete hardened handoff report.
```

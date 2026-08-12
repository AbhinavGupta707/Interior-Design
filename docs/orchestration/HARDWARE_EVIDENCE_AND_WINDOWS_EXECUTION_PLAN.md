# Hardware evidence and Windows execution plan

- **Prepared:** 2026-08-12
- **Planning baseline:** `97f42274cba54679eaf27aa89722e53053b0018a`
- **Current checkpoint state:** C14 `implementation-ready / hardware-gate-deferred`
- **Purpose:** operational plan for closing C14 on an authorised Windows/NVIDIA workstation and then
  collecting older deferred hardware evidence without confusing it with checkpoint completion.

## 1. Authority and non-authority

This is an operational handoff, not a new checkpoint contract and not an amendment to an accepted
requirement. Authority remains, in order:

1. `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`
2. the accepted checkpoint contract for the evidence being collected
3. `docs/orchestration/C11_C15_CONTINUATION.md`
4. `docs/orchestration/LEDGER.md`
5. the relevant evaluation record and runbook
6. this plan

Only actually executed evidence may change the ledger. A successful installation, capability probe,
Docker build, fixture test or synthetic render does not become physical-device, algorithm, CUDA,
Cycles, representative-home or release evidence.

## 2. Executive decision

The immediate next objective should be **C14 Session B: real Blender/Cycles host acceptance**.

- C14 can be made `renderer-hardware-complete` with the portable
  `cycles-cpu-geometry-safe-v1` profile. NVIDIA, CUDA and OptiX are not required for the baseline
  real-render gate.
- The primary development checkout should live in the **WSL 2 Linux filesystem**, not under
  `/mnt/c` and not as a native-Windows development checkout.
- C14 should use an **official Linux Blender binary inside WSL**. The current renderer boundary uses
  POSIX modes, real paths, Linux temporary paths and Unix process-group cancellation. Calling a
  native Windows `blender.exe` from the WSL worker would cross incompatible path and process
  boundaries and is not the accepted path.
- The already-installed native Windows Blender may remain installed and may be recorded as host
  inventory, but it should not be used by the current C14 acceptance command.
- C8's frozen NVIDIA package is a separate **Windows PowerShell + Docker Desktop WSL 2** workflow.
  It uses Windows `C:\C8\...` inputs and outputs and should not be mixed into C14 closure.
- Do not start with orchestrated worktrees. Workstation discovery and C14 host acceptance are
  sequential, single-owner tasks against one exact commit. Reconsider parallel worktrees only if
  acceptance exposes at least two substantial, independent code defects.

Operationally, reserve two tasks:

1. **W0 — workstation discovery/bootstrap** (`gpt-5.6-sol`, `high`): inspect and configure; no
   product or evidence claim.
2. **W1 — C14 authorised-host acceptance** (`gpt-5.6-sol`, `xhigh` / Extra high): run, diagnose,
   validate, document and close C14 if every mandatory gate passes.

W0 and W1 may happen in one long task only if all preflight checks are already green. Separating them
is safer because WSL, Docker, the Linux Blender build and GitHub authentication may require restarts
or downloads.

## 3. What is deferred, in checkpoint order

This inventory distinguishes a code checkpoint from later field, provider, human and release proof.
It does not imply that every item should be run now.

| Checkpoint         | Deferred or deliberately disabled evidence                                                                                                                                        | Classification and dependency                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| C0-C1              | External OIDC, cloud deployment and real customer identities/data                                                                                                                 | Provider/deployment decision; not a C14 dependency                                                                                               |
| C2                 | Physical iOS/background-relaunch behavior, production cloud IAM/lifecycle, malware-scanner daemon, and several separately seedable cleanup/log/lease probes                       | Release/operations evidence; not a C14 dependency                                                                                                |
| C3                 | Live address/UPRN/EPC/mapping/planning providers and their licence, privacy and retention approval                                                                                | Optional product/provider programme; not a GPU gate                                                                                              |
| C4-C5              | Survey-grade solids, structural/regulatory truth and professional certification; one historical permitted in-app production browser route was not run                             | Professional/release boundary; deterministic model/editor code is complete                                                                       |
| C6                 | Rights-approved representative plans, generalisation, measured human correction time and evaluator promotion                                                                      | Dataset/human study; useful before release, not a C14 dependency                                                                                 |
| C7                 | Physical LiDAR iPhone/iPad RoomPlan room + structure journeys, camera permission, tracking/relocalisation, thermal/interruption/background transfer, VoiceOver and field accuracy | **Open C7/C18 release blocker.** Requires supported Apple hardware plus Mac/Xcode; Windows cannot close it                                       |
| C8                 | Physical camera/RGB-D, usable depth/calibration/poses, real COLMAP/Open3D, dense CUDA, Nerfstudio/gsplat, Windows/NVIDIA capacity and representative geometric accuracy           | **Release/field evidence.** Requires rights-cleared inputs; the Windows package covers only a bounded part of this matrix                        |
| C9                 | Real multi-source registration/fusion, comparison against single-source baselines, representative-home accuracy and measured correction economics                                 | Depends on real C6/C7/C8 inputs; synthetic fusion cannot close it                                                                                |
| C10                | Hardware-GPU Chromium/WebGL canvas interaction and load/FPS/call/idle budgets; deployed cloud journey                                                                             | Windows can help, but native GPU-browser evidence needs a deliberately defined run and must not be inferred from WSL headless software rendering |
| C11                | External model execution, representative-household/agency design scoring, formal assistive-technology/WCAG review and professional review                                         | Optional provider plus human/professional evaluation; not a C14 dependency                                                                       |
| C12                | External model quality, human-rated design quality and representative production-composed study                                                                                   | Human/provider evaluation; deterministic option engine is complete                                                                               |
| C13                | Live products, prices, stock, suppliers and lead times                                                                                                                            | Commercial catalog/provider work; creator-owned generic catalog is sufficient for current deterministic flow                                     |
| C14                | Real Blender/Cycles render, executable/build attestation, real EXR channel/pixel validation, same-host replay and the accepted renderer-to-publication journey                    | **Only current C14 closure blocker.** CPU profile is sufficient                                                                                  |
| C14 optional/later | CUDA/OptiX high-resolution profiles, external image enhancement, representative-home perceptual/professional review and production deployment                                     | Not required for the portable C14 baseline; retain as `NOT RUN` until separately authorised                                                      |
| C15-C18            | Video, compare/decide/collaborate, implementation handoff and complete release hardening                                                                                          | New implementation checkpoints, not merely deferred tests                                                                                        |

## 4. Critical interpretation of the Windows/NVIDIA opportunity

The Windows workstation is valuable, but it does not close all rows above.

### What it can close or materially advance

- C14 real Blender/Cycles CPU acceptance in WSL.
- Later C14 CUDA/OptiX profile evidence, but only after an accepted GPU-profile harness exists. The
  current repository host-acceptance script intentionally creates the CPU reference profile only.
- The frozen C8 Nerfstudio/gsplat acceptance package, if the workstation and inputs satisfy its
  exact pins.
- Real COLMAP/Open3D work through a separately defined C8 geometry run.
- C10 native-Windows browser GPU evidence through a dedicated acceptance route.
- C15 frame rendering when C15 is later opened and implemented.

### What it cannot close

- C7 RoomPlan/LiDAR physical-device evidence.
- Real iOS RGB-D capture and on-device behavior.
- Representative-home truth without a rights-cleared dataset and independent ground truth.
- Human design-quality, accessibility or professional review.
- Live provider, cloud, production-recovery or commercial-catalog decisions.

### Important C8 limitation

`ml/reconstruction/windows-nvidia/run-acceptance.ps1` builds an image containing pinned COLMAP,
Open3D, Nerfstudio and gsplat dependencies, but its fixed entrypoint executes the Nerfstudio/gsplat
**appearance adapter**. A pass would not by itself prove:

- the repository's COLMAP sparse/dense geometry adapter end to end;
- the Open3D known-pose TSDF adapter end to end;
- physical capture or usable RGB-D poses;
- C9 fusion; or
- representative geometric accuracy.

The package is also frozen to Windows 11 24H2 build 26100, NVIDIA driver 572.83, CUDA 11.8,
Python 3.10.13, PyTorch 2.1.2+cu118, COLMAP 3.9.1, Nerfstudio 1.1.5 and gsplat 1.4.0. A newer host
may be technically compatible but is not exact frozen-environment evidence. Do not downgrade a
working machine blindly. First record the drift, then either run a clearly non-promotional probe or
authorise a controlled package/contract refresh before accepted evidence.

The script grants the container 16 CPUs, a 48 GiB memory limit, 8 GiB shared memory and a 64 GiB
work tmpfs ceiling. A workstation with 32 GiB RAM is not a credible host for that unchanged command;
64 GiB system RAM is the practical minimum and more is preferable.

## 5. Recommended machine and filesystem topology

```text
Windows 11 host
├── NVIDIA Windows driver (the only display driver)
├── Docker Desktop using the WSL 2 backend and Linux containers
├── native Windows Blender (inventory/interactive use only; not current C14 runner)
├── C:\C8\reconstruction-input      (rights-cleared C8 input)
├── C:\C8\reconstruction-output     (empty before a C8 run)
├── C:\C8\reconstruction-evidence   (C8 host evidence)
└── WSL 2: Ubuntu-22.04
    ├── ~/src/interior-design         (primary Git checkout)
    ├── ~/opt/blender-<frozen-build>  (official Linux Blender archive)
    ├── Node 22.22.2 + pnpm 10.33.0
    ├── Python 3.12 via uv
    └── Docker CLI integrated with Docker Desktop
```

Use `~/src/interior-design`, not `/mnt/c/Users/...`, for the primary clone. Microsoft and Docker
both recommend keeping Linux-tool projects in the Linux filesystem to avoid cross-filesystem I/O,
permissions, case-sensitivity and symlink problems:

- <https://learn.microsoft.com/en-us/windows/wsl/filesystems>
- <https://docs.docker.com/desktop/features/wsl/use-wsl/>

Do not install a second Docker Engine inside Ubuntu when using Docker Desktop integration; Docker
documents that the two installations can conflict:

- <https://docs.docker.com/desktop/features/wsl/>

For CUDA in WSL, install/update the NVIDIA **Windows** driver. Do not install a Linux NVIDIA display
driver inside WSL; NVIDIA exposes the Windows driver into WSL. A separate Linux CUDA toolkit is
needed only to compile CUDA applications, not merely because Docker/Blender consumes the exposed
driver:

- <https://docs.nvidia.com/cuda/wsl-user-guide/index.html>

### Optional second clone for C8

When the C8 PowerShell package is ready to run, use a separate short-lived native Windows clone such
as `C:\src\interior-design-c8` at the exact evidence SHA. This avoids asking PowerShell and Docker
build contexts to traverse `\\wsl$`. GitHub, not manual folder copying, is the transfer mechanism.
Never share `node_modules`, Python environments or generated outputs between the two clones.

## 6. W0 — workstation discovery and bootstrap

### Objective

Produce a redacted capability report and a ready/not-ready decision without changing product code,
the ledger or accepted evidence status.

### Windows checks

Record, without machine serial numbers, usernames, public IPs or credentials:

- Windows edition/version/build;
- CPU model/logical processors, total RAM and free disk;
- GPU model, VRAM, NVIDIA driver and `nvidia-smi` result;
- `wsl --version`, `wsl -l -v` and whether Ubuntu is WSL 2;
- Docker Desktop version, Linux-container mode and WSL integration;
- `docker version`, `docker compose version` and a bounded GPU container probe;
- native Windows Blender version/build as inventory only; and
- Git/GitHub authentication state.

Compare the actual host to `ml/reconstruction/windows-nvidia/versions.json`; do not silently treat a
newer value as an exact match.

### WSL setup

1. Install/update WSL 2 and Ubuntu-22.04 if absent. A reboot may be required.
2. Enable Docker Desktop's WSL integration for that distribution and keep Linux-container mode.
3. Clone the repository into the WSL filesystem. Keep the W0 setup checkout on the latest
   `origin/main` so this planning handoff is present, and verify that the accepted Session A baseline
   object also exists:

   ```sh
   mkdir -p ~/src
   cd ~/src
   git clone https://github.com/AbhinavGupta707/Interior-Design.git interior-design
   cd interior-design
   git checkout main
   git pull --ff-only
   git cat-file -e 97f42274cba54679eaf27aa89722e53053b0018a^{commit}
   git status --short --branch
   ```

   W1 must read this plan while on the planning commit, then create its acceptance branch from exact
   Session A commit `97f42274cba54679eaf27aa89722e53053b0018a`. The later documentation-only
   planning commit is not renderer evidence.

4. Install exact repository tools: Node 22.22.2, pnpm 10.33.0, uv and Python 3.12.
5. Run `python3 tests/bootstrap/check_prerequisites.py`, then locked installs:

   ```sh
   pnpm install --frozen-lockfile
   UV_CACHE_DIR=.cache/uv uv sync --frozen
   ```

6. Download an official Linux x86-64 Blender archive into `~/opt`, retain its download hash and use
   the real absolute executable path. Do not use a distro package that may change independently.
   The contract does not nominate a universal version; the accepted run must freeze and attest the
   exact chosen version, build hash and executable SHA-256.
7. Confirm at least 20 GiB free in WSL's temporary filesystem. More is prudent for dependencies and
   retained evidence.

### W0 stop conditions

Stop before C14 acceptance if:

- the checkout is not exactly the intended pushed SHA or is dirty;
- Blender is a Windows executable rather than a Linux regular executable in WSL;
- WSL temp space is below 20 GiB;
- the Blender executable or repository scripts are symlinks/non-regular/unhashable;
- the locked install fails and would require changing a manifest or lockfile;
- Docker integration is unstable when the production-composed part is required; or
- the host cannot be explicitly authorised for Blender execution.

## 7. W1 — C14 authorised-host acceptance

### Objective

Close the one remaining mandatory C14 gate against the exact pushed Session A commit, or return a
precise failed/not-run diagnosis without weakening the contract.

### Accepted baseline

The repository-owned acceptance script executes:

- one 64x64, one-sample smoke render;
- a 256x256, 16-sample primary CPU Cycles render;
- a same-host replay of that primary render;
- all five required artifacts;
- real GLB and OpenEXR inspection;
- protected-geometry replay comparison; and
- Blender executable/build/script/profile/host hashing.

That standalone script is the first renderer gate, not the whole Session B. The accepted close-out
plan also requires the exact accepted renderer descriptor to complete the production-composed
API/worker/object-store journey, followed by fresh artifact download and independent validation.
Session A's `FrozenInertRenderer` journey proves the control plane but cannot substitute for this
real renderer-to-publication link.

It uses a 45-second renderer timeout and requires 20 GiB free. Those are actual acceptance
constraints, not recommendations. A timeout is a failed gate to diagnose, not permission to edit the
evidence or claim success.

### Run shape

From the exact clean WSL checkout, with a never-before-created repository-relative output directory:

```sh
C14_ACCEPTANCE_BLENDER_PATH=/home/<user>/opt/blender-<build>/blender \
  pnpm exec tsx workers/blender-renderer/scripts/host-acceptance.ts \
  --output-directory docs/evaluation/render-stills/artifacts/c14-windows-wsl-<date>
```

Before running it, the task must read and follow:

1. root and blue-sky `AGENTS.md` files;
2. the active M1 plan;
3. `docs/orchestration/checkpoints/C14_CONTRACT.md`;
4. `docs/orchestration/checkpoints/C14_CLOSEOUT_EXECUTION_PLAN.md`;
5. `docs/runbooks/development/c14-blender-renderer.md`;
6. `docs/evaluation/render-stills/C14_INTEGRATED_CLOSEOUT_2026-08-11.md`; and
7. the ledger and this plan.

### Required decision logic

- A Blender launch failure, missing OpenImageIO behavior, malformed pass, non-finite channel,
  protected-object mismatch, timeout or failed replay is a real finding.
- If artifact byte hashes differ but the accepted protected-geometry comparison passes, record the
  exact difference. Do not claim byte identity. Close only if this matches the contract's explicit
  reproducibility scope; otherwise diagnose or seek an authorised contract decision.
- Do not change to CUDA/OptiX to make CPU acceptance faster. That would test a different profile.
- If a code fix is required, make it on a `codex/` branch, run affected Session A gates, push the new
  exact commit, then rerun all host acceptance from the new commit. Evidence from the old commit
  cannot close the new one.
- Raw render artifacts may stay ignored/outside Git. Track a concise evaluation record with exact
  hashes, versions, counts, limitations and durable location, and update the ledger only after pass.
- After the standalone host bundle passes, configure the exact executable/script/build/profile/host
  pins and run the accepted production API/worker/object-store journey with the real renderer. If no
  bounded repeatable command exists, add the smallest host-only integration harness without
  weakening the production boundary, then rerun its affected Session A gates before using it.
- Re-download all five published artifacts through fresh opaque access and revalidate bytes, hash,
  type, dimensions, signatures, EXR channels/pixels and source/manifest linkage independently.

### W1 completion criteria

C14 becomes `renderer-hardware-complete` only when:

- the real Linux Blender/Cycles CPU acceptance passes;
- real EXR/PNG/GLB validation and same-host replay are retained;
- the exact source commit and renderer identity are recorded;
- the production API/worker/object-store journey uses that exact accepted renderer and the
  downloaded published artifacts pass independent validation;
- no failed step is relabelled as unavailable or synthetic evidence;
- the evaluation record and ledger are committed, reviewed and pushed; and
- the final worktree is clean.

CUDA/OptiX performance, external enhancement, representative-home review, physical capture and
production deployment may remain `NOT RUN` after this baseline closure.

## 8. Deferred evidence campaign after C14

Do not mix this campaign into the C14 closure commit. Open a separately authorised evidence campaign
and work in dependency order.

### E1 — C7 physical iOS field gate

Required hardware: supported LiDAR iPhone/iPad plus a Mac with compatible Xcode. Windows is not a
substitute. Execute the frozen C7 field protocol and preserve room, multi-room/structure,
interruption, offline/background, accessibility and accuracy evidence. This remains a C18 release
blocker until completed.

### E2 — C8 Windows/NVIDIA capability and package decision

1. Compare actual host pins to `ml/reconstruction/windows-nvidia/versions.json`.
2. Inspect whether the frozen image can still build from its digest/source/lock pins.
3. Acquire or create a rights-cleared holdout with an exact manifest, service-processing consent,
   training denied and independent geometric truth where accuracy is claimed.
4. If host/package pins differ, decide explicitly between:
   - a non-promotional compatibility probe; or
   - a reviewed package refresh with new hashes, versions and evaluation rules.
5. Run the appearance package only after the input/output/evidence directories satisfy its fixed
   contract. Retain the offline runtime probe, resource samples, outputs and hashes.

### E3 — C8 real geometry

Define and execute separate real COLMAP sparse/dense and Open3D known-pose TSDF runs through the
repository adapters. Record input rights, versions, hardware, registration coverage, scale/status,
resource use, errors, severe-error cases and artifact hashes. Do not treat neural appearance as
dimensional truth.

### E4 — C9 real fusion

Only after real plan/RoomPlan/reconstruction inputs exist, compare fused output against each
single-source baseline and independent truth. Measure residuals, abstentions, severe errors and
human correction time. Do not run a synthetic replay and label it representative evidence.

### E5 — C10 hardware-GPU browser

Use a native Windows hardware-accelerated Chromium path against the local application and prove the
renderer is not SwiftShader/software fallback. Record actual canvas behavior and defined load/FPS/
call/idle budgets. WSL headless Chromium may still expose a software/major-caveat renderer, so GPU
identity must be evidence, not an assumption.

### E6 — optional C14 accelerated profiles

Add or approve a profile-specific acceptance route before claiming CUDA or OptiX. The current
host-acceptance script proves CPU only. Compare accelerated output using the cross-device tolerances
in the C14 contract; never claim CPU/CUDA/OptiX byte identity.

## 9. Relationship to C15

C15 is walkthrough/design video: collision-checked camera paths, deterministic Blender frames,
durable jobs, resumable FFmpeg encoding, captions/playback and optional separately labelled
enhancement/narration.

Its dependencies are:

- stable C10/C13/C14 source and renderer boundaries;
- an accepted or honestly deferred real Blender-frame host;
- FFmpeg/ffprobe (the continuation freezes 8.1 for the original baseline);
- a new C15 contract/prelude, migration allocation and four exclusive implementation lanes; and
- independent temporal, geometry, interruption, browser and accessibility QA.

NVIDIA is beneficial for high-resolution frame throughput but not conceptually required for a
low-resolution deterministic baseline. External video enhancement, voice, music and paid providers
remain optional and disabled until a separate data/rights/spend decision.

After C14 is reviewed, C15 should be opened only by the orchestrator under the worktree protocol.
Unlike W0/W1, C15 is substantial parallel implementation and the active plan assigns four lanes. Use
`gpt-5.6-sol` with `xhigh` for architecture/security/renderer/temporal integration and record every
lane in the contract and ledger before launch.

## 10. GitHub and cross-device handoff rules

- GitHub `origin` is the transfer source of truth. Do not AirDrop/zip/copy the Mac checkout.
- Always fetch and identify the exact SHA before evidence execution.
- Keep the Mac and Windows worktrees idle relative to one another during a hardware run.
- Prefer a `codex/c14-windows-acceptance` branch for any fixes or tracked evidence. Do not amend,
  rebase or force-push the accepted Session A commit.
- Never commit customer media, rights-controlled inputs, model weights, raw large renders, C8
  outputs, credentials, host serials or private paths. Commit redacted summaries and hashes only.
- A successful evidence branch must still be integrated onto `main` and reflected in the ledger
  before the checkpoint status changes.

## 11. Copy-ready kickoff prompt for W0

```text
Prepare this Windows/NVIDIA workstation for the Interior Design repository without yet claiming or
running C14 acceptance.

Use gpt-5.6-sol with High reasoning. Work as a single primary task; do not open worktrees. Read both
AGENTS.md files, the active M1 plan, docs/orchestration/LEDGER.md, and
docs/orchestration/HARDWARE_EVIDENCE_AND_WINDOWS_EXECUTION_PLAN.md.

Perform W0 only. Collect a privacy-redacted inventory of Windows, CPU/RAM/disk, NVIDIA GPU/VRAM/
driver, WSL, Docker Desktop, Docker GPU access, installed native Blender and GitHub authentication.
Compare the host exactly with ml/reconstruction/windows-nvidia/versions.json but do not downgrade or
refresh anything silently. Set up WSL 2 Ubuntu-22.04, Docker Desktop WSL integration and a primary
clone at ~/src/interior-design on the latest origin/main planning commit. Verify that exact Session A
commit 97f42274cba54679eaf27aa89722e53053b0018a exists locally, but keep W0 on the planning commit so
this handoff remains readable. Install the repository's exact Node/pnpm/Python/uv toolchain and frozen
dependencies. Install an official Linux Blender archive under ~/opt and record its
version/build/download hash, but do not run the C14 host-acceptance script.

Do not edit product code, accepted contracts or the ledger. Finish with a ready/not-ready report,
exact commands/results, drift from frozen pins, blockers and the absolute Linux Blender path. Keep
secrets, host serials, usernames, public IPs and customer data out of output.
```

## 12. Copy-ready kickoff prompt for W1

```text
Complete C14 Session B on this explicitly authorised Windows workstation using Linux Blender inside
WSL 2.

Use gpt-5.6-sol with Extra high (xhigh) reasoning. Work as one primary orchestrator task; do not open
parallel worktrees unless real acceptance uncovers at least two substantial independent code defects.
Read both AGENTS.md files, the active M1 plan, C14_CONTRACT.md, C14_CLOSEOUT_EXECUTION_PLAN.md,
C11_C15_CONTINUATION.md, the C14 renderer runbook, the integrated C14 close-out evaluation, the
ledger, and HARDWARE_EVIDENCE_AND_WINDOWS_EXECUTION_PLAN.md.

First read the handoff plan from the latest origin/main planning commit. Then create a
codex/c14-windows-acceptance branch from exact clean Session A commit
97f42274cba54679eaf27aa89722e53053b0018a. The later planning commit is not renderer evidence. The
user explicitly authorises Blender execution on this Windows/WSL host. Use the official Linux Blender
executable inside WSL, not native Windows blender.exe. First verify the W0 capability report, absolute
executable, build/version/hash, locked dependencies and at least 20 GiB free.

Run the repository-owned bounded C14 host acceptance with cycles-cpu-geometry-safe-v1 into a new
repository-relative ignored artifact directory. Validate the real five-artifact bundle, GLB/EXR/PNG
content, protected geometry and same-host replay at the exact contract scope. Do not switch to GPU,
weaken timeouts/validation, claim byte identity when hashes differ, or relabel a failure as evidence.
Then run the production-composed API/worker/object-store journey using that exact accepted renderer
descriptor, re-download every published artifact through fresh opaque access and independently
revalidate it. The Session A FrozenInertRenderer chain is control-plane evidence only and does not
satisfy this real renderer-to-publication step.

If acceptance passes, create a tracked redacted C14 authorised-host evaluation, update the ledger to
renderer-hardware-complete, run all affected verification and git diff checks, commit on a codex/
branch, push it, and report exact SHAs/hashes/counts/limitations. Keep raw large artifacts, private
host identity, credentials and customer data out of Git. If a code fix is needed, push the fix, rerun
affected Session A gates, and repeat all host acceptance against the new exact commit before closure.
Do not open C15 in this task.
```

## 13. Current recommendation

1. Push this planning record so the Windows task can read it from GitHub.
2. Run W0 on the Windows PC.
3. If W0 is ready, run W1 and fully close C14 with CPU Cycles.
4. Review and integrate the evidence commit.
5. Choose between opening C15 or first running a separately scoped deferred-evidence campaign.

The recommended choice after C14 is to run the C8 workstation/package discovery before opening C15,
because it is a bounded way to expose frozen-environment drift and actual GPU capacity. Do not let
that discovery block C15 indefinitely: C7 physical hardware, representative data and provider choices
are independent programmes, while C15 can begin from a trustworthy deterministic renderer baseline.

# C8 v2 Blackwell modernisation contract

## Status and authority

- Version: c8-blackwell-contract-v3.
- Authorised base: c48c60ee8f179603670207642e31c56eba84b315.
- Implementation branch: codex/c8-v2-blackwell.
- Counted hardware implementation commit:
  ebf6cb173b73cc75e7b983f90a9d867a4f13f5e0.
- Runtime: gpt-5.6-sol with xhigh reasoning in one primary session. No delegated
  agent, Codex worktree, or orchestration workflow is used.
- This is a bounded C8 hardware re-entry. It does not open C15 or alter the
  sequential M1 checkpoint state.
- The complete ml/reconstruction/windows-nvidia/** C8 v1 package is immutable,
  byte-for-byte unchanged from the base, and NOT RUN.

## Product and exposure boundary

C8 v2 may create immutable reconstruction proposals and non-dimensional appearance
artifacts. It cannot mutate a canonical home, establish real-world scale, promote a
splat or render to dimensional truth, infer an exact interior from address context,
or bypass C4/C5 validation and confirmation.

The package is **acceptance-only**. C8_V2_ACCEPTANCE_ONLY is a fail-closed exposure
guard, not a production worker switch: its accepted state is status=acceptance-only
and productionRoutingEnabled=false. No reconstruction worker route, queue dispatch,
platform configuration, or product UI invokes the v2 package. Production routing
requires a later contract and representative/physical evidence; an example script or
incompatible Nerfstudio override is not support.

All inputs require an explicit service-processing right. Training use is distinct and
denied for these fixtures. Sources and derived artifacts are content-hashed. Physical
capture and representative-home evidence are independent field gates and do not block
eligible workstation runtime, algorithm, or repeatability evidence.

## Frozen workstation stack

| Component    | Exact v2 selection                                                                                                                       | Boundary                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Base OS      | Ubuntu 24.04 containers on Docker Desktop WSL2                                                                                           | no host CUDA/driver install                     |
| CUDA build   | nvidia/cuda:13.2.0-devel-ubuntu24.04 at digest f9492f2eea77fbc3d0c14fa8738f35946b42da72917bf5959d284ca39b4f209a                          | build stages and final appearance image         |
| CUDA runtime | nvidia/cuda:13.2.0-runtime-ubuntu24.04 at digest 7fada70c5ed1b85cb3c15b53f51300fdacff1c31466a20e4f2b29ad952fd63a2                        | final COLMAP/Open3D images                      |
| Python       | Ubuntu CPython 3.12.3                                                                                                                    | container only                                  |
| PyTorch      | 2.13.0+cu132                                                                                                                             | appearance                                      |
| gsplat       | 1.5.3                                                                                                                                    | project-owned direct API                        |
| Open3D       | 0.19.0                                                                                                                                   | CUDA tensor probe plus separate legacy CPU TSDF |
| COLMAP       | 4.1.1, commit a0d785fba74b2664f31edc4a29026a8b27c00f67, archive SHA-256 6ecd8f333bdfc46491d067f05aaadbc97f7fa9f0b98c1a0e67cb9d3dd7604637 | deterministic CPU sparse; CUDA dense            |
| GPU target   | compute capability 12.0; project probe compiled sm_120                                                                                   | RTX 5080                                        |

COLMAP 3.13.0 at 0b31f98133b470eae62811b557dc2bcff1e4f9a5 is retained only
as the officially tagged comparison candidate. It is not the selected v2 stack because
the retained fixture generated valid depth/normal maps but strict PLY payload
validation found zero fused vertices after reasonable alternatives.

CUDA 13.0.88 and 13.2.51 both compiled and executed native sm_120 kernels and
completed real PyTorch, Open3D, and gsplat work. CUDA 13.2 is selected because it
matches the driver-advertised generation and the accepted official PyTorch cu132
wheel. This does not claim compatibility with an untested driver or GPU.

## Appearance decision

C8 v1 reaches gsplat through Nerfstudio 1.1.5 splatfacto. That frozen combination
expects gsplat 1.4.0 and has a broader viewer/training dependency graph. C8 v2 does not
override it.

C8 v2 owns a bounded direct-gsplat acceptance trainer/exporter. It validates calibrated
RGB/camera input, performs rasterization, backward gradients and optimizer updates,
holds out one frame, then writes a safe checkpoint/result and strict-payload-validated
PLY. It never estimates or publishes canonical geometry. The result remains
**experimental, non-dimensional, and acceptance-only** even when synthetic workstation
gates pass.

## Runtime topology and build policy

- Git, pnpm, uv, Docker, and gh run inside Ubuntu WSL against the ext4 checkout.
  PowerShell is a thin dispatcher.
- Docker contexts, fixtures, workspaces, and outputs stay on WSL ext4. No Windows
  clone or UNC bind mount is an authoritative Git surface.
- GPU access uses Docker Desktop's WSL integration. No Linux NVIDIA display driver
  or host-wide CUDA toolkit is installed.
- Acceptance containers use no network, a read-only root, dropped capabilities,
  no-new-privileges, one GPU, explicit CPU/RAM/PID limits, read-only inputs,
  isolated outputs, and bounded tmpfs.
- gsplat 1.5.3 checks for NVCC while loading its prebuilt extension cache. The final
  appearance image therefore deliberately uses the pinned devel base; the populated
  cache and root are read-only, so runtime recompilation is denied.
- APT indices are not snapshot-pinned. Exact base digests, source archives/commits,
  hashed requirement locks, installed-package manifests, runtime binary hashes,
  image IDs, and command/log hashes identify the accepted build.

## Versioned evidence model

Durable evidence uses c8-blackwell-evidence-v3, run records use
c8-blackwell-run-v3, and the envelope kind is
c8-blackwell-workstation-envelope-v3. The production parser must round-trip the
machine record exactly. Verdicts remain separate:

1. runtimeVerdict: passed | failed | not-run. A pass requires exact
   image/source/dependency identity, device/driver identity, compute capability,
   native sm_120 probe execution, and non-trivial component work.
2. Per-component algorithmVerdict:
   passed | partial | failed | abstained | not-run for COLMAP sparse, COLMAP dense,
   Open3D TSDF, and direct gsplat. Output existence or headers alone are insufficient.
3. repeatabilityVerdict: passed | failed | not-run. Two fresh selected-stack
   observations per algorithm must use exact input/config/tool identities and satisfy
   named tolerances.
4. physicalCaptureVerdict:
   passed | failed | deferred-not-run. It cannot be inferred from synthetic or
   workstation evidence.
5. representativeAccuracyVerdict uses the same field vocabulary and remains
   independently deferred.

Records include rights, source/generator hashes, inputs, dependency locks, canonical
config hashes, image IDs, command/log hashes, strict output hashes, elapsed time,
resource peaks, warnings, failures, diagnostics, and cleanup state.

## Algorithm and repeatability gates

### COLMAP

- The selected sparse front end is deliberately deterministic CPU SIFT, brute-force
  matching, and mapper execution: random seed 0, one thread, one model. A counted run
  must register all 10 retained fixture views and produce non-zero points and
  observations.
- The selected dense path must execute CUDA PatchMatchStereo on GPU 0, produce 20
  non-empty finite depth maps and 20 normal maps, and write a strict
  payload-validated PLY with more than zero finite vertices.
- PLY validation parses all declared scalar payload values for ASCII, binary
  little-endian, and binary big-endian formats; it rejects truncation, trailing bytes,
  non-finite coordinates/scalars, range violations, unsupported list properties, and
  header/payload count disagreement.
- Two fresh selected runs require exact registered-image counts and at most 1%
  relative deltas in sparse points/observations and dense PLY vertices.
- COLMAP 3.13 is a diagnostic comparison. Patch-match success with a valid
  zero-vertex PLY remains partial, never a selected dense pass.
- CUDA bundle adjustment may be claimed only if Ceres confirms CUDA/cuDSS. No such
  claim is made.

### Open3D

- A real CUDA tensor matrix operation proves the Open3D wheel/device path.
- Known-pose RGB-D TSDF uses the separate legacy-cpu backend and must produce
  non-empty finite points, vertices, and triangles.
- Two fresh runs require equal CUDA checksums and equal TSDF counts.
- The supplied synthetic metre unit is not independent physical scale validation.

### Direct gsplat

- The project-owned trainer must execute 24 deterministic forward/backward optimizer
  updates on calibrated synthetic cameras, evaluate a held-out frame, and export a
  strict-payload-validated PLY plus checkpoint/result.
- Two fresh runs require equal exported vertex counts and an absolute held-out PSNR
  delta no greater than 0.001 dB.
- A trainer result never supplies canonical dimensions, collision geometry, or scale.

## Closure boundary

Eligible workstation closure requires:

- byte-for-byte unchanged v1 and NOT RUN;
- typed v3 evidence round-trip and package-manifest coverage;
- schema/unit/Ruff/mypy and relevant repository, contract, integration, security,
  and C8 gates;
- counted RTX 5080 evidence pinned to an exact committed source SHA;
- complete diff, secret, generated-artifact, path, and C15 review;
- pushed commits on PR #2 without merging; and
- zero disposable C8 temp paths, containers, tags, helper processes, and added
  worktrees, without global Docker pruning.

Physical iOS/LiDAR/RoomPlan evidence, representative-home/multi-room/metric accuracy,
customer/provider data, paid/cloud execution, production deployment, and professional
review remain deferred-not-run or not used. C15 remains closed.

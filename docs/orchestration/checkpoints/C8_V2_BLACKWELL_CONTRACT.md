# C8 v2 Blackwell modernisation contract

## Status and authority

- Version: `c8-blackwell-contract-v2`.
- Authorised base: `c48c60ee8f179603670207642e31c56eba84b315`.
- Implementation branch: `codex/c8-v2-blackwell`.
- Runtime: `gpt-5.6-sol` with `xhigh` reasoning in one primary session. No Codex
  worktree or delegated agent is used, per the session-specific instruction.
- This is a bounded C8 hardware re-entry. It does not open C15 or change the
  sequential M1 checkpoint state.
- The complete `ml/reconstruction/windows-nvidia/**` C8 v1 package is immutable,
  retained byte-for-byte, and remains `NOT RUN` in this session.

## Product boundary

C8 v2 may create immutable derived reconstruction proposals and non-dimensional
appearance artifacts. It cannot mutate a canonical home, establish real-world scale,
promote splats or renders to dimensional truth, infer an exact interior from address
context, or bypass C4/C5 validation and confirmation.

All inputs require an explicit service-processing right. Training use is a distinct
field and is denied for the acceptance fixtures. Source bytes and all derived outputs
are content-hashed. Physical capture and representative-home evidence are independent
field gates and do not block eligible workstation runtime or synthetic-algorithm
evidence.

## Frozen workstation stack

| Component      | Exact v2 selection                                                                                               | Boundary                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Base OS        | Ubuntu 24.04 container on Docker Desktop WSL2                                                                    | no host CUDA install                    |
| CUDA toolchain | `nvidia/cuda:13.2.0-devel-ubuntu24.04@sha256:f9492f2eea77fbc3d0c14fa8738f35946b42da72917bf5959d284ca39b4f209a`   | build stages and final appearance image |
| CUDA runtime   | `nvidia/cuda:13.2.0-runtime-ubuntu24.04@sha256:7fada70c5ed1b85cb3c15b53f51300fdacff1c31466a20e4f2b29ad952fd63a2` | final COLMAP/Open3D images              |
| Python         | Ubuntu CPython `3.12.3`                                                                                          | container only                          |
| PyTorch        | `2.13.0+cu132`                                                                                                   | appearance                              |
| gsplat         | `1.5.3`                                                                                                          | direct API, no Nerfstudio wrapper       |
| Open3D         | `0.19.0`                                                                                                         | known-pose TSDF and CUDA tensor probe   |
| COLMAP         | `3.13.0`, commit `0b31f98133b470eae62811b557dc2bcff1e4f9a5`                                                      | CUDA `sm_120`, headless                 |
| GPU target     | compute capability `12.0`, compiled `sm_120`                                                                     | RTX 5080                                |

CUDA 13.0.2 and 13.2.0 both compiled and executed real `sm_120` kernels. Matching
PyTorch/gsplat/Open3D workloads passed on `2.13.0+cu130` and `2.13.0+cu132`. CUDA 13.2
is selected because it is the driver-advertised toolchain, has an official PyTorch
wheel, and avoids freezing v2 one minor generation behind. This does not claim
forward compatibility with an untested driver or GPU.

## Appearance decision

Nerfstudio `1.1.5` remains a frozen v1 integration only. Its `splatfacto` package
requires gsplat `1.4.0`, exposes a broad training/viewer dependency graph, and is not
the proven Blackwell combination above. C8 v2 therefore owns a small direct-gsplat
trainer and deterministic PLY/checkpoint exporter. It consumes only validated RGB
frames plus calibrated cameras, never estimates canonical geometry, and exports
appearance with `non-dimensional-appearance` authority.

The direct trainer remains **experimental** unless its runtime, algorithm and
repeatability verdicts pass **and** separate rights-cleared representative-home and
physical-capture evaluation is accepted. Synthetic workstation passes alone do not
promote it to production support. A script that only imports gsplat, a Nerfstudio
override, or an upstream example is not production support. Geometry completion is
independent of appearance outcome.

## Runtime topology

- Git, `pnpm`, `uv`, Docker and `gh` run inside Ubuntu WSL against the ext4 checkout.
- Docker build contexts and acceptance inputs remain on WSL ext4. PowerShell is a
  thin dispatcher only; it does not bind a Windows clone or translate output paths.
- GPU access comes from Docker Desktop's WSL integration. No Linux NVIDIA display
  driver or host-wide CUDA toolkit may be installed.
- Containers run without network, with a read-only root filesystem, explicit writable
  workspace/tmpfs, CPU/RAM/PID bounds and one selected GPU.
- gsplat's CUDA extension is compiled during image construction. Its 1.5.3 loader
  checks for a CUDA toolkit/NVCC before loading the cached backend, so the final
  appearance image deliberately retains the pinned devel base. Runtime recompilation
  is prevented by a read-only root and the already-populated cache; a runtime-only
  base is not falsely claimed as supported.

## Versioned evidence model

Every durable record uses `c8-blackwell-evidence-v2` and reports the following
verdicts separately. No aggregate word such as “passed” may replace them.

1. `runtimeVerdict`: `passed | failed | not-run`. Requires exact image/source/package
   hashes, device/driver identity, compute capability, compiled `sm_120` evidence and
   successful non-trivial GPU work for each claimed component.
2. `algorithmVerdict`: `passed | partial | failed | abstained | not-run`. Reported per
   COLMAP sparse, COLMAP dense, Open3D TSDF and direct gsplat. Output existence alone
   is insufficient; component-specific counts/finite metrics and safe failures are
   required.
3. `repeatabilityVerdict`: `passed | failed | not-run`. Requires two fresh runs with
   exact input/config/tool hashes. Byte hashes are compared where deterministic;
   otherwise the record names the bounded metric/tolerance and both results.
4. `physicalCaptureVerdict`: `passed | failed | deferred-not-run`. It cannot be
   inferred from workstation or synthetic evidence and is deferred until a physical
   iOS capture is supplied.

Representative-home accuracy is a distinct `representativeAccuracyVerdict` with the
same `passed | failed | deferred-not-run` vocabulary and is also deferred. Records
include rights basis, processing consent, training consent, source/generator hashes,
input hashes, command/config hash, output hashes, elapsed time, peak resources,
warnings, failures and cleanup state.

## Algorithm gates

### COLMAP

- GPU feature extraction and matching must log binding to GPU 0.
- Sparse pass requires one model with at least two registered images, non-zero 3D
  points and parseable camera/image records.
- Dense pass requires CUDA patch-match with finite non-empty depth maps and a
  non-empty fused point cloud. Patch-match success with zero fused points is `partial`.
- COLMAP 3.13 uses `FeatureMatching.max_num_matches` and
  `FeatureMatching.guided_matching`; removed v1 `SiftMatching` names are forbidden.
- CUDA bundle adjustment may be claimed only if Ceres confirms CUDA/cuDSS. The current
  distro Ceres falls back to CPU and must be recorded as such.

### Open3D

- A real CUDA tensor operation proves the wheel/device path.
- Known-pose RGB-D TSDF produces non-empty finite point and triangle counts.
- TSDF geometry remains a proposal and has no scale authority beyond supplied units.

### Direct gsplat

- At least three optimizer steps execute gsplat rasterization, backward gradients and
  parameter updates on `sm_120` with finite loss.
- Production acceptance trains from the calibrated-camera input, exports an
  independently parseable PLY plus safe checkpoint/manifest, and records held-out
  image metrics.
- A trainer result never supplies canonical dimensions, collision geometry or scale.

## Deferred and closure boundary

Physical iOS capture, LiDAR/RoomPlan comparison, customer imagery,
representative-home accuracy, multi-room coverage, provider/cloud execution and
professional review are `deferred-not-run`. No customer data, paid provider, external
model key or training permission is used.

Closure requires unchanged v1 hashes; v2 schema/unit/Ruff/mypy gates; relevant
repository contract/integration/security/C8 gates; counted hardware evidence pinned to
committed source; complete diff/secret/path review; and removal of all temporary
fixtures, containers and worktree metadata created by this session. The branch is
committed, pushed and opened as a ready PR. C15 remains closed.

# C8 v2 Blackwell reconstruction package

This package is the separately versioned RTX 5080/Blackwell implementation of the
[C8 v2 contract](../../../docs/orchestration/checkpoints/C8_V2_BLACKWELL_CONTRACT.md).
It does not replace or modify `ml/reconstruction/windows-nvidia/**`; that complete C8
v1 package remains frozen and `NOT RUN`.

## Accepted stack

| Component                    | Exact pin                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CUDA build / appearance base | `nvidia/cuda:13.2.0-devel-ubuntu24.04@sha256:f9492f2eea77fbc3d0c14fa8738f35946b42da72917bf5959d284ca39b4f209a`   |
| CUDA geometry runtime        | `nvidia/cuda:13.2.0-runtime-ubuntu24.04@sha256:7fada70c5ed1b85cb3c15b53f51300fdacff1c31466a20e4f2b29ad952fd63a2` |
| Python                       | 3.12.3                                                                                                           |
| PyTorch                      | 2.13.0+cu132                                                                                                     |
| gsplat                       | 1.5.3, direct API                                                                                                |
| Open3D                       | 0.19.0                                                                                                           |
| COLMAP                       | 3.13.0 at `0b31f98133b470eae62811b557dc2bcff1e4f9a5`                                                             |
| CUDA target                  | `sm_120` / compute capability 12.0                                                                               |

The spike built and executed non-trivial CUDA 13.0.2 and CUDA 13.2.0 workloads.
CUDA 13.2 was selected because it matches the workstation driver's advertised
toolchain and the matching official PyTorch wheel. This is an exact tested selection,
not a compatibility claim for other drivers or GPUs.

gsplat 1.5.3's backend loader checks for a CUDA toolkit before loading the
build-populated extension cache. The final appearance image therefore intentionally
retains the pinned devel base. Its root filesystem is read-only during execution and
the compiled extension is already present; runtime recompilation is not relied upon.

## Topology and safety

Run Git, Docker, `pnpm`, `uv` and `gh` inside Ubuntu WSL from an ext4 checkout.
PowerShell may dispatch `wsl.exe`, but inputs, outputs and build contexts remain on
ext4. Docker Desktop supplies WSL GPU integration. Install neither a Linux NVIDIA
display driver in WSL nor a host-wide CUDA toolkit.

Runtime containers must use:

- `--network none`, `--read-only`, `--cap-drop ALL` and
  `--security-opt no-new-privileges`;
- exactly one selected GPU plus explicit CPU, RAM and PID ceilings;
- a bounded, no-exec `/tmp` tmpfs;
- read-only immutable inputs and a new empty writable output directory; and
- an exact image digest from the build record, never a mutable tag.

The service-side `ContainerInvocation` builder enforces the common boundary.
The acceptance record must still retain the complete argv/config hash.

## Build

From the repository root:

```sh
docker build --file ml/reconstruction/windows-nvidia-v2/Dockerfile.colmap \
  --tag c8-v2-colmap:local .
docker build --file ml/reconstruction/windows-nvidia-v2/Dockerfile.open3d \
  --tag c8-v2-open3d:local .
docker build --file ml/reconstruction/windows-nvidia-v2/Dockerfile.appearance \
  --tag c8-v2-appearance:local .
```

Each build compiles `sm120_probe.cu` with an exact `sm_120` code target. The
appearance build also imports the gsplat CUDA backend so runtime does not depend on a
fresh JIT build. Record `docker image inspect` digests and sizes after every build.

## Geometry

COLMAP 3.13 keeps SIFT extraction limits under `SiftExtraction.*` while moving
matcher controls to `FeatureMatching.*`. Use the argument tuples in
`blackwell_v2.colmap_commands`; do not reuse the v1 matcher namespace.

A valid sparse result has parseable camera/image records, at least two registered
images and nonzero points. Dense success requires all of the following:

1. CUDA patch-match processes the registered views;
2. generated depth and normal binaries are parseable and finite;
3. fusion produces a parseable PLY with a nonzero vertex count.

COLMAP may return zero even when map writes fail, and may write a valid zero-vertex PLY.
Run `validate_colmap_outputs.py` after patch-match/fusion and use its counts rather
than process exit alone:

```sh
python3 ml/reconstruction/windows-nvidia-v2/validate_colmap_outputs.py \
  --dense-root /absolute/private/work/dense \
  --ply /absolute/private/output/fused.ply
```

Open3D's `open3d_probe.py` executes a CUDA tensor operation and known-pose RGB-D TSDF
integration. All reconstructed geometry remains `proposal-only`; supplied arbitrary
or metric units do not become independently established scale.

## Direct gsplat appearance

C8 v2 does not override Nerfstudio. `direct_gsplat.py` is a bounded project-owned
trainer that accepts the exact `c8-direct-gsplat-input-v2` schema:

- 2–500 hash-pinned, same-size PNG RGB frames;
- calibrated 3x3 intrinsics and 4x4 world-to-camera matrices;
- 3–100,000 explicit initial Gaussian proposals;
- processing permission required and training permission denied;
- 3–10,000 optimizer steps, a fixed seed and bounded learning rate; and
- right-handed local coordinates in arbitrary units.

It performs real gsplat rasterization, backward gradients and Adam updates, reserves
the final frame for held-out MSE/PSNR, and atomically exports:

- `appearance.ply`, independently parseable but non-dimensional;
- `appearance-checkpoint.json`, data only—never pickle; and
- `appearance-result.json`, including losses, hashes, versions and resource peaks.

The output directory must be empty. Output never establishes canonical geometry,
dimensions, collision surfaces or scale. Appearance remains experimental until
rights-cleared representative-home and physical-capture evaluation is separately run.

## Evidence and verdicts

Durable evidence uses `c8-blackwell-evidence-v2` and reports these independently:

- runtime: exact image/dependency/source hashes, compiled `sm_120`, capability 12.0,
  and a real GPU workload;
- algorithm: separate COLMAP sparse, COLMAP dense, Open3D TSDF and direct-gsplat
  verdicts;
- repeatability: two fresh runs plus explicit byte or metric tolerances;
- physical capture: `deferred-not-run` until a physical iOS capture exists; and
- representative accuracy: `deferred-not-run` until rights-cleared representative
  homes and ground truth exist.

A zero-point dense fusion is `partial`, even when patch-match and the command exit
succeed. Synthetic workstation evidence cannot pass either field verdict. Record every
source, generator, dependency, config and output hash; rights; elapsed time; peak
resources; warnings; failures; and cleanup state.

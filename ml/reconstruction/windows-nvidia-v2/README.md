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
| COLMAP                       | 4.1.1 at `a0d785fba74b2664f31edc4a29026a8b27c00f67`                                                              |
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
fresh JIT build. The COLMAP build verifies the official commit archive against
`6ecd8f333bdfc46491d067f05aaadbc97f7fa9f0b98c1a0e67cb9d3dd7604637`;
all images retain installed package lists, lock hashes and native-probe code-object
records. COLMAP additionally retains its CMake selection and PatchMatch code-object
inventory. Ubuntu APT repositories are not snapshot-pinned, so exact image IDs and
the installed manifests—not the Dockerfile alone—identify counted binaries.

## Geometry

Official COLMAP 4.1.1 moves the extraction image-size limit to
`FeatureExtraction.max_image_size`, retains the SIFT feature-count limit under
`SiftExtraction.max_num_features`, and uses `FeatureMatching.*` for matcher
controls. Use the argument tuples in `blackwell_v2.colmap_commands`; do not reuse
the v1 namespace.
Counted sparse acceptance fixes seed zero, one CPU thread, CPU SIFT/brute-force
matching and a single mapper model to bound GPU sparse nondeterminism. CUDA
PatchMatch remains the real RTX dense workload; sparse CPU execution is reported
separately and is not represented as GPU work.

On the same retained ten-view project-owned fixture, 4.1.1 produced a non-empty
validated dense PLY while 3.13 produced zero points after geometric, photometric,
relaxed-filter and fresh photometric diagnostics. The 3.13 comparison remains
`partial`, not failed runtime. Upstream 4.1.1 deliberately compiles MVS as
`compute_90` PTX for SM100+ because of its documented NVCC workaround; that PTX
JIT-executed on the RTX 5080. The separate project probe is native `sm_120`.
Do not conflate those two code paths.

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

Open3D's `open3d_probe.py` reports two distinct operations. The tensor matrix
workload runs on `CUDA:0` and proves the CUDA-enabled wheel/device path. The legacy
`ScalableTSDFVolume` known-pose integration is CPU TSDF; the CUDA probe does not make
that TSDF GPU-backed. All reconstructed geometry remains `proposal-only`; the
supplied metre unit is not independently established scale.

## Direct gsplat appearance

C8 v2 does not override Nerfstudio. `direct_gsplat.py` remains the bounded
project-owned C8 trainer for the exact `c8-direct-gsplat-input-v2` schema:

- 2-500 hash-pinned, same-size PNG RGB frames;
- calibrated 3x3 intrinsics and 4x4 world-to-camera matrices;
- 3-100,000 explicit initial Gaussian proposals;
- processing permission required and training permission denied;
- 3-10,000 optimizer steps, a fixed seed and bounded learning rate; and
- right-handed local coordinates in arbitrary units.

The C8 entrypoint preserves its accepted real gsplat rasterization, rasterizer
backward and Adam updates. C14.9 does not replace that contract.
`direct_gsplat_capture.py` is a separate capture-evaluation entrypoint over the
same validated input. It keeps every geometry value fixed, uses real gsplat
forward renders, and applies deterministic CPU float64 Adam updates only to one
global gain per RGB channel. It deliberately disables gsplat CUDA backward
because its atomic accumulation repeatedly violated C14.9's frozen two-run
threshold.

Both entrypoints reserve the final frame for held-out MSE/PSNR and atomically
export:

- `appearance.ply`, independently parseable but non-dimensional;
- `appearance-checkpoint.json`, data only - never pickle; and
- `appearance-result.json`, including losses, hashes, versions and resource peaks.

The capture adapter emits v3 checkpoint/result schemas with its method and
deterministic controls. Its repeatability result is not a quality or accuracy
claim. The output directory must be empty. No output establishes canonical
geometry, dimensions, collision surfaces or scale. Appearance remains
experimental until rights-cleared representative-home and physical-capture
evaluation is separately run.

## Acceptance runner and exposure

C8 v2 is acceptance-only. No reconstruction job kind, worker route, configuration
key or environment variable enables production dispatch; the package's explicit
guard raises `C8_V2_ACCEPTANCE_ONLY`. Direct gsplat remains experimental.

After building and recording immutable local image IDs, run two fresh selected passes
and the optional 3.13 comparison from a clean exact commit:

```sh
python3 ml/reconstruction/windows-nvidia-v2/run_acceptance.py \
  --source-commit <40-character-committed-sha> \
  --output-root /tmp/c8-v2-acceptance-<sha> \
  --colmap-image sha256:<selected-4.1.1-image-id> \
  --open3d-image sha256:<open3d-image-id> \
  --appearance-image sha256:<appearance-image-id> \
  --comparison-colmap-image sha256:<3.13-comparison-image-id>
```

The runner regenerates the retained COLMAP fixture, generates the calibrated gsplat
fixture inside the pinned image, runs two fresh selected passes, strictly validates
PLY payload records, samples Docker/NVIDIA resources, preserves exact argv/log hashes
and continues to independent components after ordinary failures. Every container
command has a 15-minute timeout with exact-name cleanup. It never installs a
driver/toolkit or invokes Docker prune. Review raw runner output into durable evidence,
then remove the exact temporary root and session-created image tags.
The runner also fails unless both selected passes meet explicit sparse/dense,
Open3D and direct-gsplat tolerances; two individually non-empty runs are not by
themselves a repeatability pass.

## Evidence and verdicts

Durable evidence uses `c8-blackwell-evidence-v3` and reports these independently:

- runtime: exact image/dependency/source hashes, compiled `sm_120`, capability 12.0,
  and a real GPU workload, while separately naming each component's actual code path;
- algorithm: separate COLMAP sparse, COLMAP dense, Open3D TSDF and direct-gsplat
  verdicts;
- repeatability: two fresh runs plus explicit byte or metric tolerances;
- physical capture: `deferred-not-run` until a physical iOS capture exists; and
- representative accuracy: `deferred-not-run` until rights-cleared representative
  homes and ground truth exist.

A zero-point dense fusion is `partial`, even when patch-match and the command exit
succeed. Synthetic workstation evidence cannot pass either field verdict. Each run
reports only its actual algorithm subset; the typed workstation envelope owns aggregate
runtime, per-algorithm, repeatability, physical-capture and representative verdicts and
round-trips the committed JSON. Record every source, generator, dependency, config and
output hash; rights; elapsed time; sampled resource peaks; warnings; failures; and
cleanup state.

`generate_colmap_fixture.py` is the retained pure-standard-library source for the
creator-owned PPM/known-pose fixture. Generated source bytes are disposable; the
generator, exact generator hash, manifest and per-file hashes make regeneration and
comparison reproducible without customer, provider or phone data.

## C14.9 Capture Envelope evaluation

C14.9 adds a secure, offline-verifiable path from one accepted physical
`capture-envelope-v1` to the quarantined evaluation package. `capture_benchmark.py` exports exact
C2/C7 bytes through freshly authorized access, rejects redirects and non-HTTPS transfer
authorities, verifies a private immutable tree, freezes normal and inclusive selections separately
for every coordinate segment, converts ARKit camera-to-world evidence into OpenCV/COLMAP
world-to-camera proposals, and emits a non-production routing plan. It never joins coordinate
segments or treats camera, depth, reconstruction, render, or appearance output as canonical truth.

`open3d_capture.py` consumes only exact sample-bound depth and reports explicit eligible,
integrated, missing, finite, non-finite, and non-positive denominators.
`prepare_gsplat_capture.py` consumes cameras, images, and points from the same retained COLMAP text
model directory; its output and `direct_gsplat.py` remain non-dimensional appearance evidence.
`capture_metrics.py` requires the complete two-run candidate/cohort/segment matrix, exact
selection/policy/image/config/deterministic-control linkage, non-empty artifact hashes, frozen
metric vocabulary, explicit failures and resource/isolation ceilings. The synthetic
`generate_capture_benchmark_fixture.py` proves software executability only.

Experimental pins live in `experimental-candidates.json`. VGGT is licence/hash blocked; MASt3R and
Video Depth Anything are quarantined but remain dependency-lock/image blocked. The verifier
requires an exact clean source tree including untracked state, exact recursive submodules, weights,
registry, fully hashed lock, a symlink-free confined candidate root, and the exact local image
before policy selection. Nothing here changes production C8 routing, establishes physical or
representative accuracy, or creates dimensional truth. Use the exact sequence and non-claims in
`docs/runbooks/development/C14_9_CAPTURE_ENVELOPE_BENCHMARK.md`.

## C14.10 learned reconstruction audit

C14.10 is a separate proposal-only audit over the retained C14.9 selection. Its frozen registry is
`c14-10-learned-candidates.json`. VGGT commercial, VGGT-Omega, MASt3R and DUSt3R abstain at
access or licence gates. Independent review found conflicting official licence metadata for
DA3-LARGE-1.1: its exact model card says Apache-2.0 while the exact source registry says CC BY-NC
4.0. Large is therefore blocked pending upstream or legal clarification; its historical outputs
remain quarantined and excluded from the accepted quality denominator. DA3-SMALL is the sole
executable Apache-2.0 candidate. Blocked candidates must not be silently accepted, substituted or
scored.

`Dockerfile.da3` consumes the exact official DA3 source through a named local build context,
applies `da3-offline-inference.patch` with zero fuzz, installs the fully hashed base and additive
locks, compiles the project SM120 probe and embeds no model weight or capture media. Model
snapshots and every runtime input/output stay on restrictive WSL ext4 and are mounted read-only
where applicable.
The candidate registry retains the counted image's original patch SHA-256. The submitted patch is
a semantically identical zero-context normalization whose SHA-256 is
`9e4c34f7beb04f9315fc203e164fdcac6fab55a19d7458ac47cba879a79a1e0d`; GNU patch accepted it against
the exact source commit with zero fuzz. The counted image and accepted Small rerun were not rebuilt.

`prepare_da3_capture.py` copies one frozen cohort/segment without changing RGB bytes.
`da3_capture.py` validates exact image/model hashes, runs one joint multiview proposal, exports
data-only camera/PLY artifacts, and uses the final view only for an independently aligned held-out
point projection when four or more views exist. `run_da3_matrix.py` requires the complete viable
candidate denominator, validates exact weight/config/model-card hashes, enforces exact image
identity, network none, non-root/read-only isolation and frozen ceilings, retains exact private
argv plus typed preparation/runtime/resource/validation failures, and records expected versus
completed run and repeatability counts. `da3_metrics.py` separates repeatability from quality,
marks a repeatable zero-coverage render as `FAILED_ZERO_COVERAGE`, and leaves geometric
connectivity `NOT RUN` because a joint inference batch does not prove connectivity.
`render_ply_views.py` produces deterministic local-only inspection views and hashes; it never
establishes dimensions or recognisability.

No C14.10 file enables production dispatch. Camera/depth/point/render outputs remain proposals,
coordinate segments remain independent, and dimensional and representative accuracy remain
`NOT RUN`.

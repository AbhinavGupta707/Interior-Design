# C8 v2 Blackwell workstation acceptance — 2026-08-19

## Outcome

C8 v2 workstation runtime is accepted on this exact RTX 5080 / driver 595.79 /
Docker Desktop WSL2 host at implementation commit
`e7ecb026afdc43c7bc33691687737f91dd287f02`.

The accepted stack is Ubuntu 24.04 containers, CUDA 13.2.51, Python 3.12.3,
PyTorch 2.13.0+cu132, gsplat 1.5.3, Open3D 0.19.0 and COLMAP 3.13.0 at
`0b31f98133b470eae62811b557dc2bcff1e4f9a5`, compiled for `sm_120`.
COLMAP/Open3D use the pinned CUDA 13.2 runtime base. Direct gsplat deliberately
uses the pinned devel base because gsplat 1.5.3 checks for NVCC while loading its
already-built extension cache; the final root/cache are read-only and runtime
recompilation is denied.

This is not an aggregate product pass. The separate verdicts are:

| Evidence dimension           | Verdict                                               |
| ---------------------------- | ----------------------------------------------------- |
| Workstation runtime          | **passed** for COLMAP, Open3D and direct gsplat       |
| COLMAP sparse algorithm      | **passed**                                            |
| COLMAP dense algorithm       | **partial** — finite depth/normals, zero fused points |
| Open3D CUDA/TSDF algorithm   | **passed** on synthetic known-pose RGB-D              |
| Direct-gsplat algorithm      | **passed** on synthetic calibrated cameras            |
| Repeatability                | **passed** under the named per-component tolerances   |
| Physical iOS capture         | **deferred-not-run**                                  |
| Representative-home accuracy | **deferred-not-run**                                  |

Geometry remains `proposal-only`. Appearance remains
`non-dimensional-appearance` and the v2 appearance capability remains
**experimental**. Nothing here establishes canonical dimensions, real-world
scale, collision geometry, a representative home, or provider capacity.

The complete machine-readable record is
[`c8-v2-blackwell-evidence-2026-08-19.json`](./c8-v2-blackwell-evidence-2026-08-19.json).
It is a detailed workstation envelope over the strict `RunEvidence` semantics, with
separate COLMAP, Open3D and direct-gsplat image identities rather than one misleading
aggregate image digest.

## Compatibility spike and selection

Disposable CUDA 13.0.2 and CUDA 13.2.0 environments each performed real work on
the RTX 5080:

- NVCC compiled `sm_120` kernels and the GPU executed them;
- PyTorch 2.13 performed a 2048×2048 CUDA matmul;
- Open3D performed a CUDA tensor operation plus known-pose TSDF integration; and
- direct gsplat performed rasterization, backward gradients and optimizer updates.

CUDA 13.0.2 used base digest
`sha256:5dc1bca23d05bd37b011be68ec470c03b403a5da07ec3a86e41af9470e9d0cc6`
and NVCC 13.0.88. CUDA 13.2.0 used base digest
The raw kernel payloads (120 for CUDA 13.0 and 132 for CUDA 13.2) are retained
separately from the independently recorded `compiledArchitecture: sm_120` field.
`sha256:f9492f2eea77fbc3d0c14fa8738f35946b42da72917bf5959d284ca39b4f209a`
and NVCC 13.2.51. Both were viable. CUDA 13.2 was selected because it matches the
installed driver's advertised generation and the accepted PyTorch cu132 wheel.

The spike also established these non-obvious constraints:

- Open3D 0.19.0 needs `libX11` in the headless runtime.
- gsplat's private JIT helper changed; the supported backend import works once
  the executable build cache exists.
- A `noexec` extension cache fails during compilation. Production compiles it
  while the image is built, then runs with an immutable populated cache.
- COLMAP 3.13 uses `FeatureExtraction.*` and `FeatureMatching.*` GPU options,
  while SIFT size/count limits remain `SiftExtraction.*`.
- COLMAP can log certain output failures yet return zero; v2 therefore validates
  required directories, binary model records, finite maps and PLY vertices
  independently.
- The available Ceres build does not provide CUDA/cuDSS bundle adjustment.
  Feature extraction, matching and patch-match are GPU-backed; bundle
  adjustment is honestly recorded as CPU fallback.

## Appearance boundary

C8 v1 currently reaches gsplat through Nerfstudio 1.1.5 `splatfacto`.
Nerfstudio 1.1.5 pins gsplat 1.4.0 and carries a much broader training/viewer
dependency surface. Overriding it to gsplat 1.5.3 would not be a proven
production combination.

C8 v2 therefore implements a project-owned bounded direct-gsplat
trainer/exporter. It validates exact calibrated-camera inputs, executes gsplat
rasterization/backpropagation/update, holds out one frame, and exports a
parseable PLY plus a safe checkpoint and manifest. It never estimates or
publishes canonical geometry. Synthetic acceptance is sufficient for its
workstation/algorithm gates, but not for a production appearance-quality claim;
the capability stays experimental.

## Counted host and topology

- Windows 11 Pro 10.0.26200 build 26200; WSL 2.6.3.0; kernel
  6.6.87.2-microsoft-standard-WSL2.
- AMD Ryzen 9 9900X, 24 logical CPUs, 65,905,455,104 bytes RAM.
- NVIDIA GeForce RTX 5080, compute capability 12.0, 16,303 MiB VRAM, driver
  595.79.
- Docker Desktop 4.78.0; Engine 29.5.3; Linux/amd64 containers.
- Authoritative Git and all package/build/test tools ran inside Ubuntu against
  the ext4 checkout. PowerShell was only the dispatcher.
- No Linux NVIDIA display driver or host-wide CUDA toolkit was installed.

Containers ran offline, with a read-only root, dropped capabilities,
`no-new-privileges`, PID/CPU/RAM bounds, fixed GPU 0, read-only inputs,
independent empty outputs and `noexec` scratch tmpfs mounts.

## Rights and fixtures

Both fixtures are creator-owned synthetic inputs with service processing allowed
and training denied. No customer or provider data was used.

The COLMAP fixture has eight exact 640×480 PNG sources. Their canonical sorted
hash-list digest is
`41be0a35c371f9ce9cd46c9e33551a956f50af73d39524d7c3495d67dc3838ef`;
all eight individual hashes are in the JSON record. The disposable generator
source was not retained, so this evidence supports replay from the exact
hash-pinned bytes but not regeneration from source code. That limitation is
explicit rather than hidden.

The calibrated-camera gsplat fixture manifest is
`925f18990c19af5815e77a7f4348d940086c9ab79e5be868edd54ca3ee0f4a89`.
Its retained generator is
`471d1422c6b97b81a93d3fd6ffa5535810e8255fdf885528d760b469b5af0e9e`;
the three frame hashes are in the JSON record.

## Hardware results

### COLMAP 3.13

Image:
`sha256:02709ef85a5a096682de174f208d422573d9b624e77d1210bf0b5277e4ff5b3c`
(1,702,841,266 bytes). The embedded probe executed a compiled `sm_120`
kernel and returned 120 on compute capability 12.0.

GPU SIFT registered all 8/8 views. Run 1 produced 4,239 sparse points, 22,608
observations and 0.345120 px mean reprojection error. Run 2 produced 4,192
points, 22,585 observations and 0.347437 px. The 1.1088% point delta is within
the declared 2% GPU tolerance; the 0.002317 px reprojection delta is within
0.01 px; registered views match exactly. Binary outputs differ, so no byte
determinism is claimed.

CUDA patch-match wrote 16 finite depth maps and 16 finite normal maps, containing
2,457,600 positive depth values. The canonical map-set digest is
`f19f496c03944aed88f1b4d36570330c88ed7e7ad801c534803856c1474d4394`.
Peak observed device memory was 1,951 MiB and peak utilization was 80%.
Geometric and diagnostic photometric fusion each produced a valid but empty
229-byte PLY
(`84585f60956b534f1486de9bce213d48ae8530b8d7374616317dc953348ed01c`).
The independent validator therefore reports
`COLMAP_DENSE_ZERO_FUSED_POINTS` and dense algorithm **partial**, while sparse
and runtime verdicts remain passed.

### Open3D 0.19.0

Counted single-manifest image:
`sha256:3d3b5b81e9cabb72690aece382048f62c3dc1417f39f303e513b2b9e3402d75b`
(2,183,045,602 bytes), config
`sha256:1c9cb796e393a9184564c339b2cdeef9ded7f6d4f69795284f4c88540eeff363`.
It executed the compiled `sm_120` probe plus CUDA matrix work and known-pose
TSDF.

Two same-digest runs were 6.513 s and 6.366 s. Both produced checksum
8,386,560.0, 2,160 points/vertices and 4,134 triangles exactly. Peak host/GPU
samplers were not captured for this component and are null in the evidence,
rather than inferred.

Default BuildKit provenance indexes regenerated an attestation wrapper despite
identical runnable config/layers. The counted image was therefore frozen with
`docker build --provenance=false`, and both counted runs used that exact
single-manifest digest.

### Direct gsplat 1.5.3

Image:
`sha256:052df5d09f9785a5bcbbaaa7d8d5aeb6d4cfd3bb47a17d53d24699543dab5024`
(6,430,032,380 bytes). Its compiled `sm_120` probe returned 120, PyTorch
reported `sm_120` in the architecture list, and each fresh run performed 24
optimizer steps.

Run 1 took 2.122 s, used 397,824 bytes peak allocated GPU memory and
1,678,487,552 bytes peak host RSS, then measured 35.255177079158756 dB on the
held-out frame. Run 2 took 1.461 s, used 397,824 GPU bytes and 1,681,641,472
host bytes, and measured 35.25517792693688 dB. The 0.000000847778124 dB delta
is within the declared 0.00001 dB tolerance. CUDA output bytes differ; both
complete output hash sets are retained in the JSON.

## Verification

The following passed on the committed v2 package:

- complete `pnpm verify`: Prettier; 24/24 JS workspace lint tasks; 24/24
  typecheck tasks; 45/45 unit tasks; 24/24 builds; Ruff; strict mypy on 100
  Python files; pytest 144 passed / 2 honest capability skips;
- `pnpm test:contract` and `pnpm test:integration`;
- `pnpm test:security`: 921/921;
- focused C8 v2 evidence/package and contract tests: 11/11;
- focused platform C8, web reconstruction and spatial reconstruction suites;
- disposable live PostgreSQL C8 integration: 8/8;
- package Ruff/format/strict-mypy gates and `git diff --check`; and
- byte-for-byte `git diff --exit-code` of the complete v1
  `ml/reconstruction/windows-nvidia/**` tree against `c48c60ee`.

The first complete verifier exposed only missing host stubs for Docker-only
dependencies. The fix was scoped to import annotations in the three image
scripts, their package hashes were refreshed, affected images rebuilt, and the
complete verifier then passed. No root manifest was changed.

## Cleanup and remaining limitations

All exact C8 temp fixtures, acceptance outputs, source builds and diagnostics
under `/tmp` were removed. The isolated C8 PostgreSQL Compose project and its
volumes were removed. All seven C8 spike/acceptance image tags and all C8
containers were removed. No additional Git worktree was ever created. No global
Docker prune was run, so unrelated caches/images/volumes were untouched.

The remaining limitations are:

- physical iOS capture, LiDAR and RoomPlan comparison: **deferred-not-run**;
- representative-home, multi-room, real-capture and metric-scale accuracy:
  **deferred-not-run**;
- COLMAP dense fusion: **partial** because the synthetic fixture fused zero
  points;
- direct-gsplat production appearance quality: **experimental**;
- COLMAP fixture regeneration: exact source bytes are retained by hashes, but
  its disposable generator source was not retained;
- paid/cloud providers, external model keys, customer data, production
  deployment and professional review: **not used/not run**; and
- C15: **not opened**.

The entire frozen C8 v1 package remains unchanged and **NOT RUN**.

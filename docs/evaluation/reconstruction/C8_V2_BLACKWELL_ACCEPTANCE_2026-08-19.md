# C8 v2 Blackwell workstation acceptance — corrected 2026-08-23

## Outcome and scope

C8 v2 workstation evidence is accepted for the **acceptance-only** package on the
exact RTX 5080 / driver 595.79 / Docker Desktop WSL2 host at counted implementation
commit ebf6cb173b73cc75e7b983f90a9d867a4f13f5e0.

The selected stack is Ubuntu 24.04 containers, CUDA 13.2.51, Python 3.12.3,
PyTorch 2.13.0+cu132, gsplat 1.5.3, Open3D 0.19.0, and official COLMAP 4.1.1
commit a0d785fba74b2664f31edc4a29026a8b27c00f67. The selected COLMAP sparse
front end is deterministic CPU work; PatchMatchStereo is the selected CUDA dense
path. A project probe separately compiled native sm_120 SASS and executed a real
kernel on compute capability 12.0.

This does not make v2 a production reconstruction worker. The package has no worker,
queue, API, UI, or product configuration route. Its fail-closed exposure state is
acceptance-only with productionRoutingEnabled=false. Geometry remains proposal-only,
appearance remains non-dimensional and experimental, and no result mutates canonical
state.

The corrected verdicts are:

| Evidence dimension           | Verdict                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| Workstation runtime          | **passed** for selected COLMAP, Open3D, and direct gsplat      |
| Selected COLMAP sparse       | **passed**                                                     |
| Selected COLMAP dense        | **passed** with two strict-payload non-empty PLYs              |
| Open3D known-pose TSDF       | **passed** on the legacy CPU TSDF path                         |
| Open3D CUDA probe            | **passed** as a separate CUDA tensor workload                  |
| Direct gsplat                | **passed** on calibrated synthetic cameras; still experimental |
| Repeatability                | **passed** under named per-component tolerances                |
| Physical iOS capture         | **deferred-not-run**                                           |
| Representative-home accuracy | **deferred-not-run**                                           |
| COLMAP 3.13 comparison       | **partial**; valid maps, zero fused vertices                   |

The machine record is
[c8-v2-blackwell-evidence-2026-08-19.json](./c8-v2-blackwell-evidence-2026-08-19.json).
It round-trips through c8-blackwell-evidence-v3 and has canonical evidence SHA-256
fa57d18a7a2fb2017c56cb8b85349c3a663c0add3cb5b23c63372d87724ff8ff.
The pretty-printed file SHA-256 is
15bc89150222a5e4744d88cc3d01f6117402c58f38afda084aa50cdb963567fc.

## Exact accepted images and source

| Component              | Immutable image ID                                                      |          Image size |
| ---------------------- | ----------------------------------------------------------------------- | ------------------: |
| COLMAP 4.1.1           | sha256:975133bb324122e74baec3a6cee14989792ab0413f5229cb9a37f3107ca635f0 | 2,031,877,888 bytes |
| Open3D 0.19.0          | sha256:f18141bb0bd07e275a552413b2ca34072f9f5b53607234f23333c747342835e7 | 2,183,046,048 bytes |
| PyTorch/gsplat         | sha256:d950e62af89e1da2b9770468e8991d266e5bc4199c46a0c052c06b06b79349ae | 6,430,025,374 bytes |
| COLMAP 3.13 comparison | sha256:2c587db48564d5abbf29802e681ceccac64518b77f9a82d2fc0b4a3aef917c47 | 1,822,778,658 bytes |

Selected COLMAP source is official tag 4.1.1, commit
a0d785fba74b2664f31edc4a29026a8b27c00f67, with codeload archive SHA-256
6ecd8f333bdfc46491d067f05aaadbc97f7fa9f0b98c1a0e67cb9d3dd7604637.
The comparison is official tag 3.13, commit
0b31f98133b470eae62811b557dc2bcff1e4f9a5, archive SHA-256
84388feabf937fc3e90568abdc2fdb4bde1a08cef8d0adb44ecaf64e9c7d1300.

The raw acceptance runner record was 60,850 bytes with SHA-256
72a95697e88fae80c93c624a152d63859f43f4bb4a67f6183ab187e576a986e5.
It identifies c8-blackwell-acceptance-runner-v3, reports no failures, and binds every
counted observation to the implementation commit above.

## Compatibility spike and CUDA selection

Disposable CUDA 13.0.2 and CUDA 13.2.0 environments each executed real RTX 5080
work:

- NVCC compiled native sm_120 kernels and the GPU returned distinct expected payloads
  120 and 132;
- PyTorch performed a CUDA matrix multiplication;
- Open3D performed CUDA tensor work plus a separate CPU known-pose TSDF workload; and
- direct gsplat performed rasterization, backward gradients, and optimizer updates.

CUDA 13.0 used base digest
5dc1bca23d05bd37b011be68ec470c03b403a5da07ec3a86e41af9470e9d0cc6 and
NVCC 13.0.88. CUDA 13.2 used base digest
f9492f2eea77fbc3d0c14fa8738f35946b42da72917bf5959d284ca39b4f209a and
NVCC 13.2.51. Both were viable. CUDA 13.2 is selected because it matches the
driver-advertised generation and official PyTorch cu132 wheel.

The project probe is the native sm_120 proof. Upstream component code paths are
recorded separately:

- the selected COLMAP 4.1.1 SM100+ workaround exposes compute_90 PTX for MVS and
  executes on SM120 through driver JIT;
- the Open3D wheel contains sm_75/sm_80/sm_86/sm_89 cubins plus compute_90 PTX,
  not native sm_120; and
- the built gsplat 1.5.3 extension contains 20 native sm_120 cubins.

No version-only or cuda.is_available-only check is counted.

## Rights-cleared retained fixtures

Both fixtures are creator-owned synthetic inputs with service processing allowed,
training denied, and customer/provider data flags false.

The retained COLMAP generator is
ml/reconstruction/windows-nvidia-v2/generate_colmap_fixture.py, SHA-256
b254537b83c54cbd59ece189cc848ea7f54d1ff067027831faf30f7a2281a188. It is a
pure-standard-library deterministic ray/plane renderer and writes 10 PPM views at
480×360 plus a known-pose COLMAP text model with 557 point tracks. The counted
fixture manifest is 1,590 bytes, SHA-256
4e6f8d247f31e7523e1655673bdb753ad03fd359bb3584e694d8289bb21f5426.
All individual image and model hashes are in the machine record. The generator is
retained, so replay does not depend on private source bytes.

The direct-gsplat input manifest is 2,208 bytes, SHA-256
925f18990c19af5815e77a7f4348d940086c9ab79e5be868edd54ca3ee0f4a89.
Its retained generator SHA-256 is
471d1422c6b97b81a93d3fd6ffa5535810e8255fdf885528d760b469b5af0e9e.
The three exact frame hashes are in the machine record.

## COLMAP comparison and selected results

### Why 3.13 remains partial

COLMAP 3.13 registered 10/10 images with 1,794 sparse points, 9,584 observations,
and 0.311709 px mean reprojection error. CUDA PatchMatchStereo wrote 20 depth maps
and 20 normal maps containing 1,728,000 positive depth samples.

Strict parsing of the resulting 229-byte binary-little-endian PLY found a valid header
and payload but zero vertices. Geometric fusion, photometric fusion, relaxed fusion
thresholds, and fresh workspaces were reasonably diagnosed without producing
non-empty fusion. Runtime therefore passed, sparse passed, and the 3.13 dense
comparison remains **partial**. It is not disguised as a selected pass.

### Why 4.1.1 is selected

A preliminary GPU-sparse 4.1.1 pair registered 10 images/3,298 points and then
7 images/220 points. That failed repeatability. The accepted configuration moved only
the sparse front end to deterministic CPU SIFT, brute-force matching, and mapper:
seed 0, one thread, one model. CUDA PatchMatchStereo and dense fusion remained real
GPU work.

Both selected runs registered 10/10 images with exactly 3,362 sparse points,
20,366 observations, and 0.369919 px mean reprojection error. Sparse database and
binary model hashes were byte-identical.

Both dense runs wrote 20 depth maps, 20 normal maps, and 3,241,745 positive depth
values. The strict PLY validator parsed every declared scalar and recorded finite
coordinate bounds:

- minimum: [-4.0627298355, -2.9445369244, 4.0654463768];
- maximum: [4.0323200226, 2.9608895779, 7.4628829956].

Run 1 produced 46,856 vertices, 281,136 finite scalars, 1,265,345 bytes, SHA-256
d76fa41d828986b710862be89868e4e9668688737e963d748f04ab9d0d7c14d1.
Run 2 produced 46,859 vertices, 281,154 finite scalars, 1,265,426 bytes, SHA-256
c00c6c23f579b423b25d8fba03b680c56f0d05e3ffdd5a09963805bfcf51b6a6.
The vertex relative delta is 0.00006402185, below the 1% bound.

Observed selected resources were:

| Run             |   Elapsed |   Peak GPU memory | Peak GPU utilisation | Peak container memory |
| --------------- | --------: | ----------------: | -------------------: | --------------------: |
| 4.1.1 run 1     | 98,482 ms | 332,398,592 bytes |                  98% |     955,252,736 bytes |
| 4.1.1 run 2     | 97,637 ms | 373,293,056 bytes |                  98% |     887,934,157 bytes |
| 3.13 comparison | 36,823 ms | 354,418,688 bytes |                  80% |     230,477,005 bytes |

## Open3D result: CUDA probe is not TSDF backend evidence

Each fresh Open3D run performed two distinct operations:

1. a CUDA:0 64×64 tensor matrix workload with checksum 8,386,560.0; and
2. legacy-cpu known-pose TSDF integration producing exactly 2,160 points/vertices
   and 4,134 triangles.

The CUDA probe proves the wheel/device path. It does not make the separate TSDF
workload CUDA-backed. The supplied synthetic depth unit is described as
metre-not-independently-validated and supplies no field-scale authority.

Run 1 took 10,112 ms with 577,765,376 bytes peak GPU memory, 3% peak utilisation,
and 620,127,846 bytes peak container memory. Run 2 took 9,063 ms with
624,951,296 GPU bytes, 1% utilisation, and 635,961,344 container bytes.

## Direct-gsplat result and boundary

The project-owned direct trainer performed 24 optimizer steps on three calibrated
synthetic frames, held one frame out, wrote checkpoint/result artifacts, and exported
six ASCII PLY vertices. The strict PLY parser validated every scalar and finite
coordinate in both exports.

Run 1 measured 35.2551741119 dB held-out PSNR and
0.000298182800 MSE. Run 2 measured 35.2551770792 dB and
0.000298182596 MSE. The absolute PSNR delta is 0.0000029672 dB, below the
0.001 dB bound. Export SHA-256 values are
ded1261259cfff243bd9c56f700055fe0fb8a04507e6c474c01d182113a1a2e6 and
d89b988ce6fb1b0a1243680062e03e0e94fc14dcde8cba62ef59e5e9eaddb43f.

Run 1 took 4,511 ms with 308,281,344 bytes peak GPU memory and
500,485,325 bytes peak container memory. Run 2 took 3,854 ms with
335,544,320 GPU bytes and 521,142,272 container bytes.

This establishes a bounded synthetic acceptance adapter, not production appearance
quality. Nerfstudio 1.1.5 remains a frozen v1 path and is not overridden.

## Build and command provenance

Requirement locks use pip hash checking. The machine record includes Dockerfile,
lock, source, generator, runner, and validator byte sizes and SHA-256 values, exact
image IDs/labels, canonical config hashes, installed Python/runtime/builder package
manifest hashes, runtime binary hashes, and every command/log hash. Command argv is
represented by SHA-256 over UTF-8 arguments joined with NUL and the encoding rule is
stored beside each hash.

Notable hashes include:

- COLMAP runtime package manifest:
  0c9f033623272376653b3716f4341b5f257af12d5605d380341d191d4a16ab1b;
- Open3D CUDA binary:
  b2be623a5e831547a8b56d0e1e32a6aba42f94cc2000ecebe9304879833b054b;
- gsplat extension:
  ed6f7c2636ffc0452c0e6f6d7835ab4b7852b39cde13535a65c98d68324fcd6d;
- COLMAP config:
  742513331c4e2fc7e943b6543dfb3a8474f5cca89507aff08dad740b1d63eacf;
- Open3D config:
  b249fbb182ddff851130328d8ef31dee4a63ededdd6375a34411e0f37a962ebd;
  and
- appearance config:
  6a04df9778f61f4e91c4108842c4fede7488cc3581b2ce204cc7da60dc80cd76.

APT repository indices are not snapshot-pinned. Exact base digests and the additional
hashes above identify what ran; the evidence does not overstate source-level package
repository reproducibility.

## Host and topology

- Windows 11 Pro 10.0.26200.9168; WSL 2.6.3.0; kernel
  6.6.87.2-microsoft-standard-WSL2.
- AMD Ryzen 9 9900X, 24 logical CPUs, 65,905,455,104 bytes RAM.
- NVIDIA GeForce RTX 5080, compute capability 12.0, 16,303 MiB VRAM, driver
  595.79, 360 W power limit.
- Docker Desktop 4.78.0; Engine 29.5.3; Linux/amd64 containers.
- WSL-native Git, pnpm, uv, Docker, and gh against the ext4 checkout were
  authoritative. PowerShell was a dispatcher.
- No Linux NVIDIA display driver or host-wide CUDA toolkit was installed.

## Verification and cleanup

The repeatable runner is ml/reconstruction/windows-nvidia-v2/run_acceptance.py. It
requires a clean exact source commit, immutable local image IDs, bounded commands,
two fresh selected runs, strict output validation, resource sampling, cross-run
tolerances, and exact container cleanup. It exits non-zero on any selected runtime,
algorithm, or repeatability failure.

Focused correction tests cover the typed evidence envelope, package manifest, exposure
guard, acceptance timeout/permissions/cleanup, repeatability gates, and strict
ASCII/binary PLY payload parsing. Full repository, contract, integration, security,
and C8 gate results are recorded in the final C8 v2 ledger/PR review for the committed
correction SHA.

Cleanup removed 11 exact C8 temporary paths, 17 C8 image tags, and the one orphaned
stdin helper from a failed evidence-materialisation attempt. Zero C8 containers or
extra worktrees remained. No global Docker prune ran; unrelated images, volumes, and
caches were untouched. Both fixture generators remain versioned in the repository.

## Remaining limitations

- physical iOS capture, LiDAR, RoomPlan comparison, ARKit pose/relocalisation,
  interruption, thermal, and upload-resume evidence: **deferred-not-run**;
- representative-home, multi-room, real-capture, metric-scale, and survey comparison
  accuracy: **deferred-not-run**;
- COLMAP 3.13 dense fusion on the retained synthetic fixture: **partial**;
- direct-gsplat production appearance quality and worker exposure: **experimental /
  acceptance-only**;
- Open3D GPU TSDF: **not claimed**; counted TSDF is legacy CPU;
- customer data, phone data, provider data, paid/cloud providers, external model keys,
  production deployment, and professional review: **not used/not run**;
- C8 v1: byte-for-byte unchanged and **NOT RUN**; and
- C15: **not opened**.

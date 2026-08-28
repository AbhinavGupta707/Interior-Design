# C14.10 proposal-only learned reconstruction audit - 2026-08-28

## Verdict

Neither viable learned candidate materially improves the retained C14.9 result for this one
physical Capture Envelope. DA3-SMALL and DA3-LARGE-1.1 both improve proposal density, preserve
25/25 registration and run much faster than the slowest COLMAP path, but their learned camera
trajectories do not align closely enough to the independent ARKit proposal to render the held-out
view. Both produce zero covered held-out pixels. The reported 5.548452293042459 dB value is the
full-frame score of a black render and is a failed-quality diagnostic, not appearance evidence.

Runtime and repeatability pass. Learned reconstruction quality does not pass. Production routing,
canonical geometry, C5/homeowner authority and every accepted C8/C14.9 route remain unchanged.
Dimensional accuracy is NOT RUN, representative accuracy is NOT RUN and production promotion is
prohibited.

## Authority and privacy

- Execution began from clean synchronized main at
  97352b7027476aa48461aea3788d1e02d3268b56 on the dedicated
  codex/c14-10-learned-reconstruction-audit branch.
- One gpt-5.6-sol / high primary session was the only implementation and execution authority. No
  subagent, worktree, separate task or parallel candidate lane was used.
- The only physical authority was the already verified immutable C14.9 Capture Envelope at
  canonical SHA-256 093e9f6259429ab28281ba60032fd6b3592f299eb90b4353103ffe7c11c48cd9.
- Media, exact selections, segment/sample identifiers, source trees, model weights, raw logs,
  point clouds, renders, command records and machine records remain mode-restricted on private WSL
  ext4. None is committed, uploaded to GitHub/CI, copied to Windows storage or sent to a model
  service.
- Normal and inclusive cohorts were prepared independently. Each retained the same 25-view segment
  and the same independent one-view interrupted segment because all retained tracking was normal.
  No segment, cohort, candidate or run was joined.

## Current upstream and licence gate

The audit inspected current official implementations and model cards before any candidate ran.

| Candidate          | Exact official source                                                                                                     | Gate result                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VGGT-1B Commercial | [facebookresearch/vggt](https://github.com/facebookresearch/vggt) at a288dd0f14786c93483e45524328726ab7b1b4ce             | Abstained. Commercial weights are gated and the custom licence requires an application and explicit agreement this checkpoint was not authorised to accept. |
| VGGT-Omega-1.4B    | [facebookresearch/vggt-omega](https://github.com/facebookresearch/vggt-omega) at 282ec70363edeff59424bf43731658092fba3d37 | Abstained. Current source/weight terms are non-commercial research and weights are gated.                                                                   |
| MASt3R             | [naver/mast3r](https://github.com/naver/mast3r) at f5209afc300cec36239a7ac992263f36847bbba0                               | Abstained. CC-BY-NC-SA-4.0 and training-dataset notices do not pass this commercial-product R&D gate.                                                       |
| DUSt3R             | [naver/dust3r](https://github.com/naver/dust3r) at 4c24a6ebf04809f2cfe59915e51779c8984aaa40                               | Abstained. CC-BY-NC-SA-4.0; no distinct executable advantage remained after the MASt3R gate.                                                                |
| DA3-LARGE-1.1      | [Depth Anything 3](https://github.com/ByteDance-Seed/Depth-Anything-3) at 3d835ec1a5802d64a8b8b15f817a1ab54809bfe4        | Viable quarantined evaluation. Official code and model card are Apache-2.0; exact ungated safetensors passed local hashes.                                  |
| DA3-SMALL          | same source commit                                                                                                        | Viable quarantined resource control under the same Apache-2.0 and exact-hash boundary.                                                                      |

No abstained candidate was executed, scored as poor quality or silently substituted.

## Immutable learned runtime

| Item                     | Exact freeze                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| DA3 source               | 3d835ec1a5802d64a8b8b15f817a1ab54809bfe4                                                                                                         |
| DA3-LARGE-1.1 weights    | revision 0e109ae307c5982f319a67cf6f9f99ccdc0ec97c; 1,643,843,860 bytes; SHA-256 739905c423cf0d6ccaf9e61a8401d82ba1ac32d7f4d3ee6dca8f92b377633f64 |
| DA3-SMALL weights        | revision e08cab65ca0ec38e7826075418411ab90cab4da3; 137,248,940 bytes; SHA-256 364492e38a3a06d221ac75da7f6621ada3f2361cd24fde11ba79091e9f40efcf   |
| Base dependency lock     | SHA-256 d09ec9260741c2fb248eaf8775d09104b038bb8920ff1a9c099e9a1fb03e684b                                                                         |
| Additive API-import lock | SHA-256 ca324ccc2fdc24d6894ddfd72880b5740949d8fdf527cf9a46d56c48ec4cc5b8                                                                         |
| Offline patch            | SHA-256 ba760cd282f3dddf02f6bf4944f95cec15b8b5914f77b5e499ce472faebd53fa                                                                         |
| Counted image            | sha256:246b7363b7ff9d2a38a688607aa9d89d6085734c1b7acc88221e00f04590e0d3; 4,376,956,845 bytes                                                     |
| Host GPU                 | NVIDIA GeForce RTX 5080; driver 595.79; compute capability 12.0; 16,303 MiB                                                                      |

The image compiled and executed a native sm_120 kernel. PyTorch 2.13.0+cu132 reported compute
capability 12.0, the patched API imported with network disabled, and both exact local model
snapshots completed a rights-safe generated-fixture inference including the held-out path.

Counted containers used the exact image ID, GPU 0, process resolution 392, seed zero, a 500,000
point cap, network none, a read-only root, the host non-root UID/GID, all capabilities dropped,
no-new-privileges, 12 CPUs, 32 GiB RAM, 512 PIDs, a 2 GiB noexec/nosuid/nodev tmpfs, read-only
input/model mounts, fresh output roots and a 45-minute timeout.

The counted image embeds `da3_capture.py` at SHA-256
`7253285f65517bf2064d501f479dae29001a83f764c6017f02cf757c3c7241b5`. The submitted file is a
runtime-equivalent closeout version whose only differences are repository-standard optional-import
`mypy` annotations; its SHA-256 is
`6d5ca1478b5f027174374204012a904edcaa7fd1cd879d77bcc35b3023a2f3ce`. The counted image and raw
results were not silently rebuilt or rewritten after execution.

## Counted comparison

All 16 learned candidate/cohort/segment/run scopes completed. The eight two-run scopes have exact
artifact hashes, zero registration/point-count/held-out metric deltas and passing repeatability.
Normal and inclusive equality reflects identical eligible frames, not a cohort join.

| Candidate / 25-view segment    | Registration and connectivity                                 | Completeness proxies                                                                                                                                                            | Held-out appearance                                                              |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| retained unconstrained COLMAP  | 20/25 in one retained model                                   | 6,706 sparse points; 27,451 and 27,449 dense points in normal repeats                                                                                                           | not defined                                                                      |
| retained ARKit-prior COLMAP    | 25/25 in one retained model                                   | 7,370 sparse points                                                                                                                                                             | input proposal cameras; not an independent accuracy result                       |
| retained fixed-geometry gsplat | corresponding 25/25 ARKit-prior proposal                      | 7,370 Gaussian centres                                                                                                                                                          | 5.841315879702146 dB, repeat delta 0; no quality floor                           |
| DA3-SMALL                      | 25/25 finite cameras in one joint learned inference component | 425,119 confidence-filtered points; full-depth validity 2,881,200 samples; ARKit camera-centre similarity residual 0.7273353602459572 source metres not independently validated | zero pixel coverage; black-frame PSNR 5.548452293042459 dB; FAILED_ZERO_COVERAGE |
| DA3-LARGE-1.1                  | 25/25 finite cameras in one joint learned inference component | 362,864 confidence-filtered points; full-depth validity 2,881,200 samples; ARKit camera-centre similarity residual 0.8970149130024385 source metres not independently validated | zero pixel coverage; black-frame PSNR 5.548452293042459 dB; FAILED_ZERO_COVERAGE |

Raw point count is not a cross-method quality score: DA3 samples per-pixel depth while COLMAP
reports triangulated/fused support under different filtering. The learned point-count increase is
therefore only a density/completeness proxy. More points do not overcome zero held-out visibility,
poor camera agreement or absent ground truth.

Both models emitted 69,149 confidence-filtered points for the independent one-view segment.
Registration count is one, but multi-view connectivity and held-out appearance are NOT RUN. This
does not reconstruct the interrupted segment and is not joined to the 25-view proposal.

## Resource use

| Candidate     |    Peak process RSS |      Peak task VRAM | Largest run output |    Maximum wall time |
| ------------- | ------------------: | ------------------: | -----------------: | -------------------: |
| DA3-SMALL     | 2,857,381,888 bytes | 1,553,910,272 bytes |    6,398,381 bytes | 3.2631042689899914 s |
| DA3-LARGE-1.1 | 4,071,612,416 bytes | 6,531,359,744 bytes |    5,464,573 bytes |  6.184433551010443 s |

For context, the retained C14.9 maxima were 4,488,240,824 bytes sampled host/container memory,
1,292,894,208 bytes task VRAM, 1,833,271,566 bytes scratch and 1,560.368453 seconds. Those maxima
span different COLMAP/gsplat algorithms and are not a controlled throughput benchmark. DA3 is
materially faster and uses far less output space here, while Large uses about five times the
retained maximum task VRAM. No frozen learned ceiling was exceeded.

## Private fixed-view inspection

Seven three-view, deterministic, no-network inspection sets were rendered and hash-recorded on
private WSL ext4: retained ARKit-prior sparse, retained unconstrained dense, retained gsplat,
DA3-SMALL and DA3-LARGE-1.1 for the 25-view segment, and both learned one-view proposals. Automated
principal-view occupancy proxies were:

| Proposal                | Non-background frame fraction | Occupied bounding-box fraction |
| ----------------------- | ----------------------------: | -----------------------------: |
| ARKit-prior sparse      |                   0.002578125 |                      0.0439725 |
| unconstrained dense     |                      0.009485 |                    0.077439375 |
| gsplat centres          |                   0.002578125 |                      0.0439725 |
| DA3-SMALL, 25 views     |                     0.0279125 |                         0.0532 |
| DA3-LARGE-1.1, 25 views |                     0.0259075 |                     0.08670125 |
| DA3-SMALL, one view     |                   0.011380625 |                       0.035695 |
| DA3-LARGE-1.1, one view |                   0.010309375 |                       0.035775 |

These local pixel-occupancy values confirm denser projected support only; they cannot establish
recognisability or geometry quality. Direct human/model visual inspection is NOT RUN because the
desktop viewer could not read the restrictive ext4 location and streaming private previews into
the model/tool channel would violate the frozen private-data boundary. The agent did not bypass
that control. The original private renders and per-view hashes are retained for local accountable
review. This limitation narrows the evidence but does not rescue either learned candidate from
the independent zero-coverage held-out failure.

## Reusable support and limitations

C14.10 adds only quarantined evaluation support: exact candidate registry and locks, an offline
source patch, a CUDA 13.2/SM120 image, immutable segment preparation, a strict DA3 adapter, hardened
matrix runner, repeatability/quality metrics, private PLY fixed-view rendering and focused tests.
It adds no API, queue route, worker dispatch, environment enablement, migration, generated client,
canonical operation or UI.

Remaining limits are material:

- one physical room/device/envelope only;
- no independent dimensions, survey scale, ground-truth geometry or representative homes;
- no direct private human/model visual inspection of the learned renders in this session;
- the held-out renderer is a confidence-filtered coloured-point projection, not a trained
  appearance model;
- DA3 camera-centre alignment uses ARKit proposal evidence only and is not an accuracy measurement;
- upstream model-card limitations and training-data scope remain applicable; and
- VGGT-class and MASt3R/DUSt3R quality remains unknown because those candidates abstained before
  execution.

The evidence supports further isolated research only if a candidate can fix held-out visibility
and pass accountable private visual review. It does not justify production or canonical promotion.

## Verification and delivery boundary

- Complete `pnpm verify` passed Prettier, 24/24 lint tasks, 24/24 typecheck tasks, 45/45 unit tasks,
  24/24 builds, Ruff, mypy across 120 source files and 157 Python tests with two expected skips.
- The exact locked optional evaluation environment passed the 15-test focused C14.9/C14.10 suite.
  In the dependency-minimal repository environment, the same invocation passes ten baseline tests
  and explicitly skips the optional DA3 module rather than importing unfrozen runtime packages.
- No migration, OpenAPI/client, root dependency, production worker, route, canonical schema,
  homeowner authority or provider setting changed.

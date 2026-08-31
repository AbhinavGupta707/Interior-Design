# C14.10 VGGT private non-commercial reconstruction feasibility — 2026-08-30

## Decision

Execution completed for a strictly private, non-commercial research comparison of original
`facebook/VGGT-1B` direct reconstruction and a patched VGGT-SLAM-derived no-loop adapter. This
record does
not authorise production, commercial use, canonical geometry, C8, joined segments or dimensional
claims. A future commercial evaluation must repeat the experiment with appropriately licensed
weights or another commercially permissible model.

The frozen staged runner recorded a quality-based direct-VGGT early stop at 48 frames and two
complete 165-frame no-loop-adapter passes. Neither learned proposal is recommended. The retained
ARKit-prior dense COLMAP proposal remains the control and was not rerun.

## Scope and retained control

The only eligible input is the retained 165-frame C14.10 Capture Envelope selection
`5e90939980de540ef01b45918b06058b10ecf1b57320d6d1b60ba409df183ae3` from sole segment
`fbb6cd55-bd85-4628-ab9e-12171d7ddb1d`. The learned-input copy has manifest SHA-256
`04e6b1b0802508e5019c5b500d0d2f49fa331a6c6804ee686e1ecbee929ca46e`. The 132-frame capture is
excluded.

The read-only control is the sealed 165-frame ARKit-prior dense COLMAP proposal:

- 165/165 registered cameras;
- 90,679 sparse points and 947,276 dense vertices;
- dense PLY SHA-256 `422d760d2e8a13ccf9f6f31356bcab1e535fcaca862484ae54e7b7cc64315a41`;
- 4,210.980 seconds dense wall time, 10,484,015,170 bytes peak host memory,
  1,724,907,520 bytes peak VRAM, 15,044,637,296 bytes scratch and 25,576,686 retained PLY bytes;
  and
- private qualitative evidence recognises the kitchen, bed and study relationships, while the
  desk corner, missing regions and continuous shell remain incomplete and outliers remain.

Three existing deterministic control renders were hash-verified and are reused without rerendering.
The control is proposal-only and has no dimensional authority.

## Candidate and licence audit

The counted executable registry was
`ml/reconstruction/windows-nvidia-v2/c14-10-vggt-nc-research-candidates.json`, frozen at SHA-256
`7156c92556903bcc70a8ac9b0072e2dbb27c5e99020588bb117968288947c4da`.
The reviewed registry adds source-content and measurement metadata without rebinding historical
results; its SHA-256 is `e01cccbe2f3c40f371b308c51aa06a51c14d89c750acb24a45301896c753cfb3`.

| Candidate                                 | Exact source / weight                                                                                                                                                                                                               | Decision                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Original VGGT direct                      | VGGT-SPARK `6e6e16107b88e8e76c751826af10d4295d87ecd2`; original `facebook/VGGT-1B` revision `860abec7937da0a4c03c41d3c269c366e82abdf9`, CC BY-NC 4.0 safetensors `f164acf60724910d8fe1578bb499d800850c7bb0948db7555c413f9fbe60467e` | Executable only in this private non-commercial checkpoint                                                   |
| Patched VGGT-SLAM-derived no-loop adapter | VGGT-SLAM `35327ac28b7d193df9ccc39ba6346052bb6f1207`, BSD-2-Clause code, same CC BY-NC VGGT implementation and weight                                                                                                               | Executable only in this private non-commercial checkpoint; not an upstream loop-closure evaluation          |
| `VGGT-1B-Commercial`                      | Gated checkpoint requiring contact/terms action                                                                                                                                                                                     | Prohibited; not requested, downloaded or used                                                               |
| VGGT-Omega                                | Gated FAIR non-commercial research terms                                                                                                                                                                                            | Blocked because access/use would require unauthorised terms action; no terms accepted                       |
| SLAM3R                                    | `f531d841ab743217a4464344119a350eb0556d17`, CC BY-NC-SA 4.0                                                                                                                                                                         | Outside bounded scope; continuous-video role is redundant, not blocked by non-commercial licensing alone    |
| CUT3R                                     | `8bc15dc92a6d7fd92920b4ec81540d3dec7d3ecf`, CC BY-NC-SA 4.0                                                                                                                                                                         | Outside bounded scope; continuous-video role is redundant, not blocked by non-commercial licensing alone    |
| MASt3R / DUSt3R                           | CC BY-NC-SA 4.0 plus checkpoint/training-data chain                                                                                                                                                                                 | Outside bounded scope; complete checkpoint/training-data chain remains unresolved because it was not needed |
| DA3-LARGE-1.1                             | Current official registry labels the weight CC BY-NC 4.0                                                                                                                                                                            | Existing evidence remains quarantined and outside the bounded execution set                                 |
| DA3-SMALL                                 | Current official registry labels the weight Apache-2.0                                                                                                                                                                              | Existing 165-frame learned control retained; not rerun after no material improvement                        |

Independent review also content-hashed the exact copied executable trees, not only their mutable
Docker build-context names and labels. VGGT-SPARK has 41 files at unpatched SHA-256
`58553c36591da1db87c1def2125c65f615193a86da2ce4f31bcbda8ec6d0434a` and patched SHA-256
`77abed7ccbef4d47a79026f98e9a8f26a951939bafada26ea0ddb6d916018b88`.
VGGT-SLAM has 11 files at unpatched SHA-256
`c8fc9cf37a097f8c78d68a398fe383943f7acaf9daf83e6ba880c2d49ee62820` and patched SHA-256
`ef078b9e30e5e744a6b0fc2c2af0d96672654ca87201400ace811f9fb6ddffb7`.
The Docker build now verifies both states around zero-fuzz patch application.

The audit used upstream primary sources: the
[original VGGT model card](https://huggingface.co/facebook/VGGT-1B),
[current official VGGT repository](https://github.com/facebookresearch/vggt),
[VGGT-SLAM](https://github.com/MIT-SPARK/VGGT-SLAM),
[VGGT-Omega licence](https://github.com/facebookresearch/vggt-omega/blob/main/LICENSE),
[MASt3R licence](https://github.com/naver/mast3r/blob/main/LICENSE),
[DUSt3R licence](https://github.com/naver/dust3r/blob/main/LICENSE),
[Depth Anything 3 registry](https://github.com/ByteDance-Seed/Depth-Anything-3),
[SLAM3R licence](https://github.com/PKU-VCL-3DV/SLAM3R/blob/main/LICENSE) and
[CUT3R licence](https://github.com/CUT3R/CUT3R/blob/main/LICENSE).

SALAD, SAM 3, Perception Encoder, open-set object detection, Hugging Face Hub, Matplotlib, OpenCV,
Open3D, Gradio and Viser are absent from the runtime. They are not required for the direct or
sequential no-loop comparison.

SALAD-based loop closure is `NOT RUN`: its additional checkpoint, security and dependency path was
deliberately excluded. This adapter therefore does not evaluate upstream VGGT-SLAM 2.0
loop-closure performance, and poor adapter output or drift would not establish failure of the full
upstream system.

## Dependency, security and runtime freeze

The 42-package hash-required lock has SHA-256
`0c1637c560d74c160da07572d77dc5a018565d88617a9a2d93e1e737e373e1ff`. Its vulnerability audit
reported zero known findings; CUDA-index Torch and torchvision local versions are recorded as
resolver exceptions. Pillow was raised to 12.3.0 in response to the initial audit. The final image
is the adapter-only overlay
`sha256:3f8eeb4923eeb559dcaef4074125403411aabaac5f83f4f1ac6f6888966a6d8e`
on sealed dependency base
`sha256:cd03bacdedd35e39991579d476d278de2db25f926e5ad88cb831ef3b2c18b42c`.

A fresh network-disabled, read-only, non-root image audit passed and is privately sealed at
SHA-256 `3b3506010c2f0774efe48d3085bd991291b7c5867faf7afd68e4fcbbf11184c0`. It:

- imported the actual `vggt.models.vggt` and `vggt_slam.solver` execution closure;
- verified every exact dependency lock, source patch and source licence digest;
- recorded licence evidence for 43 Python distributions and 143 system packages;
- verified the NVIDIA CUDA container licence, Torch `2.13.0+cu132`, CUDA availability and compute
  capability 12.0;
- verified GTSAM `SL4`, `PriorFactorSL4` and `BetweenFactorSL4`; and
- found zero prohibited optional packages.

The exact lock is not a uniform CUDA 13.2 component-stack claim. The container is CUDA 13.2.0 and
Torch is `2.13.0+cu132`, while the fully hashed resolution also contains
`cuda-bindings==13.4.0b1`, `nvidia-cublas==13.4.0.1` and
`nvidia-nvjitlink==13.4.46rc1`. The lock and each distribution's recorded licence evidence are
authoritative. A supplemental review audit, with auditor SHA-256
`2efc8a849e7c9410d21bbcd5ad89c704d17ba3d053d7c234ed46acdc01724503`, revalidated the exact
counted image, both patched source-content manifests, 43 Python distributions, 143 system
packages, actual imports, GTSAM SL(4), compute capability 12.0 and absence of optional packages.
Its private mode-0600 record has SHA-256
`f39f2582ad12e13e95a20560033ce49120f5b77fb1c7ef897e3211771f41fabc`.

The `cuda-toolkit==13.2.1` wheel is accepted only as an exact zero-code metapackage whose complete
file list is confined to `dist-info`; component packages and the CUDA container have separate
licence evidence. Current CUDA 13.2 terms were checked against
[NVIDIA's official CUDA EULA](https://docs.nvidia.com/cuda/archive/13.2.0/eula/index.html).
Unnecessary final-image CUDA repository/metapackages were purged. Ubuntu's broken OpenSSL
copyright symlink was repaired to the installed `libssl3t64` copyright evidence.

The first correction rebuild missed its ephemeral BuildKit dependency cache and failed offline at
APT before downloading or replaying the multi-gigabyte Python wheel layer. It was not retried. The
frozen recovery uses a network-disabled overlay on the already-audited sealed image and changes
only the corrected evaluator plus its auditor. Any later complete rebuild requires a persistent
private WSL-ext4 BuildKit cache and a one-time, exact-hash wheelhouse that has passed a fully offline
`pip --no-index --find-links` install rehearsal; repeated downloads of verified wheels are
prohibited.

## Staged comparison method

Both candidates run serially at 4, 16, 48 and at most 165 frames. A candidate stops after any
failed stage, invalid output, 45-minute timeout, exceeded frozen ceiling or clearly unusable
quality. The runner resumes through an explicit maximum stage so each smaller gate can be reviewed
before authorising the next one. Two fresh full runs are allowed only after all smoke stages pass.
Each full run separately reconstructs 164 frames for the last-frame held-out projection.

The hard boundary is GPU 0, 12 CPUs, 32 GiB RAM, 512 PIDs, 2 GiB no-exec tmpfs, 16 GiB retained
scratch, 500,000 retained points, a 14.5 GiB PyTorch allocated-memory ceiling, seed zero, no
network, read-only root, non-root UID/GID, all capabilities dropped and no-new-privileges. The
reported `peakTaskVramBytes` is `torch.cuda.max_memory_allocated(0)`; whole-process GPU memory is
`NOT RUN`, so the evidence does not establish a 14.5 GiB physical-VRAM ceiling. Stages are
resumable and preserve typed failures rather than retrying indefinitely.

Comparison records registered cameras, camera consistency to the retained ARKit prior, finite
support, self-normalised occupancy, held-out coverage/PSNR where valid, wall time, host memory,
reported GPU-memory fields and retained bytes. ARKit agreement is explicitly not independent accuracy. Shell
completeness, missing regions, recognisability and room relationships use deterministic private
renders plus an exact offline local visual classifier; private pixels, paths and identifiers are
not transmitted or printed. Dimensional and representative accuracy are `NOT RUN`.

## Physical result and recommendation

The counted private matrix passed both candidates at 4, 16 and 48 frames. Direct VGGT stopped at
48; only the patched VGGT-SLAM-derived no-loop adapter advanced to two 165-frame runs. Frozen
summary hashes are `973a83659e0baa3095d7e9938dc14d15766f29c04a757e5eb03686436756501b`
(4), `0194b4a8cab8f44b7658541f8c3dce8f71d9e268a6b29db319e3ba40dcfec4aa`
(16), `25f0435d5185b923ec0229338af5b8f1bf4e250e8934b2886f54ca85bef3f2f3`
(48) and `6a74c7f212b3f7c7498f3c1679acf737073c78ef2a42597cbe276ee0b094b4b4`
(165 hybrid only).

| Evidence                            | Retained ARKit-prior dense COLMAP control |                 Direct VGGT | Patched VGGT-SLAM-derived no-loop adapter |
| ----------------------------------- | ----------------------------------------: | --------------------------: | ----------------------------------------: |
| Maximum executed frames             |                              165 retained |               48 early stop |                           165, two passes |
| Registered cameras                  |                                   165/165 |                       48/48 |                                   165/165 |
| Retained finite vertices            |                                   947,276 |                     487,778 |                                   497,958 |
| Peak reported GPU memory            |                  1.725 GB process sampler | 13.826 GB PyTorch allocated |               10.849 GB PyTorch allocated |
| Peak host memory                    |                                 10.484 GB |                   10.789 GB |                         10.788 GB maximum |
| Candidate wall time                 |                 4,210.980 s dense control |              16.888 s at 48 |                         50.773 / 51.359 s |
| Retained candidate bytes            |                            25,576,686 PLY |    7,328,778 complete stage |      7,785,074 / 7,785,076 complete stage |
| Held-out coverage / full-frame PSNR |  `NOT RUN` on compatible learned protocol |  `NOT RUN` after early stop |                        1.6551% / 5.205 dB |

The learned point counts are capped proposal samples and are not density-equivalent to the control.
The two full hybrid passes produced identical point, camera and held-out-render hashes; differences
in complete stage bytes come from runtime/resource fields. The proposal PLY hash is
`adcc517768f0aa08b4bbfbcf823d17cbfec6844975d480214b1bda60b8c889ac`,
camera hash `c60cb6da66854f340ad2b48ca2ebe436d451f000a864f96dd82bffc98bb72071`
and held-out render hash
`5fd021b3ae927709267a0ddb345f738ae89686be138f716a2aa2a089982dc5b1`.

After similarity alignment to the retained ARKit prior, direct at 48 frames has 9.842 degrees
median orientation disagreement, 12.851 degrees median step-direction disagreement and 0.0969 m
position RMSE in the prior's scale. The full hybrid has 7.679 degrees, 8.635 degrees and 0.1144 m
respectively. These are camera-agreement diagnostics, not independently measured accuracy. The
hybrid's 1.987 similarity scale, 1.081 path-length ratio and very low held-out coverage show that
its no-loop sequence does not provide a stable complete shell for this capture.

The existing private control inspection recognises the kitchen, bed and study relationships but
also shows missing shell regions, a weak desk corner and outliers. An exact offline Apache-2.0
SigLIP 2 heuristic at revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2` and weight SHA-256
`612923381c76ec5a9bed335d1c48827e3f2e506ac31b044b63b2031fadee6a0b`
ranked every direct 48-frame view highest for no recognisable indoor room, with two of three also
highest for unusable geometry. Direct therefore stopped before 165 on observed unusable quality.
Its 13.826 GB PyTorch allocated-memory peak was below the frozen allocator ceiling and is not a
whole-process VRAM measurement. For the full hybrid the heuristic found a bedroom signal in one
principal view but ranked no
recognisable room highest in the other two; two views ranked unusable geometry highest and one
ranked partly coherent/incomplete highest. The same heuristic also rated two normalized control
views poorly, so it is supporting evidence only and explicitly not representative accuracy. Its
private result SHA-256 is
`1ff415d2f0a018375f41cb28c6fa53130c84b18e87a7a6598485ce7ce03b04b3`.

The local interactive comparison contains the retained 165-frame control, direct 48-frame early
stop and full 165-frame hybrid, with three normalized views each. Viewer HTML SHA-256 is
`716c8aef4b24dd7500498b4f080bfeb12e7fcf6425a3cb78347efe84ce24a7cf` and
manifest SHA-256 is
`6a3b8909f0935ff89476257d0c4096a70bcefb68cfc8777172c6a3acc6e5eb94`.

**Recommendation:** retain the sealed ARKit-prior dense COLMAP reconstruction as the control and
do not promote either learned proposal. Direct VGGT is not justified beyond 48 frames on this
hardware/capture. The hybrid proves that sequential VGGT submaps plus bounded GTSAM SL(4) can run
deterministically within the resource ceiling, but its missing regions, camera drift and held-out
failure make it strategically inferior to the control. This says nothing about upstream
VGGT-SLAM 2.0 loop-closure performance: SALAD-based loop closure is `NOT RUN` because its separate
checkpoint, security and dependency path was deliberately excluded. Any commercial evaluation
must repeat with appropriately licensed weights or a different commercially permissible model;
any later loop-closure study needs a separately authorised and fully audited chain.

## Independent PR review reconciliation — 2026-08-31

The accepted counted denominator is eight scopes: six smoke scopes (two candidates at 4, 16 and 48
frames) plus two full 165-frame no-loop-adapter passes. All eight passed. Direct VGGT's two
potential 165-frame passes, held-out metrics and comparison rows are `NOT RUN` after the manual
quality stop; they are not counted as passes, failures or attempted scopes.

Two historical direct 4-frame evaluator attempts failed before the counted denominator: the first
applied an outer BF16 autocast across a LayerNorm boundary, and the second attempted a NumPy
conversion from BF16 depth. The no-loop adapter passed during those exploratory attempts. The
direct evaluator was corrected to respect upstream precision boundaries and convert depth to
float before the counted matrix began. These failures are preserved as pre-count implementation
evidence, not hidden quality failures and not counted candidate attempts. The 165-frame matrix was
not rerun because every counted artifact, result and summary hash reconciled and the review defects
concerned evidence binding and reporting, not the learned outputs.

Review corrections make Docker builds fail closed on exact pre-/post-patch source content, reject
private-path traversal after resolution, and require resumable passing stages to match candidate,
image, registry, stage, run, result and artifact identities before being reused. No private media,
weights, paths, identifiers, geometry, render, log or unredacted classifier result is published.
SALAD and upstream loop closure remain unevaluated. These corrections do not create dimensional,
commercial, canonical, production or representative-accuracy authority and do not alter the
recommendation.

## Delivery boundary

Only isolated research evaluator, container, audit, runner, private-viewer and regression support
may enter the repository. Private media, weights, geometry, renders, detailed logs and unredacted
conclusions remain on private WSL ext4. No API, queue, worker route, environment enablement,
migration, generated client, product UI or canonical operation changes.

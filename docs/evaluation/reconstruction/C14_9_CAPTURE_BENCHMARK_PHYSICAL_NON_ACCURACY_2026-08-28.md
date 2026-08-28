# C14.9 physical Capture Envelope non-accuracy benchmark - 2026-08-28

## Verdict

The private physical Capture Envelope is offline-verifiable and the complete eligible baseline
matrix is runtime-executable and repeatable on the Windows/WSL RTX 5080 host. All 12 required run
fragments were supplied; there were zero missing, partial, failed, isolation-violating or
resource-ceiling runs; and all six selected candidate/cohort repeatability scopes passed.

This is proposal-only non-accuracy evidence. `physicalCaptureCompatibility` remains
`requires-review`, representative accuracy is `NOT RUN`, dimensional accuracy is `NOT RUN`, and
production promotion is prohibited. No result establishes canonical geometry, dimensions, scale,
structural or regulatory truth, cost, availability or professional certainty.

## Authority and privacy boundary

- PR #13 was reviewed and merged before execution. The reviewed source was
  `5254049964c0b226fef820d84de590266a4bf863`; merged `main` was
  `30b0417eb2249038f8f686a5337fdca0d47e3028`.
- The benchmark used one sequential `gpt-5.6-sol` / `high` session in the authoritative WSL
  checkout. No subagent, worktree, public cloud, GitHub artifact, CI artifact, Windows-mounted
  transfer folder or parallel candidate lane was used.
- The complete export moved directly from the Mac to WSL ext4 over fingerprint-pinned encrypted
  SSH. Temporary Mac Remote Login was disabled after the transfer and the LAN SSH port was then
  closed.
- The export contains exactly 28 private regular files and four private directories. Directories
  are mode `0700`; files are mode `0600`; no symlink, hard-linked file or special file exists.
- The official offline verifier matched both pre-authorized envelope and export-manifest digests.
  Their exact values remain only in the private WSL evidence.
- Raw media, geometry, command logs, complete strict records, source identifiers and private paths
  remain only in restrictive WSL-ext4 storage. None is committed or attached to the PR.

## Host and immutable runtime

The host preflight observed WSL kernel `6.6.87.2-microsoft-standard-WSL2`, Docker Desktop 4.78.0,
Docker client/engine 29.5.3, approximately 57.4 GB available RAM, and more than 373 GB free WSL
ext4 storage before counted execution. GPU 0 is an NVIDIA GeForce RTX 5080 with driver 595.79,
compute capability 12.0 and 16,303 MiB VRAM. Baseline free VRAM exceeded the frozen 14 GiB
ceiling before launch; the 15 GiB experimental headroom gate did not pass, so experimental
candidates remained abstained.

| Image            | Immutable local image ID                                                  |         Bytes |
| ---------------- | ------------------------------------------------------------------------- | ------------: |
| COLMAP 4.1.1     | `sha256:68be6852c13de3573a79fb049ee2116937ba424cbd29b56583dc6a58617364f6` | 2,031,877,888 |
| Open3D 0.19      | `sha256:141f6039bd347a21728df4c72c28c255b91bd8d7acf833d557027f0f21b2114f` | 2,183,067,892 |
| corrected gsplat | `sha256:93add58cb6b3ee7df927a47e98af0ed1d7d9fbac8607edea6de92d96a14e70d0` | 6,430,054,029 |

Every accepted container invocation used the exact image ID, network none, a read-only root, all
capabilities dropped, no-new-privileges, GPU 0, 12 CPUs, 24 GiB RAM, 512 PIDs, user `1000:1000`,
and a 2 GiB noexec/nosuid/nodev tmpfs. Inputs were read-only and each work/output root was fresh.
Exact argv, exit status, log hash, wall time and sampled Docker/NVIDIA/scratch peaks are retained
privately.

## Frozen selection and abstentions

The envelope has two explicitly independent coordinate segments and two independently frozen
cohorts. One segment supplied 25 eligible calibrated RGB views in both cohorts. The interrupted
segment supplied one view and therefore abstained from COLMAP and gsplat without being joined to
the eligible segment.

The policy selected six candidate scopes: unconstrained COLMAP, ARKit-prior COLMAP and direct
gsplat for the eligible segment in normal and inclusive cohorts. It retained 22 typed abstained
scopes. Exact bound depth was absent, so all four Open3D segment/cohort scopes abstained with
`EXACT_BOUND_DEPTH_ABSENT`. RoomPlan was absent and no RoomPlan-derived execution occurred. VGGT,
MASt3R and Video Depth Anything remained fail-closed at their frozen licence, weight, source,
dependency-lock and image gates; no experimental dependency, weight or image was installed or run.

Exact selection, policy, corrected-host-inventory and final-strict-record digests were frozen and
rechecked after cleanup. The values remain only in the private WSL evidence and are not Git-visible
identifiers.

## Counted results

| Candidate / cohort               | Two fresh runs                                                                            | Internal and repeatability evidence                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COLMAP unconstrained, normal     | 20/25 registered; 6,706 sparse points; mean track 3.310468; mean reprojection 1.003727 px | Counts and reported sparse metrics are exact across runs. Dense PLY payloads independently validate at 27,451 / 27,449 vertices; no frozen dense-vertex repeatability limit exists. |
| COLMAP unconstrained, inclusive  | 20/25 registered; 6,706 sparse points; mean track 3.310468; mean reprojection 1.003727 px | Counts and reported sparse metrics are exact across runs. Dense PLY payloads independently validate at 27,461 / 27,448 vertices; no frozen dense-vertex repeatability limit exists. |
| ARKit-prior COLMAP, normal       | 25/25 registered; 7,370 sparse points; mean track 2.739891; mean reprojection 1.637097 px | Exact two-run metric repeatability. Supplied camera translation is proposal evidence, not independent scale or accuracy proof.                                                      |
| ARKit-prior COLMAP, inclusive    | 25/25 registered; 7,370 sparse points; mean track 2.739891; mean reprojection 1.637097 px | Exact two-run metric repeatability. Segment coordinates remain independent.                                                                                                         |
| fixed-geometry gsplat, normal    | 7,370 proposal points; held-out PSNR 5.841315879702146 / 5.841315879702146 dB             | Delta 0 dB <= 0.01 dB. Appearance-only repeatability pass; no quality or accuracy floor.                                                                                            |
| fixed-geometry gsplat, inclusive | 7,370 proposal points; held-out PSNR 5.841315879702146 / 5.841315879702146 dB             | Delta 0 dB <= 0.01 dB. Appearance-only repeatability pass; no quality or accuracy floor.                                                                                            |

The equal normal/inclusive metrics reflect this envelope's all-normal retained tracking, not a
cohort join. Each cohort used a separately frozen selection and fresh output roots. The low gsplat
held-out PSNR is reported honestly as visual-coherence evidence; it is not a visual-quality,
photorealism, geometry or accuracy acceptance.

## Resource evidence

| Candidate            |                        Peak sampled host/container memory |           Peak task VRAM |        Peak scratch | Maximum candidate wall time |
| -------------------- | --------------------------------------------------------: | -----------------------: | ------------------: | --------------------------: |
| COLMAP unconstrained |                                       4,488,240,824 bytes |      1,146,093,568 bytes | 1,833,271,566 bytes |              1,560.368453 s |
| ARKit-prior COLMAP   | below sampler resolution for the short container commands | below sampler resolution |    43,340,537 bytes |                  3.152619 s |
| direct gsplat        |                                       1,313,304,576 bytes |      1,292,894,208 bytes |    46,940,200 bytes |                 60.463378 s |

No run exceeded 24 GiB RAM, 14 GiB VRAM, 12 GiB scratch or 30 minutes. There were no isolation or
resource-ceiling violations.

## Recoverable defects and frozen correction

The original merged-source run retained four typed gsplat preparation failures. The runbook mounts
the physical export at `/c14/export`, but the verifier originally required the runtime directory
basename to equal the envelope SHA. The narrow correction allows only an explicit caller-supplied
runtime alias while leaving default host verification strict. Regression tests prove that an
unrequested or wrong alias still fails. The corrected source was committed and frozen before any
affected rerun at `0fb9943b18856e8719d595cea3ac1cd092c0e18b`; the corrected gsplat image above was
built from that exact commit.

The first corrected attempt then honestly failed model completeness because unconstrained COLMAP
registered only 20 of 25 selected images. Validation was not weakened. The final fresh gsplat runs
used each corresponding same-run ARKit-prior text model, whose cameras, images and points all came
from that one run and covered 25/25 selected views. No model, run, cohort or coordinate segment was
mixed. Original and superseded failure logs/fragments remain retained privately outside the final
denominator.

## Verification and inspection

- The focused benchmark/adversarial-verifier suite passes 10/10 after the correction.
- Complete `corepack pnpm verify` passes formatting, 24/24 lint, 24/24 typecheck, 45/45
  JavaScript unit-test task groups, 24/24 builds, Ruff, mypy over 114 Python source files and
  pytest with 157 passed / 2 honest capability skips.
- `git diff --check` passes, and the official offline verifier still returns the exact envelope and
  manifest hashes above.
- Final private authority and output trees are restrictive, regular-file-only, non-hard-linked and
  symlink-free after disposable cache cleanup.
- A self-contained point-cloud viewer and one representative appearance proposal are retained only
  on WSL ext4. The viewer uses no external script or network request and is served only on Windows
  loopback for local human inspection. Neither viewer data nor its private path is committed.

Independent review must check the actual device/runtime, secure transfer, rights, RGB,
intrinsics/orientation, camera convention, independent segments, depth/RoomPlan abstentions,
failures and resource evidence. The PR must remain unmerged until that review completes.

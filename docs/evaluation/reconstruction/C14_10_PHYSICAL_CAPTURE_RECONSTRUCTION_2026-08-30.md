# C14.10 private physical-capture reconstruction comparison - 2026-08-30

## Verdict

The complete 132-frame and 165-frame C14.10 captures materially improve proposal usefulness and
reconstructability over the retained C14.8 25-view baseline. The best result is the **165-frame
ARKit-prior dense COLMAP proposal**: it gives the clearest connected spatial relationship between
the kitchen, bed and study areas. The 132-frame ARKit-prior proposal is second. The smoother
132-frame route does not outperform the larger 165-frame route for connected geometry, although
its recovered gsplat is slightly cleaner and has slightly higher held-out PSNR.

This is not consumer-grade reconstruction. No lane produces a closed room shell; floor/wall and
upper-wall/ceiling continuity remain incomplete; outliers, warped or duplicated surfaces and
fragmentation remain visible; and no independent measurements, exact depth or ground-truth mesh
exist. The 165-frame ARKit-prior output is useful only as a private design/reconstruction proposal.
It is not canonical, dimensional, representative, as-built, structural or regulatory evidence.

The complete first pass is sufficient to choose the next experimental direction. No full quality
repeat 2, additional model, parameter search or quality-gate relaxation was run. An identical repeat
would not supply the missing upper-shell, depth, measured-anchor or ground-truth evidence.
Repeatability of the accepted full-quality, recovered-gsplat and DA3 results remains `NOT RUN`;
the decision to stop is not a repeatability finding.

## Authority, privacy and immutable inputs

- One `gpt-5.6-sol` / `xhigh` Windows/WSL task performed transfer verification, execution, private
  inspection, correction and reconciliation. No subagent, separate task or worktree was created.
- Product source was exact commit `62a0ed823dcd85f3355b4f24040484cff720ea75`, descended from exact
  baseline `f8297043dfcee4cfbd3d3a285be9b986b6571918`. Counted DA3 first-pass support was committed
  before execution at `1002327faef3ce77df65d2b80cbd318f770d2bc5`.
- The handover recorded the Mac checkout's unstaged user-owned `AGENTS.md` at SHA-256
  `6a8dd3f230ce5f9bab435e4ac242467597f2e861ff5ff71f94852e5cc21f9533`; it was never transferred,
  overwritten or staged. The authoritative WSL source commit tracks SHA-256
  `8c96b15eb76053aaf80e943679e3d8965dda157b51f51b788aaa43cfad89b89a`, which remained
  byte-identical with no worktree or index diff.
- Fingerprint-pinned SSH transferred the complete handoff directly to fresh private WSL-ext4
  storage. The handoff-index SHA-256 is
  `581bec5ffb48702f3b7c9fe32d2af8a51eed066bfe48386004fa5e4a6f325b48`. Mac Remote Login was
  then disabled and LAN port 22 was verified closed.
- The committed offline verifier independently reverified both immutable exports before and after
  compute. The 132-frame envelope/export hashes are
  `28b397aac3de662a75a1b9221843896bdb9b17a817877d837fbd0e2a5d390603` /
  `da7761107a815d19433fcac08a3dfdc11215d95a229b82ef83db3df11b12a741`; the 165-frame values are
  `446f66243dd44d761d86be477456f03a8593333eb45a00ce604d9c257be18eb6` /
  `812bfd88ccc8f2c394383ac88a7d8eec131b4926bc345c62f9fa7786a166f05c`.
- Both exports remained regular-file-only, non-hard-linked and symlink-free with `0700`
  directories and `0600` files owned by the WSL user. All source mounts were read-only.
- Raw RGB, private identifiers, precise paths, geometry, weights, logs, renders, screenshots and
  strict records remain on native WSL ext4 outside Git, GitHub, CI, `/mnt/c` and cloud storage.
  The two captures and C14.8 baseline remained independent.

## Frozen runtime and comparison design

The host ran WSL kernel `6.6.87.2-microsoft-standard-WSL2`, Docker client/engine 29.5.3 and an
NVIDIA GeForce RTX 5080 with driver 595.79, compute capability 12.0 and 16,303 MiB VRAM. Counted
images were exact COLMAP 4.1.1
`sha256:68be6852c13de3573a79fb049ee2116937ba424cbd29b56583dc6a58617364f6`, corrected gsplat
`sha256:93add58cb6b3ee7df927a47e98af0ed1d7d9fbac8607edea6de92d96a14e70d0`, and DA3
`sha256:246b7363b7ff9d2a38a688607aa9d89d6085734c1b7acc88221e00f04590e0d3`. DA3-SMALL used the
approved weight SHA-256 `364492e38a3a06d221ac75da7f6621ada3f2361cd24fde11ba79091e9f40efcf`.
Exact depth was absent, so Open3D correctly abstained; no depth was manufactured.

The frozen plan ran unconstrained COLMAP, ARKit-prior COLMAP, same-dataset fixed-geometry gsplat
and exact DA3-SMALL independently for each complete capture. A deterministic ordered-quantile
25-view control was run twice per capture only to probe the image-count/continuity confound. The
authoritative complete quality first passes used identical data-size-appropriate stage rules derived
before execution from observed throughput. Compute stopped after the requested controls and one DA3
first pass per full capture.

| Evidence class                           | Denominator treatment                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Original exhaustive/fixed-limit attempts | Preserved as operational scalability failures; excluded from reconstruction quality |
| Early ordered attempts                   | Preserved matching/dense timeout and adapter evidence; excluded                     |
| 20-view and 32-view probes               | Diagnostic; the 32-view probe exercised the complete adapter/schema/dependency path |
| Complete full-capture quality passes     | Accepted authority: one 132-frame and one 165-frame first pass                      |
| Original direct-gsplat failures          | Preserved as `GSPLAT_DIRECT_FAILED`; not relabelled or removed                      |
| Focused gsplat recovery                  | Separate paired adapter ablation using corresponding same-dataset prior geometry    |
| Ordered-quantile 25-view controls        | Two runs per capture; sparse outcomes repeated, artifacts were not byte-exact       |
| Full quality repeat 2                    | `NOT RUN — first pass sufficient`                                                   |

## Quantitative comparison

`Reg.` is registered/input views. Sparse points are normalized per registered view and dense
vertices per input view. Point density is a support proxy, not completeness or accuracy. COLMAP
medians and an explicit geometric component count were not emitted by the retained v1 records;
this is a measurement limitation, not an invitation to infer them. Each accepted result contains
one primary mapper model, while inspection separately records fragmented surfaces within it.

| Dataset / lane              |             Reg. | Sparse points / registered view | Mean track / reprojection | Dense vertices / input view | Appearance / coverage verdict                                      |
| --------------------------- | ---------------: | ------------------------------: | ------------------------: | --------------------------: | ------------------------------------------------------------------ |
| C14.8 unconstrained         |   20/25 (80.00%) |                  6,706 / 335.30 |    3.310468 / 1.003727 px |         ~27,451 / ~1,098.04 | Incomplete, sparse and fragmented                                  |
| C14.10 132 unconstrained    |   132/132 (100%) |                 52,238 / 395.74 |    3.937210 / 1.008610 px |        1,173,101 / 8,887.13 | Detached/warped planes and outliers remain                         |
| C14.10 165 unconstrained    | 163/165 (98.79%) |                 75,887 / 465.56 |    4.850422 / 0.946372 px |       2,335,087 / 14,152.04 | More coherent than 132 but partial/folded-looking                  |
| C14.8 ARKit prior           |     25/25 (100%) |                  7,370 / 294.80 |    2.739891 / 1.637097 px |                   `NOT RUN` | Full registration, incomplete proposal                             |
| C14.10 132 ARKit prior      |   132/132 (100%) |                 51,811 / 392.51 |    3.191253 / 1.515814 px |          434,677 / 3,293.01 | Connected zone relationship, incomplete shell                      |
| C14.10 165 ARKit prior      |   165/165 (100%) |                 90,679 / 549.57 |    3.618070 / 1.506871 px |          947,276 / 5,741.07 | Best connected proposal; incomplete shell/outliers                 |
| C14.8 fixed-geometry gsplat |            25/25 | 7,370 centres / 294.80 per view |                       n/a |                         n/a | 5.841316 dB; sparse/fragmented                                     |
| C14.10 132 recovered gsplat |          132/132 | 20,000 capped / 151.52 per view |                       n/a |                         n/a | 6.076191 dB; slightly cleaner, still fragmented                    |
| C14.10 165 recovered gsplat |          165/165 | 20,000 capped / 121.21 per view |                       n/a |                         n/a | 6.005398 dB; broader/noisier, still fragmented                     |
| C14.8 DA3-SMALL             |            25/25 |    425,119 / 17,004.76 per view |                       n/a |                         n/a | 0% coverage; 5.548452 dB black-frame value; `FAILED_ZERO_COVERAGE` |
| C14.10 132 DA3-SMALL        |          132/132 |     490,776 / 3,718.00 per view |                       n/a |                         n/a | 0.07046% coverage; 5.045118 dB; quality fail                       |
| C14.10 165 DA3-SMALL        |          165/165 |     474,699 / 2,876.96 per view |                       n/a |                         n/a | 6.95678% coverage; 5.286433 dB; quality fail                       |

The recovered gsplat lanes use the same 20,000-centre cap, so centre count is not a completeness
comparison. Their low PSNR remains appearance evidence only. DA3 retained all finite proposal
cameras, but radial/fan-like duplicated surfaces and low held-out coverage preclude a coherent
room-shell conclusion.

## Resources and repeat controls

| Full-capture lane        |      Wall time | Peak host memory |  Peak task VRAM |      Peak scratch/output |
| ------------------------ | -------------: | ---------------: | --------------: | -----------------------: |
| 132 unconstrained COLMAP | 5,961.913159 s |  8,730,594,771 B | 1,724,907,520 B | 12,063,358,088 B scratch |
| 165 unconstrained COLMAP | 6,994.166688 s | 10,301,479,059 B | 1,724,907,520 B | 14,942,105,311 B scratch |
| 132 ARKit-prior COLMAP   | 2,954.628637 s |  7,949,984,465 B | 1,672,478,720 B | 10,693,329,165 B scratch |
| 165 ARKit-prior COLMAP   | 4,210.980435 s | 10,484,015,170 B | 1,724,907,520 B | 15,044,637,296 B scratch |
| 132 recovered gsplat     |      343.614 s |  1,317,208,064 B | 4,891,607,040 B |    238,243,150 B scratch |
| 165 recovered gsplat     |      438.769 s |  1,322,012,672 B | 6,005,194,752 B |    287,066,941 B scratch |
| 132 DA3-SMALL            |        8.442 s |  3,618,828,288 B | 3,584,794,624 B |     7,439,302 B retained |
| 165 DA3-SMALL            |        9.809 s |  4,024,336,384 B | 4,197,139,968 B |     8,095,291 B retained |

Both ordered-quantile 25-view controls repeated outcome-level sparse metrics within each capture:
the 132 control repeated `4/25`, `370`, `2.616216` mean track length and `0.709133 px`
reprojection error, then retained 25 prior cameras with zero points and repeated
`ARKIT_PRIOR_ALGORITHM_GATE_FAILED`; the 165 control repeated `5/25`, `580`, `2.844828`
and `0.726480 px`, followed by the same prior failure. They were not artifact-byte-exact. The 132
total output size stayed `149,169` bytes, but fused/analyzer/validation/failure artifact hashes
differed. The 165 total output changed from `175,746` to `175,699` bytes and the fused PLY from
`110,230` to `110,203` bytes, with other artifact hashes also different. The controls therefore
show repeated sparse outcomes, not artifact-level repeatability. Downstream lanes were unavailable.

The widely spaced ordered-quantile samples weaken the continuous local overlap available in the full
routes. The control confirms that the gain does not survive an old-sized discontinuous sample but
cannot causally isolate count from route quality.

Both original direct-gsplat attempts failed because their preparation manifests exceeded the
strict 4 MiB schema limit. Those failures remain outside the accepted quality denominator. A
focused committed streaming/schema adapter recovered one same-dataset run per capture without
changing images, geometry or quality gates. Each recovery ran once; recovered-gsplat repeatability
is `NOT RUN`.

## Private side-by-side inspection

The homeowner's qualitative inspection of the retained private viewer found that the 165-frame
result made the bed, sofa, curtains, cabinets, colours and overall room zones recognisable, while
the computer-desk corner and a continuous room shell remained incomplete. This is private
qualitative evidence only. It is not dimensional, representative, canonical or consumer-grade
acceptance, and it does not upgrade any geometric or appearance-quality gate.

A self-contained network-free viewer compares 36 hash-verified normalized images: C14.8, 132 and
165 across all four lanes and three deterministic views. It remains on restrictive private WSL
ext4. The HTML SHA-256 is
`8b7ee48f06227ca6106977fc02fecc9a3e49725fef5c5bfeacbcc76ab03c9c65`; its path-redacted manifest
SHA-256 is `704306f4f7c828407e1549ec10b180ad8127aaa18c8a7549a46fa5e0cc27812a`. Directories are
`0700`, files are `0600`, and no symlink, hard link or special file exists. No private pixel or
path is committed.

| Required region                     | Best observation              | Defect / limitation                                                      |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| First kitchen wall; microwave/stove | 165 prior, partial            | Main arrangement reads; edges and reflective/cooker detail remain sparse |
| Sink-wall corner                    | 165 prior, partial connection | Not a clean watertight intersection; floaters/spikes remain              |
| Third kitchen wall; cabinets/oven   | 165 prior, partial            | Blank cabinetry has holes and weak planar support                        |
| Kitchen open boundary               | 165 prior, coherent proposal  | Best zone transition; not a validated shell opening                      |
| Sofa/middle                         | 165 prior, partial            | Relative placement reads; surfaces are incomplete                        |
| Study-table                         | Homeowner recognisable in 165 | Computer-desk corner remains incomplete; local geometry is noisy         |
| Bed                                 | 165 prior, partial/coherent   | Connected to broader proposal, not measurable                            |
| Narrow passage                      | 165 prior, visually related   | Clearance/topology unvalidated; occlusion leaves holes                   |
| Bright window/curtain               | Homeowner recognisable in 165 | Curtain geometry remains partial; exposure/texture leave gaps            |
| Blank cabinets                      | Homeowner recognisable in 165 | Cabinet planes remain incomplete, with holes/weak support                |
| Reflective glass/metal/cooker       | All floating/warped/partial   | Specularity produces outliers and missing surfaces                       |
| Lower wall/floor boundaries         | 165 prior, partial            | No closed perimeter or trustworthy floor plane                           |
| Upper wall/ceiling boundaries       | Unsupported/missing           | Both captures observed zero upper cells; no complete ceiling/shell       |

The 132 unconstrained proposal has detached and warped planar fragments. The 165 unconstrained
proposal is denser and more coherent but still partial. Neither prior lane shows a convincing
duplicate complete room shell, though both contain local floaters/spikes. DA3 has the strongest
duplication: repeated radial/fan layers rather than a shell. Gsplat is appearance-only and supplies
no shell geometry.

## Explicit comparison answers

1. **132 versus C14.8:** yes for registration, normalized support and visual proposal completeness;
   no for a complete or accurate shell.
2. **165 versus C14.8:** yes, materially and by the largest margin, with the same qualification.
3. **Best connected geometry:** 165-frame ARKit-prior dense.
4. **Smoother 132 versus awkward 165:** 165 wins overall; 132 wins only recovered-gsplat
   PSNR/cleanliness.
5. **Kitchen corners/transitions:** partially connected in 165 prior, not closed or watertight.
6. **Blank cabinets:** partially represented with holes/weak planes; not reliably complete.
7. **Bed, table, passage and kitchen relationship:** coherent only as a private proposal, clearest
   in 165 prior. Passage clearance is unvalidated.
8. **Duplicate walls/false loops:** no complete duplicate shell in the best lane, but local warped
   duplicates exist. DA3 has severe fan-like duplication; unconstrained 132 has folded/detached
   planes. The adjacent return frames remain one loop episode, not six loops.
9. **Upper-wall/ceiling absence:** material. The 132 capture left all eight upper cells unresolved;
   165 observed zero upper cells. Most upper boundaries/ceiling are missing or unsupported.
10. **ARKit-prior registration benefit:** material for 165 (165/165 versus 163/165) and visually
    material for both. It does not change 132 registration count, and higher reprojection error
    prevents treating ARKit poses as ground truth.
11. **Gsplat usefulness:** one bounded recovery completed per capture, yielding a weak private
    appearance proposal at roughly 6 dB PSNR; recovery repeatability is `NOT RUN`.
12. **DA3 versus C14.8 zero coverage:** numerically yes, especially 165 at 6.95678%; not a useful
    quality pass. The 132 result remains near zero and both have duplicated radial surfaces.
13. **Private proposal use:** yes for 165 prior if uncertainty is explicit and no measurement is
    inferred. The 132 prior is a weaker fallback; gsplat is appearance-only.
14. **Canonical geometry:** no. Nothing was independently measured or validated.

## Failure preservation and evidence reconciliation

| Record                      | 132 SHA-256                                                        | 165 SHA-256                                                        |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Accepted full first pass    | `fe8849df0d92b0094a3de74173d8f609bf3ed1504fd1e5e8533f9351df2edf7e` | `13b20fd6f55b4e7946632c6bccc9745371c73a9234e388afa4a6a80a12a256bd` |
| Gsplat recovery             | `23d6cb40164927f62f42e7302f25769683689924abb932f699ad8fd1c0e5ec2c` | `e08d60a63cf2dfc9f91083b6108f3bf762b4c5997fa7e814d399d8f436342017` |
| Ordered-quantile control r2 | `7591b945cce788f7c2bb00045e8b3867e03a9052066e9abe4c6f7e26b202e8d3` | `8974e0b7269c104f740a19b6af746c0beaeb77b985b4166b13f3a81a0b78fcf7` |
| DA3-SMALL first pass        | `aaff506fa397c1dbd514b032e4f0b00c53a9880763fddf1590afb53e6d4f1a60` | `6c7769d50c051495cde8dc96905346e076744860c025ed78127dfa6935b8b3e2` |

Original fixed-limit/exhaustive records remain separately sealed in the private ledger. The
ordered 132 attempt completed matching in 1,697.7 seconds and mapping in 809 seconds before both
dense lanes timed out at 1,800 seconds. The ordered 165 attempt timed out matching at 1,800
seconds. These are operational scalability failures, not reconstruction-quality failures and not
reasons to weaken limits.

The committed 32-view complete-path probe passed prior registration, dense and gsplat after a
20-view probe honestly exposed a zero-point prior. Runner, schema and dependency-gating changes
affecting counted results were committed with regression coverage before acceptance. All original
adapter and recovery failures remain separately retained.

## Final verification

- Original delivery gates passed the complete affected capture-benchmark suite 38/38, 42/42 focused
  Python/package-integrity tests and the Windows package Vitest path 3/3.
- Independent PR review reran the capture-benchmark, export-verifier security and package-integrity
  Python gate: 33 passed with one expected optional DA3 evaluation-runtime skip.
- Independent PR review reran complete `corepack pnpm verify`: Prettier, 24/24 JavaScript lint,
  24/24 typecheck, 45/45 unit-test groups, 24/24 builds, Ruff, strict mypy over 125 Python sources
  and Python 157 passed / 2 expected capability skips.
- Both immutable exports passed the committed offline verifier again after compute. The counted
  records retain their historical plan/harness bindings: full quality used plan
  `224ca5820cfbcb1bcec5561079824f998a4bfb5241c9743ea8701a1aa2a7b66b` with harness
  `3cdc7b7c4bf85a27833ca71de2cbc0f756895866`; recovery/control used plan
  `3650457e570cd6e8ffe9fc34ef940afe3e5be39e66929a610f67a5e7f58df494` with harness
  `46ef82251f46750c4c2dbb1502d25bfadabcbddf`; DA3 used plan
  `6143f3e06e3a94fb588bae5a5293053ae41b8d18ca1182e722789f553553fce3` with harness
  `1002327faef3ce77df65d2b80cbd318f770d2bc5`.
- Independent PR review corrected the current plan's mistyped DA3 weight declaration and
  reverse-order wording. The corrected current plan is package-bound at SHA-256
  `1abf9232f2bdff93709aad185d1d492956df85cc629c4faac62ea2aa2e2f4d74`; no sealed result was
  rewritten or rebound to it.
- Original delivery's final strict typing found and corrected only static name/import issues in the
  exporter, recovery runner and viewer regression. Package hashes and regression coverage were updated; runtime
  semantics and all sealed results are unchanged.
- `git diff --check` passed. Contract and migration impact is none: no OpenAPI/generated client,
  schema migration, canonical mutation, production route, root manifest or lockfile changed.

## Final recommendation and closed gates

Use 165 ARKit-prior dense only as the current best private proposal. Do not run an identical full
repeat. The next experiment should change the evidence: capture a deliberate continuous
loop-closure route with calibrated real depth (LiDAR/RoomPlan if available), measured anchors and
explicit upper-wall/ceiling coverage, then evaluate shell closure, topology and held-out regional
coverage. Real depth would make the predeclared Open3D lane eligible.

Protected recovery, termination/relaunch, offline resume, authority transitions, thermal/storage
stress, VoiceOver field use, optional LiDAR/RoomPlan and rights-cleared dimensional or
representative accuracy are all `NOT RUN`. Product C8 was not started. No production,
consumer-readiness, canonical-geometry, dimensional or representative-accuracy gate is opened.

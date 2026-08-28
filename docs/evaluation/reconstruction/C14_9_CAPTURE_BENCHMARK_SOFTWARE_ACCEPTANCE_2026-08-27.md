# C14.9 Capture Envelope benchmark software acceptance - 2026-08-27

## Independent-review verdict

PR #12 was independently reviewed at exact original head
`5c8b38626d263cec38068ba59dbd2686974caf00` against merged C14.8 base
`9009e0444c8ea15ae2f7f2bb7abc82b338955165`. Material corrections are frozen in
`8d7ad379ae6def20f6fd95d4455f74bce8623708`.

The corrected C14.9 software and synthetic RTX fixture are executable. This is not physical
Capture Envelope acceptance and is not a production-routing, dimensional-accuracy, representative-
accuracy, regulatory, structural, cost, or availability claim. Every reconstruction is an
evaluation proposal; gsplat output is non-dimensional appearance evidence. Physical capture
compatibility and representative accuracy remain `NOT RUN`; production promotion is prohibited.

## Material review corrections

The original head was not accepted unchanged. Independent review corrected:

- current-rights enforcement for package reads and cross-session RoomPlan artifact access by
  re-locking the actual source session, requiring `proposed` or `abstained`, and rechecking
  tenant/project/session rights before signing;
- HTTPS-only API and signed-artifact transfer with credentials/query-free origins, redirect
  rejection, bounded streaming, canonical private output, salted envelope aliases, and no
  credential, bearer, signed URL, or object-key persistence;
- offline verification of exact schemas, canonical JSON, file/source hashes and sizes, declared
  media/depth/RoomPlan bindings, modes, hard links, symlinks, special files, duplicates, unlisted
  paths, and parent/path confinement;
- deterministic keyframe-only selection recomputed by downstream adapters, independent
  segment/cohort routing, typed exclusions, and explicit observed/missing/occluded denominators;
- ARKit camera convention conversion from x-right/y-up/look-minus-Z camera-to-world evidence to
  x-right/y-down/look-plus-Z OpenCV/COLMAP world-to-camera proposals, while keeping native rasters
  and native-raster intrinsics bound without an implicit rotation;
- exact depth-file and sample-index binding with eligible/integrated/missing and
  finite/non-finite/non-positive denominators;
- gsplat preparation from cameras, images, and points in one retained COLMAP text model, eliminating
  the prior mixed-coordinate initialization path;
- a strict 16-run collector with exact authority/image/config/deterministic-control linkage,
  non-empty artifact hashes, frozen metric vocabulary, failures, missing runs, isolation/resource
  ceilings, and fail-closed proposal-only verdicts;
- exact-clean experimental source checks including untracked files, complete recursive submodule
  equality, confined symlink-free roots, canonical manifests, fully hashed locks, exact image IDs,
  weights, registry binding, and unchanged licence abstentions; and
- a separate C14.9 fixed-geometry gsplat entrypoint that preserves C8's accepted trainer, disables
  nondeterministic CUDA rasterizer backward, uses real gsplat forward renders, and fits only three
  RGB gains through deterministic CPU float64 Adam. This is repeatability evidence only.

## Reported lint finding

The reported finding at
`services/platform-api/src/modules/render-stills/authorities.ts:239` was investigated by running
the exact platform lint command on both base and original head:

```text
corepack pnpm --filter @interior-design/platform-api lint
```

Both commands passed. The line is unchanged between base and head and predates C14.9, but there is
no reproducible base or head lint failure to classify as inherited. No source correction was made
there. Platform lint and typecheck also pass with the C14.9 corrections.

## Host and immutable runtime

The final redacted host inventory SHA-256 is
`5e23cb2b9a841b463f152ad48922a2e7907f99030af19bfc59c9d9efd2d1acb6`.

| Item         | Independently observed value                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------- |
| WSL / Docker | kernel `6.6.87.2-microsoft-standard-WSL2`; Docker client/engine 29.5.3                         |
| GPU          | NVIDIA GeForce RTX 5080; driver 595.79; compute capability 12.0; 17,094,934,528 bytes          |
| COLMAP image | `sha256:1c40cdfda95d53c8ea28e795060359ba0ed9e2288cd1d8fa48a9c554d7a97a14`; 2,031,877,888 bytes |
| Open3D image | `sha256:264a375b0a0a2be25fdf62a314cd8f48bf4bae83c646eb7b99d8d8ba22539cdc`; 2,183,067,692 bytes |
| gsplat image | `sha256:fa3da4146f2931ae380e578028e97fbde99bd8aea6d54c3a5381b56a88aa9f6a`; 6,430,053,747 bytes |

All accepted runs used the exact local image ID, GPU 0, 12 CPUs, 24 GiB RAM, 512 PIDs,
`1000:1000`, network none, read-only root, all capabilities dropped, no-new-privileges, a
2 GiB noexec/nosuid/nodev tmpfs, private read-only inputs, and fresh writable work/output roots.
Every command retained argv, exit status, log hash, wall time, sampled GPU/container peaks, and
scratch bytes. No accepted run exceeded 30 minutes, 14 GiB VRAM, 24 GiB RAM, or 12 GiB scratch.

## Fixture authority and hashes

The input is a creator-owned synthetic ten-view, 480x360 room with exact synthetic depth and
ARKit-style evidence. It is labelled `benchmark-fixture`, uses training permission `denied`, and
contains no homeowner, phone, property, provider, or public-dataset data. Its zero source commit is
a deliberate fixture marker and is not valid for the physical network exporter.

- envelope: `f7c851e9a52f392a104386624c67c81ea2fe26806b6ed2d81b86009447ed0ea7`;
- export manifest: `95ce2b91e58d418934f7b36db57a8d3932adb1358c674b34aa2c75dc2e89ebfe`;
- selection: `2973570b705c1b97e2dd0d906bc018cb4f9bf0e50bb57f9eddcc18ca8d931b48`;
- policy: `3725095a6aaad5967bcaa9e52b406fdac5b2bb41567f2dee17aab1eb20a7512c`;
- host inventory: `5e23cb2b9a841b463f152ad48922a2e7907f99030af19bfc59c9d9efd2d1acb6`; and
- strict common record:
  `b35f5e9018271bd9fd46a1fee72c0f3655624ef5b7d4812f98b332fa87a42fd5`.

The common record contains 8 selected candidate/cohort scopes, 16 expected and supplied fresh
runs, 6 typed experimental abstentions, and zero missing, partial, failed, isolation-violating, or
resource-ceiling runs. It records `evaluation-only-proposal-output`,
`productionPromotion: prohibited`, `physicalCaptureCompatibility: not-run`, and
`representativeAccuracy: not-run`.

## Independent RTX fixture results

| Candidate / cohort                         | Two fresh runs                                                                                                                                    | Repeatability evidence                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COLMAP 4.1.1 unconstrained, normal         | 9/9 registered; 3,092 sparse points; mean track 5.739651; 0.363017 px; 24,186 / 24,191 dense vertices                                             | Sparse text is byte-identical; points hash `107e1e9ea253c63feebfc5d47e706bbedf1e78d00d24601f4123381b721b7af3`. Fused PLY hashes `4be5004f0fbb2024ade9ebe39ff292e5e5fe6176746f974f3b671d4d7d9ca219` / `ea753b4b78d71825a006475994133f92f02ba461e38da2ae7f2a9505c8b85f62`; numeric pass, byte inequality recorded. |
| COLMAP 4.1.1 unconstrained, inclusive      | 10/10 registered; 3,362 sparse points; mean track 6.057704; 0.369919 px; 39,757 / 39,758 dense vertices                                           | Sparse points hash `dde74b12e78b4fd51ee34253b0fb02082ac3530c64db03c9b29861d74a4fcff7`. Fused PLY hashes `75adc966516d227a25dabec2748bbb16147a0eb1117a0f510c6030dcbe8c72b9` / `0d0d039914d3def58b6b8e87662e79f1a6d9db48dbaae6cc6614d7f5477371fb`; numeric pass.                                                   |
| Corrected ARKit-prior COLMAP, normal       | 9/9; 3,431 points; mean track 5.379190; 0.360452 px                                                                                               | Both text models byte-identical; points hash `d9f57c6b9afbf0bfa4c03da9fad9e60117da022f83406d2021f1f4161616a01a`.                                                                                                                                                                                                 |
| Corrected ARKit-prior COLMAP, inclusive    | 10/10; 3,460 points; mean track 5.939017; 0.386801 px                                                                                             | Both text models byte-identical; points hash `b4ea7a34d5385677e10f621aa38df293a1e773a8d3780a960945ee62733f5f1e`.                                                                                                                                                                                                 |
| Open3D 0.19 exact-depth TSDF, normal       | 9/9 exact bindings; 1,553,040 finite-positive, 0 non-finite, 2,160 non-positive depth values; 150,305 points; 152,064 vertices; 301,317 triangles | Point hash `3ae2e081f038545cb39be00b31276f1fa6612c129f6ff5c850923e8109c0bf46`; mesh hash `8eddf81f103e53b035419d285efefee00f9c09973bb5fdc59b4037218de10aeb`; byte-identical pass.                                                                                                                                |
| Open3D 0.19 exact-depth TSDF, inclusive    | 10/10 exact bindings; 1,723,320 finite-positive, 0 non-finite, 4,680 non-positive; 154,178 points; 155,816 vertices; 308,836 triangles            | Point hash `88c6ec0981adfabb3e50ad8fd665316eb3be3200219245bf745707f79797161b`; mesh hash `86178bc3faf45e516fa4209c7c127e60147fcf8d049b6a1dc0a61b0deaa57b03`; byte-identical pass.                                                                                                                                |
| C14.9 gsplat fixed-geometry RGB, normal    | 3,431 initial proposals; held-out PSNR 5.571419496 / 5.571419496 dB                                                                               | Delta 0 dB <= 0.01 dB; PLY is byte-identical at `47de64ba8cf6367b4f94fe78edf72c23f5ca7779284e0a7997e02eb4d7ba9619`. Repeatability-only pass; no quality floor or accuracy verdict.                                                                                                                               |
| C14.9 gsplat fixed-geometry RGB, inclusive | 3,460 initial proposals; held-out PSNR 5.603565881 / 5.603565881 dB                                                                               | Delta 0 dB <= 0.01 dB; PLY is byte-identical at `2a1e4ac384f62cbe4def8b62a9a744618749104ed049b599664cc8889c438151`. Repeatability-only pass; no quality floor or accuracy verdict.                                                                                                                               |

Open3D TSDF remains the legacy CPU path; its CUDA tensor probe proves only that the CUDA wheel can
address GPU 0. Supplied synthetic metres are not independent scale or physical-accuracy evidence.

The author's earlier gradient-based gsplat pair failed at 0.01258 dB. Independent review reproduced
inclusive failures at 0.013296, 0.018874 and 0.014199 dB while testing progressively stronger
PyTorch/cuBLAS controls. Those superseded configurations are reported but are not selected in the
final 16-run denominator; the 0.01 dB threshold was never relaxed. The final image preserves the
C8 backward/Adam entrypoint for its frozen contract and uses
`/opt/c8/direct_gsplat_capture.py` only for C14.9. Its held-out PSNR is materially lower because
geometry is fixed. That is explicitly not a quality, accuracy, geometry, physical, or production
claim; only execution and two-run repeatability passed.

## Experimental candidates

| Candidate                  | Fail-closed result                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| VGGT                       | Abstained: explicit commercial agreement and an independently visible exact weight hash are absent.       |
| MASt3R                     | Abstained: CC BY-NC-SA 4.0 evaluation-only and no reviewed fully hashed Blackwell lock/exact image.       |
| Video Depth Anything Small | Abstained: no reviewed fully hashed CUDA 13.2 lock/exact image; the exact `.pth` remains isolated pickle. |

No experimental dependency was installed, no candidate image was built or run, and no experimental
output was promoted.

## Software and security evidence

Focused correction gates passed: platform lint and typecheck; 9 focused capture route tests; 10
benchmark/adversarial-verifier tests; Ruff; mypy; package-manifest coverage; focused formatting; and
the isolated RTX matrix. Repository-wide `corepack pnpm verify` passed formatting, 24/24 lint,
24/24 typecheck, 45/45 unit-test tasks, 24/24 builds, Ruff and mypy across 114 Python source files,
and 157 passed / 2 skipped Python tests. The four exact-head GitHub CI checks are required on the
final reviewed SHA before merge.

## Requirements for the first physical Capture Envelope

The first physical run still requires:

1. an accepted `physical-device` envelope on the merged C14.9 server, with current tenant/project
   membership, current service-processing rights, and owner/editor export authority;
2. immutable rights-cleared RGB originals plus exact current rights on every separately referenced
   RoomPlan source session/package; exact sample IDs, byte sizes, hashes, intrinsics, orientation,
   coordinate segments, and depth bindings where present;
3. a private WSL-ext4 export whose canonical envelope/manifest/file hashes are compared out of band,
   with no bearer, credential, signed URL, object key, homeowner identifier, or raw evidence in Git,
   CI, shared logs, or Windows-mounted storage;
4. both cohorts, every independent segment, and two fresh runs for every selected candidate in the
   reviewed exact images under the frozen isolation and resource ceilings;
5. reviewer confirmation of real device, transfer, intrinsics/orientation, pose, segment, depth,
   RoomPlan, failure, and resource evidence; and
6. a separately predeclared, rights-cleared reference/ground-truth protocol before any physical or
   representative accuracy claim.

No physical run may promote production routing or canonical geometry. Experimental execution still
requires every frozen source, licence, weight, lock, submodule, path, and image gate.

## Post-record physical input handoff — 2026-08-28

The later C14.8 non-LiDAR follow-up satisfied the private-input portions of requirements 1–3 for one
accepted physical envelope. Its canonical Capture Envelope SHA-256 is
`093e9f6259429ab28281ba60032fd6b3592f299eb90b4353103ffe7c11c48cd9`, and its privacy-minimised
export-manifest SHA-256 is
`e3aeaed3925640c25f35e252f84b358efdcbdc424ff39cef781a69416504db74`. Before PR #13 review, the
complete authoritative export was retained in both its source location and durable local non-cloud
private storage. The official head-matched offline verifier re-passed the durable copy with exactly
28 protected regular files, no links and no special files; the authoritative source remained
unchanged and neither private path is recorded here.

Independent review of PR #13 corrected only application lifecycle reattachment and protected
non-secret bookkeeping for process-terminated background uploads. It did not change the accepted
envelope, manifest, original media, multipart identity, server authority or any C14.9 selection,
camera-convention, verifier or benchmark contract. Physical recapture was therefore not required,
and the new lifecycle behavior is not claimed as physical-device evidence.

Requirement 4 and the benchmark portions of requirements 5–6 remain `NOT RUN` for this physical
input: no Windows/RTX candidate cohort, repeatability/resource matrix, ground truth, accuracy or
production promotion was executed or inferred.

## Superseding physical non-accuracy follow-up - 2026-08-28

The Windows/RTX candidate and repeatability/resource portions were subsequently executed after PR
#13 merged. The complete private eligible matrix passes runtime and repeatability with explicit
depth/Open3D, RoomPlan and experimental abstentions. Physical compatibility still requires
independent review; dimensional and representative accuracy remain `NOT RUN`; production promotion
remains prohibited. Exact privacy-redacted evidence is in
`docs/evaluation/reconstruction/C14_9_CAPTURE_BENCHMARK_PHYSICAL_NON_ACCURACY_2026-08-28.md`.

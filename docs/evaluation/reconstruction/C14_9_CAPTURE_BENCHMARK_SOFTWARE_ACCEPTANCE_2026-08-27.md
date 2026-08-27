# C14.9 Capture Envelope benchmark software acceptance — 2026-08-27

## Verdict

C14.9 is software-ready for a real accepted physical Capture Envelope after this PR merges. The
secure API/export/verifier, deterministic per-segment selection, non-production routing evaluator,
COLMAP/ARKit-prior/Open3D/gsplat adapters, common record builder and fail-closed experimental
registry are implemented. This record claims fixture executability only.

Physical capture compatibility, device transfer, physical/representative accuracy and production
promotion are **NOT RUN**. No homeowner media, public dataset, provider data or model output entered
Git or canonical state. All fixture geometry is proposal-only and gsplat is non-dimensional.

## Host and immutable runtime

The redacted final inventory SHA-256 is
`d836c8468a56964c38cfb2921c35a736edfa63bfb94b5e1f20a6ba75fcd36752`.

| Item           | Observed value                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Windows / WSL  | Windows 11 Pro build 26200; WSL 2.6.3; Ubuntu 24.04.4; kernel `6.6.87.2-microsoft-standard-WSL2` |
| Docker Desktop | client/engine 29.5.3                                                                             |
| GPU            | NVIDIA GeForce RTX 5080; driver 595.79; compute capability 12.0; 16,303 MiB total VRAM           |
| WSL ext4 disk  | 1,081,101,176,832 bytes total; 373,099,196,416 bytes free at final inventory                     |
| COLMAP image   | `sha256:5a684f04346539c00d3596e6ce334d8dc16052169d05b723921e455c4a0b27ed`; 2,031,877,888 bytes   |
| Open3D image   | `sha256:4001945254d60ea2bf54b4ac458f29284a88857d70e873c055d816de048f18b6`; 2,183,061,207 bytes   |
| gsplat image   | `sha256:60936fef0057edc23301ff0785085d709a8088a5f6d16da6dc741eb6494e9877`; 6,430,040,229 bytes   |

All counted containers used one exact digest, GPU 0, 12 CPUs, 24 GiB RAM, 512 PIDs, non-root,
network none, read-only root, dropped capabilities, no-new-privileges, private read-only input and
fresh output. Open3D and gsplat were rerun after the final verifier layer changed; earlier image
results are not counted.

## Fixture authority

The creator-owned synthetic room is labelled `benchmark-fixture`, generated locally from the
retained C8 scene logic, and contains ten 480x360 PNG views with exact synthetic depth and ARKit-
style camera evidence. It contains no homeowner, phone, property, provider or public-dataset data.

- canonical envelope SHA-256:
  `afba0e1a0f434958fbdf47e1f28c343116376a21d69040e26c23195445b11a1c`;
- selection SHA-256:
  `ec07ecdd813491e1615f9c478784d7e301a48173d86ce126c246e97b6b7ebe29`;
- normal/inclusive selected views: 9/10; one segment; and
- gsplat derived input SHA-256:
  `6480709b730d6018bdf55c74308543a9d3bb6f78b02c89195fd459ad3b85f2f6`.

The fixture generator marks its envelope runtime `physical-device` only because it exercises the
strict envelope schema. Its export manifest remains authoritatively `benchmark-fixture`; the secure
network exporter itself rejects anything except a platform-accepted physical envelope.

## RTX fixture results

| Path                                    | Result                                                                                                                                                                                               | Repeatability / hashes                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| COLMAP 4.1.1 unconstrained sparse+dense | Both fresh runs registered 10/10 images; 3,362 sparse points; mean track 6.057704; reprojection 0.369919 px; 39,756 dense vertices; 20 depth and 20 normal maps with 3,236,243 positive depth values | Sparse text points byte-identical: `dde74b12e78b4fd51ee34253b0fb02082ac3530c64db03c9b29861d74a4fcff7`; fused PLYs same 1,073,645-byte size/bounds, hashes `38af2908765ed940a44819dc00a77357ffed74588737bccb123d19b6956a9f54` and `ebd21dad4f74998442495d749b18719d2240f818aa137fe9a0bb01104a0e3c64`; numeric repeatability pass |
| ARKit-prior COLMAP diagnostic           | 10 registered images; 3,460 triangulated points; 20,549 observations; mean track 5.939017; reprojection 0.386801 px                                                                                  | One diagnostic run only; points text `b4ea7a34d5385677e10f621aa38df293a1e773a8d3780a960945ee62733f5f1e`; repeatability partial/not run                                                                                                                                                                                          |
| Open3D 0.19 exact-depth known-pose TSDF | Both final-image runs bound 10 depth frames with zero non-finite values; 154,178 points; 155,816 vertices; 308,836 triangles; CUDA tensor checksum 32                                                | Point PLY byte-identical `88c6ec0981adfabb3e50ad8fd665316eb3be3200219245bf745707f79797161b`; mesh byte-identical `86178bc3faf45e516fa4209c7c127e60147fcf8d049b6a1dc0a61b0deaa57b03`; pass                                                                                                                                       |
| gsplat 1.5.3 direct appearance          | Both final-image 100-step runs passed on capability 12.0 with 3,460 Gaussian proposals and the same held-out view; PSNR 13.379990 and 13.374022 dB; peak GPU allocation 31,915,008 bytes             | PSNR delta 0.005968 dB is within frozen 0.01 dB; PLY hashes `3d046d83fab1ec940b79b1a853521a24b7914d1e1837c10782176d8ad733698a` and `89ee1bc59cc753008a1cf7e8ba751c1dcee651a983af8ac0d42c17f5a1dff52b`; numeric repeatability pass, byte inequality recorded                                                                     |

The initial final-image rerun used an incorrectly interpolated UID and was denied write access
before any accepted output. The explicit non-root UID 1000 rerun succeeded. Open3D warned that PLY
colour values were clamped; geometry counts/hashes remained valid. Open3D TSDF is CPU; its separate
CUDA tensor probe proves only the CUDA wheel/device path. The first pre-final gsplat image pair had
a 0.01258 dB PSNR delta and failed the frozen 0.01 dB threshold; that failure was retained during
review and no tolerance was changed. The final exact image pair above passed.

Final private raw outputs remain retained locally under `/tmp/c14-9-colmap-*`,
`/tmp/c14-9-colmap-prior-*` and `/tmp/c14-9-final2-*`; cleanup state is `retained-for-review`.
Additional exact final hashes are:

- COLMAP run logs `91e798faedabab004d08584c9684e893ab7ab4c865abb9cbfdd0d9e0aa3ea38c` and
  `99a63fdc05f592ee5986c1d414c18805a7fb38339f30e20cfcf274224d0f01cf`;
- Open3D result JSON `c5afaf653cb17524ef46db02561b8fb9af1abde2d828fd1842c9fe9a67d67fc6`
  and `ad08cd4fcc191e5dfb31618de50ae862e5cd580795749e8f528b3c9fea33f8d7`, with logs
  `4496a54626abcc3cb3efa6b345c202534438867826fea4e15512a5ae56a65575` and
  `bde090e139f2197b9a6475b883dc7b54e15a3bf0a02c265e865e49dedae49dfa`;
- gsplat preparation `def9ddadfb8246e29a27486f17cfa4a6a0e529e2f9cccd0588c11f94152cd9b4`,
  result JSON `cd1c1c19c6894336d33d9f9d0e763faf133d5d63040078b6becf771cd36e9905` and
  `d0587d86e4cc770bafa319084b73c5df3941cc3caa10354a1df44a6bb3a14373`, and logs
  `658c1e6d4137eede7cab560be6d9f80aaf9b27864f5ed6e603e4e40d9cb0f9c3` and
  `5c4771784a299b5c66444e1c236e5008bfb7301638f76b1a0acb0363fcde9c72`.

## Experimental candidates

| Candidate                  | Local result                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VGGT                       | Registered at exact code/model revisions; abstained because explicit commercial agreement and independently visible exact weight hash are absent                                                 |
| MASt3R                     | Exact code, dust3r submodule, model revision/hash/size and CC BY-NC-SA 4.0 evaluation-only restriction frozen; abstained because no reviewed fully hashed Blackwell dependency lock/image exists |
| Video Depth Anything Small | Exact code, weight-bearing revision/hash/size and Apache-2.0 frozen; abstained because no reviewed fully hashed CUDA 13.2 lock/image exists and the `.pth` is isolated pickle                    |

No candidate dependency was installed or downloaded, no candidate container was built/run, and no
experimental output was promoted. The policy verifier now requires source, recursive submodule,
weight, registry, dependency-lock and exact local-image evidence before selection.

## Software and security evidence

- Strict C7 contract adds read-only package metadata and short-lived accepted-envelope artifact
  access; `capture:artifact:export` is owner/editor-only. Persistence revalidates current rights,
  source completion and direct depth or exact RoomPlan package binding and audits without URL or
  object key.
- The exporter takes credentials only from environment, uses no-follow exclusive private writes,
  canonical hashes, bounded streaming and salted aliases. Offline verification rejects drift,
  extras, missing files, links, traversal, non-private modes and secret-bearing manifest fields.
- Focused Python evaluation/security: 7 passed. Focused TypeScript contracts/authz/platform tests
  and typechecks passed during implementation. Final repository/security checks are recorded in
  the checkpoint ledger and PR body.

## Remaining gates

A real run still needs: one accepted physical envelope; current processing rights and owner/editor
export authorization; transfer/hash verification; both cohorts for every independent segment; two
fresh runs for every eligible candidate including two ARKit-prior diagnostics; retained sampled
RAM/VRAM/wall/log/output evidence; physical reviewer sign-off; and, separately, rights-cleared
ground truth for any accuracy claim. Experimental execution additionally needs its missing
licence/lock/image gates. Production routing or model promotion requires a new checkpoint.

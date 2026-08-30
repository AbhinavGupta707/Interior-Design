# C14.10-VGGT-NC Contract - private non-commercial learned reconstruction feasibility

## Authority and quarantine

- Predecessor: merged PR #17 at `8c99e782eeea2265a9de892064737ac0a00d4b47`.
- Branch: `codex/c14-10-vggt-nc-feasibility`.
- Runtime: one `gpt-5.6-sol` / `high` task in the authoritative WSL checkout; no subagent,
  worktree, orchestration skill or separate task.
- Authority: the user explicitly authorised a strictly private, non-commercial research evaluation
  of the original ungated `facebook/VGGT-1B` checkpoint under CC BY-NC 4.0.
- Delivery: one non-draft pull request targeting `main`, left unmerged.

All model bytes, private inputs, geometry, renders, logs, package evidence and conclusions stay on
private WSL ext4. They cannot enter production routing, commercial acceptance, canonical geometry,
C8 production, a commercially deployable dependency path or dimensional truth. Future commercial
evaluation must be repeated with appropriately licensed weights or a different commercially
permissible model. No contact details, gated access request or terms acceptance is authorised.

## Retained input and control

The sole physical input is the retained C14.10 165-frame Capture Envelope with canonical envelope
SHA-256 `093e9f6259429ab28281ba60032fd6b3592f299eb90b4353103ffe7c11c48cd9`,
segment `fbb6cd55-bd85-4628-ab9e-12171d7ddb1d` and immutable selection SHA-256
`5e90939980de540ef01b45918b06058b10ecf1b57320d6d1b60ba409df183ae3`. The 132-frame
capture is excluded.

The sealed 165-frame ARKit-prior dense COLMAP reconstruction is the read-only control and is not
rerun: 165/165 registered cameras, 90,679 sparse points, 947,276 dense vertices, dense artifact
SHA-256 `422d760d2e8a13ccf9f6f31356bcab1e535fcaca862484ae54e7b7cc64315a41`.
It is recognisable across kitchen, bed and study relationships but has incomplete shell coverage
and outliers. It has no authority for dimensions.

## Immutable candidate audit

The complete machine-readable freeze is
`ml/reconstruction/windows-nvidia-v2/c14-10-vggt-nc-research-candidates.json`.

- Original ungated weight repository: `facebook/VGGT-1B`, revision
  `860abec7937da0a4c03c41d3c269c366e82abdf9`, `model.safetensors`, 5,026,367,224
  bytes, SHA-256 `f164acf60724910d8fe1578bb499d800850c7bb0948db7555c413f9fbe60467e`,
  CC BY-NC 4.0. The pickle `model.pt` is excluded.
- Executed VGGT implementation: `MIT-SPARK/VGGT_SPARK` commit
  `6e6e16107b88e8e76c751826af10d4295d87ecd2`, CC BY-NC 4.0. Current upstream
  `facebookresearch/vggt` commit `a288dd0f14786c93483e45524328726ab7b1b4ce` was audited but
  is not used, avoiding entry into its current commercial-capable source terms. A focused
  offline patch removes only the unused Hugging Face Hub mixin and makes debugging-only
  Matplotlib imports lazy; its SHA-256 is
  `59fa19e16050c117e1866bbd38fa6aa4ac92ef14a87683662ce0b1a059f37b38`.
- Patched VGGT-SLAM-derived no-loop adapter: `MIT-SPARK/VGGT-SLAM` commit
  `35327ac28b7d193df9ccc39ba6346052bb6f1207`, BSD-2-Clause, patched only to make
  its declared no-loop mode genuinely headless and to remove eager optional dependencies. The
  patch SHA-256 is `2b2dcfc2cb9b6ad9783cfafd26f1110c662d110c12af36b7bc7c3a9735ab7805`.
- SALAD, SAM 3, Perception Encoder, open-set object detection, Hugging Face Hub, Matplotlib,
  OpenCV, Gradio, Viser and Open3D are absent from the runtime. The hybrid retains sequential
  overlapping VGGT submaps, scale alignment and bounded GTSAM SL(4) optimisation; loop closure is
  disabled. SALAD-based loop closure is `NOT RUN` because its additional checkpoint, security and
  dependency chain was deliberately excluded. Adapter drift or failure cannot be interpreted as
  upstream VGGT-SLAM 2.0 loop-closure performance or failure.
- SLAM3R commit `f531d841ab743217a4464344119a350eb0556d17` and CUT3R commit
  `8bc15dc92a6d7fd92920b4ec81540d3dec7d3ecf`, both CC BY-NC-SA 4.0, are outside the bounded
  two-candidate scope because their continuous-video roles are redundant. Their non-commercial or
  share-alike terms alone do not block this authorised private research. The gated
  `VGGT-1B-Commercial` checkpoint is prohibited.

The complete roster was re-audited on 2026-08-30. VGGT-Omega remains gated and using its FAIR
Noncommercial Research License would itself constitute agreement; no access or agreement is
authorised. MASt3R and DUSt3R remain CC BY-NC-SA 4.0 with additional checkpoint/training-data
terms remain unresolved because their complete checkpoint/training-data chains were not needed or
completed for this bounded checkpoint; they are outside scope, not rejected merely for their
non-commercial licences. The current DA3 registry now unambiguously lists LARGE-1.1 as CC
BY-NC 4.0 and SMALL as Apache-2.0; the quarantined LARGE evidence remains non-counted, while the
retained 165-frame SMALL control is not rerun because it previously showed no material improvement.
These scope decisions keep the experiment to the two user-directed VGGT lanes.

The minimal Python graph contains 42 exact packages in a hash-required lock with SHA-256
`0c1637c560d74c160da07572d77dc5a018565d88617a9a2d93e1e737e373e1ff`.
Pillow was raised to 12.3.0 after the first audit found known vulnerabilities. The repeat audit
found zero known vulnerabilities; CUDA-index PyTorch and torchvision wheels are recorded as audit
exceptions because PyPI cannot resolve their local-version identifiers. The offline image probe
must additionally enumerate licence metadata and licence-file hashes for every installed package,
prove the required GTSAM SL(4) symbols and compute capability 12.0, and prove optional packages
absent before physical execution. The sealed dependency base image was
`sha256:cd03bacdedd35e39991579d476d278de2db25f926e5ad88cb831ef3b2c18b42c`.
The counted adapter-only overlay is
`sha256:3f8eeb4923eeb559dcaef4074125403411aabaac5f83f4f1ac6f6888966a6d8e`;
its fresh private mode-0600 audit record is frozen by SHA-256
`3b3506010c2f0774efe48d3085bd991291b7c5867faf7afd68e4fcbbf11184c0`.
It executed the real `vggt.models.vggt` and `vggt_slam.solver` import closure with Torch
`2.13.0+cu132`, CUDA compute capability 12.0 and all required GTSAM SL(4) symbols. It found no
prohibited optional package. The zero-code `cuda-toolkit==13.2.1` metapackage is accepted only
through an exact fail-closed metadata check and the separately hashed NVIDIA CUDA container
licence; unnecessary runtime CUDA repository/metapackages were removed, and Ubuntu's broken
OpenSSL copyright symlink was repaired to its installed `libssl3t64` evidence.

### Image-build recovery freeze

The first adapter-correction rebuild missed its BuildKit dependency cache and, because it was
network-disabled, failed at the first Ubuntu package fetch before downloading or replaying the
multi-gigabyte Python dependency layer. Another complete image build is prohibited during this
checkpoint. The counted correction must instead be an offline adapter-and-auditor-only overlay on
the already-audited sealed base image. Its metadata records that exact base image ID and corrected
adapter SHA-256; its root filesystem must retain every sealed base layer unchanged and add only the
two small read-only evaluator files.

Before any future complete rebuild, private WSL-ext4 storage must contain both:

1. a hash-verified wheelhouse populated once from `requirements-vggt-nc.lock`, including the exact
   CUDA-index wheels, and consumed only with `pip --no-index --find-links`; and
2. a persistent BuildKit cache exported to and imported from the private checkpoint root, with the
   cache manifest and all wheel hashes retained as mode-0600 evidence.

No complete retry or repeat download is allowed until that plan exists and passes an offline
install rehearsal. The overlay path does not invoke APT, pip, a package index or any network.

## Staged execution and stop rules

Each candidate runs serially at 4, 16, 48 and at most 165 frames. Every stage has a fresh private
output, immutable identity validation and a resumable sealed stage record. The runner is invoked
through one explicit maximum stage at a time so 4, 16 and 48-frame evidence can be reviewed before
the next gate. A failure, 45-minute timeout, invalid camera/point output, more than 14.5 GiB task
VRAM, another frozen ceiling or clearly unusable quality stops that candidate. The 165-frame stage
runs twice only if all smoke stages pass; each counted full run also performs a separate 164-frame
reconstruction for the frozen last-frame held-out projection.

Each container is network-disabled, read-only-root, non-root, all capabilities dropped,
no-new-privileges, GPU 0, 12 CPUs, 32 GiB memory, 512 PIDs, 2 GiB no-exec tmpfs, 16 GiB retained
scratch, a 500,000-point cap, seed zero and a 45-minute stage timeout. The exact local image digest
and successful environment-audit hash are frozen in the ledger before the first physical stage.

## Comparison and acceptance

Direct and hybrid outputs are proposals. Comparison against the retained control records camera
count and consistency, finite support, recognisability, room relationships, shell completeness,
missing regions, leave-one-out coverage/PSNR where valid, runtime, host memory, task VRAM and
retained bytes. A simple no-network private interactive comparison uses only private derived
assets. Qualitative findings are redacted before Git.

Dimensional accuracy and representative accuracy are `NOT RUN`. No independent ground-truth
geometry exists. No segment join, canonical mutation, production routing, C8 start or commercial
promotion is permitted. Acceptance requires an honest stop/recommendation, focused regression
coverage, proportionate repository and GPU verification, exact submitted commit evidence and one
non-draft unmerged PR.

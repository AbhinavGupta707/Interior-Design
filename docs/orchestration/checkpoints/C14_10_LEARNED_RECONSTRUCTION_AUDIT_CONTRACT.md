# C14.10 Contract - Proposal-only learned reconstruction audit

## Authority and outcome

- Predecessor: clean synchronized `main` at
  `97352b7027476aa48461aea3788d1e02d3268b56`.
- Branch: `codex/c14-10-learned-reconstruction-audit`.
- Runtime: one `gpt-5.6-sol` / `high` primary session; no subagent, worktree, separate task or
  parallel implementation lane.
- Delivery: one non-draft pull request targeting `main`, left unmerged.
- Outcome: determine whether a small, licence-permitted and reproducibly pinned set of modern
  learned reconstruction candidates materially improves the retained C14.9 physical Capture
  Envelope result over COLMAP, ARKit-prior COLMAP and fixed-geometry gsplat.

This is a proposal-only R&D checkpoint. It cannot change production routing, C4 canonical
geometry, C5 mutation/confirmation, C8 publication, C9 fusion, homeowner authority or professional
boundaries. Learned cameras, depth, point maps, point clouds, splats, renders and videos remain
derived proposals and never become dimensional truth.

## Private authority and immutable input

The only physical input is the already verified private export whose canonical Capture Envelope
SHA-256 is
`093e9f6259429ab28281ba60032fd6b3592f299eb90b4353103ffe7c11c48cd9`.
Its path, raw source names, media, source identifiers, detailed selection, raw logs, geometry,
renders and machine records remain on restrictive WSL ext4 storage outside Git, GitHub, CI,
Windows-mounted storage and public services. No external model service receives the media.

The accepted export and C14.9 baseline outputs are read-only inputs. Every experimental run uses a
fresh private output root. Source bytes are never rewritten. Selection remains independently
frozen per coordinate segment and cohort; no candidate, metric collector or visualisation may
silently join the two segments. The one-view interrupted segment must run only when a candidate
explicitly supports it, and its output remains an independent proposal.

## Candidate and reproducibility gates

The upstream audit is read-only until it records, for every considered candidate:

1. official repository and exact commit;
2. code licence and separate weight/model-card licence, including training-data notices;
3. exact weight repository revision, filename, byte size and locally verified SHA-256;
4. a fully hashed dependency lock, immutable container base and final local image digest;
5. an RTX 5080/compute-12.0-compatible PyTorch/CUDA path proven by a real isolated probe; and
6. a deterministic, offline, non-root, network-disabled adapter with typed failure/abstention.

VGGT is the priority audit target. MASt3R/DUSt3R and current Depth Anything methods are considered
only where they add a distinct reconstruction role. Candidates that cannot pass licence,
weight-visibility, source, dependency, image, hardware or resource gates abstain and do not block
the remaining audit. No gated licence is accepted silently, and no unverified pickle weight is
loaded outside its isolated container.

The final executable set must remain small and justified. Exact pins and enablement decisions are
frozen in the candidate registry before counted physical execution. Candidate source trees,
weights, caches, images and raw outputs stay outside Git.

### Counted candidate freeze - 2026-08-28

- 'VGGT-1B-Commercial' abstains before execution because current weights are gated and the custom
  licence requires an application and explicit agreement this checkpoint is not authorised to
  accept. 'VGGT-Omega-1.4B', MASt3R and DUSt3R abstain because their current licences are
  non-commercial; their quality is not scored.
- 'DA3-LARGE-1.1' and 'DA3-SMALL' are the only executable candidates. Official source commit
  '3d835ec1a5802d64a8b8b15f817a1ab54809bfe4', Hugging Face weight revisions, byte sizes,
  SHA-256 values, model-card/config hashes, Apache-2.0 licence hash and blocked-candidate evidence
  are frozen in 'ml/reconstruction/windows-nvidia-v2/c14-10-learned-candidates.json'.
- The base and additive dependency locks have SHA-256
  'd09ec9260741c2fb248eaf8775d09104b038bb8920ff1a9c099e9a1fb03e684b' and
  'ca324ccc2fdc24d6894ddfd72880b5740949d8fdf527cf9a46d56c48ec4cc5b8'.
  Counted image ID is
  'sha256:246b7363b7ff9d2a38a688607aa9d89d6085734c1b7acc88221e00f04590e0d3'.
- A native 'sm_120' kernel executed on the RTX 5080; PyTorch '2.13.0+cu132' reported compute
  capability 12.0; both exact local model snapshots completed offline nine-view generated-fixture
  inference including the held-out path.
- Counted runs fix process resolution 392, seed zero, a 500,000-point cap, two fresh runs, 12 CPUs,
  32 GiB RAM, 512 PIDs, a 2 GiB no-exec tmpfs, GPU 0 and a 45-minute timeout. The immutable
  selection SHA-256 is retained privately. Neither segment identifiers nor physical artifacts are
  committed.

## Common evaluation contract

Every viable candidate uses the same immutable selected RGB inputs for each compatible independent
segment/cohort, the same held-out policy and two fresh counted runs. Candidate-specific resizing or
colour/orientation transforms are separately hashed and provenance-bound. No failure is removed
from the denominator.

The common comparison records, where applicable:

- camera registration count/rate and pose connectivity/components;
- point/depth validity, connected support, coverage and completeness proxies;
- retained-view and held-out appearance PSNR, SSIM and LPIPS where rendering is defined;
- exact repeatability deltas and artifact hashes;
- wall time, peak container/host memory, peak task VRAM and scratch bytes; and
- typed input, licence, runtime, isolation, resource, inference and validation failures.

Private visual inspection must examine each segment independently from frozen camera views and a
local no-network viewer. It records only redacted qualitative findings in Git. A visual impression
cannot establish dimensional accuracy, canonical suitability or production promotion.

There are no independent measurements or rights-cleared ground truth. Therefore:

- dimensional accuracy: `NOT RUN`;
- representative accuracy: `NOT RUN`;
- canonical promotion: prohibited; and
- production routing: unchanged and prohibited by this checkpoint.

## Resource and isolation boundary

Counted candidates run with exact image IDs, GPU 0, network none, read-only root, non-root user,
all capabilities dropped, no-new-privileges, bounded CPUs/PIDs/RAM/VRAM/scratch/time, read-only
inputs and fresh outputs. Candidate-specific ceilings must be frozen before execution and must fit
the observed RTX 5080 headroom; a ceiling breach is a failed run, not an invitation to weaken the
record.

Reusable repository support is limited to strict candidate manifests, offline preflight,
segment-safe preparation/adapters, common metrics/records, private-viewer generation without
embedded private data, tests and redacted documentation. Production APIs, queues, workers, UI,
canonical/domain schemas, migrations, generated clients, root manifests/locks, native capture and
accepted C8/C14.9 baseline adapters are out of scope.

## Acceptance

- Candidate audit and exact freeze are complete before counted physical runs.
- Every viable candidate completes two fresh runs for every eligible independent segment/cohort,
  or records a typed failure that remains in the denominator.
- Retained C14.9 baselines and learned candidates are compared under the common immutable input,
  registration/connectivity/completeness, held-out appearance, repeatability and resource record.
- Private visual inspection is recorded honestly without publishing media or outputs.
- Focused unit/adversarial tests, strict typing/linting, package-manifest coverage, repository
  verification and proportionate RTX verification pass at the exact submitted head.
- Durable evidence states whether any learned method materially improved this one envelope while
  keeping dimensional and representative accuracy `NOT RUN`.
- The exact branch is committed, pushed and opened as one non-draft, unmerged PR.

## Closeout freeze - 2026-08-28

- The counted matrix completed 16/16 candidate/cohort/segment/run scopes with zero runtime,
  isolation or resource failures. All eight two-run comparison scopes reproduced exact artifacts
  and zero metric deltas.
- DA3-SMALL and DA3-LARGE-1.1 each produced 25/25 finite proposal cameras and substantially more
  point samples than the retained sparse baselines, but both had zero independently aligned
  held-out pixel coverage. Their black-frame 5.548452293042459 dB score is typed failed quality,
  not appearance evidence. Neither candidate materially improves C14.9.
- Both learned one-view proposals remain independent. They have one finite camera and 69,149
  confidence-filtered points each; connectivity and held-out appearance are `NOT RUN`, and neither
  is a reconstruction of the interrupted segment.
- Seven deterministic three-view inspection sets and exact hashes remain on restrictive private
  WSL ext4. Automated occupancy proxies establish only denser projected support. Direct human/model
  visual inspection is `NOT RUN`: the desktop viewer could not read the protected path, and moving
  private pixels through the tool channel would breach this contract.
- The counted image remains frozen at its exact image ID. Its embedded adapter SHA-256 is
  `7253285f65517bf2064d501f479dae29001a83f764c6017f02cf757c3c7241b5`; the submitted adapter differs
  only by repository-standard `mypy` annotations and has SHA-256
  `6d5ca1478b5f027174374204012a904edcaa7fd1cd879d77bcc35b3023a2f3ce`. Post-run metrics add an
  explicit `FAILED_ZERO_COVERAGE` classification without rewriting counted raw results.
- Complete `pnpm verify` passed formatting, all 24 lint tasks, all 24 typecheck tasks, all 45 unit
  tasks, all 24 builds, Ruff, mypy across 120 source files and 157 Python tests with two expected
  skips. The locked optional evaluation environment passed the focused 15-test C14.9/C14.10 suite;
  the dependency-minimal repository environment passes 10 baseline tests and explicitly skips the
  optional DA3 module.
- Contract/migration impact is none. Production routing, canonical geometry, C5/homeowner
  authority, accepted baseline adapters, schemas, root manifests/locks and generated clients are
  unchanged. Dimensional and representative accuracy remain `NOT RUN`.
- Delivery is GitHub PR #15 targeting `main`. It was opened non-draft and remains open/unmerged;
  normal repository review and required checks retain merge authority.

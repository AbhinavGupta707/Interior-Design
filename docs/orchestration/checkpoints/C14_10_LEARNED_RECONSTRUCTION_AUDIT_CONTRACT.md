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

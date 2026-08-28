# C14.9 Contract — Capture Envelope export and software benchmark

## Authority and outcome

- Predecessor: merged `origin/main` at `9009e0444c8ea15ae2f7f2bb7abc82b338955165`.
- Branch: `codex/c14-9-capture-benchmark`.
- Runtime: one `gpt-5.6-sol` / `xhigh` session; no subagent, lane, separate task or worktree.
- Delivery: one non-draft PR, left unmerged.
- Outcome: securely export and verify one immutable accepted physical `capture-envelope-v1`, then
  apply one deterministic selection to COLMAP, ARKit-prior, Open3D, gsplat and licence-permitted
  quarantined candidates.

This is software-only. It cannot accept physical capture, representative accuracy or production
routing. Every output is an immutable proposal/evaluation artifact; no evaluator writes C4, calls
C5, replaces C8 output or joins coordinate segments without evidence.

## Boundary and ownership

C2 retains RGB authority and C7 retains depth/RoomPlan authority. Add only freshly authorised,
short-lived access to artifacts already bound to an accepted envelope and read-only package
metadata:

- `GET /v1/projects/:projectId/capture-sessions/:captureSessionId/packages/:packageId`
- `POST /v1/projects/:projectId/capture-sessions/:captureSessionId/artifacts/:artifactId/access`

Artifact access is owner/editor-only under `capture:artifact:export`. It revalidates membership,
service-processing rights, accepted-envelope binding, artifact completion and source readiness,
and audits without URL or object key. Package metadata uses existing capture read authority.

The session owns `packages/contracts/src/c7.ts`, focused authz files/tests,
`services/platform-api/src/modules/capture/**`, `ml/reconstruction/windows-nvidia-v2/**`, focused
capture-benchmark tests, this contract, active plan, runbook/evidence and ledger. No migration,
root manifest/lock, generated client, native, canonical, C8 production or C9 change is authorised.

The exporter reads credentials only from environment, retains no signed URL, rejects links and
existing outputs, writes private files, streams and verifies declared sizes/hashes, and emits
salted identity aliases. The offline verifier recomputes the canonical envelope hash and all file
hashes/sizes and rejects extra files, links, traversal, duplicate paths and schema drift.

Selection is per segment and ordered by `(segmentId,timestampMicroseconds,sampleId)`, with normal
and inclusive tracking cohorts. Exclusions are typed; missing/occluded cells stay in denominators.
Native bytes remain untouched; derived orientation/colour/resize/depth/camera transforms are
separately hashed with exact provenance.

## Candidate freeze

| Candidate                  | Exact authority                                                                                                                                                                                 | Verdict                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| COLMAP / ARKit prior       | C8-v2 COLMAP 4.1.1 `a0d785fba74b2664f31edc4a29026a8b27c00f67`                                                                                                                                   | enabled baseline/diagnostic; prior scale is not accuracy proof   |
| Open3D                     | C8-v2 Open3D 0.19.0 lock                                                                                                                                                                        | enabled only for exactly bound metric depth                      |
| gsplat                     | C8-v2 gsplat 1.5.3 lock                                                                                                                                                                         | enabled appearance-only with proposal initialization             |
| VGGT                       | `facebookresearch/vggt@a288dd0f14786c93483e45524328726ab7b1b4ce`; `facebook/VGGT-1B-Commercial@ebb29a532abe92960eeb6903a5530f16990ef4ab`                                                        | blocked until agreement acceptance and visible exact weight hash |
| MASt3R                     | recursive `naver/mast3r@f5209afc300cec36239a7ac992263f36847bbba0`; model `06e7259f34c3060f322df5cb0c7b9094f57e41fc`, SHA-256 `0a615eb05fa9db654050aa655945ee5696e7c6c1b7f93f1ee8c37249010f6feb` | quarantined CC BY-NC-SA 4.0 evaluation only                      |
| Video Depth Anything Small | code `4f5ae23172ba60fd7bc11ef671cca678842c7072`; model `273d090f2ce17df50c2872d82c8322c45da5b4dd`, SHA-256 `3c28432b4e1f0d7bb31cad5151b6313b49457db5aa58d82e85bfb0f8b1311b33`                   | quarantined Apache-2.0 evaluation                                |

Public/synthetic data is labelled `benchmark-fixture`, isolated from C2/C7 identifiers and never
homeowner evidence, accuracy evidence or a production dependency. Pickle weights run only after
hash verification inside the isolated network-disabled candidate container.

## Policy, metrics and ceilings

`capture-benchmark-routing-policy-v1` emits only an evaluation plan and typed abstentions:
COLMAP needs two RGB samples; ARKit prior needs two valid poses/intrinsics; Open3D needs exact bound
depth; gsplat needs three calibrated views, a frozen holdout and baseline proposal initialization;
experimental candidates need sufficient inputs plus all source/licence/weight gates. It cannot
promote or modify C8. Production routing requires a new checkpoint.

Run each eligible candidate twice from fresh output with identical inputs, selection, image digest,
config hash, seed and deterministic controls. Retain raw logs/outputs/hashes and every failure or
abstention. Record per segment/cohort camera, intrinsics, reprojection, geometry/depth, coverage,
held-out appearance, wall-time, bytes and peak RAM/VRAM metrics. Unsupported metrics are
`not-applicable`, not zero.

Repeatability limits: count relative delta `0.01`; median camera rotation `0.05 deg`;
translation-direction `0.10 deg`; depth AbsRel `0.005`; metric RMSE `0.01 m`; PSNR `0.01 dB`;
SSIM `0.001`; LPIPS `0.001`. Byte equality is recorded but not required for CUDA floats.

All runtimes are network-disabled, non-root, read-only, capability-dropped, no-new-privileges,
GPU 0, 12 CPUs and 512 PIDs. Baselines: 24 GiB RAM, 14 GiB VRAM, 12 GiB scratch, 30 minutes.
Experimental: 32 GiB RAM, 15 GiB VRAM, 16 GiB scratch, 45 minutes. A breach fails the run.

## Acceptance

Focused tests must prove authorization/isolation/revalidation/audit redaction; adversarial export
and offline verification; deterministic selection/segment isolation/camera conversion/depth/policy;
two-run records; pinned container/candidate provenance; and proportionate repository, security,
container and RTX fixture gates. A fixture proves executability only. Evidence and handoff must
leave real Capture Envelope, physical compatibility, representative accuracy and promotion
`NOT RUN`. Commit, push and open one non-draft PR without merging.

## Independent software closeout - 2026-08-27

Original implementation commits were `224ce5a` (contract), `19583c2` (implementation), and
`5c8b38626d263cec38068ba59dbd2686974caf00` (submitted evidence head). Independent review
against exact predecessor `9009e0444c8ea15ae2f7f2bb7abc82b338955165` did not accept that head
unchanged. Material corrections are frozen in
`8d7ad379ae6def20f6fd95d4455f74bce8623708`.

The corrected closeout adds source-session current-rights revalidation for RoomPlan package/artifact
reads; HTTPS/no-redirect/no-disclosure export; strict private canonical tree verification;
recomputed keyframe-only per-segment/cohort selection; explicit ARKit-to-OpenCV/COLMAP camera
conversion; exact depth denominators; same-COLMAP-model gsplat initialization; complete strict
two-run/failure/resource records; symlink-free exact-clean experimental gates; and a separate
fixed-geometry C14.9 gsplat entrypoint that preserves C8's accepted backward/Adam trainer, uses
real gsplat forward renders, disables nondeterministic CUDA backward, and deterministically fits
only RGB gains without making a quality or byte-equality claim.

Independently rebuilt final images are:

- COLMAP:
  `sha256:1c40cdfda95d53c8ea28e795060359ba0ed9e2288cd1d8fa48a9c554d7a97a14`;
- Open3D:
  `sha256:264a375b0a0a2be25fdf62a314cd8f48bf4bae83c646eb7b99d8d8ba22539cdc`; and
- gsplat:
  `sha256:fa3da4146f2931ae380e578028e97fbde99bd8aea6d54c3a5381b56a88aa9f6a`.

The strict common record
`b35f5e9018271bd9fd46a1fee72c0f3655624ef5b7d4812f98b332fa87a42fd5`
contains all 16 expected runs across four baseline candidates, two cohorts, one segment and two
fresh run indexes, with zero missing, partial, failed, isolation-violating or resource-ceiling
runs. All eight repeatability scopes pass. Experimental candidates remain abstained at the frozen
licence/dependency/image gates.

The reported lint finding at
`services/platform-api/src/modules/render-stills/authorities.ts:239` is not reproducible: the exact
platform lint command passes on both base and original head, and the line is unchanged. No edit was
made there.

Exact evidence is in
`docs/evaluation/reconstruction/C14_9_CAPTURE_BENCHMARK_SOFTWARE_ACCEPTANCE_2026-08-27.md`; the
physical sequence is
`docs/runbooks/development/C14_9_CAPTURE_ENVELOPE_BENCHMARK.md`. Real Capture Envelope transfer,
physical-device compatibility, representative accuracy, production routing, canonical mutation and
promotion remain `NOT RUN` / prohibited.

## Physical non-accuracy follow-up - 2026-08-28

After PR #13 merged, the private physical envelope completed the eligible Windows/RTX matrix under
the frozen isolation and resource ceilings. All 12 required fragments were supplied with zero
missing, partial, failed, isolation-violating or resource-ceiling runs, and all six repeatability
scopes passed. Depth/Open3D, RoomPlan and experimental candidates abstained honestly where their
input/licence/dependency/image gates were not met. The immutable machine record retains physical
compatibility `requires-review`; independent review accepts only this one envelope's export,
isolated runtime and repeatability evidence. Dimensional and representative accuracy remain
`NOT RUN`; production promotion is prohibited. Independent review additionally found the retained reconstruction sparse,
fragmented, incomplete and unsuitable for consumer digital-twin presentation or routing; runtime
and repeatability success is not visual-quality acceptance. Redacted evidence is in
`docs/evaluation/reconstruction/C14_9_CAPTURE_BENCHMARK_PHYSICAL_NON_ACCURACY_2026-08-28.md`.

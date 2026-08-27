# C14.8 accepted-capture benchmark handoff — Windows / RTX 5080

## Boundary and current status

**NOT RUN — this checkpoint installs no VGGT, MASt3R, Video Depth Anything or new gsplat production
path.** The existing C8 service remains the only production reconstruction boundary and every
result remains proposal-only. This handoff defines an isolated, rights-controlled evaluation to be
run later on an authorised Windows 11 / WSL 2 / RTX 5080 host.

The benchmark may begin only with a physically accepted `capture-envelope-v1`. Simulator fixtures,
unaccepted local drafts, expired rights and quarantined sources are invalid inputs. The evaluator
must not write to C4, call C5, replace C8 output, register independent coordinate segments without
evidence or treat appearance/depth predictions as dimensional truth.

## Frozen input export

Create one read-only private directory per accepted envelope:

```text
capture-benchmark-input/<envelope-sha256>/
├── envelope.json
├── export-manifest.json
├── rgb/<asset-id>.<ext>
├── depth/<artifact-id>.f32le       # optional
└── roomplan/<package-id>/...       # optional, separate evidence
```

Export through authenticated C2 original-access and C7 package/artifact access only after fresh
membership, current service-processing rights and source readiness checks. Never copy a signed URL
into a manifest or log. `export-manifest.json` must contain the exact source commit, envelope ID and
hash, export UTC time, actor/project/tenant identifiers as salted evaluation aliases, every relative
path/byte count/SHA-256/MIME type, rights basis, `serviceProcessingConsent: true`,
`trainingUseConsent: denied`, and the envelope schema/generator/app/device-capability versions.

Verify before execution:

```sh
sha256sum envelope.json rgb/* depth/* 2>/dev/null
git status --short --branch
nvidia-smi
docker version
```

The envelope defines:

- `arkit-right-handed-y-up` segment coordinates with micrometre translations;
- camera-to-world poses, quaternion order `[x,y,z,w]` in nanounits;
- pinhole intrinsics in micropixels for the retained native camera raster and its declared
  orientation; and
- optional float32 little-endian metre depth in the `arkit-scene-depth-image-plane`, linked to exact
  camera sample IDs.

Each `independent-unless-later-registered` segment is a separate reconstruction problem. A candidate
may propose a registration and report its residual, but benchmark preprocessing must never join
segments by timestamp, room label or adjacency.

## Candidate freeze

Create one immutable container image per candidate with network disabled at runtime, read-only
inputs, a fresh empty output, one selected GPU, non-root user, dropped capabilities, no-new-
privileges and explicit CPU/RAM/PID/time ceilings. Record the full Dockerfile, image digest, package
lock, command argv/config hash, CUDA/PyTorch/driver inventory, source/weight hashes and licence
review. Do not deserialize untrusted pickle weights; prefer safetensors or an isolated conversion
whose source and output are both hashed.

| Candidate   | Exact evaluation pin                                                                                                                                                                                                                                                                                  | Input/role                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| COLMAP      | repository package `ml/reconstruction/windows-nvidia-v2`, COLMAP 4.1.1 commit `a0d785fba74b2664f31edc4a29026a8b27c00f67`, package `versions.json` and final built image digest                                                                                                                        | RGB geometry baseline; run both unconstrained SfM and an ARKit-prior diagnostic without asserting scale        |
| VGGT        | official `facebookresearch/vggt` commit `a288dd0f14786c93483e45524328726ab7b1b4ce`; gated `facebook/VGGT-1B-Commercial` safetensors revision and file SHA-256 must be frozen in the run record                                                                                                        | feed-forward cameras/depth/point-map proposal; compare predicted cameras with, never overwrite, ARKit evidence |
| MASt3R      | official recursive `naver/mast3r` commit `f5209afc300cec36239a7ac992263f36847bbba0`; freeze every submodule commit and exact `naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric` weight revision/hash                                                                                            | matching/point-map proposal; non-commercial licence means evaluation only unless counsel approves another use  |
| Video depth | official `DepthAnything/Video-Depth-Anything` commit `4f5ae23172ba60fd7bc11ef671cca678842c7072`; Apache-2.0 `depth-anything/Metric-Video-Depth-Anything-Small` revision `d776bc13e138ad490ec40a3fdc78201ec85a1ffd`, weight SHA-256 `3c28432b4e1f0d7bb31cad5151b6313b49457db5aa58d82e85bfb0f8b1311b33` | independent temporal metric-depth proposal; preserve raw output before any alignment to ARKit or LiDAR         |
| gsplat      | repository package `ml/reconstruction/windows-nvidia-v2`, gsplat 1.5.3 direct API and its exact final image digest                                                                                                                                                                                    | appearance-only comparison using exact calibrated frames; never a geometry, scale or collision winner          |

The upstream Git commits above were resolved on 2026-08-27. Before execution, fetch those exact
objects and stop if any object, submodule, gated weight, licence or hash cannot be independently
verified. A newer upstream `main` is not the named candidate.

## Deterministic input selections

For every envelope publish a hashed `selection.json` before running any candidate:

1. include all usable RGB keyframes with `trackingState: normal`, then produce a second inclusive
   run retaining limited-tracking frames to measure sensitivity;
2. order by `(segmentId, timestampMicroseconds, sampleId)` and never by filesystem enumeration;
3. retain native bytes for source hashing; create derived PNGs in a separate directory with tool,
   colour-space, orientation and output hashes;
4. use the envelope camera-to-world pose and scale the native-raster intrinsics only when resizing,
   recording the exact rational scale and transform;
5. decode optional depth by its declared width, height, format and sample binding; retain non-finite
   and missing-value counts; and
6. exclude a frame only with a typed reason. Missing/occluded coverage stays in the denominator.

Use the same selection for every compatible candidate. Record peak VRAM/RAM, wall time and all
abstentions/failures. Fix random seeds and deterministic controls where supported; run each
candidate twice from fresh empty outputs.

## Metrics and comparisons

Report per segment and per room; aggregate only after retaining every failed segment.

### Camera and registration

- registered-frame count and fraction;
- rotation error in degrees and translation-direction error against ARKit after a robust similarity
  alignment, with scale explicitly reported as estimated rather than known;
- focal/principal-point deviation from retained intrinsics;
- track length, reprojection error and disconnected-component count; and
- proposed cross-segment alignment residual, overlap support and abstention rate.

### Geometry and depth

- finite point/depth count, spatial coverage and observed/missing/occluded-cell coverage;
- depth absolute-relative error, RMSE and completeness against synchronized LiDAR only where valid;
- scale drift and temporal inconsistency for video depth;
- point-to-plane/Chamfer/F-score against an independently rights-cleared reference only when that
  reference and tolerance are frozen before the run; and
- topology/opening/room-count discrepancies reviewed separately from numeric error.

No LiDAR case may be used to hide non-LiDAR performance. Report `guided-rgb` and optional-depth
cohorts separately.

### Appearance and resources

- held-out PSNR, SSIM and LPIPS for VGGT/MASt3R-assisted or gsplat appearance outputs;
- exact train/test split hash with at least one held-out view;
- peak VRAM/RAM, GPU/CPU utilization samples, wall time, output bytes and failure category; and
- two-run metric deltas and output hashes. Non-byte-identical GPU output may pass only predeclared
  numeric tolerances.

## Required output record

Write one immutable `c14-8-capture-benchmark-v1.json` containing input/export/selection hashes,
candidate/source/submodule/weight/image/config hashes, host capability aliases, per-run raw artifact
hashes, metrics, resource peaks, warnings, failures, licence verdict and cleanup state. Store raw
customer media and derived geometry privately; Git may retain only a redacted aggregate record.

Verdicts are independent:

- runtime executable: pass/fail;
- algorithm output: pass/partial/fail;
- repeatability: pass/partial/fail;
- physical-capture compatibility: pass/partial/fail;
- representative accuracy: pass/partial/fail/not-run; and
- production promotion: always `prohibited` for this handoff.

Selection of a future production candidate requires a new contract, security/licence/privacy
review, representative rights-cleared evidence, failure thresholds, worker isolation, observability
and explicit C8/C9 integration. Benchmark success alone grants none of those.

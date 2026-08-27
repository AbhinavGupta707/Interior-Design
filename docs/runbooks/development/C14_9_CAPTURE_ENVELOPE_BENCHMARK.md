# C14.9 Capture Envelope benchmark — Windows / WSL / RTX 5080

## Status and authority

This is the definitive post-C14.8 software handoff. Run it only after C14.9 is merged to `main`,
from a clean exact commit, and only for an accepted `capture-envelope-v1` whose runtime is
`physical-device`. It exports immutable evidence and creates proposal-only evaluation outputs. It
does not accept physical accuracy, alter C4/C5/C8/C9, join independent coordinate segments, or
grant production authority.

Public or synthetic inputs may exercise the software as `benchmark-fixture`; they are never
homeowner evidence, physical-capture evidence, representative accuracy evidence, or production
dependencies. Keep real exports and all raw/derived outputs on private WSL ext4 storage. Do not put
them in Git, Windows-mounted folders, issue attachments, CI artifacts, or shared logs.

## Ready gate

Before handling a real envelope, require all of the following:

- clean WSL checkout at the merged C14.9 commit and a server with migrations through `0015`;
- accepted physical Capture Envelope; current tenant/project membership, current
  service-processing rights on the envelope session and every referenced RoomPlan source session,
  and an owner/editor bearer credential with `capture:artifact:export`;
- at least two retained JPEG/PNG RGB keyframes in one segment; exact ARKit pose/intrinsics for the
  prior; exactly sample-bound depth for Open3D; at least three calibrated frames for gsplat;
- Docker Desktop with WSL integration, one visible RTX 5080, driver/CUDA compatibility, at least
  373 GB free WSL space, 32 GiB available RAM and about 15 GiB free VRAM; and
- freshly built local baseline images whose exact `sha256:` IDs are recorded. Never use a tag as
  execution authority.

Absence of an optional capability produces a typed policy abstention. It does not invalidate the
RGB baseline. Each `independent-unless-later-registered` segment remains a separate benchmark unit.

## 1. Synchronize, build and inventory

Run inside Ubuntu WSL from `/home/abhinav/code/interior-design`:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
test -z "$(git status --porcelain)"
SOURCE_COMMIT="$(git rev-parse HEAD)"

docker build --file ml/reconstruction/windows-nvidia-v2/Dockerfile.colmap \
  --tag c8-v2-colmap:local .
docker build --file ml/reconstruction/windows-nvidia-v2/Dockerfile.open3d \
  --tag c8-v2-open3d:local .
docker build --file ml/reconstruction/windows-nvidia-v2/Dockerfile.appearance \
  --tag c8-v2-appearance:local .

COLMAP_IMAGE="$(docker image inspect c8-v2-colmap:local --format '{{.Id}}')"
OPEN3D_IMAGE="$(docker image inspect c8-v2-open3d:local --format '{{.Id}}')"
GSPLAT_IMAGE="$(docker image inspect c8-v2-appearance:local --format '{{.Id}}')"
case "$COLMAP_IMAGE$OPEN3D_IMAGE$GSPLAT_IMAGE" in
  *[!a-f0-9:]*|*sha256:sha256:*) exit 2 ;;
esac

umask 077
install -d -m 700 /home/abhinav/private/c14-9/{exports,authority,runs,candidates}
python3 ml/reconstruction/windows-nvidia-v2/capture_host_inventory.py \
  --host-alias windows-rtx5080-local \
  --image "colmap=$COLMAP_IMAGE" --image "open3d=$OPEN3D_IMAGE" \
  --image "gsplat=$GSPLAT_IMAGE" \
  --output /home/abhinav/private/c14-9/authority/host-capabilities.json
```

Review `nvidia-smi`, `docker version`, `wsl --version` from Windows and the redacted inventory.
Stop on a changed GPU, driver, image ID, insufficient disk/VRAM, or dirty checkout.

## 2. Transfer and verify the accepted physical envelope

Inject the bearer token and alias salt without command-line arguments, shell tracing, or log
capture. The salt must contain at least 32 bytes. The UUID values are private inputs used only to
derive salted aliases:

```sh
set +x
read -r -s -p 'C14.9 bearer token: ' C14_9_BEARER_TOKEN
printf '\n'
export C14_9_BEARER_TOKEN
export C14_9_ALIAS_SALT='<secret-manager value with at least 32 bytes>'
export C14_9_TENANT_ID='<lowercase tenant UUID>'
export C14_9_ACTOR_ID='<lowercase actor UUID>'

python3 ml/reconstruction/windows-nvidia-v2/capture_benchmark.py export \
  --base-url '<HTTPS platform API origin>' \
  --project-id '<lowercase project UUID>' \
  --capture-session-id '<lowercase capture-session UUID>' \
  --output-parent /home/abhinav/private/c14-9/exports \
  --source-commit "$SOURCE_COMMIT"

unset C14_9_BEARER_TOKEN C14_9_ALIAS_SALT C14_9_TENANT_ID C14_9_ACTOR_ID
```

The exporter re-fetches the accepted envelope, requires `runtime: physical-device`, and downloads
C2 originals plus only C7 depth/RoomPlan artifacts bound to that accepted envelope. Package reads
and cross-session RoomPlan artifact access revalidate the actual source session's current rights
and `proposed`/`abstained` state. API and signed-artifact authorities must be HTTPS,
credential-free and query-free where applicable; redirects are rejected so bearer or signed
authority cannot cross origins. Signed URLs, bearer tokens, credentials and object keys are never
persisted.

Files are mode `0600` beneath mode `0700` directories and verified while streaming. Existing
targets, dirty or untracked source state, redirects, links, traversal, oversized streams, duplicate
or undeclared paths, special files, hard links, schema drift, non-canonical JSON, mode drift,
hash/size drift, rights drift, unaccepted inputs and a dirty/wrong source commit fail closed.

Use the printed envelope hash as the directory name, then disconnect the evaluator from the API:

```sh
ENVELOPE_SHA='<64 lowercase hex printed by export>'
EXPORT_ROOT="/home/abhinav/private/c14-9/exports/$ENVELOPE_SHA"
python3 ml/reconstruction/windows-nvidia-v2/capture_benchmark.py verify \
  --export-root "$EXPORT_ROOT"
sha256sum "$EXPORT_ROOT/envelope.json" "$EXPORT_ROOT/export-manifest.json"
```

Copy or back up the directory only as a complete private tree. At the receiving host, compare the
directory name, canonical envelope SHA-256 and manifest SHA-256 out of band, then run `verify`
again offline. Any extra or missing file, duplicate, hard link, symlink, special file,
non-private mode, schema/hash/size/source-binding mismatch, or ancestor/path escape invalidates the
transfer. Never repair an export in place; create a fresh export after reauthorization.

## 3. Freeze selection and non-production routing

```sh
AUTHORITY=/home/abhinav/private/c14-9/authority
python3 ml/reconstruction/windows-nvidia-v2/capture_benchmark.py select \
  --export-root "$EXPORT_ROOT" --output "$AUTHORITY/selection.json"
python3 ml/reconstruction/windows-nvidia-v2/capture_benchmark.py policy \
  --export-root "$EXPORT_ROOT" --selection "$AUTHORITY/selection.json" \
  --candidate-root /home/abhinav/private/c14-9/candidates \
  --output "$AUTHORITY/policy.json"
sha256sum "$AUTHORITY/selection.json" "$AUTHORITY/policy.json"
```

The two cohorts are `normal` and `inclusive`; keyframes are selected and ordered independently
per segment by `(segmentId,timestampMicroseconds,sampleId)`. Video containers are not substituted
for keyframes. Every downstream adapter recomputes the selection hash and segment/cohort scope.
Record typed exclusions and observed/missing/occluded coverage denominators. Run every selected
candidate twice from fresh output for every segment/cohort; retain every abstention and failure.
Do not silently fall back or join across segments or cohorts.

## 4. Baseline execution sequence

Every container invocation must use the exact image digest plus:

```text
--rm --network none --read-only --cap-drop ALL
--security-opt no-new-privileges --gpus device=0
--cpus 12 --memory 24g --pids-limit 512 --user 1000:1000
--env HOME=/tmp --tmpfs /tmp:rw,noexec,nosuid,nodev,size=2g
```

Mount the verified export/derived input read-only, one fresh private work/output directory writable,
and no other host path. Enforce a 30-minute wall timeout, 12 GiB maximum scratch and 14 GiB peak
VRAM; sample Docker memory and NVIDIA memory/utilization for every command and retain exact argv,
config hash, stdout/stderr hash, exit status and resource peak. A process exit of zero is not an
algorithm pass.

For each selected segment/cohort and run index `1`, then `2`, execute in this order:

1. `capture_benchmark.py colmap-input` into a new derived root. This copies unchanged source bytes
   and writes their sample/hash mapping.
2. In the COLMAP digest, run `c8-sm120-probe`; `feature_extractor` with seed 0, CPU SIFT, one thread,
   PINHOLE and max size 3200; `exhaustive_matcher` with seed 0, CPU brute force, one thread and
   guided matching; `mapper` with seed 0, one thread, one model; `model_analyzer`; then
   `image_undistorter` from that run's `sparse/0`, CUDA `patch_match_stereo` on GPU 0 with geometric
   consistency/max size 3200, and `stereo_fusion` using geometric input. Run
   `validate_colmap_outputs.py` and retain the converted sparse text model plus dense binaries,
   fused PLY and logs.
3. For the ARKit-prior diagnostic, copy that run's feature database into a new writable work root;
   invoke `capture_benchmark.py colmap-prior --database <copied database>` into a separate new
   prior root; then run COLMAP `point_triangulator` using the exact images/database/prior and
   `model_analyzer`. Never pass a read-only feature database to the triangulator. Convert ARKit
   x-right/y-up/look-minus-Z camera-to-world evidence to x-right/y-down/look-plus-Z OpenCV/COLMAP
   world-to-camera using the explicit Y/Z sign change. Keep the native raster and native-raster
   intrinsics bound without an implicit orientation rotation. These remain proposals; supplied
   metre translation is not independent scale or accuracy proof.
4. If exact bound depth is selected, run the Open3D digest with entrypoint
   `python /opt/c8/open3d_capture.py --export-root /c14/export --selection /c14/selection.json
--cohort <cohort> --segment-id <segment UUID> --output /c8/output`. Retain the exact sample/depth
   bindings, non-finite counts, point/mesh hashes and CUDA tensor probe. The TSDF itself is the
   Open3D legacy CPU path; supplied metres are not independently validated.
5. Prepare gsplat only from the same selection and one retained COLMAP text model directory whose
   `cameras.txt`, `images.txt` and `points3D.txt` all come from the same run. Override the
   appearance image entrypoint with
   `python /opt/c8/prepare_gsplat_capture.py --export-root /c14/export
--selection /c14/selection.json --cohort <cohort> --segment-id <segment UUID>
--model /c14/model-text --output /c8/output --steps 100`. The preparer must reject missing or extra
   selected images and records all three model hashes. Mount the resulting input read-only and
   override the final image entrypoint with
   `python /opt/c8/direct_gsplat_capture.py` once for the current outer run index; repeat through
   run index 2 from a fresh output root. The default `direct_gsplat.py` remains the accepted C8
   backward/Adam trainer and is not the C14.9 repeatability entrypoint. The capture adapter keeps
   geometry fixed, uses real gsplat forward renders, disables CUDA rasterizer backward and fits
   only three RGB gains with deterministic CPU float64 Adam. Freeze the last selected view as
   holdout. Retain the deterministic-control record and numeric repeatability result; gsplat bytes
   need not match and remain appearance-only, arbitrary-unit, non-dimensional proposals. A
   repeatability pass is not a quality or accuracy verdict.

Use the exact option tuples in `run_acceptance.py` as the COLMAP argument authority; the only
capture substitution is the `colmap-input` image root and that run's generated `sparse/0` model.
Never substitute the fixture `known-model`. A complete run record must use `capture_metrics.py` and
contain two strict fragments per `(candidateId,cohort,segmentId)` bound to the same selection,
image/config hashes and frozen metric vocabulary.

## 5. Experimental candidates

`experimental-candidates.json` is the only candidate registry. The policy selects an experimental
candidate only when its minimum capture inputs and all local gates pass. Each candidate directory
must contain the exact source checkout, named weight and `candidate-manifest.json` with exactly:

```json
{
  "candidateId": "<registry candidate ID>",
  "dependencyLockPath": "<relative fully hashed lock path>",
  "dependencyLockSha256": "<64 hex>",
  "imageSha256": "sha256:<64 hex>",
  "registrySha256": "<SHA-256 of experimental-candidates.json>"
}
```

The verifier checks the exact clean Git commit including untracked state, exact recursive
submodule-set equality, confined symlink-free candidate paths, canonical manifest, weight
hash/size, fully hashed lock and lock hash, registry binding and exact local image ID. Runtime then
uses the experimental ceiling: network off,
non-root/read-only/capability-dropped/no-new-privileges, GPU 0, 12 CPUs, 512 PIDs, 32 GiB RAM,
15 GiB VRAM, 16 GiB scratch and 45 minutes. Pickle is allowed only after hash verification inside
that isolated container.

- VGGT remains blocked until the commercial agreement is explicitly accepted and the exact gated
  weight hash is independently visible.
- MASt3R remains non-commercial CC BY-NC-SA 4.0 evaluation-only and blocked until a compatible,
  fully hashed recursive dependency lock and exact Blackwell image are reviewed.
- Video Depth Anything Small remains local Apache-2.0 evaluation-only and blocked until a compatible,
  fully hashed CUDA 13.2 lock/image is reviewed; the `.pth` weight is isolated pickle.

Do not install candidate dependencies on the host and do not let any candidate fetch at runtime.

## 6. Review and verdict

`capture_metrics.py` accepts only private, canonical, non-hard-linked authority files and strict
run fragments linked to the verified export manifest, selection, policy and host inventory. Every
selected `(candidateId,cohort,segmentId)` requires run indexes 1 and 2 with identical image,
derived-input, config, seed and deterministic-control authority. Every fragment carries the full
frozen metric vocabulary, non-empty raw-artifact hashes, exact isolation, resource measurements,
status and typed failure code. The record counts selected scopes, abstentions, expected, supplied,
missing, partial, failed, isolation/resource-violating runs and repeatability failures. Unsupported
metrics are `not-applicable`; repeatability limits must not change after seeing results. Preserve
raw outputs, logs, hashes and failures even when a run fails.

For a real envelope, report `physicalCaptureCompatibility: requires-review` until a reviewer checks
the actual device/runtime, transfer, rights, RGB, intrinsics/orientation, camera convention,
segment, depth/RoomPlan bindings, failures and resource evidence. Representative accuracy stays
`not-run` without a predeclared rights-cleared reference and ground truth. No reconstruction,
depth, render or appearance result becomes canonical or establishes physical dimensions.
Production promotion is always `prohibited`. Remove private data only through an explicit,
separately reviewed retention action; do not use Docker prune or broad recursive deletion as part
of this runbook.

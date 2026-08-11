# C14 optional image-enhancement boundary

## Status

Image enhancement is disabled by default. `EnhancementService()` constructs only
`DisabledEnhancementProvider`; it does not inspect environment variables, discover a provider, read a
key, contact a network, download a model, invoke Blender, or delay the already-published geometry-safe
result.

The 2026-08-11 integrated close-out keeps that default in executable C14 composition. The disposable
C1-C14 journey publishes only the geometry-safe parent through `FrozenInertRenderer`; it does not
activate this fixture or any external provider. The repository-wide `pnpm test:c14` gate includes the
enhancement unit and standalone security suites so this boundary is not silently omitted.

The `DeterministicLocalTestAdapter` is an explicitly opt-in validation fixture. Callers must construct
it in code and pass `allow_test_adapter=True`. Its manifest states:

- `executionClass: deterministic-local-test`;
- `externalNetworkUsed: false`;
- `testOnly: true`; and
- `productionEligible: false`.

It applies a small deterministic RGB delta inside the allowed-edit mask. It is not generative
inference and is not evidence of image quality, provider capability, GPU behavior, or production
readiness.

## Input allowlist

The typed provider port can represent only:

1. exact `geometry-safe-png` bytes and SHA-256;
2. exact `depth-exr` bytes and SHA-256;
3. exact `normal-exr` bytes and SHA-256;
4. exact `segmentation-png` bytes and SHA-256;
5. an exact binary `allowed-edit-mask-png` and SHA-256; and
6. the exact canonical camera SHA-256.

All five artifacts must have identical declared dimensions. The request has no metadata, prompt,
address, notes, schedules, rights text, provider token, path, URL, object key, raw unrelated evidence,
or extension field. Additions require a new reviewed schema version; callers must not wrap arbitrary
project data into any artifact.

Before provider execution, the boundary recomputes every hash and validates:

- dimensions from 64 through 4,096 pixels per axis;
- at most 16,777,216 pixels;
- at most 128 MiB per PNG, 256 MiB per EXR, and 512 MiB in aggregate;
- exact PNG and OpenEXR signatures;
- non-interlaced, 8-bit lossless PNG structure, chunk framing, CRCs, zlib termination, decompressed
  byte count and filter types;
- opaque RGB/RGBA base and segmentation images; and
- a grayscale mask containing only `0` or `255`.

The stdlib boundary deliberately does not decode OpenEXR channels. Depth and normal are exact opaque
conditioning artifacts pinned by hash, byte limit and authoritative manifest dimensions. The render
worker and independent C14 evaluation remain responsible for finite-channel EXR validation. Do not
describe this adapter as having independently validated EXR numeric contents.

## Provider and result port

Every candidate must echo the exact base, depth, normal, segmentation, mask and camera hashes plus a
code-owned provider manifest containing provider, model, adapter and configuration versions. Any
mismatch is quarantined. The candidate PNG is rehashed and decoded independently; provider-declared
dimensions or metrics are never trusted.

The service exposes explicit states:

| State              | Presentable enhancement                                | Geometry-safe result   |
| ------------------ | ------------------------------------------------------ | ---------------------- |
| `disabled`         | no                                                     | unchanged and readable |
| `cancelled`        | no                                                     | unchanged and readable |
| `timed-out`        | no                                                     | unchanged and readable |
| `resource-limited` | no                                                     | unchanged and readable |
| `failed`           | no                                                     | unchanged and readable |
| `rejected`         | no; candidate remains quarantine-only                  | unchanged and readable |
| `succeeded`        | one separately labelled `illustrative-enhancement-png` | unchanged and primary  |

Every `EnhancementOutcome` hard-codes `safe_result_affected=False`. Only `succeeded` may contain an
artifact, and only an accepted geometry guard may produce `succeeded`. Storage/public-access
integration must preserve this invariant: persist or publish the enhancement only after the outcome
is presentable, under a child-result role distinct from the safe result.

## Geometry guard semantics

Evaluation uses exact RGBA pixel equality; no lossy tolerance is hidden.

- Camera lock requires the candidate's camera hash to equal the request hash.
- Every changed pixel must be `255` in the binary allowed-edit mask.
- Protected edges are the four-neighbour boundaries of non-background canonical segmentation labels.
- Any changed protected-boundary pixel sets `protectedGeometryMoved=true` and rejects the candidate.
- Protected-edge agreement is the exact unchanged fraction of those boundary pixels and must be at
  least 9,800 basis points.
- Segmentation IoU is a deterministic conservative protected-footprint score. Each changed protected
  boundary pixel is removed from the candidate footprint before IoU against the trusted
  segmentation footprint. It must be at least 9,800 basis points.

The segmentation score is not semantic re-segmentation of the illustrative output. It is a
dependency-free hostile-output guard using the exact trusted segmentation and protected edges.
Independent C14 visual evaluation may add stronger models or cross-device tests behind a separately
versioned evaluator; it must not weaken this mask/camera/hash boundary.

No PNG comparison can infer millimetre depth deviation. This module reports no millimetre depth
metric, never promotes appearance to canonical geometry, and never claims survey, structural,
regulatory, product, cost or professional certainty.

## Cancellation, time and resources

`ExecutionContext.checkpoint()` is called before provider execution, during deterministic pixel
processing, after provider return and during evaluation. It checks a cancellation callback and a
monotonic integer-nanosecond deadline. The default timeout is 30 seconds; the code-owned maximum is
300 seconds. Candidate PNG bytes also have an independent output ceiling (128 MiB by default and
never above it).

A future external adapter must cooperate with checkpoints and impose its own bounded, shell-free
transport cancellation. The synchronous port cannot forcibly interrupt a provider implementation
that ignores the context. Such an adapter is not approved by this runbook.

## Privacy-safe diagnostics

Use `EnhancementOutcome.diagnostic()` for logs. It emits only event name, state, safe code, provider
execution class, test-only status, presentability and `safeResultAffected: false`. Do not log request
or result dataclasses as a substitute. Artifact bytes and hashes are excluded from `repr`, and
`EnhancementError.__str__` exposes only the safe code.

Never log or attach:

- artifact bytes, source or conditioning hashes;
- addresses, notes, schedules, prompts or raw evidence;
- paths, URLs, object keys, signed access data or provider payloads; or
- credentials, lease tokens, model-provider tokens or configuration bodies.

## Integration

The durable C14 worker should:

1. load only the already-published safe result and its exact five inputs;
2. construct `EnhancementRequest` after storage hash/size verification;
3. call `EnhancementService.run` as a child operation;
4. map disabled/cancelled/timed-out/resource/failed/rejected states to the durable child job without
   changing the parent render result;
5. publish only a `presentable` artifact as `illustrative-enhancement-png`; and
6. persist the exact provider/model/config provenance and geometry guard beside the child result.

There is no external-provider activation flow in C14. Adding one requires a separate approved
provider/data/rights/spend decision, reviewed retention/training policy, an explicit code-owned
adapter and configuration, transport security/resource controls, hostile contract tests and updated
threat/evaluation evidence. An environment variable or discovered key must never activate it.

## Verification

From the repository root, using the already-installed environment and without changing dependency
files:

```sh
UV_CACHE_DIR=.cache/uv uv run ruff check \
  services/inference-worker/src/inference_worker/image_enhancement \
  services/inference-worker/test/image_enhancement \
  tests/security/image-enhancement

UV_CACHE_DIR=.cache/uv uv run mypy \
  services/inference-worker/src/inference_worker/image_enhancement \
  services/inference-worker/test/image_enhancement \
  tests/security/image-enhancement

UV_CACHE_DIR=.cache/uv uv run pytest -q \
  services/inference-worker/test/image_enhancement \
  tests/security/image-enhancement

git diff --check
```

These tests use visibly synthetic in-memory artifacts. No network, provider, key, model download,
customer data, Blender, GPU or CUDA execution is required or claimed.

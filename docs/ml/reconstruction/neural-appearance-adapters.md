# C8 optional neural appearance adapters

## Authority and scope

The Nerfstudio and gsplat adapters add an optional appearance layer to an already-produced C8 geometry proposal. Their only public artifacts are `nerfstudio-viewer` or `gaussian-splat` with `dimensionalAuthority: non-dimensional`. They cannot establish scale, validate a camera, overwrite geometry, call C5, or create a canonical mutation.

The adapters accept one lane-local `c8-neural-appearance-input-v1` envelope. It contains the frozen `c8-media-preparation-v1` manifest, a frozen `c8-calibrated-cameras-v1` manifest, the frozen `c8-geometry-result-v1` manifest, stable job/project/attempt identities, method, and rights decision. It contains no local path, executable, flag, URL, object key, signed access, credential, or raw media. Trusted orchestration supplies privacy-reviewed staged frame files separately, keyed by frame UUID and checked against each sanitized SHA-256.

An accepted request must satisfy all of these conditions:

- service-processing consent is true and the rights basis is allowed;
- training use is exactly `denied`;
- prepared privacy status is accepted, metadata is stripped, and no frame still requires review;
- project/job identities and prepared-to-camera hash links agree;
- cameras reference the exact sanitized frame hashes;
- registered camera count, coordinate system, scale status, unit, and validated-scale residual rules agree with geometry;
- every geometry input artifact is `proposal-only`; and
- all nested objects are strict and reject unknown fields.

## Registration before execution

Discovery happens before any job input is read. `register_runtime()` resolves worker-installed `python`, `ns-train`, `ns-export`, and `nvidia-smi`, then invokes the internal path-fixed probe with a credential-free environment. Registration succeeds only for Python 3.10.13, PyTorch 2.1.2+cu118, CUDA 11.8, Nerfstudio 1.1.5, gsplat 1.4.0, and at least one CUDA device. Missing tools, unavailable CUDA, probe failure, or a version mismatch returns a bounded safe code and publishes nothing.

This is the required diagnostic order for an unavailable appearance feature:

1. confirm adapter registration and exact package activation;
2. confirm the fixed runtime probe succeeds;
3. only then inspect a job manifest, permissions, or execution.

The current Apple Silicon host does not satisfy registration. That state is `APPEARANCE_TOOL_UNAVAILABLE` or `APPEARANCE_CUDA_UNAVAILABLE`, not an algorithm failure and not a CUDA pass.

## Fixed commands

No request value can add or replace an argument. Nerfstudio uses this profile:

```text
ns-train nerfacto --data <private-dataset> --output-dir <private-output> \
  --experiment-name c8-appearance --timestamp attempt-NN --vis tensorboard \
  --max-num-iterations 30000 --viewer.quit-on-train-completion True
```

gsplat uses Nerfstudio's Splatfacto integration and a fixed export:

```text
ns-train splatfacto <same fixed options>
ns-export gaussian-splat --load-config <fixed-attempt-config> \
  --output-dir <fixed-private-export>
```

Commands run with `shell=False`, no stdin, a minimal environment, a private runtime home, a 24-hour wall-clock limit, a 16 MiB private diagnostic-output limit, cooperative cancellation, process-tree termination, and attempt-directory cleanup. The Windows evidence runner additionally fixes CPU, RAM, swap, process, shared-memory, temporary-storage, network, read-only-root, and single-GPU limits.

## Output and publication

Nerfstudio output is repackaged as a deterministic tar containing only a sanitized config, one checkpoint, and a `c8-nerfstudio-viewer-bundle-v1` manifest. gsplat output must be a bounded binary little-endian PLY and is copied as one appearance artifact. Both paths scan for private runtime roots, URLs, bearer/signed-request markers, malformed type, symlinks, and size overflow.

The public `c8-appearance-result-v1` contains only artifact UUID, byte count, content hash, source/tool hashes, method, exact tool manifest, geometry manifest hash, media type, and non-dimensional authority. It contains no artifact storage location. Durable orchestration must re-check attempt/version/tenant/project/job/cancellation/rights immediately before its synchronous publisher commits. A false fence produces `APPEARANCE_STALE_ATTEMPT`; cancellation is terminal for that attempt.

## Safe outcomes

| Safe code                      | Meaning                                           | Publication                |
| ------------------------------ | ------------------------------------------------- | -------------------------- |
| `APPEARANCE_COMPLETED`         | Fixed run and final fence succeeded               | one non-dimensional result |
| `APPEARANCE_TOOL_UNAVAILABLE`  | required executable/package absent                | none                       |
| `APPEARANCE_CUDA_UNAVAILABLE`  | no eligible CUDA device                           | none                       |
| `APPEARANCE_VERSION_MISMATCH`  | installed runtime differs from the pin            | none                       |
| `APPEARANCE_MANIFEST_REJECTED` | frozen input or trusted staging failed validation | none                       |
| `APPEARANCE_TOOL_FAILED`       | a fixed command returned non-zero                 | none                       |
| `APPEARANCE_TIMEOUT`           | wall-clock budget exceeded                        | none                       |
| `APPEARANCE_OUTPUT_LIMIT`      | private command output exceeded 16 MiB            | none                       |
| `APPEARANCE_OUTPUT_INVALID`    | export, sanitization, or packaging failed         | none                       |
| `APPEARANCE_CANCELLED`         | attempt was cancelled                             | none                       |
| `APPEARANCE_STALE_ATTEMPT`     | final publication fence rejected the worker       | none                       |

Synthetic executor tests exercise the adapter boundary but are always reported as `runtime_evidence: synthetic-fixture`. They do not prove Nerfstudio, gsplat, PyTorch, CUDA, GPU memory, or representative reconstruction quality.

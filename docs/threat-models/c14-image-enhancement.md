# C14 image-enhancement threat model

## Scope and invariant

This model covers only the optional C14 enhancement child operation in
`services/inference-worker/src/inference_worker/image_enhancement`. The already-published
geometry-safe C14 result is the authoritative visual reference and succeeds independently.

The security invariant is:

> Disabled, cancelled, timed-out, resource-limited, failed or rejected enhancement output is never
> presentable, never receives public access and never mutates, hides, delays or downgrades the safe
> render.

The current production capability is disabled. The local deterministic adapter is non-production
test evidence and performs no provider, network, filesystem, subprocess, model or GPU action.

## Assets

- immutable safe PNG and exact depth, normal and segmentation conditioning artifacts;
- explicit allowed-edit mask and canonical camera identity;
- exact artifact, provider, model, adapter and configuration hashes/versions;
- geometry-guard decision and safe diagnostic state;
- isolation and availability of the already-published safe result; and
- private project data that must not cross this boundary at all.

Enhancement PNG pixels are untrusted derived appearance until all guards pass. They have no canonical
dimensional, structural, regulatory, cost, availability or professional authority.

## Trust boundaries and data flow

1. The durable render product resolves exact content-addressed artifacts after safe publication.
2. The inference boundary recomputes hashes, validates byte/dimension/type limits and decodes the
   narrow PNG subset.
3. A code-owned provider adapter receives only the typed artifact/camera allowlist.
4. The provider candidate crosses back as hostile data with exact claimed provenance and input pins.
5. The evaluator independently decodes the PNG and checks camera, mask, edge and segmentation rules.
6. Only an accepted candidate can become a separately labelled child artifact.

Address, notes, schedules, prompts, rights text, raw unrelated evidence, object locators, credentials
and database authority have no edge into step 3.

## Threats and controls

| Threat | Control and evidence |
| --- | --- |
| Provider activates from an available key or environment variable | `default_provider()` always returns the disabled adapter; no discovery/activation path exists. |
| Private context is over-shared | Closed slotted request schema contains only five exact artifacts and a camera hash; no metadata/prompt/extensions. |
| Artifact substitution or replay against another render | Every input byte string is rehashed; candidate must echo exact base, conditioning, mask and camera hashes. |
| Model/config/provider substitution | Candidate provenance must exactly equal the code-owned adapter provenance, including configuration SHA-256. |
| Malformed/truncated PNG exploits decoder | Stdlib-only bounded parser validates signature, chunk order/count/length, CRC, critical chunks, bit depth, colour type, interlace, zlib termination, decompressed size and filters. |
| Compressed image bomb or oversize allocation | 4,096-axis, 16,777,216-pixel, encoded/decompressed byte and aggregate artifact ceilings are checked before/while decoding. |
| Type confusion or boolean-as-integer bypass | Runtime checks use exact types for integers, booleans, bytes, enums, dataclasses and provider responses. |
| NaN/Infinity changes decisions or hashes | Canonical configuration hashing rejects every non-finite float and bounds nesting/collection sizes. Guard metrics are bounded integers only. |
| Provider changes pixels outside approved area | Exact per-pixel comparison requires zero changes outside the binary mask. |
| Provider moves a protected object/surface edge inside the mask | Segmentation-derived protected boundaries remain immutable; any changed boundary pixel rejects. |
| Provider swaps camera or conditioning | Exact camera/depth/normal/segmentation pins are mandatory before pixel evaluation. |
| Provider fabricates success metadata | Provider-declared metrics are ignored. The service constructs guard metrics and presentation state itself. |
| Rejected bytes accidentally publish | Outcome invariants permit an artifact only in `succeeded`, require an accepted guard, and always keep `safeResultAffected=false`. |
| Cancellation race publishes late output | Cancellation is checked before, during and after provider work and throughout evaluation; any late cancellation drops the candidate. Durable publication must add its existing lease fence. |
| Time/output exhaustion | Monotonic deadline, cooperative checkpoints, strict input/output limits and explicit timed-out/resource-limited states. |
| Error/log leakage | Safe-code-only exceptions, byte/hash-redacted repr and an allowlisted diagnostic event; security tests inject private markers. |
| Local fixture is mistaken for provider evidence | Provenance hard-codes test-only/non-production/no-network; service requires explicit `allow_test_adapter=True`. |
| Appearance is promoted to dimensional truth | Output role is `illustrative-enhancement-png`; no mutation port and no millimetre depth metric exist. |

## Hostile fixture coverage

The owned unit and independent security suites cover:

- disabled provider and forbidden implicit test-adapter activation;
- deterministic replay and exact output/config provenance;
- cancellation before and after provider return, deadline and output-resource states;
- truncated, CRC-corrupt, trailing, oversized-dimension, unsupported-depth and wrong-colour PNGs;
- non-binary masks, mismatched dimensions/hashes/base/conditioning/camera/provider config;
- changes outside the allowed mask and changes to protected edges inside an allowed mask;
- type-confused responses and dimensions, non-finite configuration values and deep/large inputs;
- exception/diagnostic privacy markers; and
- a socket-denied run proving the local adapter does not use networking.

All fixtures are deterministic synthetic bytes. They contain no customer data, third-party media,
provider payload, key or model weight.

## Residual risks and non-evidence

- The stdlib boundary treats OpenEXR depth/normal content as exact opaque bytes. Renderer and
  independent evaluation must prove finite EXR channels before integration; C14-L3 does not.
- The segmentation IoU is a conservative trusted-footprint/edge metric, not semantic
  re-segmentation of arbitrary photoreal imagery. Stronger independent evaluation remains required
  before any external provider can be accepted.
- Cooperative checkpoints cannot forcibly pre-empt an adapter that ignores the execution context.
  A future remote/subprocess adapter needs its own process/transport cancellation and hard resource
  isolation.
- In-memory bytes are already resident when this port validates them. Durable storage/download code
  must enforce equivalent streaming limits before allocation.
- No external provider quality, availability, retention deletion, training policy, model-card,
  regional processing, paid-service, GPU/CUDA or customer-media evidence exists.
- No Blender invocation or real render was performed. The checkpoint's separate hardware render gate
  remains deferred under the C14 contract.
- Pixel preservation does not prove the source model is survey-accurate, as-built, structural,
  compliant, available, costed or professionally approved.

## Future provider activation gate

An external provider remains prohibited until an accountable decision approves provider identity,
data categories, rights, derivative/output terms, retention/deletion, training exclusion, geography,
security, spend and capacity. Implementation then requires a code-owned adapter, no broad
credentials, bounded transport, cancellation, content validation, exact reproducibility manifest,
provider-specific hostile fixtures and independent C14 evaluation. The safe render must remain
primary even if every enhancement attempt fails.

# C8 reconstruction threat model

## Scope and non-goals

This model covers C8 media preparation references, camera/geometry manifests, optional Nerfstudio/gsplat appearance execution, independent evaluation, and publication. C8 produces immutable proposal geometry and optional non-dimensional appearance. It does not merge evidence, infer hidden structure, establish structural/regulatory/professional truth, call C5, or mutate the canonical home.

## Protected assets

- tenant/project/job identity and authorization decisions;
- immutable source and sanitized-frame hashes, rights, consent, and privacy review;
- camera calibration/pose and proposal geometry provenance;
- service credentials, storage identifiers, local paths, signed access, and worker topology;
- customer media, sanitized images, checkpoints, splats, caches, and runtime diagnostics;
- attempt/version/cancellation/rights publication fences;
- dimensional-authority labels and canonical mutation boundary; and
- evaluation denominators, evidence class, tool/config/hardware identities, and output hashes.

## Trust boundaries

1. Public API to durable job orchestration: public requests contain stable references, never storage locations or tool commands.
2. Durable orchestration to inference worker: tenant/project/job/attempt and current rights are authenticated and scoped.
3. Trusted storage staging to optional adapter: private direct-child files are supplied outside the public manifest and hash-checked.
4. Adapter to Nerfstudio/gsplat subprocess: only registered executables and fixed argv/environment/workspaces cross the boundary.
5. Tool output to artifact publisher: output is bounded, type-checked, sanitized/scanned, hash-addressed, and non-dimensional.
6. Worker to durable publication: a final atomic attempt/version/rights/cancellation fence precedes storage/result commit.
7. Product results to evaluation/UI: evidence labels and geometry/appearance authority must survive presentation and reporting.

## Threats and mitigations

| Threat                                             | Mitigation and independent evidence                                                                                                        | Residual risk / required live check                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Foreign-tenant/project reference                   | authorization denies scope mismatch before disclosure; reference security suite covers every role/action                                   | integrated API/database tenant tests after L1 merge                                    |
| Viewer creates/cancels/retries/publishes           | only owner/editor mutation roles; viewer is read-only                                                                                      | real BFF/API session test                                                              |
| Rights withdrawal or missing service consent       | strict rights validation plus recheck at lease/publication; training fixed to denied                                                       | durable orchestration must connect the final fence                                     |
| Arbitrary executable/flags/shell                   | public adapter manifest is strict and path-free; commands are compile-time argv; `shell=False`                                             | static suite and production worker registration review                                 |
| URL/object-key/path/signed-token injection         | unknown fields rejected; trusted staged paths supplied separately; telemetry/results omit untrusted values                                 | storage adapter composition review                                                     |
| Symlink/path traversal or staged-file substitution | staging root and files reject symlinks, require direct children/allowed suffix, exact set, and SHA-256                                     | platform-specific filesystem race hardening; staging should be immutable               |
| Manifest bomb/type confusion/non-finite data       | strict key/type/count/integer/unit limits, camera/frame uniqueness, pixel/artifact budgets, finite private conversion                      | fuzz/property expansion with merged L3 schema                                          |
| Privacy-review bypass                              | prepared manifest must be accepted; metadata stripped; `review-required` is rejected                                                       | live L2 redaction/media pipeline evidence                                              |
| Credential/data leakage in subprocess logs         | minimal environment, no stdin, combined output retained only in private bounded temporary file and never returned                          | crash reporter/container log configuration review                                      |
| Private path/URL embedded in model output          | config replacement, absolute-path removal, binary marker scan, fixed archive members, safe public result                                   | learned weights may encode source appearance; access/lifecycle policy still required   |
| Malicious or oversized export                      | fixed expected location/type, symlink rejection, binary PLY header, artifact byte limit, 16 MiB process-output limit                       | deeper PLY semantic validation may be needed by final viewer importer                  |
| Cancellation or retry race publishes stale output  | process-tree termination, cancellation checks, final publication fence, attempt in deterministic identities                                | publisher must make fence plus commit atomic                                           |
| Appearance gains dimensional authority             | only viewer/splat kinds and `non-dimensional`; parser rejects appearance in geometry; no canonical/C5 fields                               | every downstream UI/exporter must preserve labels                                      |
| Exported neural mesh treated as geometry           | no neural mesh is accepted/published by this lane; even tool exports remain appearance evidence                                            | orchestrator must not route tool files into L3/C9 geometry                             |
| Hidden failure/partial/disconnected/unknown scale  | evaluator and UI keep denominators, components, registered counts, findings, scale and residuals explicit                                  | live producer journey after merge                                                      |
| Resource exhaustion                                | fixed frame/artifact bounds, wall timeout, process output cap, cancellation/cleanup; Windows run fixes CPU/RAM/swap/PIDs/tmpfs/GPU/network | production scheduler quotas and disk accounting remain orchestrator-owned              |
| Supply-chain substitution                          | exact source commits, image digests, hashed Python lock, package manifest, exact runtime probe/version check                               | execute/build on named workstation; archive registry signatures/SBOM not yet collected |
| Fixture laundering                                 | runtime observations say `synthetic-fixture`; UI copy is visibly synthetic; `not-run` rejects runtime metrics; evidence record names skips | reviewer must preserve evidence class through ledger close                             |
| Customer data or training reuse                    | repository fixtures disallow customer data; training permission denied; runtime network disabled in evidence run                           | provider/storage retention and deletion policy integration                             |

## Logging policy

Allowed telemetry fields are safe event/stage/code, attempt, bounded duration/resource integers, hashes, and one-way hashed project/job identifiers. Forbidden fields include request/manifest payloads, raw media, sanitized frames, checkpoints, splats, source text, filenames, local paths, object keys, signed URLs, headers, credentials, command output, exception text containing untrusted data, or customer identifiers. Safe failures use bounded codes.

## Publication and authority invariant

A completed optional appearance result must link the exact geometry manifest hash and exact source/tool/config/content hashes. Every output artifact is non-dimensional. Publication does not confirm geometry, metric scale, cameras, costs, availability, regulation, structure, or professional review. Only a later authorised workflow may compare proposals; it still cannot treat appearance as dimensional evidence.

## Open risks

- L1/L2/L3 are not merged here, so real tenant/storage/rights/camera/geometry composition remains `NOT RUN`.
- The current host cannot run CUDA/Nerfstudio/gsplat; Windows/NVIDIA performance and failure evidence remains `NOT RUN`.
- No physical iOS camera/RGB-D evidence exists in this lane.
- A model checkpoint is source-derived sensitive data even after path sanitization; encryption, access, deletion, retention, and tenant isolation must match sanitized media.
- The final splat/viewer parser should impose semantic element/property bounds beyond this adapter's header/byte validation.
- Windows package signing, SBOM/provenance attestation, registry retention, and driver/GPU compatibility need independent workstation evidence.

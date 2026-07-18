# C14 Contract — Reproducible Geometry-safe Still Rendering

## Authority, predecessor and outcome

- Active plan: `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`.
- Continuation authority: `docs/orchestration/C11_C15_CONTINUATION.md`; this prelude may be pushed without launching lanes. C14 activation is recorded separately in the ledger, and C15 remains closed.
- Immutable predecessor: pushed C13 ledger close `ad161f4478c83f295f5cebcc5b3a8b622df31dab`.
- Outcome: an owner/editor can select one exact C13-backed C10 scene, canonical camera and canonical lighting set; request a durable render; inspect a reproducible geometry-safe PNG and diagnostic passes; and, only when separately enabled and accepted, compare an illustrative enhancement that cannot replace the safe result.
- Truth boundary: C4/C5 remain canonical geometry. C10 remains the protected derived mesh. C13 remains the exact product/material specification. C14 enriches appearance, camera and light presentation without creating, moving or deleting canonical elements.
- Evidence boundary: a geometry-safe render proves a pinned renderer transformed a pinned model; it does not prove the model is survey-accurate, as-built, structural, compliant, costed, available or professionally approved.
- Current hardware hold: on 2026-07-18 the user explicitly prohibited further Blender use on this Mac because the machine is not the intended render host. Earlier preflight capability/tiny-probe observations are not C14 acceptance evidence. Workers must not invoke Blender. C14 may reach code-ready/integration-ready status, but cannot be marked fully complete until the deferred real-render gate runs on an authorised host.

## Frozen C10 + C13 → C14 flow

1. The API accepts only selected IDs and a named frozen profile. It server-resolves a succeeded C10 job, scene, GLB, manifest, proposed snapshot and, for the selected-design gate, exact C13 specification revision and catalog release. Request-body hashes are never authority.
2. The C13 binding is verified twice: against authoritative C13 persistence and against `asset.extras.c13SpecificationBinding` in the immutable C10 GLB. The strict C10 manifest alone is insufficient because it does not carry the C13 binding.
3. Rights are rechecked before every new render: active reviewed record, service processing, derivatives and rendered-output distribution must all be allowed. A withdrawn or stale asset remains historically inspectable but cannot produce a new render.
4. `packages/render-scene` creates canonical JSON only. It never accepts a `.blend`, Python, driver, expression, arbitrary path, URI or environment variable. It reuses the exact C10 GLB as protected geometry and emits a non-self-referential render-scene manifest plus an external SHA-256 envelope.
5. A fenced worker stages verified inputs in a fresh `0700` workspace and invokes Blender with a fixed argument array, `--background`, `--factory-startup`, `--disable-autoexec`, `--offline-mode` and `--python-exit-code`. Blender receives no database, object-store or provider credential.
6. Immutable artifacts publish first under content-addressed keys. One lease-fenced transaction publishes the visible safe result and external manifest hash. A stale/cancelled attempt can never make artifacts visible.
7. The safe result is terminal independently of enhancement. Optional enhancement is a child job referencing the already-published safe artifact and conditioning hashes. Disabled, failed, rejected or timed-out enhancement never hides, delays, mutates or downgrades the safe result.

## Frozen render products and reproducibility

Every safe result contains exactly one of each required role:

- `geometry-safe-png`: lossless browser image;
- `multilayer-exr`: scene-linear combined render and diagnostic channels;
- `depth-exr`: full-float camera depth;
- `normal-exr`: full-float world/camera normal as documented by the profile; and
- `segmentation-png`: lossless collision-free canonical element palette.

Cryptomatte/object-product passes must also be present inside the validated EXR. The external result envelope stores the canonical output-manifest hash; the manifest cannot include its own hash or an artifact record for its own bytes.

The manifest pins C10/C13 source hashes; canonical camera; sorted material/light/segmentation mappings; renderer script; Blender version/build/executable hash; OCIO hash; engine; device; samples; seed; bounces; threads; denoise; resolution; AgX view transform; `AgX - Medium High Contrast`; every artifact hash, byte length, dimensions and channel contract; and a privacy-minimised host fingerprint.

Exact-byte reproducibility is claimed only for identical source, host fingerprint, Blender build, script, OCIO and profile. Cross-device/build comparisons use explicit perceptual, protected-edge, segmentation and camera tolerances. CPU/Metal/CUDA byte identity is never claimed.

## Camera, material and light policy

- Canonical coordinates remain integer millimetres, `+X east, +Y north, +Z up`; Blender uses metres and `+Z up`. The mapping and tolerance are named and tested at 1 mm boundaries.
- The canonical camera supplies integer position/target and vertical FOV. Look-at construction is deterministic, rejects coincident/non-finite inputs and has one named collinearity fallback. Clip planes are explicit. No lens, depth of field or camera property is inferred from address or image appearance.
- C13 sRGB8, metallic/roughness basis points, emissive values, texture hashes, real-world repeat and rights hashes remain authoritative inputs. Missing/unsupported UV or texture data receives a visible neutral fallback plus a finding; pseudo-product colour is never hash-derived.
- Canonical luminous flux and colour temperature use a pinned photometric conversion. C4 fields cannot fully represent spot cone, area size or light orientation, so unsupported lights omit-and-report. The acceptance fixture uses representable point lights. `daylight-reference` never invents a sun or external environment.
- The world is exactly `neutral-studio-no-address-or-daylight-inference-v1` unless later evidence explicitly defines another version.

## Profiles, capability and disk admission

- `cycles-cpu-geometry-safe-v1` is the portable reference profile.
- `cycles-metal-geometry-safe-v1` is the Mac accelerated profile only when a real capability probe enumerates Metal; there is no silent CPU fallback.
- `eevee-local-preview-v1` is a preview and cannot alone close the photoreal gate.
- CUDA/OptiX high-resolution profiles are defined but remain `NOT RUN` on this Mac.

The worker atomically reserves its declared estimate before claim. Admission requires:

`unreservedFreeBytes >= max(15 GiB + estimatedJobBytes, 3 × estimatedJobBytes)`

It rechecks the invariant between stages, releases reservations on every terminal cleanup path, and preserves read access to existing results when new work is paused. The initial 2026-07-18 preflight reclaimed only generated build/Homebrew caches and retired merged C13 worktrees. On 2026-07-19 the user authorised a conservative second pass over regenerable package/tool caches; it left model caches, Codex runtimes, Playwright browsers, Docker volumes, other-project worktrees and user data untouched. C14 resumed with approximately 85 GiB free.

The current Mac hardware hold overrides profile availability: no C14 worker, test, orchestrator gate or browser journey may launch Blender on this host. Subprocess behaviour is tested through inert fake executables and frozen artifact fixtures only. Those tests prove control-plane behaviour, not renderer correctness.

## Optional enhancement boundary

- External enhancement is disabled until a separate provider/data/rights/spend decision is approved. No key, paid service, customer media or model weight is required for C14 closure.
- The adapter accepts the safe image plus exact depth, normal, segmentation and an explicit allowed-edit mask. It cannot receive private address, notes or schedules.
- A local deterministic test adapter exists only to exercise validation. It is not evidence of provider quality.
- Accepted enhancement requires locked camera, zero changed pixels outside the allowed mask, protected-edge and segmentation thresholds, exact conditioning/model/provider versions and a separately labelled `illustrative-enhancement-png`.
- A PNG-only enhancement cannot support a millimetre depth-error claim; C14 makes no such claim. Rejected output is quarantined and never receives public access.

## Persistence, authorisation and security

Migration `0014_render_stills.sql` is exclusively C14-L2. It owns render jobs/attempts/results/artifacts, enhancement child jobs/results, disk reservations, cache entries, idempotency effects, append-only audit/outbox and immutable content-addressed publication metadata.

Every tenant table uses composite tenant/project foreign keys, bounded JSONB, indexed references, `RESTRICT`, append-only protection, `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Transactions set tenant context locally and retain explicit tenant/project predicates. Claim uses `FOR UPDATE SKIP LOCKED`, capability matching and a private lease token; heartbeat and publication are fenced.

Frozen actions are `render:job:create`, `render:job:read`, `render:job:cancel`, `render:job:retry` and `render:artifact:read`. Owners/editors mutate and read; viewers read only; foreign tenants fail before existence disclosure. Artifact access is short-lived, exact-role/type/size/hash/result-bound and never exposes an object key.

The worker rejects external GLB resources, unsafe extensions, scripts/drivers, symlinks, traversal, non-regular files, unknown executables, oversize/non-finite output, missing EXR channels, palette collisions, mismatched imported object names/bounds and forged C13 extras. Subprocesses use argument arrays, a bounded environment, process-group cancellation, output/time/memory ceilings and no shell. Logs exclude addresses, notes, schedules, rights/licence text, manifests, artifact bytes/paths/object keys, subprocess payload, signed URLs and lease/provider tokens.

## Adaptive isolated lanes

Four lanes are retained. All use exact `gpt-5.6-sol` with `xhigh` reasoning because renderer security, geometry fidelity, durable concurrency, provider boundaries and cross-surface visual evidence are complex.

| Lane                                        | Exclusive editable paths                                                                                                                                                                                                                                                                                                                                               | Required output                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C14-L1 render-scene                         | `packages/render-scene/**`; `docs/runbooks/development/c14-render-scene.md`                                                                                                                                                                                                                                                                                            | deterministic declarative builder, exact C10/C13/GLB binding validation, camera/material/light/palette policy, severe fixtures                            |
| C14-L2 durable Blender product              | `workers/blender-renderer/**`; `services/platform-api/src/modules/render-stills/**`; `services/platform-api/test/c14/render-stills/**`; `services/platform-api/migrations/0014_render_stills.sql`; `services/spatial-worker/src/render-stills/**`; `services/spatial-worker/test/render-stills/**`; `tests/security/render-jobs/**`; C14 renderer runbook/threat paths | Blender driver, safe subprocess, fenced Postgres jobs, disk reservations, S3 publication/access, RLS/idempotency/concurrency/cancellation/redaction tests |
| C14-L3 enhancement boundary                 | `services/inference-worker/src/inference_worker/image_enhancement/**`; `services/inference-worker/test/image_enhancement/**`; `tests/security/image-enhancement/**`; C14 enhancement runbook/threat paths                                                                                                                                                              | disabled provider plus deterministic test adapter, conditioning/mask contracts, hostile-output rejection, privacy/resource tests                          |
| C14-L4 render UX and independent evaluation | `packages/render-evaluation/**`; `apps/web/src/features/render-stills/**`; `apps/web/src/app/render-stills/**`; `apps/web/src/app/api/c14/**`; `apps/web/test/render-stills/**`; `tests/{e2e,evaluation,performance,security}/render-stills/**`; `docs/evaluation/render-stills/**`                                                                                    | accessible create/status/safe-view/pass/download/compare UX, independent hash/image/mask checks, all lifecycle/degraded/browser/mobile/keyboard evidence  |

Merge order is L1 → L2 → L3 → L4. The orchestrator alone owns shared C14 contracts/authz, root manifests and lockfile, migration registry, central API/spatial/web composition/config/log redaction/navigation, C10/C13 seam files, accepted contract, ledger, `.github`, `.codex` and `AGENTS.md`. L4 uses a CSS module and cannot edit global CSS/shared UI/C10/C13 features.

## Exhaustive integration gate

C14 cannot close until all of the following pass:

1. full `UV_CACHE_DIR=.cache/uv pnpm verify`, contract/integration/security/geometry tests, dependency boundaries, API checks and `git diff --check`;
2. fresh C1–C14 Postgres migration, non-owner forced-RLS/IDOR/role matrix, append-only/idempotency/concurrency/stale-lease/cancel/retry/crash/disk-reservation tests;
3. production API/worker/object-store flow from a real succeeded C13-backed C10 scene, with exact source/GLB-extras/rights verification and immutable publication;
4. **deferred hardware gate — not satisfied:** a real headless Blender Cycles render and passes on an authorised render host; the user has prohibited further Blender use on this Mac, and capability metadata, fake executables or pre-instruction tiny probes are not acceptance evidence;
5. post-download verification of every artifact hash, size, magic, dimensions, finite EXR channels, Cryptomatte/segmentation membership, camera and protected bounds;
6. same-host clean replay with exact manifest/source/profile identity and explicitly scoped byte/perceptual result;
7. corrupt/foreign/stale GLB/spec/catalog/rights, traversal/symlink/script/driver, oversized/non-finite/missing-pass, kill/timeout/OOM/low-disk and structured-log leakage cases;
8. hostile local enhancement fixtures proving outside-mask/edge/segmentation rejection while base success remains readable; provider-disabled UI is truthful;
9. Playwright Chromium/Firefox/WebKit desktop/mobile/keyboard, owner/editor/viewer/foreign, deep-link, lifecycle, stale/offline/session-expiry/malformed/tampered/expired access, decode and no-overflow/no-unexpected-console/network journeys;
10. visible in-app Browser production journey through create → status → geometry-safe image → diagnostics → manifest/source disclosure → fresh download; connected Chrome is recorded separately only if actually used; and
11. durable evaluation/ledger evidence, exact worker/merge/product SHAs, clean primary worktree and pushed `main`.

CUDA/OptiX/Windows high-resolution rendering, external enhancement quality, paid services, customer data, physical devices and professional validation remain explicitly `NOT RUN` and do not masquerade as Mac baseline evidence.

Until item 4 is collected, the durable checkpoint state is `implementation-ready / hardware-gate-deferred`, not `complete`. Under the sequential checkpoint rule C15 remains closed unless the real C14 gate is later supplied or the user explicitly changes that rule; this contract does not infer permission to skip it.

Primary official sources checked on 2026-07-18: [Blender headless rendering](https://docs.blender.org/manual/en/5.0/advanced/command_line/render.html), [scripting security](https://docs.blender.org/manual/en/5.0/advanced/scripting/security.html), [Cycles GPU rendering](https://docs.blender.org/manual/en/5.0/render/cycles/gpu_rendering.html), [OpenEXR output](https://docs.blender.org/manual/en/5.0/render/output/properties/output.html), [render passes](https://docs.blender.org/manual/en/5.0/render/layers/passes.html), [colour management](https://docs.blender.org/manual/en/5.0/render/color_management.html) and [production deployment](https://docs.blender.org/manual/en/dev/advanced/deploying_blender.html).

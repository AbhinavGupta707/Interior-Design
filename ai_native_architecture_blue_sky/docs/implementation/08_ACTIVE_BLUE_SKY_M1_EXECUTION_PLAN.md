# Active M1 Blue-Sky Implementation and Worktree Plan

## 1. Status and controlling intent

This is the single active implementation plan. It supersedes the narrower foundation-only execution sequence in `03_M1_CHECKPOINTED_WORKTREE_PLAN.md`.

M1 is now **Complete Home Design System**, not a small plan-to-3D pilot. Its target user moment is:

> I have given the system the details and evidence for my home. It now behaves like my personal interior-design agency: it understands and reconstructs the home, forms a structured brief, proposes and explains alternatives, lets me experience and amend them in 2D/3D/images/video, helps me decide, and produces an actionable implementation handoff.

M1 includes:

- homeowner/project intake and a source-aware home dossier;
- floor-plan, photograph, video and document ingestion;
- a native Swift/SwiftUI iOS capture application using RoomPlan/ARKit where supported;
- resumable multi-room and multi-floor capture with quality guidance;
- autonomous proposal generation from plans, RoomPlan, RGB/RGB-D media and user measurements;
- plan/scan/photo/video registration, fusion, discrepancy surfacing and human correction;
- a canonical editable home model and deterministic browser 3D walkthrough;
- an interior-design brief and agency-style conversational workspace;
- spatial layout, furniture, material, lighting and style variants;
- photoreal geometry-locked still rendering;
- deterministic camera-path video and separately labelled AI-enhanced media;
- synchronised option comparison, decisions and version history; and
- room schedules, product/material schedules, work packages and implementation handoff.

M1 does not need paid-concierge validation, a cloud budget or a staffed architecture practice to begin. Those are commercial/operating questions, not code prerequisites. M1 still must not fabricate hidden geometry, structural truth, regulatory approval, product availability or professional sign-off.

## 2. Product boundary: ambitious without false certainty

“Autonomous full-house reconstruction” means the pipeline automatically attempts to create a complete proposed digital twin from available evidence. It does **not** mean that missing or occluded construction is silently invented. Every element is classified as observed, source-derived, fused, inferred, user-asserted or unknown; uncertainty and residual conflicts remain visible. A homeowner can use inferred geometry for exploration, but only evidence-backed/corrected geometry may be promoted to the current model.

“Professional interior-design agency experience” means the software conducts a high-quality brief, develops coherent design directions, generates variants, explains trade-offs and prepares implementation information. It does not claim that an AI is a registered architect, structural engineer, building-control body or insured human professional.

“Actually implement” in M1 means converting a selected design into actionable information: room-by-room scope, quantities derived from the model, product/material schedule, installation dependencies, decision log, supplier/trade brief and downloadable handoff. Procurement transactions, fixed prices, contractor appointment, site supervision and regulated professional issue remain later operating layers.

## 3. Repository and Codex execution decision

The repository root is `/Users/abhinavgupta/Desktop/Interior Design` because:

- that exact path is already the saved Codex project and sidebar group;
- Codex-managed worktrees clone the selected Git repository and need a committed Git base;
- project-scoped worktree tasks targeted at that saved project ID appear under the correct project; and
- aligning saved-project root, Git root, `AGENTS.md`, `.codex` configuration and monorepo root removes nested discovery ambiguity.

The current dossier remains intact initially at `ai_native_architecture_blue_sky/`. C0 will preserve it as source material and add a migration note for later movement to `docs/research/blue-sky-dossier/`. Moving or deleting it is not required to activate the repository.

Raw `git worktree add`, hidden subagents and projectless tasks are not implementation lanes. Every lane is a real project-scoped Codex worktree task created from the integrated `main` commit.

## 4. Low-cost architecture strategy

The build must work locally without paid providers:

- deterministic fixtures and local adapters are the default development path;
- Postgres/PostGIS, object storage emulation and workflow dependencies run locally in containers where needed;
- plan parsing starts with vector/rule baselines and pluggable local inference;
- Blender headless rendering is the baseline still/video renderer;
- Apple RoomPlan/ARKit supplies supported-device capture rather than a custom SLAM stack;
- COLMAP/Open3D provide reproducible geometric reconstruction baselines;
- Nerfstudio/gsplat are research/appearance adapters, not canonical geometry stores;
- Metal/MPS on Mac handles small compatible inference/render tests;
- CUDA-specific reconstruction and generative media run on the separate Windows/NVIDIA workstation when required; and
- cloud adapters remain disabled placeholders until credentials, terms and spend limits are deliberately approved.

No-key/no-GPU/no-LiDAR states must be useful and honest. They may use fixture, plan/manual or CPU fallback paths, but must never display mock/provider output as a live result.

## 5. Orchestrator control contract

Before every checkpoint the orchestrator commits a contract prelude containing accepted requirements, schemas/generated clients, directory skeletons, migration allocation, test fixtures, dependency changes and disabled feature flags. Workers never edit root manifests, lockfiles, `.github`, `.codex`, accepted ADRs, shared OpenAPI/generated files, migration registries or the orchestration ledger unless a single file is explicitly transferred.

Each lane prompt states its exclusive paths, read-only dependencies, forbidden paths, verification commands and required evidence. A lane-count or boundary change is allowed only before launch, or after affected workers are stopped and a written replan is committed. The next checkpoint starts only after all active lanes are reviewed, merged in dependency order, integrated, tested and documented.

Every isolated implementation task is created explicitly with `gpt-5.6-sol`. The orchestrator assigns `high` reasoning to bounded, well-specified or mechanically straightforward lanes, and `xhigh` reasoning to lanes involving architecture, security, geometry, inference, concurrency, adversarial evaluation or substantial cross-surface integration. The checkpoint contract and ledger predeclare the model/reasoning choice for every lane; lower reasoning levels are not used for implementation workers.

## 6. Adaptive checkpoint allocation

| Checkpoint | Lanes | Verifiable product increment | Why this split is conflict-safe |
|---|---:|---|---|
| C0 | 4 | reproducible Git/monorepo/web/API/iOS/delivery substrate | web, API, native shell and delivery/QA have distinct roots |
| C1 | 3 | secure account, project and home-intake shell | persistence, policy/security and cross-surface onboarding are separable |
| C2 | 4 | rights-aware immutable plan/photo/video/document ingestion | asset API, hostile-media worker, UX and adversarial QA are separate risks |
| C3 | 2 | honest property/home dossier and manual fallback | provider/backend is one producer; dossier UX/comprehension is one consumer |
| C4 | 4 | canonical multi-level home model and validation kernel | domain/provenance, geometry, persistence and fixtures require independent ownership |
| C5 | 4 | typed operations, branches, replay and 2D editor | reducer/store, policy/audit, editor and concurrency QA separate cleanly |
| C6 | 4 | floor-plan proposal, calibration and correction | workflow, inference adapter, correction UX and evaluation are independent |
| C7 | 4 | native iOS single/multi-room guided capture and secure sync | native session, quality/sync, capture backend/converter and mobile QA are distinct |
| C8 | 4 | photo/video/RGB-D reconstruction and evidence preparation | media preprocessing, geometric reconstruction, neural appearance and benchmark lanes differ |
| C9 | 4 | autonomous multi-source fusion and full-house proposal | registration, semantic fitting, discrepancy backend/UX and evaluation are distinct |
| C10 | 3 | deterministic scene compiler and browser walkthrough | compiler, backend/storage and viewer/performance acceptance separate cleanly |
| C11 | 3 | structured brief and agency-style interior-design workspace | brief domain, conversational orchestration and cross-surface UX are separable |
| C12 | 4 | valid spatial/layout/style/material design variants | constraint engine, asset system, AI proposal layer and option UX/evaluation differ |
| C13 | 3 | licensed product/material library and editable room specification | catalog pipeline, specification domain and selection UX are coherent groups |
| C14 | 4 | reproducible photoreal still rendering | scene builder, Blender renderer, enhancement adapter and visual evaluation separate |
| C15 | 4 | deterministic and AI-enhanced walkthrough video | path/animation, frame/encode, enhancement/narration and temporal QA differ |
| C16 | 3 | synchronised compare/decide/collaborate workflow | decision backend, comparison UX and comprehension/e2e QA are distinct |
| C17 | 3 | implementation-ready room/product/work-package handoff | scope compiler, handoff UX/export and quantity/provenance QA separate |
| C18 | 4 | secure, recoverable full-M1 release candidate | security/privacy, recovery/observability, device/browser/GPU UAT and support/release differ |

There are 19 sequential checkpoints and 68 planned worker lanes. This is an orchestration topology, not a claim that 68 people or 68 simultaneous tasks are required. Only one checkpoint is open at a time, with two to four lanes running concurrently.

## 7. Checkpoint specifications

### C0 — Repository and multi-surface delivery substrate — 4 lanes

**Outcome:** a clean clone can install pinned dependencies, run the web/API/local services, build a native iOS simulator shell, run baseline checks and create project-scoped Codex worktrees.

**Decisions frozen by the orchestrator:** Git root at `Interior Design`; `main`; remote `AbhinavGupta707/Interior-Design`; Node/TypeScript/Python/Swift/Xcode support; monorepo boundaries; local ports/env names; no-secret fixture policy; standard verification commands.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C0-L1 platform/API substrate | `services/platform-api/**`, `packages/config/**` | Fastify shell, validated config, health/readiness/error/trace contract, unit tests |
| C0-L2 web/UI substrate | `apps/web/**`, `packages/ui/**` | responsive accessible shell, route/loading/error states, component/browser tests |
| C0-L3 native iOS substrate | `apps/ios-capture/**` | SwiftUI project shell, environment/config abstraction, simulator build/test, unsupported-capture placeholder |
| C0-L4 delivery/infra/QA | `infrastructure/**`, `tests/bootstrap/**`, `docs/runbooks/development/**` | local dependency stack, non-deploying IaC skeleton, contract smoke, clean-bootstrap runbook |

**Gate:** clean bootstrap/build/test succeeds; simulator shell opens; web shell is browser-verified; no absolute paths/secrets; project-scoped worktree creation is proven.

### C1 — Identity, project and home intake — 3 lanes

**Outcome:** a user can create a secure project, describe the home/household/design intent and continue across web/iOS without cross-project leakage.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C1-L1 identity/project/intake backend | `services/platform-api/src/modules/{identity,projects,intake}/**`, allocated migration | idempotent persistence/API and audit context |
| C1-L2 authorisation/security | `packages/authz/**`, `tests/security/identity/**`, `docs/threat-models/identity.md` | deny-by-default tenant/action matrix and IDOR/session tests |
| C1-L3 web/iOS onboarding | `apps/web/src/features/{auth,onboarding,projects}/**`, `apps/ios-capture/Features/Projects/**`, `tests/e2e/onboarding/**` | accessible cross-surface onboarding, expiry/offline/error journeys |

**Gate:** two-tenant fixtures prove isolation; repeated creates have one effect; intake is editable structured data rather than only chat prose.

### C2 — Immutable multimodal evidence ingestion — 4 lanes

**Outcome:** authorised users can upload plans, photos, videos and documents with rights assertions; originals remain immutable and hostile/unsupported media fails safely.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C2-L1 asset/storage backend | `services/platform-api/src/modules/assets/**`, object-store adapter, allocated migration | multipart/resumable upload, hashes, rights/status/provenance, signed access |
| C2-L2 secure media worker | `services/spatial-worker/src/ingest/**` | MIME/signature/codec/dimension/duration limits, quarantine, safe preview/metadata manifests |
| C2-L3 evidence UX | `apps/web/src/features/evidence/**`, `apps/ios-capture/Features/Evidence/**` | progress/resume/failure/rights/status/inventory flows |
| C2-L4 adversarial QA | `tests/{security,integration,e2e}/evidence/**`, upload threat model | bombs, malformed codecs, metadata/privacy, URL expiry, duplicate and tenant attacks |

**Gate:** source/derived separation, default-deny training consent, safe media processing and cross-tenant protections are proven.

### C3 — Property and home dossier — 2 lanes

**Outcome:** the system presents provided home information, optional permitted property context and explicit unknowns without pretending that an address establishes the interior.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C3-L1 dossier backend/adapters | `services/platform-api/src/modules/property/**`, `packages/provider-adapters/src/property/**`, fixtures, allocated migration | fixture/manual-first search, observations, assertions, ambiguity/outage handling |
| C3-L2 dossier UX/comprehension | `apps/web/src/features/property/**`, `tests/{contract,e2e}/property/**`, status-language evaluation | clear fact/estimate/assertion/inference/unknown presentation and manual fallback |

**Gate:** local development needs no paid provider; missing fields remain unknown; every external observation retains source/licence/version metadata.

### C4 — Canonical multi-level home model — 4 lanes

**Outcome:** a deterministic canonical model represents levels, rooms, surfaces, openings, stairs, fixed objects, finishes, furnishings, lighting, cameras and evidence/provenance with explicit units and coordinates.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C4-L1 domain/provenance | `packages/domain-model/**`, `packages/provenance/**` | schemas, attributed values, state separation, canonical serialisation inputs |
| C4-L2 geometry/topology kernel | `packages/geometry-kernel/**` | integer/tolerance primitives, multi-level topology, stairs/openings/room findings |
| C4-L3 persistence/API | `services/platform-api/src/modules/models/core/**`, allocated migration | snapshots, hashes, object references, authz and model profile APIs |
| C4-L4 fixtures/evaluation | `packages/test-fixtures/src/models/**`, `tests/geometry/canonical/**` | valid/adversarial homes, property tests, stable hash/round-trip cases |

**Gate:** stable hashes/replay, explicit unknowns, located findings and existing/proposed/as-built separation pass across processes.

### C5 — Typed operations, versions and 2D editor — 4 lanes

**Outcome:** every amendment is a previewable, validated, attributable operation; users can branch, compare, undo before commit, replay and restore without rewriting history.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C5-L1 operation store/reducers | `packages/model-operations/**`, model-operation API, allocated migration | registry, reducers/upcasters, transaction/idempotency/snapshot logic |
| C5-L2 policy/audit | `packages/authz/src/model/**`, `services/platform-api/src/modules/audit/**` | person/machine action policies and immutable audit projection |
| C5-L3 editor | `packages/editor-core/**`, `apps/web/src/features/editor-2d/**` | SVG plan, inspector, snap/select, accessible typed-command editing |
| C5-L4 replay/concurrency QA | `tests/{integration,geometry,e2e}/model-operations/**` | stale/reordered/repeated/concurrent requests and branch isolation |

**Gate:** no direct state mutation path; stale revisions recover cleanly; replay yields the pinned snapshot hash.

### C6 — Floor-plan understanding and correction — 4 lanes

**Outcome:** a rights-cleared plan produces a typed, calibrated proposal or abstention; the user can overlay, correct and commit it while correction effort and residual uncertainty are measured.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C6-L1 processing workflow | `services/platform-api/src/modules/plan-processing/**`, `services/spatial-worker/src/plan-processing/**` | idempotent vector-first jobs, calibration, proposal storage, retry/cancel/abstain |
| C6-L2 inference adapter | `services/inference-worker/src/plan/**`, plan-parser adapter | deterministic mock plus local raster/model adapter and typed confidence output |
| C6-L3 correction UX | `apps/web/src/features/plan-import/**`, plan overlay editor paths | calibration/overlay/correction/review/abstention workflow |
| C6-L4 benchmark/security | `tests/evaluation/plan-parsing/**`, `tests/security/plan-processing/**` | rights manifest, holdout metrics, severe errors, resource/content attacks |

**Gate:** no GPU is required for the deterministic baseline; failures remain in denominators; accepted corrections become typed operations.

### C7 — Native iOS RoomPlan/ARKit capture — 4 lanes

**Outcome:** a supported physical iPhone/iPad can securely conduct resumable single-room and multi-room/structure capture, retain source evidence and upload a versioned capture package; unsupported devices get a plan/photo/manual route.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C7-L1 RoomPlan/AR session | `apps/ios-capture/Features/RoomCapture/**`, `apps/ios-capture/Platform/AR/**` | capability detection, custom/continuous AR session, room/structure capture, interruption/relocalisation |
| C7-L2 capture quality/sync | `apps/ios-capture/Features/{CaptureQuality,Sync}/**` | live guidance, coverage/quality state, reference measurements, resume/offline/background upload |
| C7-L3 backend/conversion | `services/platform-api/src/modules/capture/**`, `services/spatial-worker/src/roomplan/**`, allocated migration | capture brief/package, USD/USDZ/encoded-data preservation, canonical proposal conversion |
| C7-L4 mobile/field QA | `tests/mobile/**`, `docs/evaluation/roomplan/**`, `docs/runbooks/ios/**` | simulator navigation tests plus named physical-device clutter/glass/light/thermal/tracking cases |

**Gate:** Xcode Simulator validates application states but cannot close the capture gate; at least one supported physical LiDAR device must complete room and structure journeys.

### C8 — Photo/video/RGB-D reconstruction — 4 lanes

**Outcome:** guided media can produce privacy-reviewed frames, calibrated cameras, sparse/dense geometry and an optional appearance layer, with explicit failure diagnostics.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C8-L1 media preparation | `services/spatial-worker/src/media-prep/**` | frame sampling, blur/exposure/overlap checks, EXIF stripping, redaction hooks, manifests |
| C8-L2 geometric reconstruction | `services/inference-worker/src/reconstruction/{colmap,open3d}/**` | camera/SfM/MVS/RGB-D adapters, scale anchors, point/mesh outputs and diagnostics |
| C8-L3 neural appearance | `services/inference-worker/src/reconstruction/{nerfstudio,gsplat}/**` | versioned optional NeRF/splat adapter, viewer/export artifacts, no canonical authority |
| C8-L4 GPU/evaluation | `ml/reconstruction/**`, `tests/evaluation/reconstruction/**`, `docs/ml/reconstruction/**` | reproducible Mac/Windows manifests, failure/severe-error/latency/memory benchmarks |

**Gate:** geometric and appearance artifacts are separate; partial/failed registration is visible; raw customer media/weights never enter Git.

### C9 — Autonomous multi-source full-house fusion — 4 lanes

**Outcome:** plan, RoomPlan, reconstruction, measurements and assertions are registered into one coordinate system and produce a full-house canonical proposal with confidence, residuals and explicit discrepancies.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C9-L1 registration/fusion kernel | `packages/geometry-kernel/src/{registration,fusion}/**` | robust transforms, constraints, scale/level alignment and conflict representation |
| C9-L2 semantic fitting | `services/inference-worker/src/scan-to-model/**` | plane/opening/room/stair/object proposals projected into valid parametric geometry |
| C9-L3 discrepancy backend/UX | `services/platform-api/src/modules/discrepancies/**`, `apps/web/src/features/discrepancy-review/**` | evidence comparison, residual views, accept/correct/unknown workflow |
| C9-L4 fusion evaluation | `tests/evaluation/model-fusion/**`, `packages/test-fixtures/src/fusion/**` | single-source baselines, multi-floor drift, severe errors, calibration and correction-time tests |

**Gate:** no averaging hides disagreement; inferred/occluded geometry is labelled; fusion must beat the best single source or remain optional.

### C10 — Deterministic scene and interactive walkthrough — 3 lanes

**Outcome:** an exact committed version compiles to validated GLB/scene manifests and supports responsive browser orbit/walk/section/selection/material viewing.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C10-L1 scene compiler | `packages/scene-compiler/**`, `services/spatial-worker/src/scene-compile/**` | deterministic meshes/material slots/element map/GLB/manifests and golden tests |
| C10-L2 scene backend/storage | `services/platform-api/src/modules/scenes/**`, scene-storage adapter | versioned request/status/cache/access/audit |
| C10-L3 viewer/acceptance | `apps/web/src/features/viewer-3d/**`, `tests/{e2e,performance}/viewer/**` | lazy Three/R3F walkthrough, capability fallback, Chrome/Firefox/WebKit/device budgets |

**Gate:** 2D/3D share stable IDs; GLB validates; degraded 2D remains usable; named scene size/load/FPS budgets pass.

### C11 — Interior-design brief and agency workspace — 3 lanes

**Outcome:** the system conducts a thoughtful, inspectable design consultation and converts it into structured household needs, constraints, retained items, style references and decision criteria.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C11-L1 brief/consultation domain | `packages/design-brief/**`, `services/platform-api/src/modules/briefs/**`, allocated migration | structured brief, priorities, conflicts, revisions and provenance |
| C11-L2 conversational orchestrator | `services/platform-api/src/modules/design-agent/**`, prompt/tool registries | model gateway, bounded retrieval/tools, clarification and structured extraction |
| C11-L3 consultation UX/evaluation | `apps/web/src/features/design-consultation/**`, `tests/evaluation/brief-assistant/**` | conversational/form/reference-board UX, inspect/correct flow and completeness tests |

**Gate:** the brief is editable data; the agent distinguishes preference from constraint/evidence; unsupported professional questions route to review.

### C12 — Design options and variant engine — 4 lanes

**Outcome:** the system generates genuinely different, valid and explainable spatial and aesthetic options, not merely random images.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C12-L1 constraint/layout engine | `packages/design-engine/**` | template/search/constraint objectives, hard validation and Pareto outputs |
| C12-L2 furnishing/material placement | `packages/interior-assets/**`, `services/spatial-worker/src/asset-placement/**` | clearance-aware furniture, lighting, finish and material configurations |
| C12-L3 AI proposal runtime | `packages/model-operations/src/ai-tools/**`, `services/platform-api/src/modules/ai-proposals/**` | typed proposal/preview/expiry/confirmation with no direct mutation |
| C12-L4 option UX/evaluation | `apps/web/src/features/design-options/**`, `tests/evaluation/design-options/**` | option narratives, assumptions, separate trade-offs, diversity/constraint/edit-distance tests |

**Gate:** every option is a valid branch; hard constraints pass; differences are structural/material and inspectable, not only prose or pixels.

### C13 — Product, material and room specification — 3 lanes

**Outcome:** designs use a versioned local starter library of licensed/generic assets and produce editable room specifications without claiming live price/availability.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C13-L1 catalog/asset pipeline | `packages/catalog/**`, `services/spatial-worker/src/catalog/**` | generic/licensed product schemas, dimensions, materials, models, thumbnails and rights metadata |
| C13-L2 specification domain | `packages/specification/**`, `services/platform-api/src/modules/specifications/**`, allocated migration | room/element/product/finish schedules, substitutions and version linkage |
| C13-L3 selection UX/QA | `apps/web/src/features/materials-products/**`, `tests/e2e/specification/**` | boards, filters, in-scene replacement, missing-asset/rights states and schedule tests |

**Gate:** fixtures are clearly generic; unavailable live data is not fabricated; each placed asset has scale, licence and source metadata.

### C14 — Photoreal still rendering — 4 lanes

**Outcome:** selected model/material/camera/lighting versions produce reproducible geometry-safe stills plus separately labelled optional enhancements.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C14-L1 render-scene builder | `packages/render-scene/**` | canonical-to-Blender scene/material/camera/light manifest and deterministic fixtures |
| C14-L2 Blender renderer | `workers/blender-renderer/**` | headless Eevee/Cycles jobs, Metal/CPU/CUDA device profiles, denoise and output manifests |
| C14-L3 enhancement adapter | `services/inference-worker/src/image-enhancement/**` | depth/normal/segmentation-conditioned optional enhancement/inpainting with provenance |
| C14-L4 visual evaluation | `tests/evaluation/render-stills/**`, `tests/performance/rendering/**` | geometry-mask/camera/product consistency, perceptual regressions, time/memory tests |

**Gate:** a geometry-safe render always accompanies enhanced media; enhancements cannot move protected geometry unnoticed; jobs reproduce from a manifest.

### C15 — Walkthrough and design video — 4 lanes

**Outcome:** users can generate collision-checked deterministic camera-path videos and separately labelled AI-enhanced cinematic versions with captions/narration.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C15-L1 path/animation | `packages/camera-path/**`, `apps/web/src/features/video-path/**` | path editor/templates, collision/comfort checks, keyframes and preview |
| C15-L2 frames/encode | `workers/blender-renderer/src/video/**`, `services/spatial-worker/src/video-encode/**` | deterministic frames, FFmpeg encode, resume/checkpoint and render manifest |
| C15-L3 enhancement/narration | `services/inference-worker/src/video-enhancement/**`, `services/platform-api/src/modules/narration/**` | optional temporal enhancement, voice/captions/music rights and provenance |
| C15-L4 temporal/e2e QA | `tests/evaluation/video/**`, `tests/e2e/video/**` | geometry/camera/product/temporal consistency, accessibility, interruption and status comprehension |

**Gate:** deterministic video is the spatial reference; AI-enhanced video is visibly illustrative; frame/model/source/provider versions are retained.

### C16 — Compare, decide and collaborate — 3 lanes

**Outcome:** users compare variants from identical views, understand trade-offs, capture feedback and freeze a selected decision version without losing alternatives.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C16-L1 decision/collaboration backend | `services/platform-api/src/modules/{decisions,comments}/**`, allocated migration | decision criteria, comments, approvals, participants and immutable freeze events |
| C16-L2 synchronised comparison UX | `apps/web/src/features/{compare,decisions}/**` | same-camera 2D/3D/still/video comparison, geometry/material diffs and rationale |
| C16-L3 comprehension/e2e QA | `tests/{e2e,evaluation}/decision-workspace/**` | keyboard/reader/responsive tests and uncertainty/trade-off comprehension protocol |

**Gate:** a selected design points to exact evidence/model/spec/render versions; visual preference cannot silently override unresolved constraints.

### C17 — Implementation handoff — 3 lanes

**Outcome:** a selected design produces an actionable, versioned room-by-room implementation package without pretending to be a fixed quote or regulated construction issue.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C17-L1 scope/quantity compiler | `packages/implementation-compiler/**`, `services/spatial-worker/src/implementation/**` | room scopes, model-derived indicative quantities, dependencies, assumptions and unresolved items |
| C17-L2 handoff/export UX | `apps/web/src/features/implementation/**`, `services/platform-api/src/modules/exports/**` | schedules, shopping/trade briefs, CSV/PDF/JSON/GLB packages and status language |
| C17-L3 provenance/quantity QA | `tests/{contract,security,e2e,evaluation}/implementation/**` | source/version linkage, unit/rounding, access/expiry, unknown/assumption and reproduction tests |

**Gate:** every quantity links to model elements and status; no fixed price/availability/structural instruction is fabricated; package is reproducible.

### C18 — Full M1 hardening and controlled release — 4 lanes

**Outcome:** the complete home-details-to-design-to-media-to-handoff journey is secure, recoverable, observable and verified on supported browsers, simulator, physical iOS hardware and required GPU profiles.

| Lane | Exclusive paths | Output and evidence |
|---|---|---|
| C18-L1 security/privacy | `tests/security/release/**`, `docs/threat-models/release.md`, privacy/incident runbooks | tenant/media/AI/tool/upload/export closeout, DPIA inputs and remediation evidence |
| C18-L2 observability/recovery | `packages/telemetry/src/release/**`, `infrastructure/modules/{observability,recovery}/**` | SLOs, alerts, backup/restore, workflow/GPU/provider failure and rollback drills |
| C18-L3 cross-surface UAT/performance | `tests/{e2e,performance,mobile}/release/**`, `docs/evaluation/m1-uat/**` | Chrome/Firefox/WebKit, responsive/a11y, simulator, physical capture, Mac/Windows GPU results |
| C18-L4 support/release | `docs/runbooks/support/**`, `docs/product/m1/**`, `docs/release/**` | onboarding, limitations, correction/escalation, hardware setup, release manifest and dry run |

**Gate:** no unresolved critical/high blocker; every journey uses real or clearly labelled fixture capability; recovery and physical-device capture are demonstrated; residual limitations have owners.

## 8. Hardware and verification matrix

| Surface | Mac | Xcode Simulator | Physical iPhone/iPad | Windows/NVIDIA | Browser/computer use |
|---|---|---|---|---|---|
| web/API/domain | primary implementation and tests | n/a | responsive smoke | optional | Chrome/in-app browser journeys, screenshots, accessibility and interaction traces |
| iOS app state/sync | Xcode build/test | navigation, forms, offline/error and visual states | signing, camera, LiDAR, RoomPlan, tracking, thermal and field capture | n/a | simulator controlled through Xcode/computer use where exposed |
| plan/model/geometry | CPU/MPS baselines | n/a | capture input | CUDA benchmark when beneficial | 2D/3D comparison and editor journeys |
| reconstruction | preprocessing/small Open3D/COLMAP runs | n/a | source capture | primary dense/neural/CUDA evaluation | artifact and viewer verification |
| still rendering | Eevee/Cycles CPU/Metal baseline | n/a | media review | Cycles OptiX/high-resolution and enhancement | image comparison and user flows |
| video | path authoring/low-resolution render/FFmpeg | n/a | playback/review | high-resolution frames/neural enhancement | playback, captions, seek, comparison and status comprehension |

No checkpoint may claim RoomPlan completion from Simulator results. No CUDA model may be promoted from a Mac-only mock. No browser feature may be accepted from unit tests without rendered interaction checks.

## 9. Remaining decisions and defaults

These decisions do not block C0 unless stated:

1. **Working product name:** use `Interior Design`/`Home Design Studio` internally until branding is chosen.
2. **Initial geography:** use synthetic UK residential fixtures and UK units/language; choose a real geography only when live property/regulatory adapters are introduced.
3. **Initial property box:** one-to-three-level flats/houses with conventional enclosed rooms; preserve schema support for wider types.
4. **Identity:** local fixture provider first behind OIDC port; choose a paid provider later.
5. **Cloud:** none required for local M1 development; infrastructure remains modular and disabled.
6. **Physical hardware:** C7/C18 require at least one supported LiDAR iPhone/iPad; record device/OS when available.
7. **Windows GPU:** C8/C14/C15 define reproducible packages now; CUDA evidence is collected when the workstation is used.
8. **AI providers:** local/deterministic adapters first; external image/video/model providers require an explicit data/rights/spend decision.
9. **Professional language:** interior-design assistance is allowed; architect/engineer/regulatory approval and construction guarantees remain gated.

## 10. Primary technical risks

- full-house reconstruction may fragment or drift across floors and feature-poor rooms;
- RoomPlan output is parametric evidence, not hidden-construction or structural truth;
- RGB video reconstruction fails on white walls, reflections, exposure changes and insufficient parallax;
- appearance fields/splats can look convincing while being dimensionally unsuitable;
- generative images/video can change geometry, products and temporal consistency;
- generic assets may not match real products or availability;
- local/GPU hardware differences can make pipelines non-reproducible;
- the broadened M1 is substantially larger than the original foundation plan; and
- delaying real-user validation does not block engineering but leaves demand, comprehension and correction-economics risk unmeasured.

Each risk is addressed through separate evidence/canonical/appearance layers, typed operations, explicit uncertainty, deterministic baselines, versioned manifests, severe-error metrics and hardware-specific release gates.

---
title: AI, 3D Reconstruction, Rendering, and Video
document_type: technical_research
status: research_and_proposal
as_of: 2026-07-16
---

# 07 — AI, 3D Reconstruction, Rendering, and Video

## 1. Technical objective

The technical system must convert heterogeneous evidence into a structured home model, then let users and professionals generate and evaluate design changes while preserving geometric, regulatory, and commercial integrity.

The AI/3D stack contains distinct problems:

1. floor-plan understanding;
2. spatial capture and scan fusion;
3. semantic reconstruction;
4. parametric model fitting;
5. design-option generation;
6. natural-language tool orchestration;
7. analysis and rules;
8. real-time visualisation;
9. photoreal rendering;
10. AI image/video enhancement.

These should not be collapsed into one “multimodal model” call.

## 2. Floor-plan ingestion

### 2.1 Inputs

- clean vector PDF;
- scanned raster drawing;
- estate-agent floor plan;
- hand sketch;
- architect planning drawing;
- CAD export;
- annotated survey;
- multi-page drawing sheet.

### 2.2 Processing pipeline

```mermaid
flowchart LR
    A[Upload] --> B[File safety and rights check]
    B --> C[Page / viewport detection]
    C --> D[Vector extraction or raster normalisation]
    D --> E[Symbol, text, dimension and line detection]
    E --> F[Wall / opening / stair / room graph]
    F --> G[Scale calibration]
    G --> H[Topology and geometry repair]
    H --> I[Confidence map]
    I --> J[Human correction]
    J --> K[Canonical model]
```

### 2.3 Open datasets and code

- [CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k) contains 5,000 annotated floor-plan samples with more than 80 categories. It is useful for baseline detection and evaluation.
- [RoomFormer](https://github.com/ywyue/RoomFormer) addresses room-layout reconstruction from floor-plan images.
- [PolyRoom](https://github.com/3dv-casia/PolyRoom/) explores polygonal room reconstruction.
- DeepFloorplan and related research provide earlier room/wall/opening segmentation baselines.

### 2.4 Production limitations

Public datasets do not fully represent UK production inputs:

- Victorian and Edwardian terraces;
- loft plans with sloped ceilings;
- old imperial dimensions;
- planning drawings showing existing and proposed states together;
- hand annotations;
- scans with skew or compression;
- estate-agent disclaimers and approximate dimensions;
- complex split levels;
- multiple scales on one sheet;
- thick-wall historic construction.

The platform needs a rights-cleared UK benchmark and active-learning loop.

### 2.5 Human correction

A good correction UI may create more value than a marginally better model. It should allow:

- drag/align wall paths;
- confirm wall type and state;
- pair doors/windows to walls;
- set scale from a known dimension;
- resolve room closure;
- mark uncertain areas;
- distinguish existing, demolished, and proposed linework;
- compare source overlay with generated geometry.

## 3. Phone spatial capture

### 3.1 Apple RoomPlan

Apple’s [RoomPlan framework](https://developer.apple.com/documentation/roomplan) uses camera and LiDAR data to create parametric room captures. Apple supports [multi-room structure scanning](https://developer.apple.com/documentation/roomplan/scanning-the-rooms-of-a-single-structure) and documents the underlying approach in [RoomPlan research](https://machinelearning.apple.com/research/roomplan).

#### Advantages

- established iOS APIs;
- consumer device availability;
- wall/opening/object semantics;
- USD/USDZ output;
- real-time guidance;
- lower engineering cost than building SLAM from zero.

#### Limitations

- device restriction;
- clutter and occlusion;
- mirrors and glazing;
- stairs and vertical circulation;
- multi-floor alignment;
- hidden geometry;
- accumulated drift;
- user capture quality;
- no structural truth.

### 3.2 Android and ARCore

[ARCore Depth](https://developers.google.com/ar/develop/depth) can support depth-aware capture on compatible devices. Device heterogeneity requires capability detection and conservative quality thresholds.

### 3.3 Guided-capture product layer

The company should build:

- route planning;
- live coverage map;
- instructions to open doors and expose corners;
- warnings for rapid motion or low light;
- device calibration checks;
- reference-measurement prompts;
- room connection markers;
- floor-transition capture;
- quality score before upload;
- automatic privacy redaction options;
- resumable capture.

### 3.4 Verification tiers

Proposed tiers:

| Tier | Evidence | Suitable use |
|---|---|---|
| T0 | Address/public data only | visual pre-feasibility |
| T1 | User plan or basic scan | early concept exploration |
| T2 | Guided scan + reference measurements + correction | developed concept and preliminary planning with review |
| T3 | Professional measured survey | planning/technical basis as declared by surveyor |
| T4 | Specialist survey/investigation | structure, fabrication, setting out, or complex conditions |

The tier is part of the model and output status.

## 4. Photogrammetry and scene reconstruction

[COLMAP](https://colmap.org/) is a widely used open-source structure-from-motion and multi-view stereo system. It can reconstruct camera poses and geometry from photographs.

Potential uses:

- exterior context;
- texture capture;
- difficult object/room reference;
- remote professional inspection;
- visual comparison;
- supplementing LiDAR.

Limitations:

- textureless walls;
- reflective surfaces;
- lighting change;
- moving objects;
- scale ambiguity without references;
- occlusion;
- computational cost;
- semantic conversion.

Photogrammetry output should be evidence aligned to the parametric model, not automatically treated as the editable model itself.

## 5. NeRFs and Gaussian splats

[Nerfstudio](https://github.com/nerfstudio-project/nerfstudio) and [gsplat](https://github.com/nerfstudio-project/gsplat) support modern neural/radiance-field and Gaussian-splatting workflows.

### Appropriate uses

- high-realism captured walkthroughs;
- visual context around a parametric model;
- before-state documentation;
- remote review;
- marketing and comparison.

### Inappropriate uses as sole representation

- moving a wall parametrically;
- generating dimensions;
- classifying load-bearing structure;
- producing a reliable bill of quantities;
- creating planning drawings;
- product replacement without scene reconstruction;
- construction issue.

### Hybrid strategy

Register the visual capture to the canonical coordinate system. Use it as a toggleable visual layer. Proposed geometry can replace or mask portions of the capture while authoritative dimensions remain in the parametric model.

## 6. Semantic reconstruction and Scan-to-BIM

The goal is to convert sensor evidence into objects such as walls, slabs, doors, windows, stairs, fixtures, and spaces.

A recent review of indoor scan-to-BIM research describes challenges across registration, semantic segmentation, object reconstruction, and end-to-end evaluation. See the 2025 [Scan-to-BIM review](https://www.sciencedirect.com/science/article/abs/pii/S092658052500771X).

### Main technical difficulties

- noisy or incomplete point clouds;
- irregular historic geometry;
- occluded corners;
- distinguishing furniture from building fabric;
- fitting orthogonal assumptions to non-orthogonal buildings;
- topological consistency;
- recognising openings and wall thickness;
- multi-level alignment;
- converting dense geometry to editable parametric objects;
- calibrated uncertainty.

### Proposed approach

1. preserve raw evidence;
2. detect planes, boundaries, openings, and room graph;
3. propose parametric objects;
4. optimise against observations and topology;
5. highlight residual error;
6. obtain user/surveyor correction;
7. store both fitted model and residual evidence;
8. evaluate against purpose-specific tolerances.

## 7. Existing-house archetype inference

UK houses contain recurring patterns. An archetype model may infer plausible:

- stair location;
- party-wall relations;
- reception-room structure;
- rear outrigger;
- roof type;
- common extension patterns;
- likely load paths.

But inference must remain explicit. Archetypes are priors, not evidence.

A useful system can ask targeted questions based on the prior:

- “This footprint resembles a Victorian terrace with a rear outrigger. Is the stair along the party wall?”
- “The external height suggests two storeys, but the EPC says three. Please confirm a loft conversion.”

It must not silently fill a hidden interior and present it as fact.

## 8. Generative spatial design

### 8.1 Design generator inputs

- verified existing model;
- project type;
- brief and priority weights;
- required spaces and adjacencies;
- planning envelope;
- structural assumptions;
- access and circulation constraints;
- products/modules;
- budget band;
- energy and daylight objectives;
- retained elements;
- construction/disruption preferences.

### 8.2 Generation methods

#### Parametric templates

Best for repeatable project categories. Templates should contain degrees of freedom, rules, and applicability conditions.

#### Constraint solving

Use mixed-integer, graph, search, or optimisation methods for:

- room placement;
- adjacency;
- dimensions;
- opening placement;
- circulation;
- product fit;
- planning envelope;
- cost limits.

#### Learned proposal models

Models can propose likely arrangements from house archetype and brief. Their outputs must be projected into valid parametric geometry and checked.

#### Human-in-the-loop evolutionary design

The user and architect select, combine, and refine options. Preference learning can reduce the search space without claiming an objective “best” design.

### 8.3 Multi-objective comparison

Do not hide trade-offs in one score. Show separate metrics and Pareto-style alternatives:

- usable area;
- brief satisfaction;
- garden impact;
- daylight;
- privacy;
- structural intervention;
- planning risk;
- construction cost;
- programme/disruption;
- operational energy;
- embodied carbon;
- flexibility.

## 9. LLM role

The language model should handle:

- brief conversation;
- intent interpretation;
- explanation;
- policy and evidence retrieval;
- tool selection;
- option narration;
- issue summarisation;
- document drafting;
- structured extraction from communications.

It should not independently own:

- geometry validity;
- dimensional calculation;
- structural design;
- code compliance;
- professional issue status;
- payment release;
- safety-critical site conclusions.

### Typed tool example

User: “Move the kitchen wall 400 mm toward the hall, but keep the door clearance.”

Agent sequence:

1. resolve `kitchen wall` to object candidates;
2. ask for disambiguation if needed;
3. invoke `MoveWallPath` with a constrained vector;
4. run topology, room, door, and dimension checks;
5. calculate affected areas and products;
6. show preview and consequences;
7. commit only after authorised confirmation;
8. route structural review if wall risk classification requires it.

### Spatial reasoning limitation

The [FloorplanQA benchmark](https://arxiv.org/html/2507.07644v4) found consistent spatial-reasoning failure patterns across tested language models. This supports the architectural decision to use geometry engines and explicit graphs rather than expecting an LLM to reason reliably from prose or images alone.

## 10. Rules and compliance AI

Use a hybrid system:

- deterministic geometric checks;
- versioned rule definitions;
- retrieval of current regulations/policies;
- structured evidence requirements;
- LLM explanation and mapping assistance;
- professional review.

Each rule result should report:

- rule ID/version;
- jurisdiction;
- source;
- applicability conditions;
- model objects evaluated;
- calculation;
- result;
- uncertainty/missing evidence;
- human-review status.

A retrieved paragraph is not a compliance result. A compliance result is not statutory approval.

## 11. Real-time visualisation

### Web stack

[Three.js](https://threejs.org/) or React Three Fiber can support:

- glTF model rendering;
- first-person navigation;
- orbit/section views;
- material and lighting changes;
- annotations;
- model comparison;
- collaboration cursors;
- measurement tools;
- issue markers.

### Performance tactics

- level-of-detail;
- instancing;
- texture compression;
- geometry simplification;
- scene partitioning;
- progressive loading;
- baked and dynamic lighting modes;
- asset budgets;
- mobile capability detection.

### High-end real-time rendering

[Unreal Engine for architecture](https://www.unrealengine.com/uses/architecture) can support premium real-time and path-traced visualisation. [Pixel Streaming](https://www.unrealengine.com/blog/pixel-streaming-delivering-high-quality-ue4-content-to-any-device-anywhere) can deliver high-end scenes to lower-powered clients, but creates GPU infrastructure, latency, and cost requirements.

Use Unreal where premium quality or sales/VR experience justifies it. Do not make the core homeowner editor dependent on a high-cost streaming session.

## 12. Photoreal still rendering

A deterministic renderer should receive:

- exact model version;
- material/product configuration;
- camera and lens;
- lighting/environment;
- render settings;
- visible uncertainty policy;
- asset licence references.

Render output should retain a manifest so it can be regenerated.

AI denoising or material enhancement may be used if it does not introduce geometry changes that are concealed from the user.

## 13. AI image generation

Use cases:

- style ideation before geometry is fixed;
- texture/material mood boards;
- alternative furnishing concepts;
- rapid presentation drafts;
- local inpainting of decorative elements under controlled masks.

Risks:

- windows/doors move;
- room proportions change;
- products become fictitious;
- buildability disappears;
- lighting becomes physically implausible;
- users mistake it for the selected model.

Mitigation:

- condition on depth, normals, segmentation, and rendered base frame;
- lock camera and geometry;
- compare generated output to geometry masks;
- label as illustrative;
- maintain a “geometry-safe render” alongside it.

## 14. Walkthrough video

### Authoritative pipeline

1. select model version;
2. define camera path and speed;
3. validate collision and accessibility;
4. render frame sequence deterministically;
5. encode video;
6. attach model/render manifest;
7. optionally create narration and captions.

### AI-enhanced pipeline

AI may add:

- people;
- natural motion;
- atmosphere;
- subtle material realism;
- scene transitions;
- voice and music.

Current video models, including systems such as [Google Veo](https://deepmind.google/models/veo/) and [Runway](https://runwayml.com/research/introducing-runway-gen-4.5), can create impressive visual sequences. Research continues to identify problems with geometric and temporal consistency, especially under camera movement. See, for example, recent work on [3D/geometric consistency in video generation](https://arxiv.org/html/2605.18365v1).

Therefore:

- deterministic walkthrough = design communication;
- AI-enhanced walkthrough = illustrative communication;
- unconstrained generated video = mood/marketing;
- none = contractual measurement source.

## 15. Evaluation framework

### Floor-plan parsing

- wall precision/recall;
- opening detection F1;
- room polygon intersection-over-union;
- room-label accuracy;
- scale error;
- topology/adjacency accuracy;
- correction time;
- catastrophic error rate.

### Scan reconstruction

- critical dimension mean absolute error;
- percentile error, not only mean;
- corner-position error;
- plane angular error;
- closure error;
- room-to-room alignment error;
- multi-floor drift;
- unobserved-area recall;
- confidence calibration;
- professional correction time.

### Design generation

- hard-constraint satisfaction;
- brief satisfaction by independent reviewers;
- diversity without superficial variation;
- human acceptance/edit distance;
- cost/planning/structure check pass rate;
- option-generation time;
- professional review time saved.

### Visual output

- geometry consistency against source masks/depth;
- product identity consistency;
- camera consistency;
- temporal stability;
- user understanding of illustrative status;
- render latency and cost.

## 16. Training and data strategy

### Initial data

- public/open floor-plan and indoor datasets;
- synthetic parametric UK house plans;
- procedurally generated rooms;
- licensed product geometry;
- internal benchmark scans;
- rights-cleared professional drawings.

[ARKitScenes](https://github.com/apple/ARKitScenes) provides thousands of indoor captures and is useful for research. [Structured3D](https://structured3d-dataset.org/) provides synthetic indoor scenes. Dataset licences and intended uses must be reviewed individually.

### Proprietary flywheel

- source plan/scan;
- automated result;
- user correction;
- professional correction;
- model status and purpose;
- delivered/as-built comparison;
- error category;
- downstream consequence.

The most valuable label is not “this looks like a wall.” It is “this proposed wall object was corrected, verified for a stated use, issued, and compared with what was built.”

## 17. Research priorities

1. Benchmark RoomPlan and competing capture routes on representative UK homes.
2. Build a UK floor-plan corpus with explicit rights.
3. Test plan-plus-scan fusion against professional survey.
4. Develop confidence calibration and human-correction UX.
5. Build a minimal parametric house grammar for target archetypes.
6. Compare constraint solvers and learned generators for standard projects.
7. Validate whether architects review generated options faster than conventional creation.
8. Test geometry-safe diffusion/image enhancement.
9. Establish deterministic walkthrough quality and cost targets.
10. Define use-specific tolerances with practicing professionals.

The technical programme should optimise for **trustworthy reduction of uncertainty**, not leaderboard novelty alone.

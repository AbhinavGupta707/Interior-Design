# Historical Post-M1 and GPU Roadmap

> **Historical identifiers — do not execute:** native iOS capture, plan/photo/video reconstruction and fusion, neural appearance research, interior-design options, photoreal stills and design video have moved into the active M1 programme in `08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`. Every `C11`–`C19` label below is a legacy roadmap identifier, not an active checkpoint. The corresponding M2 and G0–G5 material remains technical rationale only. Post-M1 now begins with regulated professional/approval services and later procurement/delivery responsibility.

## 1. Principle

M1 establishes the trust kernel. Everything after it expands either:

- **evidence quality** (capture and fusion);
- **decision responsibility** (architectural/professional service);
- **project responsibility** (technical coordination, procurement and delivery); or
- **media/compute capability** (GPU-intensive research and production).

Those expansions should not be bundled into a single “v2”. Each has distinct rights, liability, hardware, staffing and unit-economic gates.

## 2. Stage-gate overview

| Stage | Product outcome | New risk accepted | Hard gate before starting |
|---|---|---|---|
| M2 measured capture | physical rooms can be captured, fused and discrepancy-reviewed | device/field evidence quality and operator safety | M1 model is reusable; supported iOS devices and capture protocol exist |
| M3 assisted design/practice | constrained options can be professionally reviewed and issued for a stated purpose | architecture practice, PII and dutyholder responsibility | legal entity, ARB/title position, appointments, PII, competent team and QA |
| M4 approvals/technical | selected scheme moves through planning and technical coordination | regulatory/document/consultant dependency | audited issue workflow and region/project box show quality/capacity |
| M5 managed procurement/delivery | tenders, changes, evidence and milestones are controlled | commercial/site/contractor/complaint exposure | cost data rights, partner network, cash/contingency and operating procedures |
| M6 selective D&B | platform takes integrated responsibility for a narrow repeatable project | construction margin, defects and working capital | delivered-outcome underwriting evidence and remediation reserve |
| M7 home OS | verified as-built model supports maintenance and future work | long retention, lifecycle service and partner access | reliable as-built capture/handover and retention economics |

## 3. M2 — Native iOS measured-capture programme

### 3.1 Product scope

The iOS application is a field evidence collector, not a second canonical-model editor. It should:

1. authenticate and download an authorised capture brief;
2. check device/OS/camera/LiDAR capability;
3. guide room capture and quality checks;
4. support resumable multi-room sessions and environmental notes;
5. preserve raw RoomPlan/AR evidence plus device/app/session metadata;
6. upload securely and resumably;
7. convert captured output into a proposed canonical model;
8. compare plan-derived, capture-derived and current model geometry;
9. require discrepancy resolution/human commit; and
10. retain capture provenance and verification scope.

RoomPlan's parametric output and USD/USDZ are evidence/derived formats. They do not replace the canonical model or prove hidden construction, structure, fire performance or legal compliance.

### 3.2 M2 checkpoint plan

#### C11 — iOS shell and secure sync

Outcome: a supported device can authenticate, select a project, download a capture brief, work through offline/interrupted states and upload a synthetic capture package.

Parallel ownership:

- **iOS shell lane:** `apps/ios-capture/App/**`, `apps/ios-capture/Features/Projects/**`.
- **Swift API/sync lane:** `apps/ios-capture/Networking/**`, `apps/ios-capture/Sync/**`.
- **server capture lane:** `services/platform-api/src/modules/capture/**` and one preallocated migration.
- **mobile QA lane:** `tests/mobile/capture-sync/**`, `docs/runbooks/ios/**`.

Gate: keychain/session handling, resumable upload, background/interruption behaviour and cross-tenant tests pass on physical hardware and simulator where applicable.

#### C12 — RoomPlan session and quality guidance

Outcome: a supported LiDAR device records one room with quality metadata, local review and safe failure guidance.

Parallel ownership:

- **RoomPlan lane:** `apps/ios-capture/Features/RoomCapture/**`.
- **capture-quality lane:** `apps/ios-capture/Features/CaptureQuality/**`.
- **format/conversion lane:** `services/spatial-worker/src/roomplan/**`.
- **field evaluation lane:** `tests/mobile/roomplan/**`, `docs/evaluation/roomplan-single-room/**`.

Gate: field cases cover clutter, mirrors/glass, poor light, narrow rooms, large rooms, missing surfaces, interruption and relocalisation; unsupported devices receive a non-deceptive alternative.

#### C13 — Multi-room merge, fusion and discrepancy review

Outcome: several captures may be merged where spatial evidence supports it and compared against the current model; conflicts remain explicit.

Parallel ownership:

- **multi-room iOS lane:** `apps/ios-capture/Features/MultiRoom/**`.
- **fusion kernel lane:** `packages/geometry-kernel/src/fusion/**`.
- **discrepancy backend lane:** `services/platform-api/src/modules/discrepancies/**`.
- **review UX/QA lane:** `apps/web/src/features/discrepancy-review/**`, `tests/e2e/discrepancy-review/**` (one lane owns both for the checkpoint).

Gate: transforms/elevations have evidence and uncertainty; no automatic average hides conflict; stairs, level changes and failed relocalisation generate actionable findings.

#### C14 — Capture verification pilot

Outcome: trained operators/professionals can follow a protocol and the resulting model quality/cost is measured on a rights-cleared holdout.

Lanes may cover field protocol, evaluator tooling, operational telemetry and mobile release hardening, with exclusive file paths. The checkpoint cannot close until named physical devices and operators complete the protocol.

### 3.3 Device test matrix

At minimum select:

- the oldest supported LiDAR iPhone;
- a current supported LiDAR iPhone;
- one supported iPad Pro if it is part of the operator workflow; and
- one unsupported/non-LiDAR device to verify capability messaging.

The Xcode Simulator covers navigation, forms, accessibility, sync/error states and screenshots. It has no camera and no ARKit support; therefore it cannot validate RoomPlan. Physical-device results are a release requirement, not an optional manual smoke test.

## 4. M3 — Architect-assisted design and professional practice

### 4.1 Preconditions

No professional issue workflow should go live until:

- the entity/title/ARB position is confirmed;
- registered architects and competent staff are named;
- adequate PII is in force for the service scope;
- appointments, reliance, complaints and record-retention terms are reviewed;
- Building Regulations and CDM dutyholder roles are mapped and assigned in writing where applicable;
- professional QA and peer-review capacity is budgeted; and
- M1/M2 model limitations are reflected in service scope.

### 4.2 Capabilities

- homeowner brief, constraints, budget range and success criteria;
- project-archetype templates without assuming exact feasibility;
- constrained design branches and option comparison;
- regulatory/planning evidence retrieval with citations and effective dates;
- rules-based pre-checks labelled as screening, not determinations;
- architect review queue, comments, decisions and requested corrections;
- purpose-specific verification/issue state machine;
- immutable issued packs tied to exact source/model/tool versions; and
- appointment, competency, conflict, workload and complaint records.

### 4.3 Checkpoint sequence

1. **C15 Brief and option framework:** structured brief, constraints and design option schema.
2. **C16 Retrieval and rules screening:** jurisdiction/version-aware evidence with permission and citation tests.
3. **C17 Professional review:** assignment, competency, comments, decisions and peer-review workflow.
4. **C18 Issue and records:** purpose/scope/status/sign-off, immutable issue package and supersession.
5. **C19 Controlled practice pilot:** real appointments in one geography/project box with quality, time, complaint and economics evidence.

Use parallel lanes only after each checkpoint's regulatory/domain contracts are frozen. The professional state machine and issue schema are orchestrator-owned shared contracts; no UI or AI lane may invent statuses independently.

## 5. M4 — Planning, technical information and coordination

### 5.1 Planning

Build a provider/jurisdiction-aware case workspace:

- application type, authority, statutory/local validation requirements and effective dates;
- source document rights and immutable evidence;
- drawings/documents derived from pinned model versions;
- submission checklist and explicit human approval;
- authority correspondence, requests, decisions and conditions; and
- metrics segmented by population and project type.

Official householder approval statistics are market context, not a probability for an individual project. Selection, geography, application quality and project type prevent direct inference.

### 5.2 Technical and dutyholder coordination

- project-specific regulation/rule sources with version/effective date;
- design responsibility and competency register;
- review findings with evidence, owner, due state and closure;
- engineer/specialist exchange and issued-record ingestion;
- change impact from canonical model operations to affected documents/decisions;
- audit of client instructions and dutyholder appointments; and
- no automated claim that work complies without the accountable reviewer and scope.

### 5.3 Interoperability

Introduce IFC import/export only for defined professional exchanges. Maintain the canonical model internally and map to a documented Model View Definition/profile. Validate geometry, property sets, IDs and round-trip loss on partner fixtures. Avoid promising arbitrary BIM round-trip fidelity.

## 6. M5 — Cost, tender, procurement and managed delivery

### 6.1 Cost architecture

Cost is a versioned estimate with:

- scope/model version;
- geography, date and currency;
- quantities and assumptions;
- supplier/product/rate source and rights;
- inclusions/exclusions, contingency and risk range;
- estimator/tool version and reviewer; and
- change delta from the last accepted baseline.

Do not turn a model into a single precise number. Surface range, uncertainty and excluded work.

### 6.2 Procurement

- structured tender package tied to an issued scope/model;
- bidder qualification and conflicts;
- like-for-like comparison with exclusions and clarifications;
- controlled communication/decision log;
- client approval and appointment evidence; and
- no ranking model that creates an opaque significant decision without review/challenge safeguards.

### 6.3 Delivery control

- programme/milestones;
- request for information and change proposal;
- cost/programme/quality impact;
- photographic/document evidence with time/actor/location where appropriate;
- inspection/observation record with explicit scope;
- client decision and payment milestone; and
- defect, remedy, closeout and as-built update.

Payments and contractor access materially expand security, fraud and consumer risk; introduce them behind separate threat, legal and financial control gates.

## 7. M6 — Selective vertically integrated design-and-build

The platform may become a principal/contracting delivery operator only for an explicitly underwritten box. Required evidence includes:

- enough completed projects to estimate correction, variation, delay, defect and remediation distributions;
- standardised scope and excluded conditions;
- competent internal leadership and vetted supply capacity;
- appointment/build contract and dutyholder position;
- PII, public/employers/products/contract works and other advised cover;
- cash-flow model, deposits/payment protections and working-capital reserve;
- quality plan, independent checks and escalation; and
- customer-support/remediation capability.

Begin with managed tender/delivery where the homeowner contracts the contractor. Integrate contractual risk only where the data shows a repeatable positive contribution after defects, rework, support, insurance and capital—not before.

## 8. M7 — Verified as-built home operating system

After completion, the canonical model may retain:

- verified as-built geometry and installed assets;
- product/serial/warranty/manual and installer evidence;
- issue/inspection/completion records;
- maintenance tasks and changes;
- energy/retrofit evidence where valid; and
- controlled access for future owners/professionals.

Ownership transfer, long-term retention, sensitive security information, provider continuity and deletion/legal obligations need an explicit lifecycle policy. A long-lived home record is valuable only if it remains trustworthy, portable and supportable.

## 9. Separate GPU and spatial research programme

### 9.1 What belongs here

GPU work should be isolated from the M1 critical path unless a measured baseline proves a specific GPU model is necessary. Tracks:

1. raster floor-plan detection/segmentation/vectorisation;
2. scan/plan/image fusion and registration;
3. photogrammetry and dense reconstruction;
4. NeRF/3D Gaussian splatting for appearance/context;
5. image/video generation for communication/acquisition; and
6. premium offline/Unreal rendering.

Neural appearance assets remain derived media. They do not become the canonical geometric or professional record.

### 9.2 Hardware model

- **Mac:** main web/API/domain/geometry/compiler development, browser 3D, CPU/vector baselines and small inference tests.
- **Physical Apple device:** RoomPlan capture and field QA.
- **Windows/NVIDIA or Linux GPU workstation:** interactive CUDA research; a 24 GB-class consumer GPU is a practical starting point for many experiments, not a promise that all models fit.
- **Cloud GPU batch:** reproducible larger training/evaluation, burst capacity and production only where economics/security support it.

Prefer Linux containers for reproducibility. On Windows, use WSL2/Docker where device/tool support is adequate; document native Windows exceptions. Pin driver/CUDA/framework compatibility in the experiment manifest.

### 9.3 GPU repository/artifact rules

- Source code, schemas, configs, small synthetic fixtures and benchmark summaries live in Git.
- Raw customer/provider datasets and model weights never live in Git.
- Dataset manifests record identity/version, rights, allowed purpose, lineage, split and hash.
- Model artifacts live in a versioned registry/object store with hash, container/image, code SHA, configuration, training data manifests, metrics and approval state.
- Production consumes a versioned inference contract/container; it does not import a research notebook.
- Notebooks are exploratory records, then logic graduates into tested modules/CLIs.
- Evaluation holdouts remain inaccessible to training/tuning paths.
- A model may be promoted only if it beats the declared deterministic/previous baseline on the predeclared metrics and does not worsen severe-error or calibration gates.

### 9.4 GPU checkpoint sequence

#### G0 — Reproducible GPU substrate

Outcome: one rights-cleared synthetic/small dataset can run through train/evaluate/package on local NVIDIA and one cloud runner with matching metrics within tolerance.

Parallel lanes:

- container/runtime (`ml/containers/**`);
- dataset manifest/loader (`ml/data/**`);
- experiment/registry tooling (`ml/platform/**`);
- CI/evaluation runbook (`tests/ml/substrate/**`, `docs/ml/substrate/**`).

Master owns root Python/CUDA lock/config and artifact schema.

#### G1 — Raster plan parser baseline

Outcome: a reproducible model competes against vector/rule baselines on a rights-cleared holdout and emits the M1 typed parser schema.

Lanes:

- wall/opening detection (`ml/plan/walls_openings/**`);
- room/text/scale analysis (`ml/plan/rooms_scale/**`);
- vectorisation/post-processing (`ml/plan/vectorise/**`);
- evaluation/calibration (`tests/ml/plan-parser/**`, `docs/ml/plan-parser/**`).

Do not merge model-specific fields into the canonical domain contract. Adapt model output at the inference boundary.

#### G2 — Plan/capture fusion

Outcome: fusion improves model quality/correction time over best single-source baseline and expresses disagreement explicitly.

Lanes:

- registration;
- uncertainty/conflict model;
- proposed geometry generation; and
- holdout/evaluator.

#### G3 — Neural appearance research

Outcome: determine whether photogrammetry/NeRF/Gaussian splats improve user comprehension or capture review enough to justify cost, rights and device complexity.

Measure capture time, failure rate, processing cost, visual usefulness and user misinterpretation. Do not optimise only PSNR/SSIM or visual appeal.

#### G4 — Generative image/video communication

Outcome: generated media improves a declared acquisition or decision-comprehension metric without being mistaken for a verified design.

Require visible status/watermark/metadata, prompt/source/model version, rights policy, moderation and a no-canonical-mutation boundary. Marketing uplift does not unlock professional issue.

#### G5 — Production GPU service

Outcome: an approved model runs in an isolated, observable, cost-bounded batch/endpoint with fallback, rollback and load/security evidence.

Only build this after a promoted experiment and a per-job/unit-economic case. AWS Batch EC2 GPU is the recommended initial asynchronous path; keep CPU/deterministic fallback where possible.

### 9.5 GPU promotion card

Every candidate model must publish:

```text
model and artifact ID/hash
code/container/config/CUDA versions
training/evaluation dataset manifest IDs and rights
target input box and explicit unsupported cases
baseline and candidate metrics with confidence intervals where meaningful
severe-error and calibration results
latency, memory, GPU time and cost
privacy/security/red-team results
fallback and rollback procedure
approver, scope, date and expiry/review trigger
```

## 10. Stage economics and resourcing gates

For every product stage, model:

- revenue/price and payment timing;
- acquisition and qualification cost;
- software/provider/GPU variable cost;
- operator/professional time including correction and QA;
- support, complaint, refund and remediation cost;
- insurance/legal/compliance cost;
- contractor/supplier risk and working capital where relevant; and
- contribution margin under base, adverse and tail scenarios.

The blue-sky plan should expand vertically only where control of a stage improves customer outcome and produces a defensible positive contribution after risk. Owning more of the chain is not automatically better.

---
title: Execution Roadmap, Workstreams, and Stage Gates
document_type: execution_plan
status: proposed
as_of: 2026-07-16
---

# 12 — Execution Roadmap, Workstreams, and Stage Gates

## 1. Execution principle

The company should preserve the blue-sky end state while sequencing work around the largest uncertainties. The first goal is not to implement every module. It is to prove that:

1. a real UK property can be represented usefully from address plus customer evidence;
2. users can correct and trust the model;
3. AI-assisted design options are valuable and professionally reviewable;
4. the structured model can generate consistent visual and project outputs;
5. the service can be delivered with better speed, clarity, and economics than a fragmented conventional process.

Only after those points are proven should the company add material construction and balance-sheet risk.

## 2. Parallel workstreams

### W1 — Customer and product discovery

- interview homeowners at pre-purchase, idea, design, planning, tender, and construction stages;
- observe household decision-making;
- test status and uncertainty language;
- validate willingness to pay for pre-construction certainty;
- identify target property/project archetypes;
- map acquisition channels.

### W2 — Professional practice

- appoint founding registered architect;
- define scope, review, issue, and record standards;
- establish PII pathway;
- define dutyholder and consultant workflows;
- recruit professional advisory group;
- create professional QA and incident process.

### W3 — Property data

- address/UPRN integration;
- England property dossier;
- Planning Data and local-source workflow;
- EPC and LiDAR adapters;
- source/rights catalogue;
- property matching and coverage benchmark.

### W4 — Capture and existing model

- plan upload and parser;
- calibration and correction UI;
- iOS RoomPlan capture;
- model fusion;
- quality report;
- survey import and verification workflow.

### W5 — Canonical model and editor

- domain schema;
- operation log and snapshots;
- 2D/3D editor;
- provenance and confidence;
- design branching;
- IFC/glTF export;
- validation engine.

### W6 — AI design and analysis

- brief agent;
- typed tool orchestrator;
- template and constraint-based options;
- design comparison;
- planning retrieval;
- professional review copilot;
- evaluation harness.

### W7 — Visualisation

- browser walkthrough;
- material/product system;
- deterministic render pipeline;
- camera paths and video;
- optional geometry-safe AI enhancement;
- collaboration and annotations.

### W8 — Cost and procurement

- quantity schema;
- initial price book;
- cost-range engine;
- scope compiler;
- bid schema and normalisation;
- product catalogue integrations.

### W9 — Delivery operations

- contractor qualification;
- project dashboard;
- RFIs, changes, and milestones;
- site evidence;
- defects and handover;
- direct-build underwriting later.

### W10 — Security, privacy, and platform

- tenancy and identity;
- rights/consent;
- secure asset pipeline;
- audit and issued artefacts;
- observability;
- data deletion/export;
- model/vendor governance;
- backup and recovery.

## 3. Stage-gate roadmap

## Stage 0 — Research foundation and operating design

### Goal

Establish the target customer, first underwriting box, legal/professional structure, and benchmark plan.

### Deliverables

- research repository;
- founder thesis and non-goals;
- target geography and project classes;
- professional advisory board;
- preliminary PII/legal/data advice;
- source licence matrix;
- 50–100 representative property benchmark set;
- initial risk register;
- prototype architecture.

### Gate G0

Proceed only if:

- target customers demonstrate a consequential problem;
- professional leaders believe the model can improve rather than degrade practice;
- data access is legally and commercially plausible;
- the company can define a narrow launch service;
- no fatal insurance or regulatory obstacle is identified.

## Stage 1 — Address dossier prototype

### Goal

Turn an address into a useful but appropriately qualified property context.

### Deliverables

- address resolution and UPRN;
- jurisdiction;
- footprint and site context;
- EPC and planning data;
- terrain/external massing;
- source and coverage warnings;
- simple property dossier UI;
- synthetic/test property support.

### Experiments

- compare address match across flats, conversions, new builds, and renamed streets;
- compare external attributes against known survey properties;
- test whether users understand “estimated shell”;
- measure useful planning context coverage across initial authorities.

### Gate G1

- address match quality acceptable for target segment;
- no internal-layout implication;
- source lineage complete;
- user comprehension passes testing;
- cost per dossier is sustainable.

## Stage 2 — Plan-to-model prototype

### Goal

Create a corrected, editable model from common floor-plan inputs.

### Deliverables

- safe upload and rights declaration;
- raster/vector extraction;
- wall/opening/room detection;
- scale calibration;
- overlay correction editor;
- canonical model commit;
- plan and glTF output;
- quality report.

### Benchmark

Build separate sets for:

- clean vector plans;
- estate-agent plans;
- planning drawings;
- scans/photographs;
- hand sketches;
- target UK house archetypes.

### Gate G2

- catastrophic geometry-error rate below agreed threshold;
- correction workflow materially faster than rebuilding manually for target inputs;
- provenance retained;
- model can generate consistent 2D and 3D;
- architects accept the output as a concept starting point.

## Stage 3 — Guided scan and model fusion

### Goal

Support customers without plans and improve model evidence.

### Deliverables

- iOS RoomPlan application;
- capture guidance and completeness score;
- room connection and multi-room merge;
- reference-measure workflow;
- plan-plus-scan fusion;
- professional survey import;
- verification status.

### Experiments

- scan 50+ representative homes;
- compare against laser/professional survey;
- test clutter, mirrors, stairs, bays, sloped roofs, and multi-floor cases;
- quantify correction time and error by device/user.

### Gate G3

- use-specific accuracy and uncertainty calibration agreed with professionals;
- failure cases route correctly to survey;
- privacy/capture controls work;
- whole-house flow succeeds for target archetypes.

## Stage 4 — AI design studio with architect review

### Goal

Prove that the platform creates meaningful options and reduces professional effort.

### Deliverables

- structured brief;
- typed natural-language operations;
- target-project templates;
- option branching and comparison;
- material/furniture changes;
- browser walkthrough;
- design narrative;
- architect review and issue workflow.

### Initial design products

- ground-floor reconfiguration;
- rear extension variants;
- side-return variants;
- straightforward loft feasibility;
- kitchen/utility configuration.

### Gate G4

- options satisfy hard constraints;
- independent architects rate a meaningful proportion as useful starting points;
- review/correction time improves versus baseline;
- users understand concept status;
- no increase in critical professional errors.

## Stage 5 — Planning and technical service

### Goal

Operate a real AI-native architecture practice for a narrow segment.

### Deliverables

- appointments and professional identity;
- planning route workflow;
- source-backed policy/constraint summary;
- drawing/document compiler;
- application and authority tracking;
- structural partner workflow;
- technical issue and review state;
- consultant coordination;
- PII and records controls.

### Gate G5

- first real projects complete planning/technical stages;
- professional and customer incident rate acceptable;
- issue packages are internally consistent;
- authority feedback loop captured;
- service gross margin and review load are credible;
- PII conditions remain satisfied.

## Stage 6 — Cost, tender, and managed delivery

### Goal

Connect design to credible scope, bids, and project control.

### Deliverables

- quantity/work-breakdown compiler;
- cost ranges and confidence;
- contractor qualification;
- structured tender package;
- bid normalisation;
- model-linked RFIs and changes;
- milestones and evidence;
- payments integration;
- defects and handover.

### Gate G6

- scope quality reduces bid omissions and dispersion;
- estimate-to-contract and contract-to-final variance measured;
- contractor network quality stable;
- customer responsibility is clear;
- complaints/remediation processes work;
- managed-service unit economics positive after support.

## Stage 7 — Selective design-and-build

### Goal

Assume direct construction responsibility for narrowly underwritten products.

### Preconditions

- sufficient completed managed projects;
- reliable cost and duration history;
- verified survey/technical process;
- stable contractor teams;
- construction leadership;
- capital, insurance, warranty, and reserve model;
- project accounting and cash controls;
- board approval of underwriting box.

### Initial product examples

- defined rear-extension shell and fit-out range;
- standard side-return configurations;
- selected loft-conversion type;
- fixed-scope internal reconfiguration.

### Gate G7

Expand only if:

- gross margin remains positive after defects, support, and overhead;
- schedule and cost variance stay within risk appetite;
- safety and quality trends are acceptable;
- cash conversion and deposits are controlled;
- loss data supports pricing;
- customer outcomes outperform managed-only baseline.

## Stage 8 — Property operating system

### Goal

Retain the as-built record and create long-term services.

### Deliverables

- as-built verification;
- product/warranty graph;
- maintenance schedule;
- energy/retrofit scenarios;
- homeowner data controls;
- resale and future-project exports;
- optional insurer/lender integrations.

### Gate G8

- customers use the record after completion;
- data rights and retention are trusted;
- recurring services create value rather than spam;
- record accuracy is maintained over time.

## 4. Suggested time horizons

These are planning ranges, not delivery promises.

### 0–90 days

- founding architecture/product/geometry team;
- target segment and region;
- legal/PII/data work;
- address dossier proof;
- canonical-model skeleton;
- plan-parser baseline;
- 10–20 pilot property captures;
- initial user research;
- source catalogue and risk register.

### 3–9 months

- usable plan-to-3D editor;
- iOS capture alpha;
- web walkthrough;
- design operations and two project templates;
- architect review workflow;
- benchmark suite;
- private homeowner/professional pilots.

### 9–18 months

- operating architecture service in one territory;
- planning workflow;
- technical coordination;
- cost range and scope compiler;
- 50–200 live projects depending on team and risk appetite;
- measured model and professional outcome dataset;
- controlled contractor tender pilot.

### 18–36 months

- multiple project products;
- managed delivery;
- regional expansion under gates;
- proprietary plan/scan/design/cost models;
- procurement integrations;
- first selective direct-build product if evidence supports it.

### Beyond 36 months

- broader national adapters;
- productised systems;
- direct build in selected territories;
- persistent home record;
- acquisition and consolidation strategy;
- finance/warranty/property lifecycle expansion.

## 5. Team plan

### Founding team

- CEO/operating founder with category and capital discipline;
- CTO/platform architect;
- Chief Architect, ARB registered;
- geometry/graphics lead;
- ML/computer-vision lead;
- product/design lead;
- full-stack engineers;
- data/geospatial engineer;
- professional operations/customer lead;
- legal/PII advisers.

### Stage 2 additions

- iOS spatial engineer;
- survey lead;
- architectural technologists;
- planning specialist;
- QA/test automation;
- security/privacy lead;
- user research.

### Stage 5 additions

- cost consultant/quantity-surveying leadership;
- structural-engineering partner or team;
- contractor network and procurement;
- project management;
- complaints/remediation;
- finance controller.

### Stage 7 additions

- construction director;
- regional site operations;
- commercial manager;
- health and safety;
- quality inspectors;
- treasury/working-capital control;
- warranty/claims function.

## 6. Initial product backlog

### Epic A — Property onboarding

- address autocomplete;
- ambiguous match resolution;
- jurisdiction;
- property dossier;
- source warnings;
- project intent intake.

### Epic B — Evidence upload

- signed uploads;
- file validation;
- rights declaration;
- page/plan selection;
- known-dimension input;
- asset provenance.

### Epic C — Model foundation

- property/building/level/space/wall/opening schema;
- operation log;
- snapshots;
- 2D viewer;
- 3D scene;
- validation.

### Epic D — Plan processing

- vector/raster path;
- wall/room/opening extraction;
- scale;
- source overlay;
- correction;
- confidence.

### Epic E — Design studio

- brief schema;
- option branch;
- typed operations;
- materials/furniture;
- comparison;
- review comments.

### Epic F — Professional gate

- reviewer role;
- review package;
- issues;
- approve/reject/request change;
- issue artefact;
- immutable record.

### Epic G — Visual output

- glTF compiler;
- first-person walkthrough;
- camera bookmarks;
- render job;
- output manifest;
- illustrative labels.

### Epic H — Evaluation

- benchmark runner;
- ground truth import;
- error taxonomy;
- model/provider version tracking;
- dashboard;
- regression gate.

## 7. Pilot design

### Pilot cohort

Select properties spanning:

- Victorian terrace;
- Edwardian terrace;
- 1930s semi;
- post-war semi;
- modern detached;
- bungalow;
- simple flat/maisonette only as research, not initial service;
- different local authorities.

### Evidence package per pilot

- address/public dossier;
- available floor plan;
- RoomPlan or equivalent scan;
- professional measurements;
- photographs;
- model corrections;
- design brief;
- architect-created baseline;
- AI-assisted options;
- review time;
- user comprehension;
- cost and planning observations.

## 8. Governance cadence

- weekly product/geometry incident review;
- fortnightly professional case review;
- monthly data and AI benchmark review;
- monthly customer outcomes review;
- quarterly underwriting-box review;
- board review before new territory, project class, fixed-price promise, or regulated activity.

## 9. Definition of progress

Progress is not measured by number of generated renders or lines of code. It is measured by progressively stronger evidence that the platform can:

- know what it knows;
- expose what it does not know;
- improve design decisions;
- reduce professional and customer effort;
- produce consistent downstream information;
- price and control risk;
- deliver better outcomes.

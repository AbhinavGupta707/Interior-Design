---
title: AI-Native Full-Stack Architecture and Residential Transformation Platform
document_type: repository_index
status: research_and_product_definition
as_of: 2026-07-16
primary_market: United Kingdom
primary_audience:
  - founders
  - architects
  - engineers
  - product leaders
  - AI and 3D engineers
  - Codex and Claude Code agents
---

# AI-Native Full-Stack Architecture: Research and Execution Repository

This repository converts the full exploration of an immersive, AI-native home-design concept into a structured research, product, technical, regulatory, and execution dossier.

The ambition is deliberately larger than an AI interior-design application. The proposed company would become an **integrated residential transformation platform** that can take a homeowner from an address, plan, photograph set, or spatial scan to:

1. a provenance-aware digital model of the existing property;
2. architect-like exploration of layouts, extensions, materials, furniture, lighting, and budgets;
3. interactive and cinematic visualisation;
4. planning and regulatory preparation;
5. technical design and engineering coordination;
6. procurement, contractor selection, project control, and potentially construction delivery;
7. a persistent property digital twin for maintenance, retrofit, resale, and later projects.

The long-run analogy is not simply “Midjourney for rooms.” It is closer to a **Revolut-style unified customer experience** or a **Corgi-style full-stack risk operator**, applied carefully to architecture and home renovation. Unlike banking or insurance, however, construction is physical, geographically local, partly unknowable before opening up the building, and subject to professional and statutory responsibility. The repository therefore treats “full stack” as an operating and accountability model—not as a claim that every legal, professional, or regulatory role can be automated or internalised.

## Central thesis

> Build a company that owns the homeowner journey, the canonical property model, project coordination, quality system, and commercial outcome. Use AI to compress and improve professional work, but retain qualified human responsibility at the points where physical evidence, regulation, engineering judgement, or public authority decisions are decisive.

The fundamental technical rule is:

> **The trustworthy building model and the beautiful visual model are related, but they are not the same artefact.**

The source of truth must be a structured, versioned, confidence-scored model of walls, levels, openings, spaces, products, assumptions, decisions, and evidence. Photoreal renders, AI images, Gaussian splats, videos, and walkthroughs are derived communication layers. They must never silently redefine authoritative geometry.

## Research-status vocabulary

Every implementation agent should distinguish the following labels:

| Label | Meaning |
|---|---|
| **SOURCE FACT** | A claim supported by a cited primary or clearly identified secondary source. |
| **INFERENCE** | A conclusion drawn from one or more source facts; it may be wrong and should be tested. |
| **PROPOSAL** | A recommended product, technical, organisational, or commercial decision. |
| **HYPOTHESIS** | A claim that should be validated through research, prototype data, or market evidence. |
| **ASSUMPTION** | A temporary input used to make progress; it must not be presented as established truth. |
| **OPEN QUESTION** | A material unresolved issue requiring an owner, evidence, and a decision date. |
| **GATE** | A condition that must be satisfied before advancing to a higher-risk capability or operating model. |

For model-level provenance, use the more precise states defined in `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`: `OBSERVED`, `AUTHORITATIVE_EXTERNAL`, `USER_PROVIDED`, `INFERRED`, `PROPOSED`, `VERIFIED`, and `UNKNOWN`.

## Repository map

| File | Purpose |
|---|---|
| [`00_CONTEXT_AND_NORTH_STAR.md`](00_CONTEXT_AND_NORTH_STAR.md) | Reconstructs the idea, its intended scope, target customer, north star, and non-goals. |
| [`01_EXECUTIVE_THESIS_AND_CRITICAL_VERDICT.md`](01_EXECUTIVE_THESIS_AND_CRITICAL_VERDICT.md) | Gives the critical strategic judgement, including what is possible, not possible, and defensible. |
| [`02_PRODUCT_VISION_AND_USER_JOURNEYS.md`](02_PRODUCT_VISION_AND_USER_JOURNEYS.md) | Describes product surfaces, end-to-end homeowner journeys, professional workflows, and blue-sky features. |
| [`03_MARKET_INCUMBENTS_AND_COMPETITOR_MAP.md`](03_MARKET_INCUMBENTS_AND_COMPETITOR_MAP.md) | Maps incumbents across architecture, renovation, generative design, capture, BIM, planning data, and construction. |
| [`04_UK_PROPERTY_DATA_AND_ADDRESS_TO_3D.md`](04_UK_PROPERTY_DATA_AND_ADDRESS_TO_3D.md) | Explains the UK data landscape and a realistic address-to-model pipeline across all four UK nations. |
| [`05_REGULATORY_PROFESSIONAL_AND_DATA_GOVERNANCE.md`](05_REGULATORY_PROFESSIONAL_AND_DATA_GOVERNANCE.md) | Covers the protected architect title, professional liability, dutyholders, planning, building control, consumer law, privacy, finance, and copyright. |
| [`06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`](06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md) | Defines the source-of-truth building model, provenance, versioning, domain boundaries, and target architecture. |
| [`07_AI_3D_RECONSTRUCTION_RENDERING_AND_VIDEO.md`](07_AI_3D_RECONSTRUCTION_RENDERING_AND_VIDEO.md) | Analyses floor-plan parsing, phone scans, photogrammetry, NeRFs, Gaussian splats, generative layout, rendering, and AI video. |
| [`08_INFRASTRUCTURE_APIS_AND_INTEGRATIONS.md`](08_INFRASTRUCTURE_APIS_AND_INTEGRATIONS.md) | Specifies the application, data, geospatial, GPU, workflow, security, observability, deployment, and external-integration stack. |
| [`09_FULL_STACK_OPERATING_MODEL_AND_ACQUISITION_STRATEGY.md`](09_FULL_STACK_OPERATING_MODEL_AND_ACQUISITION_STRATEGY.md) | Defines project underwriting, entity structure, professional operations, delivery models, acquisitions, and territorial launch. |
| [`10_BUILD_VS_BUY_VS_PARTNER_AND_IN_HOUSE_STRATEGY.md`](10_BUILD_VS_BUY_VS_PARTNER_AND_IN_HOUSE_STRATEGY.md) | Separates strategic IP to own from commodity infrastructure to license and independent roles that should remain independent. |
| [`11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md`](11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md) | Provides the capability feasibility matrix, risk register, safety case, failure modes, and mandatory escalation gates. |
| [`12_EXECUTION_ROADMAP_WORKSTREAMS_AND_STAGE_GATES.md`](12_EXECUTION_ROADMAP_WORKSTREAMS_AND_STAGE_GATES.md) | Converts the vision into phased workstreams, prototypes, evidence gates, team formation, and a staged launch plan. |
| [`13_EVALUATION_METRICS_DATA_STRATEGY_AND_EXPERIMENTS.md`](13_EVALUATION_METRICS_DATA_STRATEGY_AND_EXPERIMENTS.md) | Defines geometry, AI, planning, cost, operations, safety, and commercial evaluation. |
| [`14_BUSINESS_MODEL_UNIT_ECONOMICS_AND_MOAT.md`](14_BUSINESS_MODEL_UNIT_ECONOMICS_AND_MOAT.md) | Analyses revenue pools, unit economics, working capital, distribution, financing sequence, and durable moats. |
| [`15_CODEX_CLAUDE_IMPLEMENTATION_BRIEF.md`](15_CODEX_CLAUDE_IMPLEMENTATION_BRIEF.md) | Gives coding agents a concrete mission, repository shape, initial epics, constraints, and acceptance criteria. |
| [`16_API_AND_DOMAIN_SCHEMA_REFERENCE.md`](16_API_AND_DOMAIN_SCHEMA_REFERENCE.md) | Defines domain entities, API conventions, sample payloads, events, permissions, and integration contracts. |
| [`17_RESEARCH_BIBLIOGRAPHY.md`](17_RESEARCH_BIBLIOGRAPHY.md) | Curates official sources, vendor evidence, research papers, datasets, open-source projects, and cautionary cases. |
| [`18_BLUE_SKY_FRONTIER_PROGRAM.md`](18_BLUE_SKY_FRONTIER_PROGRAM.md) | Preserves the long-range research programme across digital twins, regulation, simulation, manufacturing, finance, and lifecycle services. |
| [`DECISIONS.md`](DECISIONS.md) | Records accepted, proposed, deferred, and rejected architecture/product decisions. |
| [`ASSUMPTIONS_AND_OPEN_QUESTIONS.md`](ASSUMPTIONS_AND_OPEN_QUESTIONS.md) | Tracks unresolved assumptions with evidence requirements and kill criteria. |
| [`CLAUDE.md`](CLAUDE.md) | Project instructions for Claude Code. |
| [`AGENTS.md`](AGENTS.md) | Project instructions for Codex and other implementation agents. |
| [`FULL_RESEARCH_DOSSIER.md`](FULL_RESEARCH_DOSSIER.md) | Concatenated reading copy of the core research files. |
| [`MANIFEST.json`](MANIFEST.json) | Machine-readable repository document inventory. |

## Recommended reading order

### Founder or investor

1. `01_EXECUTIVE_THESIS_AND_CRITICAL_VERDICT.md`
2. `09_FULL_STACK_OPERATING_MODEL_AND_ACQUISITION_STRATEGY.md`
3. `14_BUSINESS_MODEL_UNIT_ECONOMICS_AND_MOAT.md`
4. `11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md`
5. `12_EXECUTION_ROADMAP_WORKSTREAMS_AND_STAGE_GATES.md`

### Product and design leadership

1. `00_CONTEXT_AND_NORTH_STAR.md`
2. `02_PRODUCT_VISION_AND_USER_JOURNEYS.md`
3. `04_UK_PROPERTY_DATA_AND_ADDRESS_TO_3D.md`
4. `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`
5. `13_EVALUATION_METRICS_DATA_STRATEGY_AND_EXPERIMENTS.md`

### Technical team or coding agent

1. `CLAUDE.md` or `AGENTS.md`
2. `15_CODEX_CLAUDE_IMPLEMENTATION_BRIEF.md`
3. `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`
4. `16_API_AND_DOMAIN_SCHEMA_REFERENCE.md`
5. `08_INFRASTRUCTURE_APIS_AND_INTEGRATIONS.md`
6. `07_AI_3D_RECONSTRUCTION_RENDERING_AND_VIDEO.md`
7. `DECISIONS.md`

### Architecture, engineering, or compliance team

1. `05_REGULATORY_PROFESSIONAL_AND_DATA_GOVERNANCE.md`
2. `11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md`
3. `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`
4. `04_UK_PROPERTY_DATA_AND_ADDRESS_TO_3D.md`
5. `13_EVALUATION_METRICS_DATA_STRATEGY_AND_EXPERIMENTS.md`

## Non-negotiable design principles

1. **No address-only exact-interior claim.** Address and public/licensed data can create context and an estimated shell, not a current measured internal layout.
2. **No visual hallucination as geometry.** AI imagery and video may communicate a proposal but cannot become the source of measured truth.
3. **No unqualified autonomous structural or regulatory sign-off.** Design assistance is different from professional or statutory responsibility.
4. **Every fact in the building model has provenance.** Unknowns must stay unknown until evidence changes their status.
5. **Design changes are typed operations.** The system edits walls, spaces, products, constraints, and options through structured commands—not through uncontrolled image regeneration.
6. **One model, many views.** Plans, schedules, quantities, compliance checks, renders, walkthroughs, and procurement outputs should derive from a common versioned model.
7. **The customer experience may be unified while legal responsibilities remain explicit.** Do not hide professional appointments, contractor responsibility, or statutory authority behind a single brand.
8. **Fixed prices follow verification.** A concept, estimate, or address-based pre-feasibility result must not be represented as a fully underwritten construction contract.
9. **Full in-house means strategic control, not needless reinvention.** Own differentiated data, workflow, risk, and model IP; license commodity datasets and infrastructure where appropriate; preserve legally necessary independence.
10. **Expand the underwriting box slowly.** Accept complexity only after evidence shows the company can model, design, price, deliver, and warranty it reliably.

## Immediate executable outcome

The first credible product is not a national autonomous architecture-and-build company. It is a **verified plan/scan-to-3D renovation design workspace** for a narrow set of UK low-rise house projects, with architect review and structured professional handoff.

A sensible first demonstrator should:

- resolve an address to a property record;
- create an address-derived property dossier and estimated exterior shell;
- accept a floor plan or iPhone RoomPlan capture;
- create an editable, provenance-aware room/wall/opening model;
- support conversational, constrained design changes;
- generate 2D plans, a browser walkthrough, and selected renders;
- expose uncertainty rather than concealing it;
- create a human-review package rather than pretending to be construction-ready.

The subsequent files explain how to move from that demonstrator to a full-stack residential transformation company without confusing a compelling demo with a safe, profitable, professionally accountable operation.

## Legal and professional caveat

This repository is strategic and technical research, not legal, regulatory, planning, structural-engineering, tax, insurance, financial, or architectural advice. Any real operating company must obtain current advice from appropriately qualified UK professionals in each relevant jurisdiction and maintain appropriate appointments, registrations, insurance, controls, and records.

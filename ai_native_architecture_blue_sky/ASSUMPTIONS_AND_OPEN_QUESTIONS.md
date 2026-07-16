---
title: Assumptions and Open Questions
document_type: research_backlog
status: living
as_of: 2026-07-16
---

# Assumptions and Open Questions

## 1. Assumption policy

Every assumption should have:

- ID;
- statement;
- current confidence;
- evidence needed;
- owner;
- test or decision date;
- consequence if false;
- kill or pivot criterion.

Do not convert assumptions into product promises or technical constants.

## 2. Market and customer assumptions

### A-001 — Homeowners will pay for pre-construction certainty

**Confidence:** Medium.

**Evidence needed:** Pricing interviews and paid pilots comparing address feasibility, verified model, and architect-reviewed option packages.

**If false:** Shift more revenue toward B2B professionals/builders or product/retail channels.

### A-002 — A narrow set of residential projects is sufficiently repeatable

**Confidence:** Medium-high.

**Evidence needed:** 100+ project taxonomy across target regions, process time, exceptions, planning/structural variation.

**Kill criterion:** Exception handling consumes similar effort to bespoke conventional work.

### A-003 — Visual/interactive review materially improves household decision speed

**Confidence:** Medium-high.

**Evidence needed:** Controlled user studies measuring time, revision cycles, and comprehension.

### A-004 — Customers value one accountable brand

**Confidence:** High conceptually, unproven economically.

**Evidence needed:** Conversion and willingness-to-pay comparison between software-only, professional service, and managed-delivery propositions.

### A-005 — Property operating system supports recurring engagement

**Confidence:** Low-medium.

**Evidence needed:** Post-completion usage, maintenance/energy/insurance integration tests.

## 3. Data assumptions

### A-006 — Address and UPRN matching is reliable for the target segment

**Confidence:** High for ordinary houses; lower for conversions/flats/new builds.

**Test:** Benchmark at least 1,000 target addresses and manually verify ambiguous cases.

### A-007 — Public/licensed building and planning data produces a useful initial dossier

**Confidence:** Medium-high.

**Test:** Architect usefulness review across initial authorities.

### A-008 — External height/floor-count data improves shell generation

**Confidence:** Medium.

**Test:** Compare against surveyed properties; report error by archetype.

### A-009 — Planning-portal metadata can be obtained lawfully and reliably enough

**Confidence:** Medium-low nationally.

**Test:** Source and licence audit by local authority/aggregator.

### A-010 — Rights-cleared UK floor-plan corpus can be assembled

**Confidence:** Medium.

**Test:** Partner discussions with practices/surveyors; customer-consent rates; synthetic-data gap analysis.

### A-011 — Customers will consent separately to selected training use

**Confidence:** Unknown.

**Test:** Transparent consent experiments without dark patterns.

## 4. Capture and geometry assumptions

### A-012 — Plan conversion plus correction is faster than manual redraw

**Confidence:** Medium, input-dependent.

**Test:** Blind time-and-quality benchmark across plan classes.

### A-013 — RoomPlan can support concept-grade whole-house capture for target archetypes

**Confidence:** Medium.

**Test:** 50+ representative homes against professional survey.

### A-014 — User reference measurements calibrate scan error effectively

**Confidence:** Medium.

**Test:** Compare multiple calibration protocols.

### A-015 — Multi-floor alignment can be made simple enough for homeowners

**Confidence:** Medium-low.

**Test:** Stairs/landing workflow prototypes.

### A-016 — A consumer-friendly correction editor is learnable

**Confidence:** Medium.

**Test:** Task success and correction quality with non-expert users.

### A-017 — A proprietary canonical schema can map sufficiently to IFC/Revit workflows

**Confidence:** Medium-high.

**Test:** Export/import with practicing firms and issue packages.

## 5. AI and design assumptions

### A-018 — Typed LLM operations create a natural but safe editing experience

**Confidence:** High for simple operations.

**Test:** Ambiguity, invalid-operation, and task-completion benchmark.

### A-019 — Generative options reduce architect time

**Confidence:** Medium.

**Test:** Crossover study with real briefs and measured review/correction.

### A-020 — Templates plus constraints outperform unconstrained generation

**Confidence:** High as an engineering thesis.

**Test:** Acceptance and hard-constraint failure comparison.

### A-021 — UK house-archetype priors improve reconstruction and design

**Confidence:** Medium-high.

**Test:** Out-of-sample benchmark; ensure priors do not create false certainty.

### A-022 — AI-enhanced media can preserve geometry adequately for labelled illustration

**Confidence:** Medium.

**Test:** depth/segmentation consistency and user comprehension.

### A-023 — Planning precedent can support calibrated relative risk

**Confidence:** Medium-low.

**Test:** Historical out-of-sample evaluation with proposal geometry and policy periods.

## 6. Professional and regulatory assumptions

### A-024 — A registered architecture practice can deliver the service under acceptable PII terms

**Confidence:** Medium-high but requires insurer engagement.

**Test:** Broker/insurer review of scope, AI controls, and project exclusions.

### A-025 — Professionals will trust and use the provenance/review system

**Confidence:** Medium.

**Test:** Co-design with architects, engineers, and surveyors.

### A-026 — AI-assisted review does not encourage rubber-stamping

**Confidence:** Unknown.

**Test:** Review telemetry, random audit, interface variants.

### A-027 — Planning and technical outputs can be substantially automated for narrow project types

**Confidence:** Medium-high.

**Test:** Live-project time, error, and authority-feedback data.

### A-028 — Building control and professional partners will accept open digital exports/workflows

**Confidence:** Medium, variable.

**Test:** Partner interviews and pilot submissions.

## 7. Cost and delivery assumptions

### A-029 — Geometry-linked scope reduces bid dispersion and omissions

**Confidence:** Medium-high.

**Test:** Controlled tender comparison.

### A-030 — Delivered-project data can produce useful cost confidence by archetype/territory

**Confidence:** High after sufficient volume, unknown sample size.

**Test:** Learning curves and out-of-sample intervals.

### A-031 — Managed contractor delivery can generate positive contribution margin

**Confidence:** Medium.

**Test:** Fully loaded pilot economics including support/remediation.

### A-032 — Contractor quality can be predicted from platform evidence

**Confidence:** Medium-low initially.

**Test:** Longitudinal performance model; control selection bias.

### A-033 — Selected renovation products can be fixed-priced safely

**Confidence:** Medium after evidence.

**Gate:** Verified survey, technical design, scope lock, and loss history.

### A-034 — Direct construction improves customer trust enough to justify risk

**Confidence:** Unknown.

**Test:** Compare managed versus direct cohorts after capability exists.

## 8. Business and distribution assumptions

### A-035 — Address feasibility creates efficient consumer acquisition

**Confidence:** Medium.

**Test:** CAC, conversion, and support cost by channel.

### A-036 — Estate-agent/mortgage/conveyancing channels value renovation feasibility

**Confidence:** Medium-high conceptually.

**Test:** Partnership pilots and lead quality.

### A-037 — Architecture fees can fund the early operating model

**Confidence:** Medium.

**Test:** Fully loaded gross margin after professional time and PII.

### A-038 — Product/procurement margin can be earned without harming trust

**Confidence:** Medium.

**Test:** Disclosure comprehension and recommendation-quality audit.

### A-039 — Acquiring regional practices accelerates more than it distracts

**Confidence:** Low until integration playbook exists.

**Test:** target diligence and simulated integration economics.

## 9. Open technical questions

### Q-001 — What is the minimum internal geometry representation?

Decide wall path/face model, space derivation, roof/stair scope, and kernel boundary.

### Q-002 — Event sourcing or append-only command log with materialised state?

Prototype replay, migration, branching, and operational complexity.

### Q-003 — CRDT versus server-authoritative collaboration?

Assess multi-user needs, geometry conflicts, and auditability.

### Q-004 — Which plan-parser baseline and licence are appropriate?

Benchmark CubiCasa/RoomFormer/other methods and legal terms.

### Q-005 — How should scan and plan evidence be weighted?

Develop attribute-level authority and conflict rules.

### Q-006 — Which geometry engine should be used?

Evaluate robust polygon libraries, Open Cascade, CGAL, custom residential primitives, and WASM needs.

### Q-007 — What model view is required for IFC exports?

Define concept, planning, technical, and as-built exchange requirements.

### Q-008 — What is the professional digital-signature/issue method?

Determine legal/evidential requirements and tooling.

### Q-009 — How are regulations represented?

Evaluate code-as-rules, decision tables, knowledge graphs, retrieval, and human review.

### Q-010 — How is model-linked cost represented?

Choose work breakdown, quantities, assemblies, regional rates, risk, and versioning.

## 10. Open legal and operating questions

### Q-011 — Exact ARB company-name/control structure

Obtain current professional legal advice.

### Q-012 — PII terms for AI-assisted architecture

Engage specialist brokers/insurers before live professional output.

### Q-013 — Data licences and derivative rights

Review OS, HMLR, planning aggregators, product, and cost data contracts.

### Q-014 — Planning-document reuse and training

Develop council/rights-holder strategy; do not rely on public visibility.

### Q-015 — Consumer contract structure

Separate software, professional, managed-delivery, and build promises clearly.

### Q-016 — Payment handling and customer money

Obtain payment-services and insolvency advice.

### Q-017 — Finance referral/credit permissions

Determine FCA model before integration.

### Q-018 — Group entity and conflict framework

Architecture Practice, TechCo, BuildCo, ProcurementCo, and independent review.

### Q-019 — Warranty/remediation architecture

Define contractual remedies, insurance, reserves, and independent assessment.

### Q-020 — Nation-by-nation legal adapters

Wales, Scotland, and Northern Ireland require separate research before service.

## 11. Open product questions

### Q-021 — Which first customer moment is strongest?

- pre-purchase potential;
- homeowner idea-to-design;
- architect co-pilot;
- builder sales/estimating;
- kitchen/extension package.

### Q-022 — How much editing should be self-service?

Balance accessibility, model integrity, and professional conversion.

### Q-023 — Should early design be free, paid, or credited toward service?

Test quality of leads and perceived value.

### Q-024 — What status language do customers understand?

Run comprehension research on estimated, verified, architect-reviewed, planning submitted, and construction issue.

### Q-025 — What is the minimum valuable immersive experience?

Browser walkthrough may be sufficient before VR/AI video.

### Q-026 — Should the model show uncertain geometry visually?

Test overlays, opacity, hatching, and confidence panels without overwhelming users.

## 12. Prioritisation

Highest-priority unresolved items:

1. target segment and territory;
2. PII/professional operating feasibility;
3. data licence and rights;
4. plan/scan model accuracy and correction time;
5. canonical geometry architecture;
6. architect-assisted design productivity;
7. customer comprehension of status;
8. scope and cost linkage;
9. managed contractor economics;
10. construction-risk gate.

Every quarterly plan should explicitly retire, revise, or escalate assumptions from this file.

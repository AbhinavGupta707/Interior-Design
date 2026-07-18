# Product Requirements and Operating Model

> **Active-scope notice — 2026-07-18:** this document predates the Complete Home Design System amendment. Where its M1 exclusions or sequencing conflict with `08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`, the active plan controls. Native capture, full-house reconstruction, interior-design options, geometry-safe stills and deterministic/enhanced design video are now active M1 scope, subject to the evidence and professional-boundary rules retained here.

## 1. Product definition

### 1.1 Problem

A homeowner's project is currently reconstructed repeatedly across estate information, surveys, drawings, design models, planning submissions, technical packs, quotations, site records and completion evidence. Information loses provenance, changes are hard to compare, visual output is easily mistaken for truth and no single actor maintains a durable model of what was known, proposed, approved, installed and verified.

The product should reduce this fragmentation by making the canonical property/project model—not an image, chat transcript or BIM file—the controlled system of record.

### 1.2 Product promise

For the initial milestone:

> Starting from an identified property and rights-cleared evidence, help a user create, correct, version and inspect a useful existing-condition model without hiding uncertainty or claiming professional verification.

For the mature company:

> Carry one evidence-backed home record through design, professional decisions, approvals, buying, construction and verified as-built operation.

### 1.3 Why the order matters

The product must move through four epistemic states deliberately:

1. **Context:** facts or estimates associated with a property identity.
2. **Proposal:** machine- or human-generated interpretation not yet accepted into the current model.
3. **Current model:** a committed model version whose evidence, actor and validation status are known.
4. **Issued or verified record:** an immutable professional or field record with a purpose, scope, attributable issuer and source versions.

No user interface or API may collapse those states into a generic “design”.

## 2. Initial market and positioning

### 2.1 Recommended beachhead

- **Jurisdiction:** England first. Scotland, Wales and Northern Ireland have different regulatory pathways and need separate product/legal work.
- **Property:** common low-rise freehold houses with legible plans and conventional construction; exclude high-rise, complex leasehold and unusual heritage conditions initially.
- **Project:** extension, loft, garage conversion or internal reconfiguration; no new-build or structural remediation as first use cases.
- **Customer state:** an owner or serious buyer with an active 3–18 month project and access to usable evidence.
- **Service area:** one or two dense local-authority clusters where professional capacity, property archetypes and acquisition relationships are present.

### 2.2 Positioning

The correct category is **trusted residential-transformation platform**, not:

- an AI room restyler;
- a planning-permission probability engine;
- a generic BIM authoring tool;
- a lead marketplace;
- an autonomous architect; or
- a fixed-price contractor from day one.

The user-facing message should focus on continuity and confidence: establish the property, make options understandable, retain the evidence and know what has and has not been verified.

### 2.3 Launch geography scorecard

Select the first cluster only after scoring candidate local authorities from 1–5 on:

| Criterion | Weight | Evidence required |
|---|---:|---|
| Addressable project density | 15% | householder applications, house types, transaction/renovation signals |
| Archetype concentration | 15% | repeatable terraces, semis, detached typologies |
| Founder/customer channel | 15% | direct partner and homeowner access, not inferred demand |
| Architect/survey capacity | 15% | named professionals, appointments, response times and fees |
| Planning-data availability | 10% | machine-readable records, document access and rights |
| OS/property-data suitability | 10% | coverage and licence terms for proposed use |
| Contractor/supply depth | 5% | relevant only after managed delivery |
| Service travel cost | 5% | physical capture/review radius |
| Average project value | 5% | enough value to support trusted service |
| Diversity for evaluation | 5% | includes non-showcase cases and hard negatives |

A weighted score does not replace a founder decision; it makes the assumptions reviewable.

## 3. Users and permissions

### 3.1 Roles

| Role | M1 responsibility | Later responsibility |
|---|---|---|
| Homeowner | owns project intent; uploads evidence; may correct and branch models | client decisions, approvals, procurement and handover |
| Prospective buyer | explores with restricted claims and incomplete evidence | converts to owner/project client after authority is established |
| Operator | supports evidence intake and model correction | measured capture and exception handling |
| Architect/designer | not a professional issuer in M1 | reviews, decides and issues purpose-specific records |
| Surveyor/capture professional | optional pilot reviewer | verifies measured state and resolves discrepancies |
| Engineer/specialist | none in M1 | receives scoped information and issues specialist decisions |
| Contractor/supplier | none in M1 | tenders, submits changes, records work and evidence |
| Organisation admin | manages members and project roles | manages practice/partner permissions and policy |
| Platform support | investigates with explicit, audited access | incident and remediation workflows |
| Machine actor | proposes typed operations only | performs bounded analysis subject to policy and review |

### 3.2 Permission principles

- The server is authoritative; hiding a control in the UI is not authorisation.
- Access is scoped to organisation, project, model branch, asset purpose and professional role.
- Source evidence, committed versions and issued records have different mutation rules.
- Support access is time-bounded, attributable and visible in the audit trail.
- A machine actor cannot issue, verify, approve payment or accept regulated responsibility.
- External identity providers authenticate; the platform owns domain permissions.
- Every export enforces the same access and purpose rules as the source records.

## 4. M1 functional requirements

Requirement IDs are intended to become acceptance-test and traceability identifiers.

### 4.1 Identity, tenancy and projects

- **FR-ID-001:** authenticate through a managed OIDC provider and establish a server-side session.
- **FR-ID-002:** create an organisation and project with stable opaque identifiers.
- **FR-ID-003:** assign project roles through explicit grants; reject cross-tenant access even for guessed identifiers.
- **FR-ID-004:** record actor, organisation, project, correlation ID and request ID for each mutation.
- **FR-ID-005:** support account/data export and deletion-request workflows without deleting records that must be retained for legal or issued-record purposes; classify those exceptions explicitly.

### 4.2 Property identity and dossier

- **FR-PROP-001:** accept full/partial address, postcode or UPRN-like adapter identifier; use deterministic fixtures until a licensed provider is selected.
- **FR-PROP-002:** require explicit user selection where more than one property matches.
- **FR-PROP-003:** retain provider, provider record version, retrieval time and licensing/purpose metadata.
- **FR-PROP-004:** display fact, estimate and unknown separately; missing data must not be defaulted into plausible values.
- **FR-PROP-005:** permit manual correction as a new asserted observation with provenance, not an overwrite of the provider record.
- **FR-PROP-006:** state that address/property data cannot establish exact interior geometry.

### 4.3 Evidence and rights

- **FR-ASSET-001:** upload supported PDFs/images through a presigned or controlled ingestion flow with filename, size and content-type limits.
- **FR-ASSET-002:** require the user to state their authority and intended purpose before processing.
- **FR-ASSET-003:** compute a content hash, retain the original immutable object and create derived previews separately.
- **FR-ASSET-004:** record uploader, source, capture/upload time, terms version and provider licence where applicable.
- **FR-ASSET-005:** quarantine unsupported, encrypted, malformed, malicious or excessively complex inputs.
- **FR-ASSET-006:** provide deletion/retention state without silently breaking dependent snapshots or issued records.
- **FR-ASSET-007:** never train or evaluate a model on customer assets unless a separate permission and governed dataset record allow it.

### 4.4 Plan proposal and correction

- **FR-PLAN-001:** extract vector primitives where available and use a raster adapter only when required.
- **FR-PLAN-002:** require a known length or other scale evidence before treating coordinates as metric.
- **FR-PLAN-003:** return either a typed proposed model with confidence/unknowns or an abstention reason.
- **FR-PLAN-004:** overlay source and proposal and allow opacity/alignment control.
- **FR-PLAN-005:** support correction of levels, wall centre/face geometry, thickness, openings, rooms and labels through typed commands.
- **FR-PLAN-006:** run local and server validation and highlight gaps, invalid polygons, disconnected openings and unsupported topology.
- **FR-PLAN-007:** record correction time, operation count, machine acceptance/rejection and unresolved unknowns for evaluation.

### 4.5 Canonical model and model operations

- **FR-MODEL-001:** represent property, project, evidence, levels, spaces, walls, openings, slabs/roofs where supported, assets, provenance, branches, versions, operations and validation findings.
- **FR-MODEL-002:** use integer millimetres for authoritative linear dimensions and explicit coordinate systems/transforms.
- **FR-MODEL-003:** preserve source value, proposed value, current value, verification state and method where relevant.
- **FR-MODEL-004:** accept mutations only through versioned typed operation schemas.
- **FR-MODEL-005:** require expected branch revision and idempotency key; reject conflicts with machine-readable recovery information.
- **FR-MODEL-006:** preview an operation and its findings before confirmation when it changes geometry.
- **FR-MODEL-007:** append accepted operations and create content-addressed snapshots; do not edit a historical operation in place.
- **FR-MODEL-008:** branch from a specific snapshot, compare versions and restore by creating a new version referencing the restored source.
- **FR-MODEL-009:** replay an operation stream deterministically and verify the resulting snapshot hash.
- **FR-MODEL-010:** support schema/op upcasting or explicit migrations for retained historical versions.

### 4.6 2D and 3D experience

- **FR-VIEW-001:** render a 2D plan from the canonical snapshot, not from separate editor-only geometry.
- **FR-VIEW-002:** expose selection, snapping, constraints, undo/redo within an uncommitted local operation session and explicit commit to server history.
- **FR-VIEW-003:** compile 3D deterministically from the exact snapshot ID and compiler version.
- **FR-VIEW-004:** show source snapshot, compile status, units and quality limitations in the walkthrough.
- **FR-VIEW-005:** support orbit/walk navigation, level visibility and element selection on desktop and a usable touch fallback.
- **FR-VIEW-006:** detect unsupported hardware/browser capability and offer 2D rather than a broken blank canvas.

### 4.7 Provenance, comparison and export

- **FR-PROV-001:** show why a value exists, its evidence, author/machine actor, method, time, confidence and verification state.
- **FR-PROV-002:** show operation history at branch and selected-element level.
- **FR-PROV-003:** distinguish validation from professional verification and issue.
- **FR-EXP-001:** export canonical JSON, a GLB scene and a manifest containing source asset hashes, snapshot hash, compiler version and known limitations.
- **FR-EXP-002:** ensure regenerated derived artifacts either reproduce the recorded hash or produce a new identified version.
- **FR-EXP-003:** require authorisation at export time and record the export event.

### 4.8 AI proposal interface

- **FR-AI-001:** route model calls through a provider-agnostic gateway that records model/provider version, policy version, prompt/template version, tool results, token/cost data and trace ID.
- **FR-AI-002:** retrieve only authorised project context and label untrusted document content.
- **FR-AI-003:** allow the model to emit only registered, versioned tool calls or a response that does not mutate state.
- **FR-AI-004:** validate tool arguments, permissions, expected revision and domain constraints on the server.
- **FR-AI-005:** require user confirmation for geometry mutations and professional confirmation for any future issue workflow.
- **FR-AI-006:** record rejected, edited and accepted proposals for evaluation without assuming permission to train.
- **FR-AI-007:** show a clear refusal/abstention when evidence or authority is insufficient.

## 5. Non-functional requirements

### 5.1 Trust and correctness

- **NFR-T-001:** source, derived and issued objects are separate and have different lifecycle policies.
- **NFR-T-002:** all state-changing APIs are idempotent and safe to retry.
- **NFR-T-003:** model replay, scene compilation and export packaging are deterministic for pinned inputs and tool versions.
- **NFR-T-004:** unknowns remain explicit; no production path converts `null/unknown` into a plausible geometry or regulatory assertion.
- **NFR-T-005:** any externally visible “verified” or “issued” status has attributable human authority, purpose and scope.

### 5.2 Security and privacy

- **NFR-S-001:** encryption in transit and at rest; keys and secrets are managed, rotated and absent from repository/client bundles.
- **NFR-S-002:** least privilege between web, API, workflow, processing and provider-adapter identities.
- **NFR-S-003:** tenant boundary, object-level authorisation and export security are covered by automated negative tests.
- **NFR-S-004:** uploads are considered hostile and processed in isolated, resource-bounded jobs.
- **NFR-S-005:** DPIA, records of processing, retention schedule, subject-rights handling and provider agreements exist before controlled production data.
- **NFR-S-006:** significant automated decisions, if introduced, include information, challenge, representation and human-intervention safeguards.

### 5.3 Reliability and operations

- **NFR-R-001:** production runs in at least two availability zones where the managed service supports it.
- **NFR-R-002:** durable workflows survive worker restart and provider timeout without duplicate domain effects.
- **NFR-R-003:** backups, point-in-time recovery and object-version restoration have tested procedures and evidence.
- **NFR-R-004:** external adapters have deadlines, retries with jitter, circuit breakers, idempotency and a degraded-mode UX.
- **NFR-R-005:** each production release can roll back application code without corrupting forward-compatible retained model data.

### 5.4 Performance budgets for M1

Set exact SLOs after baseline measurement; begin with these product budgets:

- interactive editor input feedback: next animation frame for local previews;
- non-geometry API reads: p95 under 500 ms inside the production region excluding third-party latency;
- domain mutations: p95 under 800 ms for accepted, non-job operations;
- initial web route core content: useful on a normal laptop/mobile connection without waiting for 3D code;
- 3D viewer: lazy-loaded; target 30 FPS on the supported minimum device with a representative M1 house;
- plan/scene jobs: visible queued/running/failed/succeeded state, cancellation where safe and no request-held-open design;
- exports: asynchronous when compilation exceeds the synchronous budget.

These are hypotheses until test fixtures and target hardware are selected.

### 5.5 Accessibility and inclusion

- Meet WCAG 2.2 AA for the web application outside inherently spatial canvas interactions.
- Provide keyboard routes and accessible inspector/forms for all model actions; do not require precise pointer manipulation as the only path.
- Keep status/uncertainty understandable without colour.
- Test English plain-language claims first; defer multilingual regulatory content until reviewed translations exist.
- Make 3D additive: core evidence, version and action functions remain available in 2D/structured views.

## 6. M1 analytics and evaluation

### 6.1 Event principles

- Product analytics never replace the immutable audit log.
- Analytics IDs are pseudonymous and separated from raw evidence.
- Events have a schema/version, purpose, retention and owner.
- Avoid capturing plan contents, addresses, free text or model prompts by default.

### 6.2 Funnel events

Measure:

1. qualified project created;
2. property resolved/ambiguous/abandoned;
3. evidence rights accepted and asset validated;
4. plan job started/succeeded/abstained/failed;
5. calibration completed;
6. first corrected model committed;
7. first deterministic walkthrough opened;
8. branch and typed edit completed;
9. provenance inspected;
10. export produced; and
11. paid or professional next step requested.

### 6.3 Quality measures

- accepted-input rate by archetype and input quality;
- wall/opening/room precision and recall on rights-cleared golden cases;
- metric scale error and topology validity;
- severe-error escape rate;
- calibration error and confidence calibration;
- median/P90 correction minutes and operation count;
- machine-proposal acceptance, edit and rejection rates;
- deterministic replay/compile pass rate;
- professional reuse versus redraw rate;
- user comprehension of status and limitations; and
- support/incident rate per completed model.

### 6.4 Commercial measures

- qualified-lead to paid-session conversion;
- acquisition source and founder time per qualified lead;
- variable processing + correction + professional-review cost;
- gross contribution before central R&D;
- paid transition to the next service stage;
- refunds/complaints and reason; and
- time from intent to useful decision, not merely time in the application.

## 7. Operating model by stage

### 7.1 M1 software/pilot

- Describe output as a correctable model, not a survey or architectural service.
- Use a trained operator for exceptions and record actual effort.
- Establish support, complaint, correction and data-rights procedures.
- Keep professional partners advisory unless a separate appointment explicitly exists.

### 7.2 Architecture practice stage

Before M3 professional issue:

- decide the legal entity and protected-title usage;
- obtain relevant ARB permissions for the company name/use of “architect” where required;
- appoint registered architects and maintain adequate professional indemnity insurance;
- use clear appointments, scope, limitations, reliance and record-retention terms;
- establish quality management, peer review, competency and complaint procedures;
- assign Building Regulations dutyholder roles in writing where applicable and keep them distinct from CDM roles; and
- never present automated pre-checks as the decision of a local planning authority, building control body or engineer.

### 7.3 Managed delivery stage

Add only after evidence supports it:

- a controlled contractor/supplier qualification process;
- structured tender and comparison with exclusions visible;
- change-control and evidence-backed payment milestones;
- site observation scope that does not imply continuous supervision where none exists;
- clear client/contractor/designer responsibilities;
- incident, defect and remediation procedures; and
- cash-flow and working-capital controls.

### 7.4 Selective design-and-build stage

Enter a project type only when there is a written underwriting box covering geography, archetype, value, scope, exclusions, survey quality, engineering needs, suppliers, contingency, programme, margin and remediation reserve. Independent building control remains independent; vertical integration must not erase statutory or professional checks.

## 8. Discovery programme before C1

### 8.1 Research questions

1. At which customer moment is the problem urgent enough to pay: purchase diligence, early renovation intent, measured survey, planning concept or tender rescue?
2. Which evidence do target customers actually possess, and what rights can they grant?
3. What proportion of accepted houses can be modelled usefully without a new visit?
4. How much correction does each input/archetype require, and who can perform it safely?
5. Does the resulting model save a professional time or simply shift work?
6. Which status labels prevent false certainty while retaining conversion?
7. What is the next paid action and who delivers it?

### 8.2 Two-week concierge experiment

- Recruit 8–12 qualified participants from one candidate cluster.
- Obtain explicit research/data terms and rights-cleared evidence.
- Use a clickable journey and manually assisted model-production process.
- Time every step, including hidden professional/operator labour.
- Ask participants to classify what they believe is known, estimated and verified before and after seeing the model.
- Have two independent professionals judge usefulness and necessary rework.
- Charge a meaningful pilot fee or take a refundable deposit tied to a defined deliverable.
- Conduct a disconfirmation review; do not exclude failed/ambiguous cases from the denominator.

### 8.3 Decision thresholds

Set numerical thresholds before recruitment. At minimum define:

- minimum paid conversion among qualified households;
- maximum median/P90 operator correction time;
- maximum severe-error escape rate;
- minimum professional “reuse with bounded correction” rate;
- maximum unsupported/abstained input share for the chosen box; and
- maximum variable cost compatible with the proposed price.

The exact numbers are founder decisions informed by service pricing and target margin; they cannot be truthfully inferred from the dossier.

## 9. Explicit M1 exclusions

- Planning likelihood score or “90% chance” claims.
- Automated permitted-development or Building Regulations determination.
- Structural calculation or wall-removal safety conclusion.
- Energy modelling beyond clearly labelled future integration fixtures.
- Live contractor marketplace, quotation or payment.
- IFC authoring and round-trip BIM editing.
- Android spatial capture.
- Photorealistic/AI video as a core workflow.
- NeRF/Gaussian splat as the canonical model.
- Multi-family, high-rise, listed-building or complex leasehold automation.
- International regulatory logic.

## 10. Definition of product success

M1 succeeds when the team can show, across a predeclared representative evaluation set, that the product creates a model people and professionals understand and reuse; that correction effort has a credible economic path; that severe uncertainty is surfaced; that every material state is reproducible and attributable; and that some qualified customers pay to continue. It does not succeed because one house looks convincing in a walkthrough.

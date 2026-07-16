---
title: Product Vision and User Journeys
document_type: product_definition
status: proposed
as_of: 2026-07-16
---

# 02 — Product Vision and User Journeys

## 1. Product definition

The product is an **AI-native residential transformation workspace and service layer**. It should let a homeowner progress from vague intent to a verified, professionally reviewed, and deliverable project without learning the internal complexity of architecture, planning, BIM, procurement, or construction administration.

The experience has six connected surfaces:

1. **Property Intelligence** — what the platform knows about the address, site, building, history, constraints, and data quality.
2. **Capture and Existing Model** — floor-plan upload, phone scan, photographs, measurements, survey, reconstruction, and correction.
3. **Design Studio** — brief formation, option generation, spatial editing, product and finish selection, analysis, comparison, and collaboration.
4. **Approval and Technical Workspace** — planning, Building Regulations, structural and specialist coordination, document status, decisions, and reviews.
5. **Delivery Control** — scope, bids, programme, payments, changes, site evidence, procurement, snagging, and handover.
6. **Home Record** — as-built model, products, warranties, certificates, maintenance, energy, and future work.

The product should feel like one application while maintaining explicit professional and contractual boundaries.

## 2. Product hierarchy

### Layer 1 — Understand

- Resolve property and jurisdiction.
- Gather public and licensed data.
- Identify constraints, missing evidence, and likely project routes.
- Explain what is known versus inferred.

### Layer 2 — Capture

- Upload plans and documents.
- Scan rooms or arrange survey.
- Validate geometry.
- Create the existing-condition model.

### Layer 3 — Explore

- Establish brief, priorities, household needs, budget, and style.
- Generate and edit design options.
- Compare spatial, cost, planning, light, storage, disruption, and risk trade-offs.

### Layer 4 — Decide

- Record household decisions.
- Resolve open issues.
- Obtain professional review.
- Freeze a version for the next gate.

### Layer 5 — Approve and coordinate

- Prepare planning and technical outputs.
- Manage authority and specialist responses.
- Keep model, drawings, schedules, and assumptions aligned.

### Layer 6 — Procure and deliver

- Produce a structured scope.
- Compare bids on the same basis.
- Manage products, programme, payments, changes, evidence, and defects.

### Layer 7 — Operate

- Preserve the as-built truth.
- Support future maintenance, retrofit, finance, insurance evidence, resale, and later design.

## 3. Homeowner journey: address to initial feasibility

### Trigger

The user is considering a property purchase or renovation and asks:

- “Can I extend this house?”
- “Could this become open plan?”
- “Can I add another bedroom?”
- “What could I do for £75,000?”
- “Will this need planning permission?”

### Experience

1. The user enters the address.
2. The platform resolves the jurisdiction and canonical property identifier where available.
3. A property card is assembled from permitted sources.
4. The interface presents a layered map and simple 3D context.
5. The system identifies likely constraints and missing information.
6. It asks a small number of high-value questions: ownership, property type confirmation, desired work, approximate budget, target timing, occupancy during works, and known alterations.
7. It creates a **pre-feasibility result**, not a promise.

### Output

- property identity and location;
- indicative site/building geometry;
- known planning and heritage constraints;
- relevant EPC or floor-area evidence;
- nearby planning-application context;
- likely capture route;
- preliminary project routes;
- uncertainty and evidence requirements;
- recommendation: self-scan, upload plan, or professional survey.

### UX requirement

Every field must display its status. Examples:

- “Building footprint: authoritative licensed map, retrieved 16 July 2026.”
- “Internal layout: unknown.”
- “Estimated number of storeys: inferred; confirm during scan.”
- “Conservation-area status: sourced from Planning Data; local record should be checked because dataset coverage may be incomplete.”

## 4. Homeowner journey: create the existing-condition model

### Capture choices

#### Plan upload

Accept:

- PDF;
- PNG/JPEG;
- SVG;
- DXF/DWG through a conversion service;
- IFC;
- estate-agent plan uploaded by a user with appropriate rights;
- prior architect drawings uploaded with permission.

The user identifies a known dimension or scale. The platform detects walls, openings, room labels, stairs, fixtures, dimensions, and drawing metadata. It presents uncertainties for confirmation.

#### Guided iPhone scan

Use Apple RoomPlan or a custom capture layer to:

- scan each room;
- recognise walls, doors, windows, openings, and object categories;
- guide the user around occlusions;
- detect incomplete wall coverage;
- merge rooms and floors;
- request reference measurements for quality assurance.

#### Android or non-LiDAR capture

Use guided ARCore depth where supported, structured photographs/video, and manual measurements. Be more conservative about accuracy and route complex cases to professional survey.

#### Professional survey

Offer a bookable service for:

- complex geometry;
- construction-stage output;
- customers without compatible devices;
- projects that require a defensible measured basis;
- situations where remote capture fails quality thresholds.

### Correction experience

The user should not edit BIM. They should answer visual questions:

- “Is this wall continuous?”
- “Which side does this door open?”
- “Confirm this measurement.”
- “These two room scans overlap; align using this doorway.”
- “We could not see behind the fitted wardrobe. Mark as unknown or enter the measurement.”

The system creates an existing-condition model with a quality report.

## 5. Homeowner journey: form the brief

The brief assistant should behave like a thoughtful architect, not a style quiz.

### Inputs

- household members and foreseeable changes;
- accessibility and mobility requirements;
- work-from-home patterns;
- cooking and entertaining behaviour;
- storage needs;
- privacy and acoustic needs;
- daylight and garden priorities;
- existing items to keep;
- aesthetic references;
- budget range and financing constraints;
- acceptable disruption;
- timing and phasing;
- sustainability and energy priorities;
- appetite for planning and construction risk.

### Structured output

The system converts conversation into:

- required spaces;
- preferred adjacencies;
- minimum dimensions;
- priorities and weights;
- hard constraints;
- soft preferences;
- products to retain;
- budget categories;
- unresolved household disagreements;
- approval and professional requirements.

A user should be able to inspect and correct the brief as data, not only as prose.

## 6. Homeowner journey: generate design options

### Option-generation modes

1. **Template adaptation** — adapt proven patterns for a house archetype.
2. **Constraint-based generation** — create layouts satisfying dimensions, adjacency, access, cost, and planning limits.
3. **Human-seeded variation** — an architect defines a design direction; AI explores alternatives.
4. **User-directed editing** — natural-language commands become typed changes.
5. **Style and product variants** — geometry stays fixed while products, finishes, lighting, and furniture change.

### Example request

> “Give me three ways to turn the rear ground floor into a kitchen-dining space. Keep a separate utility, preserve the front reception, improve garden access, and target a total construction budget below £110,000. One option should avoid planning permission if possible, one should maximise space, and one should minimise disruption.”

### Option output

Each option includes:

- plan and axonometric view;
- interactive walkthrough;
- key dimensions;
- gains and losses in area;
- brief satisfaction score with explanation;
- planning route and confidence;
- structural assumptions;
- estimated cost range and confidence;
- disruption and sequence notes;
- daylight and privacy observations;
- unresolved unknowns;
- professional review status.

The system must not collapse these dimensions into an unexplained single score.

## 7. Homeowner journey: immersive visualisation

### Authoritative visualisations

Derived deterministically from the selected model version:

- 2D plan;
- section/elevation where required;
- perspective views;
- browser 3D walkthrough;
- fixed camera-path video;
- AR placement;
- VR review;
- daylight and sun-time variants;
- product and finish variants.

### AI-enhanced media

Useful for:

- mood;
- lived-in scenarios;
- style exploration;
- marketing presentation;
- naturalistic people and atmosphere;
- cinematic transitions.

AI-enhanced outputs must show a visible qualification such as:

> “Illustrative visual generated from Design Version 12. Geometry may be post-processed. Refer to the verified model and drawings for dimensions.”

### Comparison experience

Users should compare options in synchronised views:

- slider or split screen;
- same camera location;
- same time of day;
- same furniture baseline;
- highlighted geometry differences;
- cost and risk deltas;
- decision notes.

## 8. Homeowner journey: professional review

A professional review is not a generic approval button. It should contain:

- reviewed model version;
- declared purpose of the review;
- evidence and assumptions available;
- issues raised;
- required changes;
- limitations;
- reviewer identity, competence, and appointment;
- date and signature/electronic attestation;
- downstream gate unlocked.

Possible review types:

- measured-model review;
- architectural concept review;
- planning review;
- structural concept review;
- technical coordination review;
- Building Regulations Principal Designer review;
- tender issue review;
- construction issue review;
- as-built verification.

The interface should prevent a review for one purpose from being interpreted as approval for all purposes.

## 9. Homeowner journey: planning and approval

### Planning workspace

- route assessment: permitted development, prior approval, full application, listed-building consent, or specialist review;
- policy and constraint retrieval with source/date;
- relevant local precedent search;
- application checklist;
- drawing and document status;
- validation requirements;
- neighbour and party-wall considerations;
- authority questions and response log;
- conditions and deadlines.

The platform may estimate relative planning risk, but the local planning authority remains the decision-maker.

### Building-regulations and technical workspace

- dutyholder and appointment record;
- technical information requirements;
- structural calculations and assumptions;
- fire, ventilation, energy, drainage, accessibility, and other applicable workstreams;
- product evidence;
- coordination issues;
- building-control submissions and responses;
- design-change control.

The product should organise and verify evidence, not imply that a language model is a building-control body.

## 10. Homeowner journey: procurement

### Scope compiler

The selected model and specification generate a structured scope containing:

- demolition;
- structural work;
- envelope;
- roof;
- windows and doors;
- partitions and linings;
- services assumptions and allowances;
- kitchens/bathrooms;
- finishes;
- external works;
- provisional sums;
- client-supplied items;
- exclusions;
- drawings, models, and evidence referenced.

### Bid normalisation

Contractors should bid against the same structured work breakdown. The platform identifies:

- missing line items;
- inconsistent quantities;
- allowances versus fixed items;
- programme assumptions;
- cash-flow profiles;
- exclusions;
- qualifications;
- evidence of competence and insurance;
- historical performance in comparable projects.

The goal is not to select the lowest number automatically. It is to make bids comparable and risk legible.

## 11. Homeowner journey: construction and handover

### Construction dashboard

- contract and approved scope;
- programme and milestones;
- information-release schedule;
- decisions required from the customer;
- site photographs, scans, and inspection evidence;
- requests for information;
- variations and approvals;
- payment applications;
- defects and resolution;
- authority inspections;
- product deliveries;
- safety and access notices.

### Change control

A change request should state:

- originator;
- affected model objects;
- reason;
- cost impact;
- programme impact;
- planning/technical implications;
- required reviewers;
- approval state;
- implementation evidence.

Changes should not be agreed solely through informal chat messages that never reach the model, drawings, price, or programme.

### Handover

- as-built model;
- completion and approval documents;
- product and equipment records;
- operating and maintenance information;
- warranties;
- snagging and defect closure;
- final account;
- photo/scan record;
- maintenance schedule;
- homeowner training where relevant.

## 12. Professional user journeys

### Architect

- review automatically assembled property context;
- verify brief and option logic;
- create or edit design rules;
- inspect model provenance;
- resolve design exceptions;
- issue professional review decisions;
- manage planning and client communication;
- reuse successful patterns without copying unsuitable designs blindly.

The product should reduce drafting, information chasing, and repeated presentation work—not reduce the architect to a rubber stamp.

### Structural engineer

- receive a structured model, sections, spans, proposed removals, and known evidence;
- mark structural assumptions;
- request investigation;
- add calculation references and design objects;
- issue status-specific reviews;
- receive alerts when geometry affecting structure changes.

### Surveyor

- follow a capture plan;
- import point clouds and measured data;
- resolve model questions;
- certify the intended accuracy/use level;
- retain evidence and calibration records.

### Builder

- receive a consistent scope and current model;
- ask structured questions;
- price quantities and work packages;
- submit programme and evidence;
- report concealed conditions against exact locations;
- propose changes with traceable effects;
- close defects with evidence.

### Supplier

- publish product geometry, options, technical data, lead times, cost, carbon, installation constraints, and warranty;
- receive configured orders tied to model objects;
- update substitutions without breaking model provenance.

## 13. Product modules

| Module | Initial function | Blue-sky function |
|---|---|---|
| Property Graph | Address dossier and jurisdiction | Long-lived UK property intelligence layer |
| Capture | Plans and iOS scans | Multi-device, whole-building, continuous site capture |
| Model Studio | Wall/room/opening editor | Full parametric home and project model |
| Brief Agent | Guided requirements | Household decision and preference model |
| Design Compiler | Templates and typed edits | Multi-objective generative architecture engine |
| Visual Studio | Web 3D and renders | Real-time AR/VR and cinematic media |
| Planning Intelligence | Constraints and document workflow | Calibrated precedent/risk models and digital submission adapters |
| Technical Coordination | Review tasks and exports | Model-based compliance and evidence graph |
| Cost Engine | Quantity-derived ranges | Underwritten price, supplier, labour, and risk model |
| Procurement | Structured scopes and bids | Dynamic supplier/contractor network and purchasing |
| Delivery OS | Milestones, changes, evidence | Model-linked site operations and selective principal contracting |
| Home Record | Handover document store | Persistent digital twin and maintenance platform |

## 14. Status language visible to users

Every output should use an unambiguous lifecycle:

1. **Concept** — exploratory; not reviewed for approval or construction.
2. **Estimated** — generated from incomplete evidence.
3. **Existing model captured** — evidence exists but quality may vary.
4. **Existing model verified for stated use** — reviewed against declared tolerance/purpose.
5. **Architect reviewed** — reviewed for the stated design stage.
6. **Planning submitted** — not approved.
7. **Planning approved with conditions** — exact conditions linked.
8. **Technical design in progress** — not construction issue.
9. **Construction issue** — approved for the specified work package and revision.
10. **As built** — verified against completion evidence to a declared level.

This vocabulary reduces the risk that an attractive image or early plan is treated as a final design.

## 15. Feature prioritisation principle

Features should be prioritised by their ability to:

1. reduce a consequential uncertainty;
2. create or improve structured property data;
3. reduce professional or operational work without reducing accountability;
4. improve decision quality;
5. generate evidence needed for a higher-risk service;
6. support repeatable project underwriting;
7. create a durable customer or data advantage.

A feature that creates a viral image but does none of the above may still support acquisition, but it should not drive the architecture of the platform.

## 16. Blue-sky experience examples

### “Show me the future of this house”

The customer enters an address before making an offer. The platform builds a provisional shell, identifies planning context, and shows three plausible expansion paths. It explains that the interior is estimated, lets the buyer upload listing plans, then recalculates options. A purchase adviser or architect reviews the highest-value route.

### “Design to my budget”

The customer defines a hard funding ceiling. The platform produces options with explicit scope bands, provisional sums, and confidence. It explains which design choices create cost volatility and offers a less risky version rather than simply reducing every finish quality.

### “Walk my parents through it”

The customer shares a guided walkthrough with voice narration, captions, accessibility controls, and option comparison. Remote family members can leave decisions tied to rooms and objects.

### “What changed on site?”

A site scan is compared with the current construction model. The system highlights likely deviations and routes them to the correct reviewer. It does not declare defective work without appropriate assessment.

### “Make the completed house a living record”

Every installed product, warranty, inspection, and final dimension is linked to the as-built twin. Years later, a future project starts from better evidence rather than recreating the property from scratch.

## 17. Product-quality test

A strong product does not merely produce a compelling answer. It enables the user to answer:

- What evidence supports this?
- What is uncertain?
- What changed between these options?
- What does this decision affect?
- Who has reviewed it, for what purpose?
- What must happen next?
- What happens if the assumption is wrong?

Those questions should shape every interface, API, model, and operating procedure.

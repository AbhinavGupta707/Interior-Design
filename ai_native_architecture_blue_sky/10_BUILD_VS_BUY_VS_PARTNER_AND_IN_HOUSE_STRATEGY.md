---
title: Build vs Buy vs Partner and In-House Strategy
document_type: capability_strategy
status: proposed
as_of: 2026-07-16
---

# 10 — Build vs Buy vs Partner and In-House Strategy

## 1. The meaning of “fully in-house”

A blue-sky vision can reasonably aim to own the full customer and operating stack. It should not interpret “in-house” as rebuilding every map, database, renderer, payment rail, foundation model, survey device, and professional institution.

The correct objective is:

> Own every capability that determines customer trust, project risk, differentiated learning, and strategic control. Build replaceable adapters around commodity or regulated external infrastructure. Preserve independence where combining roles would create legal, ethical, or safety conflicts.

## 2. Four ownership rings

### Ring 1 — Must own as strategic IP

- canonical home and project model;
- provenance and uncertainty system;
- property-to-project underwriting engine;
- design-operation and option framework;
- customer brief and decision model;
- model-linked cost/scope logic;
- professional review and issue workflow;
- project status and change-control system;
- delivered-outcome data model;
- contractor/product performance graph;
- customer experience and trust/status language;
- evaluation harness and safety gates.

These capabilities create the moat and should not be delegated to a vendor that can change terms or sell the same operating intelligence to competitors.

### Ring 2 — Build and increasingly own

- floor-plan parsing for target UK inputs;
- plan/scan fusion;
- model correction UI;
- UK house-archetype grammar;
- constrained design generation;
- planning and precedent interpretation layer;
- internal cost and risk models;
- deterministic model compiler;
- geometry-safe visual pipeline;
- project underwriting tooling;
- site-progress comparison;
- professional and operational QA analytics.

Start with open source and vendors where useful, but progressively internalise differentiated models and workflows.

### Ring 3 — License, integrate, or commoditise

- address and mapping data;
- land and planning data feeds;
- EPC and LiDAR sources;
- foundation language/vision models;
- cloud compute and storage;
- identity and authentication primitives;
- payment processing;
- email/SMS/calendar;
- e-signature;
- general observability;
- CAD format conversion libraries;
- generic rendering engines;
- product and cost-data feeds.

Maintain abstraction, data portability, and exit plans.

### Ring 4 — Independent or separately accountable

- planning authority decisions;
- building control;
- structural certification;
- specialist conservation, fire, drainage, ecology, or ground advice;
- party-wall appointments as appropriate;
- regulated lending and advice unless separately authorised;
- independent dispute or high-risk review;
- contractor legal responsibilities where contractor remains external.

The customer journey can coordinate these functions without pretending they are internal software modules.

## 3. Capability decision matrix

| Capability | Launch decision | Long-run direction | Reason |
|---|---|---|---|
| Address search | License | Multi-provider adapter | Licensed national data is commodity but essential |
| Property graph | Build | Own | Core join, provenance, and learning layer |
| External building data | License/open sources | Governed source portfolio | Expensive and not differentiating alone |
| Floor-plan parsing | Open-source baseline + build | Own target-domain models | UK production inputs create proprietary advantage |
| Room capture | Apple RoomPlan integration | Build capture QA and fusion | Sensor SLAM is costly; workflow and correction differentiate |
| Photogrammetry | Open-source/vendor | Hybrid internal | Use COLMAP/vendor components; own registration and model fit |
| Canonical model | Build | Own completely | Central strategic asset |
| IFC/glTF/USD | Open standards/libraries | Maintain adapters | Interoperability, not moat |
| Geometry kernel | Open-source/commercial library | Build selected domain layer | Avoid rebuilding computational geometry primitives |
| LLMs | Multi-provider | Fine-tune/distil selected tasks | Foundation models commoditise; domain tools/data matter |
| Design generator | Build | Own | Differentiated capability and risk |
| Planning search | Public/licensed sources | Own interpretation/outcome graph | Raw data is available; structured relevance is moat |
| Cost data | License initial benchmark | Own delivered-cost model | Actual project outcomes determine underwriting |
| Product data | Integrate manufacturers/NBS | Own normalised product graph | Network and configuration value |
| Render engine | Three.js/Unreal/Blender | Own scene compiler | Engines are commodity; model consistency is differentiator |
| AI video | Vendor abstraction | Selected internal research | Fast-moving and not authoritative core |
| Payments | Regulated provider | Orchestrate | Avoid unnecessary regulated infrastructure |
| Finance | Authorised partners | Evaluate later | High regulatory burden and not first moat |
| Architecture practice | Build/hire | Own controlled entity | Professional trust and responsibility |
| Structural engineering | Partner initially | Selective in-house team | Specialist gate; volume may justify later internalisation |
| Survey | Mixed | Likely own key regional teams | Geometry quality is strategically important |
| Construction | Partner/managed | Selective BuildCo | High risk; internalise only proven project classes |
| Building control | Independent | Independent | Public-protection and conflict reasons |

## 4. Why not build every foundation model

A full-stack company should not attempt to train a general language, image, or video foundation model before it has a product and proprietary data advantage.

The differentiated AI assets are likely to be:

- models that parse UK residential plans;
- confidence estimators for capture quality;
- design operation proposal models;
- house-archetype and precedent models;
- cost and project-risk models;
- professional-review copilots;
- contractor performance models.

Use multiple foundation providers behind an internal gateway. Retain the option to fine-tune, distil, or self-host when:

- data sensitivity requires it;
- task volume creates cost advantage;
- latency matters;
- evaluation shows a specialised model is materially better;
- provider terms threaten data/control;
- a model becomes safety-critical and needs tighter validation.

## 5. Why not build raw national mapping first

OS, HMLR, national data portals, and commercial aggregators already invest heavily in data maintenance. The company should build:

- source adapters;
- reconciliation;
- quality warnings;
- rights governance;
- property/project linkage;
- user-relevant interpretation.

Recreating national data collection would consume capital without creating the main customer value.

## 6. Open-source strategy

### Use open source for

- IFC handling: [IfcOpenShell](https://ifcopenshell.org/) and [web-ifc](https://github.com/ThatOpen/engine_web-ifc);
- browser 3D: [Three.js](https://threejs.org/);
- photogrammetry: [COLMAP](https://colmap.org/);
- spatial and database tooling: PostgreSQL/PostGIS, GDAL;
- research baselines: CubiCasa5K, RoomFormer, PolyRoom, ARKitScenes, Structured3D;
- observability and deployment components where operationally appropriate.

### Open-source diligence

For every dependency:

- licence and obligations;
- patent risk;
- model/dataset licence distinct from code licence;
- commercial-use permission;
- attribution;
- copyleft implications;
- maintenance activity;
- security posture;
- export or redistribution constraints;
- ability to fork.

Dataset licences often differ from repository code licences. Do not assume GitHub availability means unrestricted model training.

## 7. Vendor-dependency rules

Every strategic vendor integration should have:

- internal interface contract;
- source and model version logging;
- data-retention and training terms;
- regional processing information;
- cost and rate-limit monitoring;
- fallback/degraded mode;
- export path;
- termination plan;
- benchmark against alternatives;
- customer disclosure where material.

No customer project should become unreadable because a rendering or AI vendor disappears.

## 8. Acquisition versus hiring

### Hire when

- the capability is individual competence or leadership;
- the target company has significant liability or poor data;
- the service can be built with a small senior team;
- cultural integration matters more than customer book;
- valuation reflects legacy revenue rather than strategic assets.

### Acquire when

- a cohesive team and operating process are difficult to recreate;
- the target has rights-cleared, structured project data;
- local reputation and distribution are valuable;
- the customer pipeline supports a territory launch;
- contractor/supplier relationships are transferable;
- claims and professional liabilities are understood and priced;
- technology and data can be integrated.

### Partner when

- demand is variable;
- specialist competence is episodic;
- independence is valuable;
- regulation makes internalisation costly;
- the company lacks enough data to manage the risk;
- the service is not differentiating.

## 9. In-house capability roadmap

### Founding capability

- product/technology;
- registered architecture leadership;
- residential design;
- geometry/model platform;
- property data;
- scan/plan pipeline;
- customer operations;
- legal/PII governance.

### Next capability

- measured survey and model verification;
- planning operations;
- technical design;
- cost and procurement;
- contractor qualification;
- site evidence and quality.

### Later capability

- regional build operations;
- specialist engineering teams;
- standard systems and procurement;
- warranties/remediation;
- finance or insurance integrations;
- property lifecycle services.

## 10. Independence boundaries

Even in the end state, maintain boundaries where independence protects the customer:

- the person reviewing professional adequacy can reject a profitable project;
- planning and building-control decisions are not internal sales approvals;
- high-risk structural review can be independent of the design generator;
- customer complaints can escalate outside the project sales team;
- product recommendations disclose margin and panel constraints;
- contractor performance cannot be edited by account managers to preserve supply;
- AI benchmark failures cannot be waived invisibly.

## 11. Make-versus-buy trigger metrics

Consider internalising a capability when:

- annual vendor cost exceeds credible internal cost plus risk;
- the capability blocks product differentiation;
- vendor error or latency materially harms customer outcomes;
- proprietary data can produce a clear performance advantage;
- data rights or security cannot be solved contractually;
- the provider creates unacceptable concentration risk;
- enough stable volume exists to maintain competence.

Continue partnering when:

- the work is rare and specialist;
- liability exceeds strategic value;
- regulatory authorisation is disproportionate;
- multiple qualified providers preserve resilience;
- the integration is standard and well governed.

## 12. Conclusion

The blue-sky company should aim for complete strategic control of the property, design, risk, and project operating loop. It should not waste capital rebuilding commodity layers or collapse independent professional/public functions into a misleading “all automated” claim.

The mature organisation may own much more than the launch company, but every internalisation decision must improve customer outcomes and risk control—not merely increase reported revenue or satisfy a conceptual preference for vertical integration.

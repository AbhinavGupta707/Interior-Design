---
title: Context and North Star
document_type: product_context
status: proposed
as_of: 2026-07-16
---

# 00 — Context and North Star

## 1. Why this repository exists

The idea began as a note about automated interior design: create an accurate 3D model of a house, let a person walk through it, and allow real-time experimentation with furniture, colours, paintings, finishes, lighting, and structural changes. The concept then expanded in three important directions.

First, the product moved from visual inspiration to **measured spatial representation**. A compelling room image is useful, but it is not enough to decide whether a wall can move, whether a stair works, whether furniture clears a doorway, or whether a builder can price the job. The product therefore needs an editable and confidence-scored model of the property.

Second, the scope moved from a design application to an **architect-like service journey**. The homeowner should not have to understand separate tools for surveys, floor plans, 3D modelling, interior design, planning, building regulations, structural engineering, tendering, product selection, construction, and handover. The platform should guide the user through the decisions in a coherent sequence and explain why an option is good, risky, expensive, or incomplete.

Third, the strategic ambition became a **full-stack architecture and residential-transformation company**, analogous in customer experience—not regulatory structure—to a vertically integrated financial or insurance platform. The company should own the customer relationship and as much of the outcome as is economically and professionally sensible, rather than being a thin visualisation layer or referral marketplace.

This repository retains all three levels:

1. **Immersive design product** — model and visualise a house.
2. **AI-native architectural service** — turn a brief into professionally reviewed, approval-ready, technically coordinated design information.
3. **Full-stack residential transformation company** — coordinate or deliver procurement and construction, then retain the digital twin for the life of the property.

## 2. North-star statement

> Create the most trusted way for a UK homeowner to understand, design, approve, finance, and deliver a change to their home—from an address and initial idea to a verified as-built record—through one intelligent, visual, professionally accountable experience.

The word **trusted** is more important than the word **AI**. In this category, trust comes from:

- accurate representation of what is known;
- visible treatment of what is inferred or unknown;
- professional responsibility at the right stages;
- realistic cost and programme ranges;
- a complete record of decisions and versions;
- delivery evidence;
- remedies when the result deviates from the agreement.

## 3. The target problem

A homeowner planning a meaningful renovation faces a fragmented chain of uncertainty:

- They may not know the current property geometry.
- They do not know which options are physically or legally plausible.
- They struggle to imagine a plan in three dimensions.
- Different professionals produce disconnected drawings, spreadsheets, emails, and reports.
- Early cost advice is often too broad, while detailed pricing arrives after substantial design expenditure.
- Changes are poorly propagated across drawings, quantities, specifications, approvals, and contracts.
- The homeowner must coordinate parties with different incentives and vocabularies.
- Construction reveals hidden conditions that were not visible during design.
- There is rarely a durable, searchable, as-built record after completion.

The product should reduce uncertainty in the correct order rather than simply create more attractive imagery.

## 4. Target users

### 4.1 Primary initial user

A UK homeowner or prospective purchaser of a low-rise freehold house who is considering:

- a rear extension;
- a side-return extension;
- a loft conversion;
- a garage conversion;
- internal wall and room reconfiguration;
- a kitchen, utility, or principal-suite redesign;
- a combined renovation and energy-improvement project.

The best early customer has a meaningful project budget, a real address, a reasonably standard house type, and a need to make decisions before engaging or while coordinating professionals.

### 4.2 Secondary users

- residential architects and architectural technologists;
- interior designers;
- structural engineers;
- measured-survey teams;
- planning consultants;
- builders and design-and-build firms;
- kitchen, bathroom, glazing, flooring, lighting, and furniture suppliers;
- estate agents and buyer advisers;
- lenders, brokers, insurers, and warranty providers;
- local authorities and building-control bodies, only where appropriate and without compromising independence.

### 4.3 Long-run user relationship

The customer should not disappear after the renovation. The property model can support:

- maintenance and replacement schedules;
- warranty records;
- energy retrofit and operational monitoring;
- insurer or lender evidence;
- resale marketing and buyer due diligence;
- future extensions or adaptations;
- accessibility changes;
- emergency and repair history.

This creates the possibility of a persistent **property operating system**, but it must earn that position through accurate records and useful services rather than merely storing a decorative 3D model.

## 5. Jobs to be done

### Functional jobs

- Tell me what is known about my property from its address.
- Help me create or verify an accurate model of the existing home.
- Show me credible options that satisfy my priorities and constraints.
- Let me experience the proposal before I commit.
- Explain planning, structural, technical, cost, and programme implications.
- Help me choose products and materials with real dimensions and prices.
- Create the information required by professionals, authorities, and contractors.
- Help me compare and appoint delivery partners.
- Keep scope, design, cost, decisions, and evidence synchronised.
- Give me a reliable as-built record when the project is complete.

### Emotional jobs

- Reduce fear of making an expensive mistake.
- Make technical information understandable without making it falsely simple.
- Let household members explore and resolve disagreements.
- Replace opaque professional handoffs with a sense of progress and control.
- Build confidence that someone is accountable for the overall journey.

### Social jobs

- Share proposals easily with partners, family, neighbours, professionals, and contractors.
- Demonstrate design quality and value to a lender or future buyer.
- Make the renovation process feel considered rather than improvised.

## 6. Product ambition by horizon

### Horizon A — Design intelligence

- Address-based property dossier.
- Floor-plan upload and parsing.
- iPhone spatial capture.
- Editable 2D/3D model.
- Furniture, finish, lighting, and layout experimentation.
- Browser-based first-person walkthrough.
- AI-guided design review.
- Human architect review.

### Horizon B — Approval and technical coordination

- Planning-constraint and precedent analysis.
- Planning drawings and application workflows.
- Building-regulations information coordination.
- Structural and specialist review workflows.
- Product and specification schedules.
- Quantity and preliminary cost propagation.
- BIM/IFC and professional exports.

### Horizon C — Managed delivery

- Structured scopes of work.
- Contractor matching and bid normalisation.
- Change control.
- Milestone evidence and payments.
- Site capture and progress comparison.
- Procurement and delivery tracking.
- Snagging, handover, and warranty record.

### Horizon D — Selective outcome ownership

- Fixed design packages.
- Underwritten renovation products for known project classes.
- Direct design-and-build contracts in selected territories.
- Standard structural/envelope/product systems.
- Explicit service guarantees and remediation pathways.
- Project-risk reserves and disciplined exclusions.

### Horizon E — Property operating system

- Persistent as-built digital twin.
- Maintenance and retrofit planning.
- Energy and carbon scenarios.
- Insurance, valuation, and financing integrations.
- Product replacement and repair marketplace.
- Consent-based homeowner and property history.

## 7. Blue-sky scope

The blue-sky product may eventually include:

- automatic property context from address;
- guided room and whole-house scanning;
- reconstruction from plans, photographs, video, point clouds, and prior documents;
- generative but constrained layout options;
- conversational design manipulation;
- real product catalogues with dimensions, stock, price, embodied carbon, lead time, and installation constraints;
- daylight, solar, energy, circulation, acoustic, privacy, storage, and accessibility analysis;
- planning-risk and precedent models;
- deterministic walkthroughs and AI-enhanced cinematic presentations;
- AR overlays in the real house and VR review;
- automated document production with professional review;
- contractor, supplier, finance, payment, warranty, and maintenance workflows;
- continuous model updates from site scans and evidence.

Blue-sky does not mean ignoring physics, law, professional competence, data rights, or economics. It means defining the complete end state, then separating:

- what can be built now;
- what can be built after proprietary data is accumulated;
- what requires professional human judgement;
- what requires regulatory permission or a controlled operating entity;
- what should remain independent;
- what may remain fundamentally uncertain.

## 8. Product anti-goals

The company should not become:

1. **A photo restyling toy.** Attractive room images alone are not a defensible or trustworthy renovation product.
2. **A generic chatbot over planning PDFs.** Retrieval is useful, but it does not create a property model, design system, or accountable service.
3. **A lead-generation directory disguised as a full service.** Referrals may be part of the model, but customer expectations must match who owns delivery risk.
4. **A national construction contractor before it can underwrite local variance.** Geographic expansion without operational control is a high-risk failure mode.
5. **A black-box AI that conceals assumptions.** Every design and estimate must expose provenance, status, and uncertainty.
6. **A tool that encourages unqualified structural intervention.** Concept exploration must trigger appropriate professional gates.
7. **A data-scraping business dependent on questionable reuse rights.** Planning drawings, estate-agent plans, and professional designs require a lawful rights strategy.
8. **A BIM product that forces homeowners to behave like BIM managers.** The underlying structure may be sophisticated, while the customer experience remains simple.

## 9. The full-stack analogy—and its boundary

Corgi describes itself as a full-stack insurance carrier that underwrites and issues policies rather than acting only as a broker. Its public materials emphasise underwriting, policy management, servicing, and claims in one platform. See [Corgi](https://www.corgi.insure/) and its [Y Combinator profile](https://www.ycombinator.com/companies/corgi-insurance).

The relevant transferable concept is **ownership of the operating loop**:

- collect high-quality risk data;
- decide which cases fit the underwriting box;
- configure a product;
- price it;
- administer it;
- handle exceptions and adverse outcomes;
- learn from actual performance.

The architecture equivalent is not an architectural licence purchased once and applied nationally. UK architectural services, protected titles, planning, building regulations, dutyholder roles, construction contracts, local building conditions, and professional insurance operate differently. Acquiring an architecture practice can provide talent, reputation, data, and distribution, but it is not directly equivalent to acquiring an insurance risk carrier.

The analogy is strongest at the level of:

- project eligibility;
- risk classification;
- standard products with conditions and exclusions;
- price and contingency;
- service administration;
- claims-like remediation;
- proprietary outcome data.

It is weakest where the built environment contains one-off physical uncertainty and independent public decisions.

## 10. North-star experience

A mature experience might read as follows:

1. The customer enters an address.
2. The platform creates a property dossier and an estimated shell, clearly separating sourced and inferred data.
3. The customer uploads a plan or completes a guided scan.
4. The platform assembles an editable model and asks targeted questions where confidence is low.
5. The customer states an outcome: “Create a brighter ground floor with a utility room, better garden connection, and a total project target below £120,000.”
6. The system creates several constrained options, explains their logic, and identifies unknowns.
7. The customer and an architect review the options in plan, model, walkthrough, and cost form.
8. The selected option passes through planning, technical, structural, and compliance gates.
9. Quantities, specifications, bids, programme, and change control remain connected to the same model.
10. Site evidence updates progress and records variations.
11. The homeowner receives an as-built twin, completion documents, warranties, and maintenance plan.

The product succeeds when the homeowner feels that complexity has been managed—not when complexity has merely been hidden.

## 11. Core success conditions

The company must eventually demonstrate:

- **geometry trust:** critical dimensions and spatial relationships are accurate enough for the declared use;
- **uncertainty calibration:** low-confidence outputs are visibly low confidence;
- **design value:** generated options are materially useful, not cosmetic variants;
- **professional efficiency:** qualified reviewers spend less time on repetitive work and more on judgement;
- **regulatory integrity:** outputs are traceable, current, and reviewed at the appropriate level;
- **cost realism:** estimates become progressively tighter as evidence increases;
- **delivery control:** changes and defects are detected and resolved rather than hidden;
- **unit-economic discipline:** expansion does not convert construction volume into uncontrolled losses;
- **customer trust:** promises, responsibility, exclusions, and status remain understandable throughout the project.

## 12. Questions this repository is designed to answer

- Can a useful 3D model be created from an address alone?
- What additional evidence is required for design, planning, technical work, and construction?
- Which incumbent categories validate the idea, and where is the white space?
- What should the company own in-house?
- What should be licensed, partnered, or kept independent?
- What is the canonical domain model?
- How should AI interact with geometry and rules?
- What is the appropriate infrastructure and API architecture?
- How can planning, cost, product, and contractor data connect to design?
- Which professional and statutory responsibilities cannot be hand-waved away?
- How can the business progress from software to managed service to selective design-and-build?
- What evidence must be obtained before fixed pricing or outcome guarantees?
- Which experiments could invalidate the thesis early?

The remainder of the repository answers these questions while retaining the distinction between source evidence, strategic judgement, and future ambition.

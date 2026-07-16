---
title: Evaluation Metrics, Data Strategy, and Experiments
document_type: measurement_and_research
status: proposed
as_of: 2026-07-16
---

# 13 — Evaluation Metrics, Data Strategy, and Experiments

## 1. Measurement philosophy

The system should not be evaluated primarily on whether an output “looks good.” It must be measured across:

- geometric correctness;
- uncertainty calibration;
- spatial/design usefulness;
- source and policy grounding;
- professional review burden;
- user comprehension;
- cost and programme performance;
- delivery quality;
- safety and customer outcomes;
- business sustainability.

A metric is useful only if it relates to an intended use. A scan may be excellent for visualisation and unacceptable for setting out. Every benchmark result must state the use tier.

## 2. Dataset classes

### D1 — Public/open research datasets

Examples:

- CubiCasa5K;
- ARKitScenes;
- Structured3D;
- selected open floor-plan/reconstruction datasets.

Use for baseline research and pretraining, subject to licence review.

### D2 — Synthetic UK residential data

Generate parametrically:

- terraces, semis, detached houses, bungalows;
- common stair and outrigger patterns;
- extensions and lofts;
- drawing styles and scan noise;
- existing/proposed overlays;
- dimension and text variants.

Synthetic data supports coverage but can hide real-world messiness. Keep a strict real-data test set.

### D3 — Rights-cleared professional corpus

- measured surveys;
- planning and technical drawings;
- BIM models;
- corrected linework;
- professional room/element labels;
- licence and training permission.

### D4 — Customer project evidence

- uploads/scans;
- automated output;
- user corrections;
- professional corrections;
- issued model;
- delivery/as-built comparison;
- explicit training/use consent.

### D5 — Operational outcomes

- planning decisions;
- review time;
- contractor bids;
- estimate/contract/final cost;
- programme;
- changes;
- defects;
- complaints;
- remediation;
- warranty.

D5 is essential for underwriting and cannot be approximated by public floor-plan datasets.

## 3. Dataset governance

Every dataset must have a card containing:

- name/version;
- owner;
- source;
- licence and permitted uses;
- jurisdictions/property types;
- collection dates;
- annotation method;
- personal-data assessment;
- consent basis;
- known biases;
- train/validation/test split policy;
- leakage controls;
- retention/deletion;
- intended and prohibited uses.

Customer deletion and consent changes must propagate to training eligibility and future dataset versions where legally and technically required.

## 4. Geometry metrics

### 4.1 Plan parsing

- wall-segment precision and recall;
- wall centreline distance;
- thickness error;
- opening detection precision/recall/F1;
- opening position and width error;
- room polygon IoU;
- corner position error;
- room-label accuracy;
- scale error;
- room adjacency accuracy;
- topology validity;
- existing/proposed state classification;
- catastrophic-error rate.

Catastrophic errors include:

- missing an entire room;
- connecting non-adjacent spaces;
- losing a stair;
- scaling the plan incorrectly;
- treating proposed work as existing;
- placing an external wall internally.

### 4.2 Scan reconstruction

- point-to-surface residual;
- plane angular error;
- wall length error;
- opening position/size error;
- ceiling-height error;
- room closure error;
- room-to-room transform error;
- cross-floor alignment error;
- coverage percentage;
- unobserved-area detection;
- reference-measure disagreement;
- correction time.

Report median, 90th/95th percentile, and maximum consequential error—not only average.

### 4.3 Model fusion

- conflict detection recall;
- correct source-priority decisions;
- residual error to professional survey;
- number of unresolved conflicts;
- human decisions required;
- incorrect overwrites of higher-authority evidence.

## 5. Uncertainty metrics

- expected calibration error;
- reliability diagrams;
- risk-coverage curves;
- error rate by confidence band;
- abstention usefulness;
- escalation precision/recall;
- user understanding of confidence;
- false-certainty incident rate.

The system should be rewarded for correctly abstaining and routing to survey/professional review.

## 6. Design-generation metrics

### Hard constraints

- no invalid geometry;
- minimum room dimensions where defined;
- adjacency requirements;
- door and circulation clearance;
- product fit;
- planning envelope constraints used in the experiment;
- retained-element protection;
- budget upper-bound handling;
- structural-review triggers.

### Soft outcomes

- brief coverage;
- architect usefulness rating;
- homeowner preference;
- diversity of spatial logic;
- edit distance from accepted option;
- number of professional changes;
- time to accepted option;
- clarity of trade-off explanation;
- design quality review score.

### Avoid vanity metrics

- number of options generated;
- image aesthetic score alone;
- chat length;
- raw model latency without outcome quality.

## 7. LLM and agent metrics

- intent classification accuracy;
- correct object resolution;
- tool selection accuracy;
- schema-valid tool calls;
- invalid operation rate;
- ambiguous request escalation;
- source-grounded answer rate;
- unsupported assertion rate;
- high-risk advice rate;
- human override rate;
- repeated-correction rate;
- task completion;
- cost/latency per successful task.

Run adversarial tests for:

- prompt injection in uploaded documents;
- conflicting household instructions;
- unsafe wall-removal requests;
- requests to hide planning issues;
- requests to issue unreviewed work;
- ambiguous room/object references;
- outdated policy sources;
- malicious contractor messages.

## 8. Planning-intelligence metrics

- correct jurisdiction and authority;
- constraint retrieval recall;
- source freshness;
- local-source verification rate;
- application-route classification;
- relevant precedent precision;
- missing-information detection;
- professional correction rate;
- planning outcome calibration;
- false reassurance rate.

Do not optimise a planning “approval probability” until:

- proposal geometry is structured;
- outcomes and conditions are reliably linked;
- dataset selection bias is understood;
- local-policy change is handled;
- out-of-sample calibration is measured;
- professional and legal review approves the use.

## 9. Visualisation metrics

### Deterministic scene

- geometry parity with canonical model;
- material/product identity;
- camera reproducibility;
- asset completeness;
- frame time;
- load time;
- mobile performance;
- accessibility;
- annotation alignment.

### AI-enhanced imagery/video

- depth consistency;
- segmentation consistency;
- opening and wall preservation;
- product identity preservation;
- temporal consistency;
- camera-path consistency;
- hallucinated-object rate;
- user recognition of illustrative status.

## 10. Professional-efficiency metrics

- time to create existing model;
- correction time;
- design time per option;
- planning package preparation time;
- review time;
- number of review cycles;
- drawing/document inconsistency count;
- time spent on data entry versus judgement;
- professional satisfaction;
- burnout and workload distribution;
- claims/incident rate.

Efficiency is acceptable only if quality and accountability remain stable or improve.

## 11. Customer metrics

### Comprehension

Can the user correctly answer:

- Is this measured or estimated?
- Is this planning approved?
- Has an architect reviewed it?
- Is the cost fixed or a range?
- Does the render guarantee the result?
- Who is responsible for the next stage?

### Outcome

- time to confident decision;
- project progression;
- design satisfaction;
- budget comprehension;
- change-order surprise;
- complaint rate;
- trust score;
- referral rate;
- post-completion satisfaction;
- willingness to retain home record.

### Funnel

- address-to-dossier completion;
- dossier-to-capture;
- capture completion;
- model correction completion;
- design option engagement;
- professional upgrade;
- planning submission;
- tender/build conversion.

Funnel optimisation must not suppress necessary warnings or professional gates.

## 12. Cost and procurement metrics

- quantity accuracy by work package;
- estimate range coverage;
- estimate-to-tender variance;
- tender dispersion;
- scope omission rate;
- allowance/provisional-sum proportion;
- contract-to-final-cost variance;
- change-order frequency/value;
- change cause classification;
- product substitution rate;
- lead-time prediction;
- procurement margin and disclosure;
- customer savings versus comparable baseline.

## 13. Construction and quality metrics

- programme variance;
- milestone pass rate;
- inspection first-pass rate;
- non-conformance rate;
- rework cost;
- defects at handover;
- defects during warranty;
- time to defect closure;
- safety incidents and near misses;
- contractor quality score;
- customer-support load;
- gross margin after remediation.

## 14. Safety and governance metrics

- high-severity incident count;
- near-miss reporting rate;
- safety-warning override rate;
- unreviewed professional output attempts;
- source/rights violations;
- privacy incidents;
- unauthorised access attempts;
- model rollback frequency;
- issue-package integrity failures;
- time to contain/remediate;
- repeat root-cause rate.

## 15. Experimental programme

### E1 — Address dossier usefulness

**Question:** Does address-derived context improve customer and architect feasibility work without creating false confidence?

**Method:** Compare address dossier versus conventional intake on representative properties.

**Measures:** time, relevant issues found, false claims, user comprehension, professional usefulness.

### E2 — Plan parsing and correction

**Question:** For which input classes is automated plan conversion faster than manual redraw?

**Method:** Blind comparison across plan types.

**Measures:** geometry error, correction time, catastrophic errors, professional acceptance.

### E3 — RoomPlan accuracy by archetype

**Question:** Which homes and capture behaviours produce acceptable concept models?

**Method:** User scans followed by professional survey.

**Measures:** dimension/topology error, drift, correction time, escalation prediction.

### E4 — Plan plus scan fusion

**Question:** Does combining approximate plans with scans materially improve accuracy and completeness?

**Method:** Compare plan-only, scan-only, fusion, and survey ground truth.

### E5 — AI-assisted design review

**Question:** Can architects produce acceptable options faster with AI-generated structured alternatives?

**Method:** Randomised crossover study with conventional versus assisted workflow.

**Measures:** time, quality, corrections, client choice, professional confidence.

### E6 — Visual-status comprehension

**Question:** Do users understand the difference between deterministic render and AI-enhanced illustration?

**Method:** Interface variants and comprehension test.

### E7 — Planning assistant

**Question:** Does source-backed AI reduce research time without missing material constraints?

**Method:** Compare against experienced planning review on historical/current cases.

### E8 — Scope and bid normalisation

**Question:** Does model-linked scope reduce omissions and bid dispersion?

**Method:** Tender comparable projects with conventional and structured packages.

### E9 — Cost confidence

**Question:** How does error shrink as evidence moves from address to scan to technical design?

**Method:** Track estimate intervals against tender and final cost.

### E10 — Managed delivery

**Question:** Does the platform reduce change, delay, and defects enough to justify its fee?

**Method:** matched cohort or phased roll-out.

## 16. Model and system cards

Every production model should have:

- purpose;
- owner;
- version;
- provider/base model;
- training/fine-tuning data;
- evaluation results;
- supported jurisdictions/input classes;
- limitations;
- prohibited uses;
- confidence behaviour;
- human-review requirements;
- monitoring;
- rollback plan;
- privacy and security review;
- last approval date.

Every design rule and cost model needs similar versioning.

## 17. Launch thresholds

Do not publish universal numerical thresholds before professional and experimental evidence exists. Define provisional thresholds per use and revise them through governance.

A launch decision should consider:

- accuracy distribution;
- catastrophic error;
- calibration;
- user comprehension;
- professional review time;
- incident severity;
- cost per successful workflow;
- coverage of target archetypes;
- escalation effectiveness.

A model with slightly lower average accuracy but excellent abstention may be safer than a confident model with occasional severe errors.

## 18. Data flywheel

```mermaid
flowchart LR
    A[Property evidence] --> B[Automated model]
    B --> C[User correction]
    C --> D[Professional verification]
    D --> E[Design and approvals]
    E --> F[Cost and delivery]
    F --> G[As-built and outcomes]
    G --> H[Error and risk labels]
    H --> I[Models, rules, underwriting]
    I --> B
```

The flywheel must be consented, governed, and designed for causal learning. A correction is useful only when the system knows why it changed and what downstream outcome resulted.

## 19. Research reproducibility

- version datasets and splits;
- pin code and model versions;
- record hardware/configuration;
- publish benchmark definitions internally;
- retain failed experiments;
- separate test set from customer demos;
- prevent training leakage from repeated properties;
- use independent professional evaluation;
- make launch decisions traceable.

## 20. Measurement conclusion

The company’s most important early metric is not the number of AI-generated designs. It is the proportion of target projects for which the platform can produce a trustworthy, corrected model and a professionally useful option faster than the current process, while accurately identifying when it cannot.

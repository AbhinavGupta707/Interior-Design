---
title: Feasibility, Limitations, Risk, and Safety Gates
document_type: critical_risk_analysis
status: proposed
as_of: 2026-07-16
---

# 11 — Feasibility, Limitations, Risk, and Safety Gates

## 1. Capability feasibility matrix

The ratings below are strategic assessments for the proposed UK product, not certified performance claims.

| Capability | Current feasibility | Primary limitation | Required gate |
|---|---:|---|---|
| Address resolution and property dossier | Very high | licensing, match ambiguity, national variation | data-source quality check |
| Address-derived exterior massing | High | approximate height/roof and stale data | visible inferred status |
| Exact current interior from address | Very low | no comprehensive public interior record | require plan/scan/survey |
| Clean plan to editable 3D | High | scale and symbol variation | user/professional correction |
| Arbitrary plan to editable 3D | Medium | scans, annotations, multiple states/scales | confidence map and fallback |
| Single-room LiDAR scan | High | occlusion, device/user variance | capture-quality threshold |
| Whole-house multi-floor scan | Medium | drift, stairs, alignment, hidden areas | reference measures and review |
| Furniture/material experimentation | Very high | product accuracy and visual truth | product/source labelling |
| Browser walkthrough | Very high | performance and device capability | deterministic scene manifest |
| Photoreal render | Very high | misleading polish | source-version and status label |
| AI cinematic video | High visually | geometric/temporal hallucination | illustrative-only status |
| Conversational model editing | High for typed operations | ambiguity and unsafe side effects | preview, validation, confirmation |
| Automated layout options | High for narrow templates | design quality and constraints | hard-rule checks + architect review |
| Planning constraint summary | High | incomplete/changing data | source/date + professional review |
| Planning probability | Medium | local judgement, dataset bias | calibrated research use only initially |
| Guaranteed planning approval | Not credible | public authority decision | never promise as absolute |
| Concept wall-removal option | Medium-high | hidden structure | mandatory structural escalation |
| Autonomous structural sign-off | Not credible | evidence, liability, professional design | qualified engineer |
| Automated technical drawings | Medium-high for standard work | coordination and applicability | professional issue gate |
| Building Regulations compliance decision | Medium assistance, low autonomy | rule interaction and statutory process | competent dutyholder/building control |
| Quantity-derived estimate | High | specification and hidden work | range + confidence + exclusions |
| Instant fixed build price | Low before verification | scope and existing-condition risk | underwriting and evidence gates |
| Fixed price for narrow verified projects | Medium-high after data | operational variance | territory/product loss history |
| Managed contractor marketplace | High | accountability without full control | qualification and remediation |
| Direct national design-and-build | Low initially | capital, local operations, defects | regional staged expansion |
| Persistent as-built home record | High | capture discipline and data retention | handover verification and consent |

## 2. Fundamental limitations

### 2.1 Observability limit

A completed building hides important information. The system cannot infer with certainty:

- foundations;
- concealed beams and load paths;
- drainage routes;
- electrical/plumbing condition;
- hazardous materials;
- moisture and rot;
- undocumented alterations;
- workmanship quality.

Controls:

- declare unknowns;
- request targeted investigation;
- maintain provisional sums and exclusions;
- update model as evidence appears;
- stop work at defined hold points.

### 2.2 Professional-judgement limit

Architecture involves value judgements that cannot be reduced fully to optimisation:

- contextual appropriateness;
- beauty and meaning;
- household disagreement;
- long-term adaptability;
- heritage significance;
- negotiation with authorities;
- trade-offs without objective weights.

AI can broaden exploration and explain trade-offs, but human design leadership remains valuable.

### 2.3 Regulatory limit

Rules are distributed, change over time, interact, and depend on facts that may be unknown. Public authorities and registered professionals have roles that software does not inherit.

### 2.4 Physical-delivery limit

Construction quality depends on:

- labour;
- supervision;
- material condition;
- weather;
- sequence;
- access;
- workmanship;
- communication;
- inspection.

A perfect model does not build itself.

### 2.5 Economic limit

High service quality may require enough human work that “software margins” are unrealistic. The business must measure actual professional, support, rework, and remediation cost.

## 3. Risk taxonomy

### Product risks

- users misunderstand status;
- generated options are repetitive or poor;
- correction interface is too hard;
- immersive output creates false certainty;
- platform becomes feature-heavy and workflow-confusing.

### Technical risks

- geometry corruption;
- scan drift;
- model/version conflicts;
- stale derived outputs;
- unreliable AI tool calls;
- provider lock-in;
- rendering/GPU cost;
- format conversion loss.

### Data risks

- address mismatch;
- incomplete planning data;
- stale EPC/building attributes;
- licence breach;
- unauthorised training use;
- biased coverage by region/property type;
- data breach exposing home layout.

### Professional and safety risks

- unqualified advice;
- missed structural issue;
- wrong project status;
- dutyholder failure;
- outdated regulation;
- inadequate review;
- AI output rubber-stamped;
- professional-indemnity claim.

### Commercial risks

- expensive customer acquisition;
- low repeat frequency;
- underestimated service cost;
- contractor referral conflict;
- customers use design but build elsewhere;
- supplier margin distorts recommendations.

### Construction risks

- fixed-price underestimation;
- contractor insolvency;
- cash-flow mismatch;
- defects;
- delay;
- safety incidents;
- hidden conditions;
- client changes;
- regional expansion before control.

### Reputation risks

- one severe defect or safety incident;
- misleading “AI architect” claims;
- planning promise failure;
- inaccessible customer support;
- privacy incident;
- professional community distrust.

## 4. Risk register

| Risk | Likelihood early | Impact | Leading indicator | Control |
|---|---:|---:|---|---|
| Address matched to wrong unit | Medium | High | alternative matches, sub-building ambiguity | explicit confirmation and source cross-check |
| Plan parser creates plausible wrong geometry | High | High | low confidence, topology anomalies | overlay correction and known-dimension calibration |
| Scan error exceeds intended tolerance | Medium-high | High | closure error, conflicting reference measures | quality score, tiered use, survey escalation |
| AI moves unintended object | Medium | Medium-high | ambiguous referent | object preview and user confirmation |
| Visual differs from model | Medium | High | mask/depth mismatch | geometry consistency tests and dual output |
| Planning constraint missed | Medium | High | source coverage warning | local-source verification for professional output |
| Structural wall incorrectly treated as removable | Medium | Severe | wall-risk classifier uncertainty | engineer gate; no autonomous claim |
| Fixed price misses hidden work | High | Severe | provisional items, low evidence tier | investigation, exclusions, contingency, decline |
| Contractor fails during project | Medium | Severe | financial/schedule signals | qualification, payment controls, backup plan |
| Customer deposit used unsafely | Low-medium | Severe | working-capital stress | ring-fencing, regulated providers, governance |
| Home data breach | Medium | Severe | unusual access/download | encryption, least privilege, audit, response |
| Unlicensed drawing used for training | Medium | High | missing rights metadata | asset rights gate and dataset governance |
| Professional reviewer rubber-stamps AI | Medium | Severe | implausibly short review, repeat overrides | review telemetry, random audit, competence rules |
| Expansion reduces local quality | High | High | rising variance/complaints | territory gates and pause authority |

## 5. Mandatory safety gates

### G0 — Address dossier gate

Required before showing address-derived conclusions:

- address identity confirmed;
- jurisdiction known;
- source and coverage warnings present;
- internal layout labelled unknown unless evidenced;
- no legal-boundary or planning guarantee language.

### G1 — Existing-model concept gate

Required before design generation:

- minimum geometry coverage;
- scale established;
- room topology valid;
- critical unknowns displayed;
- capture tier recorded;
- customer confirms source-plan/scan alignment.

### G2 — Professional concept gate

Required before architect-branded advice or planning preparation:

- architect reviews brief and selected model;
- structural assumptions flagged;
- planning context reviewed;
- status and limitations issued;
- conflicts and missing evidence documented.

### G3 — Planning issue gate

- correct application route reviewed;
- local source checked;
- drawings derived from fixed model version;
- ownership/certificate and validation information complete;
- issue package signed/approved by responsible professional;
- AI-generated narrative checked.

### G4 — Technical-design gate

- measured basis suitable for purpose;
- dutyholder appointments recorded;
- consultant information coordinated;
- critical products and details specified;
- unresolved safety issues closed or accepted formally;
- model/drawing consistency checks pass.

### G5 — Tender/fixed-price gate

- scope and specification maturity threshold;
- investigations complete or explicit provisional sums;
- quantity review;
- contractor/site/logistics review;
- contingency and exclusions;
- professional issue status;
- underwriting approval.

### G6 — Construction-change gate

- proposed change tied to objects/scope;
- cost and programme impact;
- planning/technical review where needed;
- authorised customer and professional approval;
- updated issue information;
- site implementation evidence.

### G7 — As-built gate

- completion evidence;
- deviations incorporated;
- approvals/certificates linked;
- product/warranty information;
- unresolved defects listed;
- declared as-built verification level;
- homeowner receives export.

## 6. AI safety controls

### Agent permissions

- read-only by default;
- proposals isolated from committed model;
- no professional issue permission;
- no financial release permission;
- no construction instruction to site without authorised workflow;
- scoped tools and project context;
- prompt-injection resistant document handling.

### Validation

- JSON/schema validation;
- geometry/topology validation;
- business-rule validation;
- source citation requirements;
- uncertainty threshold;
- high-risk phrase detector;
- tool-result consistency;
- human approval where required.

### Monitoring

- hallucinated source rate;
- invalid operation rate;
- overridden safety warning rate;
- professional correction rate;
- high-severity incident rate;
- model drift by provider/version;
- user misunderstanding tests.

## 7. Failure-mode scenarios

### Scenario A — Polished but wrong model

A user uploads an approximate estate-agent plan. The system creates a convincing 3D model and the user begins detailed design. A later survey reveals major dimensional differences.

Control:

- classify source as approximate;
- require calibration and explicit use tier;
- show uncertainty watermark;
- prevent fixed products/technical issue until verification;
- make rebase/migration of design options possible.

### Scenario B — Generated open-plan design ignores structure

The AI removes a wall and renders a wide opening. Customer assumes it is easy.

Control:

- wall-removal operation creates structural-risk item automatically;
- render includes concept status;
- cost range contains structural allowance;
- engineer review required before feasibility statement.

### Scenario C — Planning data says “not in conservation area,” local portal disagrees

Control:

- planning-data coverage warning;
- professional workflow checks authoritative local source;
- store conflict and final source;
- update adapter quality metric.

### Scenario D — AI video changes window position

Control:

- deterministic walkthrough displayed alongside AI-enhanced video;
- geometry mask comparison;
- visible illustrative label;
- prohibit AI video from plan/technical decision views.

### Scenario E — Contractor bid is lowest but incomplete

Control:

- structured bid schema;
- missing-scope detection;
- allowances and exclusions comparison;
- contractor performance context;
- human commercial review;
- no automatic lowest-bid selection.

### Scenario F — Fixed-price expansion creates losses

Control:

- pause authority for underwriting team;
- project class and territory loss dashboards;
- capital/risk margin separate from design margin;
- evidence threshold;
- reprice/decline rather than grow volume.

## 8. Lessons from construction-technology failures

### Katerra

Katerra attempted broad vertical integration across design, manufacturing, procurement, and construction, raised substantial capital, and filed for bankruptcy in 2021. See [Reuters](https://www.reuters.com/legal/transactional/softbank-backed-construction-firm-katerra-files-bankruptcy-protection-us-2021-06-07/) and the [Harvard Business School case](https://www.hbs.edu/faculty/Pages/item.aspx?num=61521).

Lesson:

- scale and capital do not remove construction variance;
- integration creates coordination benefits only when operations are disciplined;
- manufacturing and project delivery can amplify fixed costs and working-capital risk.

### Veev

Technology-enabled homebuilder Veev entered insolvency and was later acquired. See [Calcalist](https://www.calcalistech.com/ctechnews/article/rkt3vazwa).

Lesson:

- productised construction still faces capital intensity and market timing;
- controlled systems do not eliminate site, sales, and financing risk.

### Made Renovation

Made Renovation marketed a technology-enabled remodelling experience but faced serious customer complaints and shutdown/bankruptcy. See [TechCrunch’s customer investigation](https://techcrunch.com/2023/08/08/made-renovation-promised-tech-enabled-remodels-customers-describe-absolute-nightmare/) and [shutdown report](https://techcrunch.com/2023/10/18/made-renovation-which-intrigued-then-infuriated-its-customers-is-shutting-down/).

Lesson:

- a polished digital front end can increase customer expectations faster than delivery quality;
- the brand owns the customer experience even when contractors perform the work;
- support, remediation, and cash-flow discipline are core product features.

These cases do not prove that full-stack construction is impossible. They demonstrate that software rhetoric cannot substitute for risk control.

## 9. Red-team questions

- What is the most damaging thing a user could infer incorrectly from this screen?
- Could this output cause a wall to be removed, money to be released, or a planning decision to be relied upon without review?
- What happens when two authoritative sources disagree?
- Can an AI agent alter an issued model indirectly?
- Can a contractor substitute a product without triggering design review?
- Can sales override a decline decision?
- Can a reviewer approve work without opening the evidence?
- Can a household member expose the property model through a public link?
- What happens if the principal contractor fails halfway through?
- What liabilities remain ten years after a project?
- Which metric could look good while customer outcomes deteriorate?

## 10. Kill criteria

Pause or narrow the product if:

- critical model errors are not detectable before professional use;
- correction time approaches or exceeds conventional modelling;
- users consistently misunderstand visual status;
- professional reviewers cannot meaningfully verify AI output;
- safety warnings are routinely overridden to preserve conversion;
- direct-build gross margin becomes negative after defects and support;
- customer deposits or working capital create solvency risk;
- privacy/security controls cannot protect home data;
- the company cannot obtain adequate PII or construction insurance;
- data rights do not permit the intended learning loop.

## 11. Positive gates for expansion

Expand capability only when:

- benchmark accuracy is stable across target archetypes;
- uncertainty is calibrated;
- professional review time falls without higher incident rates;
- planning and cost predictions show out-of-sample performance;
- contractor variance is understood;
- remediation reserves are evidence-based;
- customer comprehension tests pass;
- territory operations meet quality and cash-flow targets;
- governance can stop growth when risk rises.

The product is safe and defensible when its confidence increases with evidence and its promises increase only after controls mature.

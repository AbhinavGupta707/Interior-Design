# Decisions, Risks, Assumptions and Open Questions

## 1. How to use this document

Each unresolved item has a latest responsible point:

- **P0:** resolve before repository activation or first implementation worktrees.
- **P1:** resolve before the affected checkpoint starts.
- **Pilot:** resolve before controlled external users/customer data.
- **M3+:** resolve before professional or delivery responsibility expands.

A planning recommendation is not a founder, legal, insurance or procurement decision. Record the actual answer, owner, evidence, date and reversal trigger in an ADR/product decision log.

## 2. P0 founder/orchestrator decisions

### DQ-001 Repository root and corpus placement — resolved 2026-07-17

**Decision:** initialise Git at `/Users/abhinavgupta/Desktop/Interior Design`, the existing saved Codex project and sidebar group. Preserve `ai_native_architecture_blue_sky/` intact initially and archive/reorganise it only through a later explicit repository migration.

**Reason:** project-scoped Codex worktrees clone the selected project's Git repository. Aligning the Git root, saved project root, root instructions/configuration and monorepo removes discovery and sidebar ambiguity.

**Current state:** `https://github.com/AbhinavGupta707/Interior-Design.git` was verified reachable and empty on 2026-07-16. It can be linked safely after the local root is confirmed; there is no remote history to merge.

**Trade-off:** keeping research aids traceability but increases repository size/noise; splitting it requires a stable source reference and risks drift. Because it is Markdown/JSON, keeping it initially is pragmatic.

### DQ-002 Product/company name and protected title — P0 for branding, M3 for service

**Question:** What is the company/product name, and will it use “architect”/“architecture” in a protected-title context?

**Recommendation:** use a working code name in code and avoid public claims of being an architectural practice until ARB/company-title/legal advice is complete.

### DQ-003 First customer moment — resolved 2026-07-17

**Decision:** a homeowner supplies details/evidence for their own home and expects a personal interior-design-agency experience: understand/reconstruct the home, form a brief, generate and explain alternatives, show editable 2D/3D/photoreal image/video representations, help decide and produce implementation information.

### DQ-004 Launch geography — deferred for live integrations

**Question:** Which one or two local-authority clusters have founder channel, architect/survey capacity and repeatable property types?

**Development default:** synthetic UK residential fixtures, UK units/language and one-to-three-level conventional flats/houses. A real geography is required only before live property/regulatory/provider claims.

### DQ-005 Paid pilot offer — removed from build gate

Define deliverable, price/deposit, turnaround, correction scope, limitations, refund/complaint path and next paid step.

**Decision:** skip paid-concierge validation during product development. Keep demand/correction-economics uncertainty in the risk register; it does not block C0–C18.

### DQ-006 Team and founder advantage — not a C0 blocker

**Question:** Which capabilities already exist: product/engineering, geometry/graphics, ML/CV, UK residential architect, measured survey, regulatory, construction operations, security/privacy and customer acquisition?

**Impact:** unknown founder/team capacity is the largest planning uncertainty. It changes build-vs-partner, checkpoint duration, practice timing and budget.

### DQ-007 Budget and runway — local/minimal-cost default

**Decision:** optimise product development for local, open-source and deterministic fixture paths. Do not provision paid cloud/provider services without a later explicit decision. No delivery-date or staffing claim is inferred from Codex worktree counts.

### DQ-008 Repository/worktree execution authority — resolved for C0

**Decision:** C0 may initialise the selected root, link `AbhinavGupta707/Interior-Design`, create the baseline/scaffolding and use adaptive project-scoped Codex worktree tasks. Destructive actions, paid services, public deployment and customer-data processing remain separately controlled.

## 3. Pre-checkpoint technical/product decisions

### DQ-009 M1 scope — resolved 2026-07-17

**Decision:** M1 includes native iOS capture, photo/video reconstruction, autonomous multi-source full-house proposal, interior-design variants, photoreal stills, deterministic walkthrough video, labelled AI-enhanced media and implementation handoff. M1 still excludes planning/structural/regulatory certainty, fixed prices, contractor appointment/site execution and unreviewed professional issue.

### DQ-010 Identity provider — before C1

Procure/select Auth0, WorkOS, Cognito or another managed OIDC provider based on:

- consumer and future B2B organisation UX;
- MFA/passkey/session/admin capability;
- UK/EU data and processor terms;
- custom domain/email and migration/export;
- pricing at pilot and scale; and
- integration/security track record.

**Default:** implement an OIDC port plus local fixture; do not hard-wire provider-specific roles into domain authz.

### DQ-011 Property/address provider and licence — before C3 live adapter

Confirm exact OS/address/property products, permitted search/display/storage/derived-data use, attribution, caching, training and termination rights. Use fixtures until signed terms match the proposed use. Provider coverage/known issues reinforce the need for explicit unknowns.

### DQ-012 Planning-data provider/rights — before M3/M4

Confirm availability, document access, copyright/database rights, retention, derived training/evaluation rights and authority-by-authority coverage. Public visibility is not blanket commercial reuse permission.

### DQ-013 User-submitted evidence rights — before C2/Pilot

Legal review of upload terms, user authority, processor/controller roles, third-party plan rights, takedown, retention and separate model-training permission.

### DQ-014 Storage retention and Object Lock — before C2 production

Choose retention by source/derived/audit/issued class; legal deletion exceptions; governance bypass roles; recovery and customer-visible deletion state. Do not use compliance-mode Object Lock until legal requirements are clear.

### DQ-015 Temporal adoption — resolved for M1 substrate 2026-07-17

**Decision:** retain Temporal behind a workflow port as the M1 durable-workflow substrate. C0 proved a pinned local development server, health/operator access, persistent local state and clean bootstrap/shutdown. Workflow checkpoints must still demonstrate deterministic replay/versioning, reference-only large payloads, cancellation and operator recovery before their gates close. Domain/job contracts remain transport-neutral so a Postgres-backed queue can replace Temporal if those evidence gates fail.

### DQ-016 Geometry library — before C4

Select after a licence/correctness/performance spike on adversarial integer fixtures. Preserve the kernel interface. Do not choose native/Rust complexity merely for prestige or stay TypeScript-only if robustness evidence fails.

### DQ-017 Canonical IDs/hash/serialisation — before C4

Decide stable ID representation, canonical JSON semantics, hash inputs, collection ordering and schema evolution. This affects every export/replay and cannot drift between lanes.

### DQ-018 Parser baseline — before C6

Decide supported input types, vector-first baseline, whether the initial raster path is rules-based, external inference or internal model, and the benchmark/abstention thresholds. GPU training is not a prerequisite for C6's adapter/mock/evaluation framework.

### DQ-019 Browser/device support — before C10/C18

Name minimum Chrome/Firefox/Safari versions or a documented modern-browser policy, minimum hardware/scene budgets and whether mobile web 3D is supported or degraded to 2D.

### DQ-020 Physical iOS devices — before C7 closes

Confirm access to at least the oldest/current supported LiDAR device and a field-test owner. Xcode Simulator cannot validate RoomPlan.

### DQ-021 AI provider/data policy — before external adapters in C11/C14/C15

Approve providers/models by data class, region/transfer, retention/training, legal terms, cost and fallback. Decide which project data may be sent, whether evidence text/images are allowed and what must be redacted or processed internally.

## 4. Pre-pilot legal, security and operating decisions

### DQ-022 Data protection roles and DPIA — Pilot

Map controller/processor roles, lawful bases, purposes, data subjects, sensitive inferences, retention, subject rights, complaints, transfers and incident response. The Data (Use and Access) Act 2025 changes automated-decision rules but still requires safeguards for significant solely automated decisions; design to provide information, challenge/representation and human intervention where applicable.

### DQ-023 Analytics/recording — Pilot

Decide product analytics provider, pseudonymous schema, consent/cookie treatment, session replay prohibition or masking, retention and access. Default to no session replay and no plan/address/prompt capture.

### DQ-024 Customer terms and consumer claims — Pilot

Review scope, limitations, price presentation, cancellations/refunds, complaints, availability and claims. The current UK consumer enforcement regime materially penalises misleading practices; avoid hidden fees, unsupported approval/savings claims, fake scarcity and deceptive reviews.

### DQ-025 Support and access — Pilot

Name support owner/hours, response targets, correction path, incident escalation and time-bounded support-access approval. Define what support can view by default.

### DQ-026 Recovery objectives — before C10

Choose pilot RPO/RTO and retention. The architecture proposes Multi-AZ, PITR and versioned objects, but recovery commitments require business input and drills.

### DQ-027 Independent security review — Pilot/beta

Commission scope/timing for penetration test and privacy/security review. At minimum include auth/session, tenant/object access, upload processing, signed URLs, AI tool boundary and cloud configuration.

## 5. Professional and vertical-integration decisions

### DQ-028 Legal/practice structure — M3

Will services be delivered by an internal registered practice, a separate regulated entity, partner practices or a software-only workflow? Decide appointments, control, liability, revenue and data sharing.

### DQ-029 Professional indemnity and insurance — M3

Obtain broker/insurer advice on actual services, AI/model use, limits, exclusions, territorial work, subcontractors and record retention. ARB expects practising architects to maintain adequate PII; software disclaimers do not replace appropriate cover for professional services.

### DQ-030 Competency and issue authority — M3

Define who can verify/issue for which project types, jurisdictions and purposes; peer-review triggers; workload limits; continuing competence; conflicts and suspension.

### DQ-031 Dutyholder roles — M3/M4

Map designer/principal designer/principal contractor/client roles for Building Regulations and CDM separately. In England, relevant appointments must be made in writing where required and organisations retain legal responsibility. The platform may track this; it cannot blur it.

### DQ-032 Building control independence — M4+

Choose interfaces/partners while keeping building-control decisions independent. Do not present vertically integrated UX as control over statutory decisions.

### DQ-033 Cost and product data rights — M5

Supplier catalogues, rates and professional cost data require storage/derivation/display/training rights and freshness/version rules. Do not build precise quoting on unlicensed/scraped data.

### DQ-034 Contractor model — M5/M6

Decide marketplace, managed tender, agency, principal contractor or design-and-build role. Each changes consumer/contracts/tax/insurance/cash/fraud/site responsibility. Recommendation: managed tender/delivery first, selective integrated risk only after outcome data.

### DQ-035 Payment/finance — M5+

If collecting/deploying funds, obtain specialist advice and use regulated payment providers; define escrow/safeguarding, fraud, chargebacks, milestone disputes and insolvency exposure. Do not infer authority from a simple Stripe integration.

## 6. Assumptions used in the plan

| ID | Assumption | Confidence | Consequence if false |
|---|---|---|---|
| A-001 | Initial jurisdiction is England | high from corpus | regulatory/product plan must be reworked by jurisdiction |
| A-002 | Initial properties are common low-rise houses | high | geometry, capture and professional scope expand materially |
| A-003 | M1 is a software-led design output, not regulated professional/construction issue | high | PII/practice/issue gates move into C0–C18 |
| A-004 | Users can provide some rights-cleared plan/scale evidence | medium | wedge becomes capture/service-first |
| A-005 | canonical parametric geometry plus separate evidence/appearance layers can support M1 | medium | deeper native CAD/BIM/scan complexity may be required |
| A-006 | TypeScript/Python skills can be staffed | unknown | stack/team plan changes |
| A-007 | paid cloud is not required for local M1 development | medium-high | some provider/GPU capabilities may need local substitutes or later spend |
| A-008 | managed providers remain optional behind local/deterministic adapters | high | local quality may be lower until adapters are enabled |
| A-009 | paid-concierge validation is deliberately deferred | high | demand and correction-economics assumptions remain untested |
| A-010 | Physical LiDAR device access can be obtained before C7 closes | unknown | native capture field gate cannot close |
| A-011 | Provider/customer data licences can support intended product use | unknown | adapters/data flywheel and possibly product scope change |
| A-012 | No existing hidden code repository is the intended target | high from inspected workspace only | plans must map onto that codebase after review |

## 7. Prioritised risk register

Scores are qualitative planning priorities, not actuarial estimates.

| Risk | Likelihood | Impact | Early signal | Mitigation/gate | Owner required |
|---|---|---|---|---|---|
| Correction/verification labour destroys margin | high | critical | high median/P90 correction; professionals redraw | concierge timing; narrow box; abstain; reuse metric; stop/pivot threshold | product + architecture ops |
| Polished output creates false certainty | high | critical | users misclassify estimate/current/verified | status state machine, comprehension tests, claim review, 3D tied to provenance | product + legal/professional |
| Provider/customer rights block reuse/training | medium-high | critical | vague contracts, takedown, non-reproducible corpus | licence register, purpose enforcement, separate consent, fixtures | legal/data governance |
| Professional liability/capacity exceeds control | medium-high | critical | rework, missed reviews, complaint, PII concern | separate practice gate, appointments, competency, peer review, workload controls | practice lead |
| Construction working capital/defects overwhelm company | medium | critical | variations, delays, remediation reserves | managed delivery first; narrow underwriting; reserve/cash model | COO/finance/construction |
| Severe geometry error escapes | medium | critical | wrong wall/opening/scale accepted | calibration, hard negatives, property tests, confidence/abstention, human review | geometry/ML lead |
| Cross-tenant/evidence exposure | medium | critical | IDOR, broad signed URLs/support access | server authz, negative tests, scoped URLs, pen test, audit | security lead |
| Malicious document compromises processor | medium | critical | parser crash/egress/secret access | quarantine sandbox, limits, no secrets/network, patching | security/platform |
| Architecture over-engineering slows validation | high | high | months of infrastructure, no paid case | M1 boundaries, modular monolith, checkpoints, concierge test | CTO/product |
| Incumbents copy visual features | high | high | comparable AI render/editor launches | focus on evidence, workflow, outcome data, service reliability | CEO/product |
| Provider outage/price/coverage degrades product | medium | high | timeouts, gaps, unit cost | adapters, fixtures, circuit/degraded mode, procurement/fallback | platform/procurement |
| AI tool call unsafe or injected | medium | high | invented tool/ID, data exfiltration | registry, permission/domain recheck, untrusted content boundary, evals | AI/security |
| Historical model cannot replay after schema change | medium | high | hash mismatch/upcaster failure | snapshot/op versioning, golden retained replay suite | domain lead |
| 3D performance excludes ordinary devices | medium | medium-high | large GLB, low FPS/blank canvas | budgets, direct mesh generation, lazy/degraded 2D | graphics lead |
| Founder channel/paid willingness absent | medium-high | high | free interest but no deposits/qualified cases | direct paid concierge, partner acquisition, kill/pivot | CEO/product |
| Practice/title/consumer language non-compliant | medium | high | adviser/regulator/complaint concern | protected-title/terms/claim review before public launch | legal/practice |
| Team lacks specialised geometry/architecture/ops depth | medium-high | high | repeated rework, unowned decisions | capability inventory, partner/hire plan, reduce scope | founder |
| Cloud/GPU/provider cost exceeds willingness to pay | medium | medium-high | high cost per accepted model | CPU/vector baseline, batch GPU, cost telemetry and promotion gate | platform/finance |
| Data/model bias performs only on showcase archetypes | high | high | poor hard-negative/region performance | representative split, failures in denominator, calibrated box | data/product |
| Long-term home record becomes unsupported liability | medium | high | provider loss, deletion/transfer conflict | portability, lifecycle/retention/transfer policy before M7 | platform/legal |

## 8. Architecture trade-offs

### Modular monolith

**Pros:** transactional integrity, simpler local development, coherent policy and faster early delivery.
**Cons:** requires enforced module boundaries; high-throughput processing cannot live in the API process.
**Decision:** use modular API plus isolated workers; split only on evidence.

### TypeScript-first geometry

**Pros:** shared domain types, fast UI/server iteration and fewer language boundaries.
**Cons:** robust computational geometry/performance may eventually require native/WASM tools.
**Decision:** define kernel interface, run adversarial spike, escalate to Rust/native only if measured.

### Operation stream + snapshots

**Pros:** audit, branch/replay/restore and reproducible model history.
**Cons:** schema evolution and deterministic reducer discipline are difficult.
**Decision:** limit to canonical model, not universal business event sourcing; retain upcasters/golden replay.

### Temporal

**Pros:** durable retries/waits and explicit workflows for multi-step processing/projects.
**Cons:** new operational/mental model and workflow-version constraints.
**Decision:** short spike and fallback; keep domain truth in Postgres.

### AWS managed stack

**Pros:** London region, mature managed database/object/compute/batch and security controls.
**Cons:** vendor concentration/cost and service-specific IaC.
**Decision:** keep AWS modules optional and disabled during local M1 development; use portable domain/adapters/artifacts and avoid premature multi-cloud runtime work.

### Native iOS capture

**Pros:** best fit for RoomPlan/LiDAR, device capability and field UX.
**Cons:** separate language/app/release, physical-device requirement and Apple-device segment.
**Decision:** native iOS capture is in M1 C7, with simulator application-state tests and mandatory physical-device field evidence; no claim of universal self-capture.

### Buy authentication/models/data

**Pros:** faster and better commodity capability.
**Cons:** data terms, pricing, outages and lock-in.
**Decision:** adapters, procurement gates, pinned versions and safe degraded paths; build differentiated model/provenance/workflows.

## 9. Disconfirming evidence and pivot triggers

The team should actively seek evidence that the thesis is wrong.

### Stop or materially narrow the homeowner wedge if

- qualified participants will not pay a meaningful amount for the initial deliverable;
- usable evidence/rights are too rare in the target segment;
- users repeatedly misunderstand status after workflow/copy iteration;
- accepted-case correction time has no credible route below professional redraw; or
- severe errors escape at an unacceptable rate.

### Pivot to professional workflow software if

- professionals reuse the canonical model and workflow but homeowner acquisition/comprehension is poor;
- practice partners will pay for controlled evidence/version/issue tooling; and
- product value exists without owning consumer demand.

### Pivot to capture/service-first if

- models are valuable but user-supplied plans/scans are too unreliable;
- trained capture has repeatable positive contribution; and
- geography density supports field operations.

### Delay architecture-practice integration if

- PII/appointments/title position is adverse;
- professional review capacity becomes the bottleneck;
- complaints/rework exceed thresholds; or
- software/service boundaries can deliver value through partners first.

### Do not enter D&B if

- delivered-project data is insufficient for underwriting;
- adverse/tail scenarios consume contribution or capital;
- quality/remediation capacity is unproven; or
- responsibility/independence is unclear.

## 10. Recommended decision sequence

1. Initialise and link Git at the resolved `Interior Design` root; preserve the dossier and commit the C0 master prelude.
2. Open the four project-scoped C0 lanes from that commit and merge/verify them in dependency order.
3. Execute C1–C18 sequentially using `08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`; only one checkpoint is open at a time.
4. Use local fixtures/adapters by default; make paid provider, cloud and live data choices only before the affected integration.
5. Acquire and record a supported physical LiDAR device before C7/C18 field gates; use Windows/NVIDIA for C8/C14/C15 CUDA evidence where required.
6. Resolve privacy/rights decisions before real customer media; no customer data is required for scaffold/fixture development.
7. Resolve practice/PII/dutyholder gates before any professional issue or construction responsibility.
8. Revisit demand/unit economics before paid launch, without retroactively blocking engineering checkpoints.

## 11. Minimum decision record template

```markdown
# Decision: <title>

- ID/date/status/owner
- latest responsible point
- context and user/business consequence
- evidence and source versions
- options considered
- decision and rationale
- security/privacy/professional/data-rights impact
- implementation/contract changes
- verification required
- residual risks
- reversal trigger and review date
```

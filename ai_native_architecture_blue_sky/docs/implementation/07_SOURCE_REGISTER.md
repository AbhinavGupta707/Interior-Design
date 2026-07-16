# Source Register and Research Verification

**Research cut-off:** 17 July 2026
**Use:** trace the implementation recommendations to the supplied corpus and current primary sources.
**Caution:** regulatory, legal, insurance, provider-licensing, pricing and software-version matters can change. Recheck at the relevant checkpoint; this register is not legal, insurance or procurement advice.

## 1. Local corpus audit

The inspected workspace contains an unzipped directory, not a ZIP archive. `MANIFEST.json` lists the core research files and their SHA-256 values; the inspected hashes matched. `FULL_RESEARCH_DOSSIER.md` consolidates the core chapters and decisions/assumptions, so it was treated as a convenience copy rather than independent evidence.

### 1.1 Product and market thesis

| Local source | Used for |
|---|---|
| `00_CONTEXT_AND_NORTH_STAR.md` | company north star, trust, scope and strategic framing |
| `01_EXECUTIVE_THESIS_AND_CRITICAL_VERDICT.md` | critical verdict, moat and fatal risks |
| `02_PRODUCT_VISION_AND_USER_JOURNEYS.md` | user journeys, experience layers and initial wedge |
| `03_MARKET_INCUMBENTS_AND_COMPETITOR_MAP.md` | incumbent categories and differentiation |
| `09_FULL_STACK_OPERATING_MODEL_AND_ACQUISITION_STRATEGY.md` | practice/delivery expansion and customer acquisition |
| `10_BUILD_VS_BUY_VS_PARTNER_AND_IN_HOUSE_STRATEGY.md` | strategic ownership boundaries |
| `14_BUSINESS_MODEL_UNIT_ECONOMICS_AND_MOAT.md` | economics, underwriting and durable data loops |
| `18_BLUE_SKY_FRONTIER_PROGRAM.md` | long-term research/options separated from M1 |

### 1.2 Data, domain and architecture

| Local source | Used for |
|---|---|
| `04_UK_PROPERTY_DATA_AND_ADDRESS_TO_3D.md` | property identity, data-source limits and address-to-context distinction |
| `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md` | canonical model, provenance, revisions and derived artifacts |
| `07_AI_3D_RECONSTRUCTION_RENDERING_AND_VIDEO.md` | plan/scan/rendering technology and GPU separation |
| `08_INFRASTRUCTURE_APIS_AND_INTEGRATIONS.md` | provider adapters and cloud/integration concepts |
| `16_API_AND_DOMAIN_SCHEMA_REFERENCE.md` | proposed resource, operation, job and API schemas |

### 1.3 Regulation, risk, execution and evaluation

| Local source | Used for |
|---|---|
| `05_REGULATORY_PROFESSIONAL_AND_DATA_GOVERNANCE.md` | England practice/dutyholder/data governance framing |
| `11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md` | feasibility, limitations and safety gates |
| `12_EXECUTION_ROADMAP_WORKSTREAMS_AND_STAGE_GATES.md` | milestone sequence and stage-gate logic |
| `13_EVALUATION_METRICS_DATA_STRATEGY_AND_EXPERIMENTS.md` | benchmark, correction and outcome metrics |
| `15_CODEX_CLAUDE_IMPLEMENTATION_BRIEF.md` | M1 executable product boundary |
| `17_RESEARCH_BIBLIOGRAPHY.md` | prior bibliography and research leads |
| `AGENTS.md` | non-negotiable engineering/provenance/professional invariants and ownership boundaries |
| `DECISIONS.md` | previously proposed decisions D-001–D-035 |
| `ASSUMPTIONS_AND_OPEN_QUESTIONS.md` | unresolved founder/product/provider questions |
| `README.md` and `CLAUDE.md` | corpus structure, intent and agent instructions |

### 1.4 Local-source limitations

- The corpus is a research/design dossier, not evidence of a validated market, signed provider licence, professional practice, PII, customer channel, delivery team or working software.
- It proposes multiple possible technical approaches; this implementation package selects a concrete baseline but retains decision spikes where evidence is missing.
- Market/competitor/provider statements can age and were verified selectively through current official sources below.
- There is no source ZIP, Git history, code, test fixture, deployed environment or hidden implementation in the inspected workspace.

## 2. UK professional, regulatory, privacy and consumer sources

### Architecture and insurance

- [ARB — Professional Indemnity Insurance](https://arb.org.uk/architect-information/professional-indemnity-insurance/) — practising architects are expected to hold adequate insurance.
- [ARB — PII guidance](https://arb.org.uk/architect-information/professional-indemnity-insurance/pii-guidance/) — adequacy, policy scope, run-off and professional expectations; obtain broker advice for the actual service.
- [ARB — Company registration/title guidance](https://arb.org.uk/architect-information/company-registration/) — verify company use of the protected title before branding/professional launch.

### Building Regulations and construction duties

- [Building Safety Regulator/GOV.UK — Design and building work: meeting building requirements](https://www.gov.uk/guidance/design-and-building-work-meeting-building-requirements) — England dutyholders, competence, written principal designer/principal contractor appointments and distinction from CDM roles.
- [HSE — CDM 2015 responsibilities](https://www.hse.gov.uk/construction/cdm/2015/responsibilities.htm) — health-and-safety dutyholder responsibilities and domestic-client treatment.

### Planning demand context

- [GOV.UK — Planning applications in England, January to March 2026](https://www.gov.uk/government/statistics/planning-applications-in-england-january-to-march-2026) — current official national/local-authority planning statistics. The reported householder grant rate is a population statistic, not an individual project approval probability.

### Data protection and automated decisions

- [ICO — Data protection by design and by default](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/) — privacy/accountability must be designed from the start; current guidance reflects the Data (Use and Access) Act 2025.
- [GOV.UK — Data (Use and Access) Act 2025 privacy changes](https://www.gov.uk/guidance/data-use-and-access-act-2025-data-protection-and-privacy-changes) — summary of changed automated-decision framework and safeguards including information, representation/challenge and human intervention for significant solely automated decisions.
- [Legislation.gov.uk — Data (Use and Access) Act 2025 explanatory notes, automated decision-making](https://www.legislation.gov.uk/ukpga/2025/18/notes/division/10/index.htm) — primary legislative explanation of the amended framework.

### Consumer protection

- [CMA/GOV.UK — Unfair commercial practices guidance](https://www.gov.uk/government/publications/unfair-commercial-practices-cma207/unfair-commercial-practices) — current DMCC Act consumer-practice regime, including drip pricing and fake reviews.
- [CMA/GOV.UK — New consumer protection regime](https://www.gov.uk/government/news/cma-to-boost-consumer-and-business-confidence-as-new-consumer-protection-regime-comes-into-force) — direct enforcement context and significance for claims, pricing and terms.

### Secure AI

- [NCSC — Guidelines for secure AI system development](https://www.ncsc.gov.uk/collection/guidelines-secure-ai-system-development) — secure design, development, deployment and operation lifecycle used in the AI/security plan.

## 3. UK property and geospatial sources

- [OS — Places API overview](https://docs.os.uk/os-apis/accessing-os-apis/os-places-api) — full/partial address, postcode and UPRN search capability; procurement/licensing remains a separate decision.
- [OS — Places API technical specification](https://docs.os.uk/os-apis/accessing-os-apis/os-places-api/technical-specification) — adapter operations and rate-limit/error concepts.
- [OS NGD — Buildings known limitations](https://docs.os.uk/osngd/using-os-ngd-data/os-ngd-buildings/known-limitations) — no single definitive national source for several building attributes and known estimation limits.
- [OS NGD — Current known data issues](https://docs.os.uk/osngd/current-known-data-issues) — missing residential floor counts, incorrect height for some multi-storey/annexe cases and roof-classification confusion. This directly supports treating address/building context as fallible evidence rather than exact interior truth.

Licence, storage, attribution, derived-data and training rights must be confirmed in the signed OS/provider agreement; documentation of an API feature is not the licence decision.

## 4. Spatial capture and 3D standards

- [Apple — RoomPlan overview](https://developer.apple.com/augmented-reality/roomplan/) — camera/LiDAR-based parametric room plans and USD/USDZ output for conceptual workflows.
- [Apple — RoomPlan documentation](https://developer.apple.com/documentation/RoomPlan) — sensors, recognised surfaces/objects and capture framework behaviour.
- [Apple — Scanning rooms of a single structure](https://developer.apple.com/documentation/roomplan/scanning-the-rooms-of-a-single-structure) — multiple rooms, different floors/elevations, continuous/relocalised AR session and merge requirements.
- [Apple — Merging multiple scans](https://developer.apple.com/documentation/roomplan/merging_multiple_scans_into_a_single_structure) — sample requires an iOS device with LiDAR.
- [Apple — Testing in Simulator versus hardware](https://developer.apple.com/documentation/xcode/testing-in-simulator-versus-testing-on-hardware-devices) — Simulator lacks ARKit and does not reproduce camera/device performance; physical-device testing is required.
- [Khronos — glTF registry](https://registry.khronos.org/glTF/) — current glTF 2.0/2.0.1 specification.
- [Khronos — glTF project explorer/validator](https://github.khronos.org/glTF-Project-Explorer/) — official validation tooling used for scene-output QA.
- [COLMAP — Structure-from-Motion and Multi-View Stereo](https://colmap.github.io/) and [CLI](https://colmap.github.io/cli.html) — reproducible sparse/dense photo/video reconstruction and command-line automation baseline.
- [Open3D — reconstruction system](https://www.open3d.org/docs/latest/tutorial/ReconstructionSystem/index.html) — RGB-D fragments, registration, refinement and scene integration baseline.
- [Nerfstudio — documentation](https://docs.nerf.studio/) and [CLI](https://docs.nerf.studio/reference/cli/index.html) — local NeRF/Gaussian-splat research, evaluation, viewer and video/export adapters; appearance output is not canonical geometry.
- [Blender 5 command-line arguments](https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html) — reproducible headless still/animation rendering with CPU, Metal, CUDA or OptiX device selection.

## 5. Codex project and worktree execution

- [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees) — worktrees require a Git repository, copy the selected repository and support parallel tasks in the same project.
- Current Codex project discovery on 17 July 2026 identified `/Users/abhinavgupta/Desktop/Interior Design` as the saved local project/sidebar group. This current-session capability check supports aligning Git and monorepo root to that path.

## 6. Software and API stack sources

- [Node.js — release status](https://nodejs.org/en/about/previous-releases) — on the research date v26 is Current and v24 is LTS; Node recommends production applications use Active or Maintenance LTS.
- [Next.js — App Router documentation](https://nextjs.org/docs/app) and [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — current App Router/React baseline.
- [Fastify — validation and serialisation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) — schema-based request validation/response serialisation and warning that schemas are application code, not user-provided data.
- [OpenAPI Initiative — OpenAPI 3.1.2](https://spec.openapis.org/oas/v3.1.2.html) and [version index](https://spec.openapis.org/oas/) — 3.2 exists, but the plan selects 3.1.2 for compatibility/tooling maturity and records an upgrade decision later.
- [PostgreSQL — 18.4 release notes](https://www.postgresql.org/docs/release/18.4/) and [versioning policy](https://www.postgresql.org/support/versioning/) — current supported baseline at the research cut-off.
- [PostGIS documentation](https://postgis.net/docs/) — geospatial extension reference.
- [Amazon RDS for PostgreSQL updates](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html) — RDS PostgreSQL 18.4 and PostGIS 3.6.3/pgvector 0.8.2 availability at the research cut-off.
- [Temporal — Workflows](https://docs.temporal.io/workflows) — durable workflow semantics underlying the proposed adoption spike; the plan retains a fallback because adoption cost must be proven.
- [Playwright — Browsers](https://playwright.dev/docs/browsers) — Chromium, Firefox, WebKit and branded Chrome/Edge support; closest Safari-adjacent WebKit checks should run on macOS.

## 7. Optional AWS infrastructure sources

- [AWS — S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) — WORM model, versioning requirement and governance/compliance behaviour.
- [AWS — Object Lock considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html) — enablement/permissions and governance bypass implications.
- [AWS — RDS point-in-time restore API](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_RestoreDBInstanceToPointInTime.html) — technical recovery capability; RPO/RTO still require business policy and drills.
- [AWS Batch — GPU workload AMI](https://docs.aws.amazon.com/batch/latest/userguide/batch-gpu-ami.html) — EC2 GPU instance family/AMI path.
- [AWS Batch CLI — GPU resource note](https://docs.aws.amazon.com/cli/latest/reference/batch/submit-job.html) — GPU resources are not available to Batch jobs running on Fargate, supporting the EC2 GPU separation.
- [AWS regional services/global infrastructure](https://aws.amazon.com/about-aws/global-infrastructure/regions_az/) — verify `eu-west-2` service availability and organisational data-location requirements at procurement/deployment time.

## 8. Current competitor/platform verification

These sources confirm that the market is active and feature competition is advancing; they do not validate this startup's demand or economics.

- [Higharc — homebuilding platform](https://www.higharc.com/) — current design/configuration, estimating, visual and permit-document positioning for production homebuilders.
- [Autodesk — Forma Building Design announcement, 7 April 2026](https://adsknews.autodesk.com/en/news/autodesk-design-and-make-intelligence/) — schematic design, cloud data continuity and Revit connection.
- [Autodesk — Forma Building Design product](https://www.autodesk.com/formabuildingdesign) — current schematic design/analysis and native Revit workflow positioning.
- [Resi](https://resi.co.uk/) — current UK residential design/planning/building-regulations and builder-network service positioning; recheck detailed service pages during go-to-market work.

## 9. Evidence-to-recommendation map

| Recommendation | Main evidence |
|---|---|
| Address creates context, not exact interior | local chapters 04/06/11; OS limitations/current issues |
| Canonical model/provenance is the moat | local chapters 01/06/09/14/16; competitor platforms show feature pressure |
| M1 is the complete software-led home-design loop, while professional/construction issue remains gated | user scope amendment; local chapters 02/07/12/13/18; active plan 08 |
| Human professional issue and separate status states | AGENTS, chapters 05/11/16; ARB/BSR/HSE sources |
| Node 24 LTS + current web/API baseline | official Node/Next/Fastify/OpenAPI sources |
| PostgreSQL 18/PostGIS on RDS | official PostgreSQL and RDS release documentation |
| S3 versioning/Object Lock by record class | AGENTS/chapter 06/08 plus AWS Object Lock documentation |
| Physical LiDAR device for RoomPlan | Apple RoomPlan and Simulator/device documentation |
| Plan/photo/video/RoomPlan fusion with separate appearance layers | local chapter 07; Apple, COLMAP, Open3D and Nerfstudio documentation |
| Deterministic plus separately labelled enhanced still/video | local chapter 07; Blender and Nerfstudio documentation |
| Playwright plus branded Chrome/manual user checks | official Playwright browser support and product risk |
| Batch EC2 for GPU, not Fargate | official AWS Batch GPU/Fargate resource documentation |
| AI only through typed tools | AGENTS/chapters 06/07/11/16 plus NCSC secure-AI lifecycle |
| Paid concierge is deferred and not an engineering gate | user scope decision on 17 July 2026; demand/economics remain an explicit risk |

## 10. Re-verification schedule

- **At C0:** Node/Next/Fastify/PostgreSQL/PostGIS/provider versions, licences and security advisories.
- **Before C2/C3:** upload/retention legal terms and signed OS/property provider licences.
- **Before C7:** current RoomPlan APIs, supported LiDAR devices, Xcode/iOS deployment requirements and Apple terms.
- **Before C8/C9:** COLMAP/Open3D/Nerfstudio/driver/container versions, media rights and reconstruction benchmarks.
- **Before C11/C14/C15 external adapters:** model-provider terms, retention/training/region and current NCSC/ICO guidance.
- **Before C18:** ICO/DUAA, CMA consumer guidance, privacy/terms and penetration-test findings.
- **Before M3/M4:** ARB code/PII/company-title guidance, Building Regulations/BSR/HSE guidance and professional appointments.
- **Before M5/M6:** consumer/contracts/payments/finance/insurance/building-control and contractor obligations with specialist advisers.

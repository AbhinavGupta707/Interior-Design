# Verification, Security, Release and User-Simulation Plan

## 1. Quality objective

The system is acceptable only when a representative user can complete the intended journey and the platform can prove what happened, reject unsafe paths, recover from failure and preserve the distinction between context, proposal, current model, verification and issue.

Screenshots and unit-test counts are not sufficient. Verification must cover:

- domain/geometry correctness;
- API/persistence/workflow behaviour;
- tenant/security/privacy boundaries;
- browser/mobile accessibility and user comprehension;
- external provider failure;
- operational recovery; and
- professional/consumer claim boundaries.

## 2. Test strategy

### 2.1 Layered suite

| Layer | Main tools | What it proves |
|---|---|---|
| Static | TypeScript strict mode, ESLint, Ruff, type checker, schema lint, IaC validate | basic correctness, boundaries, unsafe patterns and drift |
| Unit/domain | Vitest; Python pytest | value objects, reducers, policies, adapters and pure transformations |
| Property-based | fast-check or equivalent; Hypothesis in Python | geometry, operation sequences, idempotency, serialisation and invariant coverage |
| Contract | OpenAPI validation/diff, generated-client compile, adapter contract suites | consumers and providers share the frozen schema |
| Integration | real PostgreSQL/PostGIS through isolated containers/resources, object-store adapter, workflow test environment | transactions, migrations, outbox, jobs and storage semantics |
| Security | automated negative suites, SAST/SCA/secrets/container/IaC scans, DAST where safe | tenant, upload, AI, export and supply-chain boundaries |
| Geometry/artifact | golden fixtures, glTF validator, bounds/topology/hash checks | canonical/replay/compiler correctness |
| Component | Testing Library/Storybook or equivalent; Playwright component where suitable | states, accessibility and contract-shaped UI |
| End-to-end | Playwright Chromium/Firefox/WebKit; branded Chrome smoke | real browser journey and integration seams |
| Performance | k6/API load, browser traces, scene benchmarks, job throughput | product and capacity budgets on named profiles |
| Mobile | XCTest/XCUITest plus physical-device RoomPlan field protocol | native UX/sync and actual spatial capture |
| Operations | staging drills, synthetic monitoring, restore/rollback/tabletop | recovery and support readiness |
| Human acceptance | scripted homeowner/operator/professional studies | comprehension, effort, usefulness and service quality |

### 2.2 Fixture classes

1. **Synthetic unit fixtures:** generated, licence-safe and small.
2. **Golden property fixtures:** rights-cleared representative plans/models with expected geometry and known unknowns.
3. **Hard negatives:** ambiguous, incomplete, malformed, unsupported, adversarial and conflicting inputs.
4. **Performance fixtures:** fixed small/typical/large M1 houses and assets.
5. **Field cases:** separately consented properties/device sessions with governed access and retention.

Every non-synthetic fixture has a manifest covering source, owner/rights, allowed purposes, retention, hash, split and whether it may be used for training. “Found online” is not an acceptable test-data status.

### 2.3 Test isolation

- Tests create unique tenant/project namespaces.
- Parallel suites cannot share mutable model branches or object keys.
- Time, IDs and provider responses are controllable where determinism matters.
- Integration databases start from the complete migration chain.
- External providers are mocked for CI; a separately gated staging suite tests licensed sandbox/live adapters.
- No test relies on execution order.
- Retries do not conceal nondeterminism; flaky tests block until triaged or explicitly quarantined with owner/expiry.

## 3. Invariant verification

### 3.1 Mutation invariants

For every operation schema/version:

- authorisation is checked for the exact project/branch/action;
- invalid units, IDs, topology and references are rejected;
- preview does not mutate;
- commit with stale revision conflicts;
- repeated idempotency key has exactly one domain effect;
- operation, new snapshot, audit and outbox are transactionally consistent;
- accepted operation replays to the stored hash;
- undo/restore creates history rather than rewriting it; and
- unknown/provenance states survive round-trip.

Use generated sequences to test branching, conflicting edits, opening hosting, polygon degeneracy, transforms and snapshot cadence.

### 3.2 Evidence invariants

- original bytes and content hash are retained independently of filename.
- derived preview/parser/scene references exact source versions and tool versions.
- rights assertion and terms version precede processing.
- quarantine cannot be read as a trusted source.
- signed access is short-lived and scoped.
- deletion/retention transitions do not leave a valid-looking broken issue/export.
- source and issued records cannot be silently replaced.

### 3.3 Status/authority invariants

- provider/context data cannot set `verified`.
- a machine actor cannot set `verified` or `issued`.
- verification requires person, competency/role where applicable, purpose, scope, time and source/model version.
- issue requires the defined professional workflow and immutable package.
- supersession links old/new records without editing history.
- UI/API/export use the same controlled vocabulary.

## 4. API, database and workflow gates

### 4.1 API

- OpenAPI validates and generated clients are current.
- Breaking diff is prohibited without an explicit version/migration decision.
- examples/fixtures compile against clients.
- every mutation documents idempotency and conflict semantics.
- error codes are stable, safe and do not leak tenant resource existence.
- pagination/load limits are enforced.
- request/response logs redact credentials, tokens, addresses, prompts and evidence content.

### 4.2 Migrations

For each migration:

1. apply from empty database;
2. apply from the previous release fixture;
3. run schema and application tests;
4. verify locks/duration on representative volume;
5. test new application with compatible old schema step where rollout requires it;
6. test backfill idempotency/resume if present; and
7. document forward-repair/rollback constraint.

Never allow two worktree lanes to allocate/edit migrations concurrently.

### 4.3 Durable workflows

Inject failures at every activity boundary:

- worker stops before/after external call;
- provider timeout, rate limit and malformed response;
- duplicate completion signal;
- cancellation during queued/running/finalising;
- workflow code version change;
- object unavailable or permission revoked; and
- database/outbox delivery interruption.

Verify a user-visible final state, no duplicate domain effect, traceable recovery and operator action where automatic recovery ends.

## 5. Upload and parser security

### 5.1 Adversarial input corpus

Include safely generated cases for:

- MIME/extension mismatch;
- truncated/corrupt PDF/image;
- encrypted/password PDF;
- excessive page count/dimensions/pixel count;
- decompression/object/recursive structure bombs;
- embedded files/scripts/links;
- path/control/Unicode filename cases;
- known test malware signature where the scanner supports it;
- parser timeout/memory exhaustion;
- adversarial text that attempts to instruct an AI stage; and
- visually empty/no-scale/contradictory plan.

### 5.2 Processing controls to verify

- quarantine identity has no trusted-source access and processor has no platform secrets.
- network egress is disabled for conversion/parser sandboxes unless a narrowly defined adapter requires it.
- read-only image/container, non-root user and bounded temp storage.
- hard CPU/memory/time/page/pixel limits.
- post-processing schema and geometry validation before proposal publication.
- errors expose safe codes, not library stack or object URLs.

## 6. AI security and evaluation

### 6.1 Threat cases

- document says to ignore policy, reveal context or call an unregistered tool;
- user asks for another project/tenant evidence;
- model invents a tool/version/element ID;
- unit confusion (metres versus millimetres);
- stale branch revision;
- tool arguments are syntactically valid but unsafe in geometry;
- request attempts professional issue, structural advice or payment;
- provider returns prose around/inside malformed JSON;
- prompt/model/provider update regresses abstention; and
- retrieved text contains sensitive data unnecessary to the task.

### 6.2 Required assertions

- retrieval is permission-filtered before model invocation.
- untrusted content is separated/labeled and cannot define system/tool policy.
- only registry tools and pinned schemas pass.
- domain/authz checks run independently of model output.
- proposal expires or revalidates on revision/context change.
- user confirmation links to the exact proposal/preview.
- professional/safety/financial actions remain denied.
- provider routing respects data class and retention agreement.
- logs/evaluation records do not expose raw evidence without approved purpose.

### 6.3 Promotion metrics

Report tool selection/argument accuracy, unsupported abstention, severe unsafe-action attempt rate, confidence where available, latency/cost and user edit/reject/accept rates. Keep adversarial and failed cases in the denominator. A lower-cost/faster model cannot be promoted if severe errors or status/authority failures worsen.

## 7. Browser and user-simulation plan

### 7.1 Tool choice

- Use Playwright in CI for repeatable local/staging assertions across Chromium, Firefox and WebKit.
- Use the in-app browser controller for interactive local UI inspection and debugging.
- Use the user's Chrome connector only when a check genuinely depends on an existing Chrome session, extension or logged-in external provider state.
- Use computer control for native macOS/Xcode/device-pairing/file-picker/download inspection where no safer API/CLI exists.
- Prefer purpose-built APIs/CLI for assertions and data setup; GUI automation verifies the user path, not internal truth.

If a browser/device feature is “missing” or unavailable, diagnose in this order:

1. is the capability/plugin/project registered and discoverable?
2. is it installed and activated through the official flow?
3. is the intended browser/app/device selected and connected?
4. only then inspect permissions, runtime, network and application bugs.

### 7.2 Automated browser matrix

| Project | Every PR | Checkpoint/release | Purpose |
|---|---:|---:|---|
| Playwright Chromium | yes | yes | primary fast e2e and component journey |
| Playwright Firefox | targeted | full M1 | independent engine behaviour |
| Playwright WebKit | targeted | full M1 on macOS runner | Safari-adjacent compatibility |
| Branded Google Chrome | smoke on release | full controlled-pilot path | actual supported Chrome and extension/session cases |
| Mobile emulation | targeted | full core path | responsive/touch product shell, not RoomPlan |

Run browser tests against stable fixture APIs for PR speed and against a production-like deployed release candidate for final acceptance.

### 7.3 Full M1 user journeys

#### UJ-01 Happy path

1. Sign in and create project.
2. Resolve unambiguous fixture property.
3. Inspect context/estimate/unknown distinctions.
4. Accept rights terms and upload valid vector plan.
5. Track job to proposal.
6. enter known dimension and calibrate.
7. correct one wall/opening/room and commit.
8. open deterministic walkthrough.
9. branch; move wall and insert opening through preview/confirm.
10. inspect validation/provenance.
11. compare and restore a version.
12. export/download package and verify visible filename/status.

Assertions connect browser-visible IDs/status to API/audit/snapshot/export hashes.

#### UJ-02 Ambiguous property

Search returns multiple matches; user must select. Cancel/back and manual path work. No hidden first-result selection occurs.

#### UJ-03 Unsupported evidence

Upload is quarantined/rejected with safe explanation; no proposal/model is created; the user can replace the file or request supported help.

#### UJ-04 Parser abstention

Low-quality/no-scale plan yields abstention and next steps. UI never displays invented geometry or a generic failed spinner.

#### UJ-05 Conflict/recovery

Two sessions edit one branch. The stale session receives a conflict, can review current head and reapply intent without losing either history.

#### UJ-06 Provider outage

Property/model provider delay or outage shows bounded retry/degraded state; existing project/model remains usable.

#### UJ-07 Access attack

User A changes URLs/API payloads to Tenant B resource IDs; response does not disclose resource and audit/alert behaviour matches policy.

#### UJ-08 AI attack/unsupported request

Injected document/user request attempts direct issue/unsafe mutation. The UI shows refusal/abstention; no operation is appended.

#### UJ-09 Interrupted job/session

Browser refresh, session expiry and worker restart occur during processing; user can reauthenticate and see one durable job/result.

#### UJ-10 Accessibility

Keyboard-only user completes non-spatial path and uses structured inspector for edits; focus/status errors are announced; 3D is not required for core completion.

### 7.4 Manual browser/computer-use script

For each release candidate:

1. start from a clean, non-admin pilot user;
2. record browser/version, screen size and release SHA;
3. complete UJ-01 in branded Chrome using the same deployment as the pilot;
4. exercise OS file picker and inspect the downloaded export contents/hash using a safe local command;
5. visually check narrow viewport, zoom 200%, dark/light where supported and reduced motion;
6. use keyboard and VoiceOver for the defined accessible route;
7. inspect 2D/3D selection/provenance status at least once;
8. capture only failure evidence or required release artifacts, avoiding customer data; and
9. record pass/fail with issue links and blocker severity.

Computer-use observations supplement automated assertions. They must not be the only proof of tenant isolation, model hash or audit state.

## 8. iOS and Xcode verification

### 8.1 Simulator scope

Use Xcode Simulator for:

- application launch/navigation;
- sign-in fixture/session states;
- project/capture brief and guidance screens;
- permissions messaging (not actual camera/AR behaviour);
- offline, retry, expired session and upload-state UI through injected fixtures;
- dynamic type, VoiceOver labels, orientation and screenshots; and
- supported deployment-target build.

### 8.2 Physical-device scope

RoomPlan requires physical supported LiDAR hardware because the Simulator has no camera/ARKit. Physical tests cover:

- device capability/permission and denial;
- one-room capture;
- large/narrow/cluttered/reflective/poor-light rooms;
- interrupted/background/terminated session;
- multi-room continuation/relocalisation;
- stairs/level changes where in scope;
- offline capture and resumable upload;
- heat/battery/storage/network constraints;
- raw/derived session provenance; and
- comparison/discrepancy workflow through the web.

Every field case records device model, OS, app build, RoomPlan/framework version, environment notes, capture duration, processing result, correction time and residual findings.

### 8.3 Native release gate

- simulator build/UI tests pass;
- physical matrix passes defined capture cases;
- privacy usage descriptions and data handling match behaviour;
- crash-free/energy/storage/network budgets are recorded;
- no raw capture leaks into analytics/crash logs;
- background/resume cannot duplicate authoritative sessions; and
- App Store/internal-distribution configuration is reviewed separately from code correctness.

## 9. Accessibility and comprehension

### 9.1 Automated

- axe or equivalent on product routes/states;
- semantic labels/roles and focus-order component tests;
- keyboard e2e for all non-canvas actions;
- colour contrast and reduced-motion checks; and
- no critical content present only in a canvas or tooltip.

### 9.2 Human

Run moderated tasks with target homeowners/operators. Ask participants, without prompting, to identify:

- what came from the address/provider;
- what the machine proposed;
- what they changed/committed;
- what remains unknown;
- whether any person verified the model and for what purpose; and
- whether the 3D/export is evidence, a design option or an issued record.

Predeclare a pass threshold and revise language/workflow when users misunderstand. A disclaimer in terms and conditions is not a substitute for interface comprehension.

## 10. Performance and resilience

### 10.1 API/load scenarios

- typical project read and audit pagination;
- concurrent independent branch operations;
- stale/conflicting operations;
- upload start/finalise bursts;
- plan/scene job enqueue and status load;
- signed export generation/download; and
- provider slowdown/circuit opening.

Measure p50/p95/p99, errors, DB connections/locks, queue age, memory/CPU and cost. Load fixtures cannot contain customer data.

### 10.2 Editor/viewer profiles

For named minimum/typical/high devices and small/typical/large M1 houses, record:

- route JS and 3D lazy chunk size;
- model/GLB bytes, triangles, draw calls, materials and textures;
- load/first-useful-view time;
- editor operation latency;
- viewer FPS/long tasks/memory; and
- disposal/reload stability.

Do not solve performance by dropping validation, identity mapping or provenance.

### 10.3 Chaos/failure drills

- external property/model provider down/slow;
- object store temporary failure;
- database failover/connection exhaustion in staging-safe form;
- worker termination mid-activity;
- duplicate queue/signal;
- telemetry provider unavailable;
- bad application release requiring rollback; and
- incompatible model/compiler artifact requiring feature rollback.

The expected degraded behaviour, alert and runbook must be defined before the drill.

## 11. Privacy, consumer and professional release checks

Before controlled production data:

- DPIA and data-flow map;
- lawful basis/purpose and data minimisation;
- retention/deletion, subject access and complaint workflow;
- processor/subprocessor agreements and international-transfer review;
- provider/model retention/training settings;
- data-breach response and contact path;
- children/vulnerable-user implications if service can reach them;
- consumer price/fee/subscription/cancellation language;
- no hidden/drip pricing or misleading urgency/review practices;
- claim review for estimated/verified/issued/planning/cost/savings language; and
- accessibility statement/support path.

Before architecture/professional issue:

- company/title and ARB position;
- registered-professional and competency register;
- PII evidence and scope;
- appointment/terms/reliance/complaint process;
- professional QA/peer review;
- Building Regulations/CDM role mapping and written appointments;
- record/issue/retention/supersession protocol; and
- clear independence of building control and specialist decisions.

Legal and insurance advisers must review the actual service; these checks are planning controls, not legal advice.

## 12. CI and supply-chain controls

### 12.1 Pull request

- formatting/lint/type/unit/property tests for affected graph;
- package boundary and OpenAPI/generated drift checks;
- migration validation when present;
- secrets and dependency review;
- SAST/CodeQL-style analysis;
- IaC policy/validate for affected modules;
- container/build provenance and SBOM for changed deployables;
- targeted integration/e2e; and
- ownership review for domain/security/professional paths.

### 12.2 Main/release candidate

- full unit/contract/integration/geometry/security suite;
- full production build and image scan;
- Chromium plus targeted Firefox/WebKit; full engines for release;
- migration upgrade test;
- synthetic deployed M1 journey;
- model/compiler/export golden verification;
- performance comparison against baseline;
- staging recovery/rollback checks per release class; and
- release manifest with code/schema/model/compiler/provider versions.

### 12.3 Dependency policy

- pin through lockfiles/images;
- automated updates with tests and changelog review;
- block known exploitable critical/high issues unless documented compensating control and expiry;
- verify licences, especially geometry/CV/model/dataset dependencies;
- avoid post-install scripts/native binaries without review;
- sign/attest first-party artifacts; and
- retain an inventory/SBOM for incident response.

## 13. Severity and release rule

| Severity | Example | Release decision |
|---|---|---|
| Critical | cross-tenant evidence access, arbitrary code via upload, history/issued-record corruption | stop; no release |
| High | severe geometry presented without abstention, authorisation bypass, unrecoverable data loss path | stop; no release |
| Medium | material workflow failure with safe workaround, accessibility barrier on non-core path | owner/fix plan; pilot go/no-go explicitly decides |
| Low | cosmetic/non-blocking issue | may release with tracked owner |

Any unresolved invariant or professional-status violation is at least High regardless of visual severity.

## 14. Release evidence pack

Every release candidate stores:

- code commit and signed build/image identifiers;
- database/API/domain/op/model/compiler schema versions;
- foundation/parser model/provider/prompt/tool versions;
- fixture/evaluation manifest versions and rights status;
- automated test summaries and exact commands;
- browser/device/manual UAT results;
- security scans/pen-test status;
- migration and restore/rollback results;
- known limitations/open risks with owners/expiry;
- approved claims/terms versions; and
- go/no-go approvers and date.

The evidence pack is an immutable release record and must not contain secrets or unnecessary personal data.

## 15. Controlled-pilot exit criteria

Move beyond the controlled M1 pilot only when:

- severe security/data/status issues are absent;
- the representative model benchmark meets predeclared thresholds;
- correction time and professional reuse show a credible economic path;
- users understand output status/limits;
- provider/data rights are contractually adequate;
- support and recovery drills work;
- complaints/refunds/incidents are within the agreed tolerance and investigated; and
- the next stage has named competent people, budget and legal/insurance gate.

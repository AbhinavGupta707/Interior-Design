---
title: Codex and Claude Code Implementation Brief
document_type: agent_execution_brief
status: proposed
as_of: 2026-07-16
---

# 15 — Codex and Claude Code Implementation Brief

## 1. Mission for implementation agents

Build the first trustworthy technical spine of an AI-native residential architecture platform. The initial system must take a UK property, source evidence, and a floor plan; create a versioned semantic model; allow controlled design edits; and produce a consistent 2D/3D result with complete provenance.

Do not optimise the first implementation for cinematic demos at the expense of model integrity. The first milestone is successful when a developer and architect can answer:

- Which property is this?
- Which source supports each key model object?
- What is observed, inferred, proposed, verified, or unknown?
- Which model version generated this plan and walkthrough?
- Which operations changed it?
- Does the geometry pass validation?
- Can an unauthorised AI agent issue or overwrite professional information? It must not.

## 2. Required reading order

Before implementation, read:

1. `CLAUDE.md` or `AGENTS.md`.
2. `DECISIONS.md`.
3. `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`.
4. `16_API_AND_DOMAIN_SCHEMA_REFERENCE.md`.
5. `08_INFRASTRUCTURE_APIS_AND_INTEGRATIONS.md`.
6. `07_AI_3D_RECONSTRUCTION_RENDERING_AND_VIDEO.md`.
7. `04_UK_PROPERTY_DATA_AND_ADDRESS_TO_3D.md`.
8. `11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md`.

Do not infer settled requirements from blue-sky examples. Check whether a statement is a `SOURCE FACT`, `PROPOSAL`, `HYPOTHESIS`, `ASSUMPTION`, or `OPEN QUESTION`.

## 3. Initial milestone

### Name

`M1: Property + Evidence + Canonical Model + Deterministic Walkthrough`

### User outcome

A test user can:

1. create a project and enter a UK address;
2. receive a mocked or real adapter-backed property identity result;
3. upload a floor-plan image/PDF with a rights declaration;
4. mark one known dimension;
5. receive a machine-proposed wall/room/opening model;
6. correct the model in a 2D editor;
7. commit a model version;
8. view a 3D walkthrough compiled from the same model;
9. create a design branch;
10. move a wall or insert an opening through a typed operation;
11. view validation errors and impact;
12. restore or compare versions;
13. inspect evidence and provenance;
14. export a GLB and a model JSON snapshot.

### Explicitly out of scope for M1

- planning submission;
- structural advice;
- Building Regulations compliance;
- fixed cost estimate;
- contractor marketplace;
- AI cinematic video;
- whole-house autonomous reconstruction;
- professional issue status beyond a mocked workflow;
- direct construction operations.

## 4. System invariants

These invariants override convenience:

1. **No model mutation without an operation record.**
2. **No issued artefact without a source model version.**
3. **No attribute without a provenance state.**
4. **Unknown is allowed.** Do not invent values to satisfy a renderer.
5. **Existing and proposed elements are never conflated.**
6. **AI proposals are isolated until confirmed and validated.**
7. **Every external fact records source, retrieval time, and licence reference.**
8. **Units and coordinate reference systems are explicit.**
9. **Permissions are server-enforced.** Client hiding is not authorisation.
10. **Source evidence is immutable.** Derived files can be regenerated.
11. **Tests cover catastrophic geometry failures, not only happy paths.**
12. **Professional status is purpose-specific.** `verified` alone is invalid without use and reviewer.

## 5. Proposed monorepo

```text
/
├── apps/
│   ├── web/                    # Homeowner and professional web UI
│   ├── admin/                  # Controlled operations/support UI
│   └── ios-capture/            # Added after plan-to-model baseline
├── services/
│   ├── platform-api/           # Modular monolith application API
│   └── ml-api/                 # Python inference and document pipeline
├── workers/
│   ├── plan-parser/
│   ├── model-compiler/
│   └── renderer/
├── packages/
│   ├── domain-model/
│   ├── geometry/
│   ├── provenance/
│   ├── api-contracts/
│   ├── authz/
│   ├── model-operations/
│   ├── validation-rules/
│   ├── scene-schema/
│   ├── ui/
│   └── telemetry/
├── adapters/
│   ├── address/
│   ├── planning-data/
│   ├── epc/
│   ├── lidar/
│   ├── ifc/
│   └── model-provider/
├── research/
│   ├── benchmarks/
│   ├── fixtures/
│   ├── notebooks/
│   └── dataset-cards/
├── infrastructure/
│   ├── terraform/
│   ├── docker/
│   └── environments/
├── docs/
│   ├── adr/
│   ├── runbooks/
│   ├── threat-models/
│   └── api/
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

## 6. Recommended initial technologies

### Web

- TypeScript;
- React/Next.js;
- React Three Fiber/Three.js;
- a robust state/query library;
- SVG or Canvas-based 2D editor initially;
- generated API client from OpenAPI;
- Playwright for end-to-end testing.

### Platform API

- TypeScript with a structured framework or Kotlin, selected by the founding team;
- PostgreSQL/PostGIS;
- object storage;
- Redis only for cache/ephemeral coordination;
- transactional outbox;
- OpenAPI;
- structured logging and OpenTelemetry.

### ML API and workers

- Python 3.12+;
- FastAPI/Pydantic;
- PyTorch;
- OpenCV and vector/PDF tooling;
- geometry operations through tested libraries;
- isolated worker containers;
- reproducible model artefacts.

### Geometry

- domain geometry types in TypeScript/Rust/C++ as appropriate;
- robust polygon library;
- optional Open Cascade/CGAL service for advanced operations later;
- glTF compilation;
- IFC adapter using IfcOpenShell after core schema stabilises.

## 7. Domain implementation order

### Step 1 — Identity and tenancy

Implement:

- `User`;
- `Organisation`;
- `Membership`;
- `Project`;
- `Property`;
- `ProjectRole`;
- permission policy.

Acceptance:

- no cross-project access;
- audit log contains actor and request ID;
- test homeowner, architect, and automated-agent roles.

### Step 2 — Assets and rights

Implement:

- signed upload;
- asset checksum;
- immutable source object;
- malware/file validation hook;
- rights declaration;
- derivation relationship;
- asset status.

Acceptance:

- duplicate assets can be detected by hash;
- derived asset cannot replace source;
- rights metadata required before processing;
- deletion request respects issued/legal-hold policy.

### Step 3 — Canonical model primitives

Implement:

- Building, Level, Space, Wall, Opening, Door, Window;
- local coordinate system;
- element lifecycle: existing/proposed/demolished/as-built;
- attribute provenance;
- model snapshot;
- validation.

Acceptance:

- simple rectangular two-room fixture round-trips through JSON;
- topology is deterministic;
- invalid polygons fail clearly;
- unknown wall thickness is represented without defaulting silently.

### Step 4 — Operation log

Implement typed commands:

- `CreateLevel`;
- `CreateWall`;
- `MoveWallPath`;
- `InsertOpening`;
- `DeleteElement`;
- `CreateSpace`;
- `AssignMaterial`;
- `AttachEvidence`;
- `VerifyAttribute`;
- `CommitVersion`.

Acceptance:

- optimistic concurrency;
- idempotency;
- audit;
- replay to snapshot;
- branch from committed version;
- invalid operation rejected without partial mutation.

### Step 5 — 2D/3D compiler

Implement:

- wall mesh generation;
- opening subtraction or equivalent rendering strategy;
- floor/ceiling surfaces;
- room labels;
- glTF/GLB export;
- scene manifest;
- browser walkthrough.

Acceptance:

- 2D and 3D derive from same snapshot;
- camera and scene version visible;
- compiled GLB has content hash;
- geometry tests compare expected vertices/bounds.

### Step 6 — Plan upload baseline

Implement:

- PDF page/raster selection;
- scale calibration;
- simple line detection or mocked inference adapter;
- proposed geometry overlay;
- confidence per detection;
- correction UI;
- commit into model.

Acceptance:

- source overlay remains visible;
- low-confidence elements are inspectable;
- parser cannot auto-issue model;
- benchmark runner produces metrics and error artefacts.

### Step 7 — AI tool orchestrator

Implement only after deterministic operations exist.

- natural-language intent;
- object candidate resolution;
- tool schema;
- proposal preview;
- validation;
- explicit confirmation;
- audit with model/provider/version.

Acceptance:

- ambiguous request does not mutate;
- agent cannot call professional issue tool;
- geometry validation is mandatory;
- deterministic test prompts cover critical operations.

## 8. Coding standards

### Type and schema discipline

- strict TypeScript;
- no unchecked `any` in domain and API packages;
- runtime schema validation at boundaries;
- generated types from one API/schema source where practical;
- explicit units in names or typed quantities;
- exhaustive enum handling;
- migrations reviewed with rollback/data plan.

### Domain purity

- business logic does not depend directly on UI framework;
- external providers accessed through adapters;
- domain entities do not import cloud SDKs;
- model operations are deterministic and side-effect free until committed;
- geometry routines have property-based tests.

### Error handling

- structured errors with code, user-safe message, and internal detail;
- never catch-and-ignore;
- failed jobs retain diagnostic artefacts;
- partial workflows are resumable;
- retries only for idempotent/transient operations.

### Security

- secrets only from secret manager/environment injection;
- no real customer media in test fixtures;
- signed URLs short-lived;
- validate content, not only extension;
- redact sensitive logs;
- agent tools use least privilege;
- dependency and container scanning in CI.

### Accessibility

- keyboard-accessible 2D/3D controls where feasible;
- non-3D alternative for core information;
- captions/transcripts for narrated output;
- status conveyed by text and icon, not colour alone;
- accessible error and review flows.

## 9. Test strategy

### Unit tests

- geometry primitives;
- topology;
- operation validation;
- provenance transitions;
- permissions;
- rights policy;
- costless deterministic compilers.

### Property-based tests

Generate random valid/invalid room and wall configurations. Test:

- no negative dimensions;
- operation replay equivalence;
- branch isolation;
- polygon validity;
- export/import stability within tolerance.

### Golden fixtures

Store small, rights-safe synthetic properties with:

- source plan;
- expected model;
- expected 2D output;
- expected GLB bounds;
- validation results.

### Integration tests

- upload to processing job;
- parser result to correction to commit;
- model commit to scene export;
- permission boundaries;
- event/outbox delivery;
- provider failure and retry.

### End-to-end tests

- homeowner onboarding;
- upload/calibrate/correct;
- branch and edit;
- compare versions;
- architect review request;
- share link expiry;
- data export/delete request.

### Security tests

- malicious PDF/CAD archive;
- prompt injection in document text;
- path traversal;
- cross-tenant ID guessing;
- expired signed URL;
- privilege escalation;
- tampered issue artefact.

## 10. Initial API use cases

Use `16_API_AND_DOMAIN_SCHEMA_REFERENCE.md` as the normative proposal. The first client flows should use:

- `POST /v1/projects`
- `POST /v1/properties:resolve-address`
- `POST /v1/projects/{id}/assets:prepare-upload`
- `POST /v1/projects/{id}/plan-processing-jobs`
- `GET /v1/jobs/{id}`
- `POST /v1/projects/{id}/models`
- `POST /v1/models/{id}/operations:propose`
- `POST /v1/models/{id}/operations:commit`
- `POST /v1/models/{id}/versions`
- `POST /v1/model-versions/{id}/scene-jobs`
- `GET /v1/model-versions/{id}/provenance`

## 11. First 12 implementation epics

1. Monorepo, CI, local environment, formatting, lint, test harness.
2. Identity, organisations, project tenancy, permissions.
3. Asset upload, checksums, rights, immutable storage.
4. Property identity and mocked/real address adapter.
5. Canonical model schema and migrations.
6. Geometry/topology library.
7. Operation log, snapshots, branching.
8. 2D plan viewer/editor.
9. glTF compiler and 3D walkthrough.
10. Plan-processing job and confidence overlay.
11. Provenance inspector and review-status UI.
12. Evaluation benchmark runner and telemetry.

Only then add natural-language operations.

## 12. Definition of done for an epic

- product behaviour implemented;
- API/schema documented;
- unit and integration tests;
- permission tests;
- audit/telemetry;
- error and retry behaviour;
- accessibility consideration;
- threat-model delta reviewed;
- migration/backfill plan if data changes;
- source/licence entry for new data/provider;
- no unresolved critical lint/type errors;
- acceptance demonstrated on synthetic fixture;
- ADR written for consequential architecture decision.

## 13. Agent behaviour rules

Implementation agents must:

- state assumptions in code/ADR/issues;
- inspect existing decisions before introducing frameworks;
- prefer small reviewable changes;
- add tests with every domain change;
- not fabricate external API fields;
- use provider interfaces and mocks when credentials/docs are absent;
- never represent a mock as a production integration;
- preserve user work and model history;
- stop and mark a blocker when legal/professional definition is required;
- avoid implementing unsafe professional claims as placeholders.

Agents must not:

- bypass permission checks for convenience;
- hard-code secret keys;
- use uncontrolled AI output as persisted geometry;
- create a `verified: true` boolean without purpose/reviewer/evidence;
- infer exact interiors from address data;
- silently assign default wall thickness or floor height as fact;
- overwrite a committed or issued version;
- make planning/structural guarantees in UI copy;
- ingest customer files into a training set by default.

## 14. Initial ADR list

Create architecture decision records for:

- ADR-001 Canonical model versus IFC as primary store.
- ADR-002 Operation log and snapshot strategy.
- ADR-003 Coordinate and unit system.
- ADR-004 Geometry library/kernel.
- ADR-005 Asset immutability and content addressing.
- ADR-006 Provenance and verification schema.
- ADR-007 Modular monolith boundaries.
- ADR-008 AI tool permission model.
- ADR-009 Web scene format and compiler.
- ADR-010 Address/data adapter and licence strategy.
- ADR-011 Rights and training-consent separation.
- ADR-012 Professional issue artefact signing.

## 15. Research tasks agents may execute

- evaluate open-source plan parsers on synthetic and rights-cleared fixtures;
- benchmark glTF compiler performance;
- prototype RoomPlan import schema;
- compare IFC mappings;
- develop property-based geometry tests;
- evaluate provider models through the internal gateway;
- document external API contracts from official sources;
- create reproducible notebooks for metrics.

Research code should not be merged into production packages without:

- licence review;
- tests;
- deterministic interface;
- error handling;
- owner;
- performance/security assessment.

## 16. M1 acceptance scenario

A reviewer opens a synthetic 1930s semi project. The project contains:

- a mocked UPRN-backed property record;
- an uploaded plan asset with rights metadata;
- a parser proposal containing confidence values;
- corrected rooms, walls, doors, and windows;
- a committed existing-model version;
- a design branch with one moved partition;
- validation output;
- a browser walkthrough and GLB;
- provenance links from model objects to plan asset and user edits;
- an audit log;
- no professional or construction claim.

The reviewer can reproduce the scene from the model version and verify that reverting the operation restores the original geometry.

That scenario is the foundation on which planning, cost, professional review, and full-stack operations can safely be built.

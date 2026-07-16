# Codex and Implementation-Agent Instructions

## Scope

This repository defines an AI-native, full-stack residential architecture and renovation platform. The first executable objective is a provenance-aware plan-to-3D model and controlled design workspace, not autonomous construction.

## Read order

- `README.md`
- `DECISIONS.md`
- `15_CODEX_CLAUDE_IMPLEMENTATION_BRIEF.md`
- `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`
- `16_API_AND_DOMAIN_SCHEMA_REFERENCE.md`
- `08_INFRASTRUCTURE_APIS_AND_INTEGRATIONS.md`
- `11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md`

## Non-negotiable invariants

1. Every model mutation is a typed, audited operation.
2. Every model attribute has provenance or is explicitly unknown.
3. Existing, proposed, and as-built states remain separate.
4. AI can propose but cannot professionally issue.
5. Every derived artefact identifies its source model version.
6. Address/public data does not establish the exact interior.
7. Source evidence and issued artefacts are immutable.
8. Verification is purpose-specific and human-attributable.
9. Permissions are enforced on the server.
10. Training permission is separate from service-processing permission.

## Coding expectations

- strict typing;
- runtime schema validation;
- explicit units/CRS;
- deterministic domain logic;
- idempotent APIs and jobs;
- optimistic concurrency for model edits;
- property-based geometry tests;
- integration and security tests;
- structured errors;
- OpenTelemetry-compatible traces/logs/metrics;
- ADRs for major choices;
- no secrets or customer data in fixtures.

## Research expectations

- Prefer official primary sources and current documentation.
- Record source, date, licence, and known limitations.
- Do not fabricate external API behaviour.
- Treat vendor capability/accuracy as a claim until benchmarked.
- Treat open-source code and datasets as separately licensed artefacts.
- Mark experiments as research; do not merge notebooks into production paths silently.

## Safety boundaries

Do not implement UI or copy that:

- guarantees planning approval;
- declares a wall non-load-bearing without engineer review;
- presents AI video as dimensional truth;
- gives a fixed build price from an unverified model;
- describes unreviewed AI output as architect approved;
- hides uncertainty or commercial incentives.

## Work protocol

For each task:

1. Locate relevant file/decision.
2. Identify assumptions and affected risks.
3. Propose a minimal implementation plan.
4. Implement with tests.
5. Run relevant checks.
6. Report changed files, tests, limitations, and follow-up decisions.

## Repository boundaries

- `/packages/domain-model` owns core domain types.
- `/packages/geometry` owns deterministic geometry/topology.
- `/packages/provenance` owns evidence/status semantics.
- `/packages/model-operations` owns typed changes.
- external systems live behind `/adapters`.
- AI provider calls go through one model gateway.
- workers do heavy processing but do not bypass domain validation.

## Definition of done

A feature is not done until it has:

- acceptance criteria;
- schema/API update;
- domain and permission tests;
- telemetry;
- error/retry behaviour;
- documentation;
- threat-model consideration;
- no false professional or regulatory claim.

# Claude Code Project Instructions

## Mission

Build a trustworthy AI-native residential architecture platform whose source of truth is a structured, versioned, provenance-aware home model.

Read before coding:

1. `DECISIONS.md`
2. `15_CODEX_CLAUDE_IMPLEMENTATION_BRIEF.md`
3. `06_CANONICAL_HOME_MODEL_AND_SYSTEM_ARCHITECTURE.md`
4. `16_API_AND_DOMAIN_SCHEMA_REFERENCE.md`
5. `11_FEASIBILITY_LIMITATIONS_RISK_AND_SAFETY_GATES.md`

## Priority

Geometry integrity, provenance, permissions, and reproducibility outrank visual novelty.

## Hard rules

- Never infer an exact interior from an address.
- Never persist AI-generated geometry without a typed operation and validation.
- Never mutate an issued or committed version in place.
- Never use `verified: true` without reviewer, purpose, evidence, scope, and date.
- Never collapse existing, proposed, demolished, and as-built states.
- Never turn a renderer fallback into a factual building dimension.
- Never allow an AI agent to issue professional information, release money, or make a safety-critical decision.
- Never use customer files for training by default.
- Never invent fields for an external API. Use official documentation or a clearly labelled mock adapter.
- Never bypass server-side authorisation.

## Implementation style

- Prefer a modular monolith and isolated workers initially.
- Keep domain packages independent from UI and cloud SDKs.
- Use strict types and runtime validation at boundaries.
- Use explicit units and coordinate systems.
- Use append-only model operations with snapshots.
- Make external providers replaceable through adapters.
- Keep source evidence immutable and content-addressed.
- Add tests for catastrophic geometry and permission failures.
- Write ADRs for consequential architectural choices.

## Required behaviour for each change

1. Identify the relevant decision and domain boundary.
2. State assumptions.
3. Make the smallest coherent change.
4. Add or update schemas and API contracts.
5. Add unit/integration/security tests.
6. Add telemetry and meaningful errors.
7. Update documentation/ADR.
8. Do not claim an integration is production-ready when it is mocked.

## Initial milestone

Implement `M1: Property + Evidence + Canonical Model + Deterministic Walkthrough` from `15_CODEX_CLAUDE_IMPLEMENTATION_BRIEF.md`.

Do not begin planning submission, structural advice, fixed pricing, contractor marketplace, or AI video until M1 invariants and benchmarks are working.

## Agent tools

AI tools are assigned side-effect classes:

- `READ_ONLY`
- `PROPOSE`
- `MUTATE_REVERSIBLE`
- `MUTATE_CONTROLLED`
- `ISSUE_PROFESSIONAL`
- `FINANCIAL`
- `SAFETY_CRITICAL`

Claude may implement and test all classes, but runtime AI agents must not execute the final three without deterministic policy and authorised human approval.

## Security and privacy

Home layouts, photographs, occupancy, valuables, and household information are sensitive. Use least privilege, short-lived links, encryption, redacted logs, immutable audit, and explicit rights/consent.

## Status language

Use precise statuses such as:

- concept;
- estimated;
- captured;
- verified for stated use;
- architect reviewed;
- planning submitted;
- planning approved with conditions;
- technical coordination;
- construction issue;
- as built.

Do not use “approved,” “accurate,” “safe,” or “buildable” without specifying by whom, for what purpose, and on what evidence.

# Codex and Worktree Instructions

## Product objective

Build the M1 Complete Home Design System defined in `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`.

The product accepts home details and multimodal evidence, creates an uncertainty-aware canonical home model, supports native iOS capture and autonomous multi-source reconstruction, runs an agency-quality interior-design workflow, generates editable design variants and geometry-consistent media, and produces an implementation handoff.

## Required reading

1. `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`
2. `ai_native_architecture_blue_sky/docs/implementation/00_MASTER_IMPLEMENTATION_PLAN.md`
3. `ai_native_architecture_blue_sky/AGENTS.md`
4. the active checkpoint contract and `docs/orchestration/LEDGER.md`

## Worktree protocol

- Only the orchestrator opens checkpoints and freezes shared contracts.
- Use project-scoped Codex worktree tasks for implementation lanes.
- Launch every implementation lane explicitly with `gpt-5.6-sol`: use `high` reasoning for bounded or straightforward work and `xhigh` reasoning for complex architecture, security, geometry, inference, concurrency or cross-surface integration work. Record the choice in the checkpoint contract and ledger before launch.
- One worker exclusively owns every editable path named in its prompt.
- Do not edit root manifests, lockfiles, `.github/**`, `.codex/**`, accepted ADRs, shared OpenAPI/generated clients, migration registry or orchestration ledger unless the prompt explicitly transfers one named file.
- Do not start a later checkpoint before the current checkpoint is merged, integrated, verified and documented.
- Preserve unrelated/user-owned changes. Never reset, discard or rewrite them.

## Product invariants

1. Every canonical mutation is a typed, authorised, audited operation.
2. Every model attribute has evidence/provenance or is explicitly unknown.
3. Existing, proposed and as-built states remain distinct.
4. Source evidence is immutable; derived artifacts identify exact source/model/tool versions.
5. Reconstructed or generated geometry is a proposal until validated and committed.
6. Appearance fields, splats, renders and video never become canonical dimensional truth.
7. AI may propose but cannot bypass permissions, geometry validation, confirmation or professional boundaries.
8. Address/context data does not establish the exact interior.
9. Training permission is separate from service processing and defaults to denied.
10. No UI may claim structural, regulatory, cost, availability or professional certainty without the required evidence and accountable reviewer.

## Engineering standard

- strict typing and runtime validation;
- explicit integer units/coordinate systems/tolerances;
- deterministic domain logic and content/version hashes;
- idempotent APIs/jobs and optimistic concurrency;
- property-based geometry tests and severe-error cases;
- server-side permissions and tenant isolation;
- safe media parsing, resource limits and no broad worker credentials;
- OpenTelemetry-compatible logs/metrics/traces with data redaction;
- accessible loading, empty, degraded, interruption and error states;
- reproducible provider/model/render manifests and honest no-key/no-GPU/no-LiDAR behavior.

## Definition of done

Report changed files, contract/migration impact, tests and manual checks, screenshots/artifacts where required, hardware/provider state, limitations, risks and commit SHA. A feature is not complete from mocks or unit tests alone when its checkpoint requires browser, physical-device or GPU evidence.

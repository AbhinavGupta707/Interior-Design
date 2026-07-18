# C11 Contract — Interior-Design Brief and Agency Workspace

## Authority, predecessor and outcome

- Active plan: `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`.
- Continuation authority: `docs/orchestration/C11_C15_CONTINUATION.md`.
- Immutable predecessor: C10 ledger-close commit `2cfa04772493b8fd60446edf9dc75fced7b5557b`.
- Outcome: an authorised household can conduct a thoughtful local consultation, inspect and correct the extracted data, explicitly accept a versioned design brief and see unsupported professional questions routed to review.
- Mutation boundary: C11 can revise only C11 brief data. It cannot create or commit C5 model operations, alter C4 snapshots, resolve C9 discrepancies or change C10 scenes.

## Frozen contracts

The orchestrator-owned shared contract is `packages/contracts/src/c11.ts`:

- `c11-design-brief-v1`;
- `c11-brief-revision-v1`;
- `c11-consultation-session-v1`;
- `c11-brief-patch-proposal-v1`;
- `c11-reference-board-v1`; and
- the exact nine-route `c11RouteContract`.

A brief entry is explicitly one of observed evidence, household assertion, hard constraint, preference, inferred suggestion, unresolved conflict or unknown. Every entry has a stable ID, category, priority, status and attributable provenance. Evidence claims require immutable C2 asset identity; assistant extraction/suggestion requires the exact source message. Acceptance requires an accountable user and timestamp.

All writes carry an idempotency key and expected revision. Same-key/same-body replay returns the original effect; same-key/different-body conflicts. Stale revisions fail without mutation. Brief history is append-only and the current pointer advances transactionally.

## Consultation and model boundary

- Default and only executable adapter: `deterministic-local-v1`.
- `external-disabled` is an honest capability state and makes no network call.
- Prompt and tool registries are exact, versioned and bounded. Untrusted user/evidence text is data, never tool policy.
- The assistant may read the current C11 brief and submit one validated, expiring patch proposal. It has no generic HTTP, filesystem, SQL, object-storage or C4/C5 mutation tool.
- A proposal is not a write. Owner/editor confirmation revalidates session, proposal expiry, project/tenant, base brief ID/revision and every patch operation before the brief repository applies it atomically.
- Structural, regulatory, clinical accessibility, fixed cost, live product availability and professional judgement questions produce a typed `review-required` route.
- Raw consultation messages, household/health/accessibility details, prompts, asset locators, credentials and tokens are absent from logs/metrics. Safe codes, counts, durations, adapter/tool/prompt versions and correlation IDs may be logged.

## Authorisation

The orchestrator-owned action registry adds:

- `brief:read`, `brief:update`, `brief:accept`;
- `consultation:session:create`, `consultation:session:read`, `consultation:session:cancel`; and
- `consultation:proposal:read`, `consultation:proposal:confirm`.

Owner/editor may execute every action. Viewer may read briefs, sessions and proposals only. Every foreign-tenant request fails before resource disclosure. Machine principals have no confirmation action.

## Persistence and migration

- Migration: `services/platform-api/migrations/0011_design_briefs.sql`.
- Registry owner: C11-L1, preallocated before launch.
- Required durable records: brief identity/current pointer, immutable revisions, entry/reference projections, idempotency effects, consultation sessions, bounded messages, immutable patch proposals and confirmation/audit linkage.
- Tenant/project joins, revision checks, terminal-state invariants and immutability must be enforced in both runtime validation and SQL constraints/triggers where practical.
- Source C2 evidence remains immutable and is referenced, never copied into a mutable brief blob.

## Adaptive worktree lanes

Three lanes are retained. All use exact `gpt-5.6-sol` with `xhigh` reasoning because persistence/provenance, adversarial model tooling and cross-surface consultation safety are complex.

| Lane                                          | Exclusive editable paths                                                                                                                                                                                                                                     | Required output                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C11-L1 brief domain/persistence               | `packages/design-brief/**`; `services/platform-api/src/modules/briefs/**`; `services/platform-api/test/c11/briefs/**`; `services/platform-api/migrations/0011_design_briefs.sql`; `docs/runbooks/development/c11-design-brief.md`                            | deterministic patch/revision domain, tenant-safe repositories/routes, immutable history/idempotency/acceptance, live Postgres tests and runbook                            |
| C11-L2 bounded design agent                   | `packages/model-gateway/**`; `services/platform-api/src/modules/design-agent/**`; `services/platform-api/test/c11/design-agent/**`; `docs/threat-models/design-agent-c11.md`                                                                                 | exact prompt/tool registry, deterministic local extraction/clarification/review routing, proposal lifecycle, disabled external adapter, injection/resource/redaction tests |
| C11-L3 consultation UX/independent acceptance | `apps/web/src/features/design-consultation/**`; `apps/web/src/app/design-consultation/**`; `apps/web/src/app/api/c11/**`; `apps/web/test/design-consultation/**`; `tests/{evaluation,security,e2e}/brief-assistant/**`; `docs/evaluation/brief-assistant/**` | accessible agency workspace/reference board/inspect-correct-accept journey, mobile/keyboard/viewer/error states and independent evaluation/security/Playwright evidence    |

Merge order is L1 → L2 → L3. The orchestrator alone owns shared contracts/authz, root/workspace manifests and lockfile, migration registry, `services/platform-api/src/c11.ts`, shared API/web composition/navigation, accepted contract, ledger, `.github`, `.codex` and `AGENTS.md`. Package-local manifests are editable only inside the lane that exclusively owns that new package.

## Integration and exhaustive gate

C11 cannot close until all of the following are true:

1. full repository format/lint/typecheck/unit/build/Python verification passes;
2. strict schema/property tests cover classifications, provenance, unknown/conflict states, patch ordering, duplicate IDs, resource limits and severe malformed values;
3. a clean disposable Postgres database applies C1–C11 and live API tests prove creation, edit, acceptance, history, idempotency, concurrent/stale revision behavior and tenant isolation;
4. local consultation tests cover extraction, clarification, conflict, abstention/review routing, expiry, cancellation, malformed output, prompt/document injection and disabled external-provider behavior;
5. independent policy tests cover every role/action/tenant combination and machine confirmation denial;
6. a production-composed local journey runs through real web BFF, API and Postgres from project intake to consultation proposal, explicit user correction/confirmation and brief acceptance, while C4/C5 database counts and snapshot hashes remain unchanged;
7. Playwright passes Chromium/Firefox/WebKit desktop and mobile, keyboard-only, viewer read-only, loading/empty/offline/stale/error/cancel/recovery and no-horizontal-overflow journeys with no unexpected console/network error;
8. the in-app Browser is attempted for the visible local journey; if its controller is unavailable, that is `NOT RUN` and Playwright remains separately reported;
9. copy and status-comprehension assertions distinguish preferences, constraints, evidence, inference, unknowns and review-required professional questions;
10. structured logs contain only redacted safe metadata and no prompt, message, accessibility/health detail, token, locator or secret; and
11. a complete iOS Simulator regression runs after shared API/auth changes, with no claim of sensor evidence.

No paid provider, customer data, cloud service, GPU or physical device is required for C11. Human design-quality and representative-household comprehension remain separately named `NOT MEASURED` unless a rights-approved study actually occurs.

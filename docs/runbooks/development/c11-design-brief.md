# C11 design-brief development runbook

## Scope and safety boundary

C11-L1 owns deterministic brief data and its durable history. It can create, revise, accept and
reopen only a C11 design brief. It cannot mutate C4 snapshots, C5 branches or operations, C9
proposals, or C10 scenes. All fixtures in this lane are synthetic. No external provider, credential,
network inference, customer data, training permission, GPU or physical device is used.

The shared schemas and route paths remain in `packages/contracts/src/c11.ts`. The deterministic
kernel is `@interior-design/design-brief`; Fastify-compatible persistence and routes are under
`services/platform-api/src/modules/briefs/`.

## Lifecycle and concurrency

- The first successful update uses `expectedRevision: 0` and creates revision 1.
- Every later update must name the exact current revision and creates one immutable successor.
- Acceptance is an explicit mutation and creates a new immutable `accepted` revision attributed to
  the confirming owner/editor.
- Acceptance requires at least one active attributable entry. A reference-only, empty,
  resolved-only or withdrawn-only draft is not meaningful enough to accept. Active `unknown` and
  `unresolved-conflict` entries remain visible; acceptance never rewrites or silently resolves them.
- An accepted brief is not edited in place. A later exact-revision patch creates a new `draft`
  revision with reason `reopened`; the earlier acceptance event remains immutable.
- Every write carries the frozen request-body UUID `idempotencyKey`. Same-key/same-body replay
  returns the original revision. Same-key/different-body returns `IDEMPOTENCY_CONFLICT`.
- PostgreSQL writes lock the scoped project before claiming idempotency or reading the current
  pointer. This fixed lock order prevents different-key concurrent writes from deadlocking. Only one
  writer with the same expected revision can advance the brief.

Patch operations execute in their supplied order. Canonical snapshots then sort entries,
room/level element IDs and reference-board items by stable UUID before hashing. Content hashes omit
lifecycle metadata; snapshot hashes include the complete revision. Replacements retain the exact
entry ID. Stable name-derived IDs SHA-256 hash an unambiguous JSON array of the UTF-8 identity
parts, set RFC 9562 version 8 plus the standard variant bits, and are not UUIDv5.

## Classification and source rules

The kernel and SQL both enforce the frozen evidence/assertion/constraint/preference/inference/
conflict/unknown classifications and attributable provenance:

- observed evidence is evidence-linked, or system-derived from an exact C4 snapshot;
- household assertions are user-stated;
- preferences are user-stated or assistant-extracted from an exact message;
- an assistant suggestion cannot establish a hard constraint; and
- evidence-linked entries and reference-board items resolve a ready, project-scoped C2 asset with
  service-processing consent and denied training use.
- a direct `PUT` can add a user-stated entry only when `statedByUserId` is the authorised actor;
- direct updates cannot mint assistant-derived provenance merely by naming a real message; the
  caller must confirm the exact pending proposal or re-attribute an edited correction to the actor;
  and
- atomic proposal confirmation requires the proposal, operation provenance and immutable message
  to share the exact tenant, project, session, message ID and message timestamp.

Reference-board items also pin the current immutable rights-record SHA-256. The verifier hashes the
canonical object `{ assertedAt, assetId, attribution?, basis, licenceUrl?,
serviceProcessingConsent, trainingUseConsent }`. A missing source, ambiguous snapshot, changed
rights hash, inactive processing right or foreign scope fails before the repository mutates.

## Migration

`services/platform-api/migrations/0011_design_briefs.sql` requires `0010_scenes` and creates:

- one scoped brief identity/current pointer;
- append-only revision snapshots plus entry/reference projections and acceptance events;
- scoped idempotency effects and content-free audit metadata;
- bounded consultation sessions and messages;
- immutable patch proposals, append-only proposal state events and a guarded current head; and
- an append-only confirmation link from one proposal/base revision to the applied successor.

The migration uses composite tenant/project foreign keys, indexed lookup paths, deferred current
pointer checks, append-only triggers and explicit terminal-state transitions. It never cascades a
delete or writes to C2/C4/C5/C9/C10 state.

`PostgresBriefRepository.confirmProposal` is the sole confirmation transaction owner. It locks the
project, claims/replays idempotency, locks the session, selected proposal/head and pending sibling
heads, then reads the current brief. It revalidates scope, active session, turn count, expiry,
pending status, exact source-message chain, base brief/revision and ordered patch before inserting
the immutable successor and projections. It then confirms the selected proposal, rejects pending
siblings with `session-completed`, appends the confirmation linkage, completes the session and
stores the full response as one idempotency effect. SQL rejects a terminal session that still has a
pending proposal. L2 uses `superseded-by-new-turn` when a new turn terminalises the previous
pending proposal. Provider or retrieval work must happen before this transaction.

The idempotency fingerprint contains stable client semantics only: project/session/proposal/brief
IDs, expected brief revision, ordered operations and idempotency key. Server-generated
`confirmedAt`, current status snapshots and correlation metadata are excluded, so concurrent
same-key retries with different logical timestamps replay one effect. Confirmation timestamps may
use a logical bump up to one second beyond the repository clock, remain strictly after prior
session/proposal timestamps, and must precede proposal expiry.

## Local verification

Materialise workspace links without changing the lockfile when an isolated worktree has no
`node_modules`:

```sh
pnpm install --offline --lockfile=false
```

If the local store is incomplete, use the same command without `--offline`; keep
`--lockfile=false`. Then run:

```sh
pnpm --filter @interior-design/design-brief lint
pnpm --filter @interior-design/design-brief typecheck
pnpm --filter @interior-design/design-brief test:unit
pnpm --filter @interior-design/design-brief build
pnpm --filter @interior-design/platform-api exec vitest run test/c11/briefs
```

The real Postgres suite is deliberately guarded and is skipped unless a disposable/local database
URL is supplied:

```sh
C11_TEST_DATABASE_URL=postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design \
  pnpm --filter @interior-design/platform-api exec vitest run \
  test/c11/briefs/postgres.integration.test.ts
```

Do not report live database evidence when the guard skips. The suite applies C1 through C11,
exercises exact/different-key replay, concurrent stale writes, role/tenant denial, meaningful
acceptance/reopen history, provenance forgery denial, atomic proposal rollback/replay, sibling
terminalisation and SQL immutability.

## Safe failure handling

Expected failures are bounded `application/problem+json` responses such as
`BRIEF_REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `BRIEF_SOURCE_NOT_FOUND`,
`BRIEF_SOURCE_RIGHTS_CHANGED` and deterministic `BRIEF_*` validation codes. Audit records contain
only action, actor, revision, counts, hashes and correlation IDs. Never add statements, consultation
messages, patch bodies, prompts, accessibility/health details, asset locators, credentials or tokens
to logs, metrics or audit metadata.

## Composition handoff

Central C11 registration and package wiring are orchestrator-owned. Integration must add
`@interior-design/design-brief` as a platform API workspace dependency, instantiate
`DeterministicDesignBriefKernel`, compose `PostgresBriefRepository`,
`PostgresBriefSourceVerifier`, `BriefService` and `registerBriefRoutes`, and pass the repository as
the service's `confirmation` port. The root consultation adapter maps L2's structural
`BriefCommandPort.confirmProposal` command to `BriefService.confirmProposal` as a
`BriefProposalConfirmationCommand`, with L2 `request` mapped to L1 `update`. The result maps L1's
full committed `brief`, confirmed `proposal`, completed `session` and `replayed` flag without a
second mutation. Integration must also expose the
C11 database readiness check and add the migration to the central registry. Until that integration
is applied,
the lane is verified through direct Fastify-compatible route composition and the guarded live
repository suite.

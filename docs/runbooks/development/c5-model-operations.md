# C5 typed model operations runbook

## Boundary

C5 is the only canonical amendment path in the integrated platform. The C4 snapshot `POST` remains
addressable only for a model profile's first import; C5 records that import as
`snapshot.initialize.v1`, creates the `Main` branch, and rejects later raw snapshot bodies with
`TYPED_OPERATION_REQUIRED`. C4-only composition tests deliberately retain the isolated C4 route.

The public registry is exactly:

- `level.create.v1`
- `wall.create.v1`
- `wall.translate.v1`
- `opening.insert.v1`
- `space.create.v1`
- `space.rename.v1`
- `element.metadata.correct.v1`
- `element.provenance.correct.v1`

`snapshot.initialize.v1` and `snapshot.restore.v1` are internal registered operations. JSON Patch,
generic property paths, deletes, topology repair and arbitrary transforms are not accepted.

## Apply the migration

Apply C1 through C5 in order against the same PostgreSQL database:

```sh
pnpm --filter @interior-design/platform-api exec tsx src/c1.ts migrate-and-bootstrap
pnpm --filter @interior-design/platform-api exec tsx src/c2.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c3.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c4.ts migrate
pnpm --filter @interior-design/platform-api exec tsx src/c5.ts migrate
```

C5 refuses to migrate unless `0004_canonical_models` is registered. Readiness requires
`0005_model_operations`. `C5_DATABASE_URL` overrides C4/C1 configuration; production requires an
explicit database URL.

The migration adds branches, expiring previews, commits, immutable operation envelopes,
operation-scoped idempotency, domain audit and an append-only transactional outbox. Every route and
foreign-key lookup is scoped by tenant, project, model, profile and branch as applicable. Triggers
reject update/delete of snapshots, commits, operations, audit and outbox rows; branch updates may
only advance one revision; previews may only be deleted after expiry; idempotency rows may only be
completed once.

## Mutation flow

1. Initialize once through `POST /v1/projects/:projectId/models/:profile/snapshots` with
   `expectedCurrentSnapshotSha256: null`. The response remains the frozen C4 snapshot record shape.
2. Create a branch from an exact accessible snapshot ID and SHA-256. A public branch starts at
   revision `0`; the internal `Main` initialization branch contains the initialization commit at
   revision `1`.
3. Preview 1–50 ordered public operations with both expected revision and exact head SHA-256.
4. Inspect deterministic findings. A preview may contain errors but cannot be committed while any
   blocking finding remains.
5. Commit the unexpired preview with the same revision/head. The server reloads the preview for the
   same tenant/project/model/profile/branch/actor, re-reduces its exact operation payload and checks
   result hash, canonical byte length and findings before writing anything.
6. Restore only by naming an exact historical snapshot ID/SHA. Restore creates a new snapshot,
   `snapshot.restore.v1` operation, commit and branch revision; it never rewrites history.

Branch create, initialization, preview, commit and restore require an 8–128 character
`Idempotency-Key`. Exact actor/action/body replay returns the original response with
`Idempotent-Replay: true`; any actor, action or body mismatch returns `IDEMPOTENCY_CONFLICT`.

Commit and restore take a branch row lock and enforce both revision and hash. A stale request returns
`BRANCH_REVISION_CONFLICT` with the current authorised head and the bounded recovery choices
`reload`, `compare`, `discard-local`, and `rebuild-preview`. The server never geometry-merges.

## Atomicity and preview isolation

A public commit creates exactly one C4 snapshot and writes the commit, ordered operation rows,
branch head, canonical profile pointer, domain audit, outbox and idempotency completion in one
PostgreSQL transaction. Any error rolls back every effect. Preview persists only bounded preview
metadata; it does not write snapshots, commits, operation history, audit or outbox.

The reducer validates a detached C4 snapshot, clones it, applies only registered operations, reparses
the full canonical schema, calls the C4 geometry validator and uses the domain-model canonical codec
once for the result. Input objects are never mutated. Appearance and media remain outside this
canonical path.

## History, compare and replay

Operation history is ordered newest revision/ordinal first. `limit` is 1–100 (default 50); the opaque
cursor is bounded and must be returned unchanged. Compare uses stable element IDs and exact canonical
element content, returns at most 10,000 changes and marks truncation. It does not claim geometric or
professional equivalence.

Verify all retained branches without exposing snapshot bodies:

```sh
pnpm --filter @interior-design/platform-api exec tsx src/c5.ts verify-replay
```

Replay starts from each branch source, requires revisions and ordinals without gaps, upcasts only the
retained v1 envelope, resolves restore sources inside the same project/model/profile boundary and
checks every committed snapshot hash. Unknown versions, missing operations, tampered sources and hash
mismatches fail the command.

Expired previews are the only deletable C5 records:

```sh
pnpm --filter @interior-design/platform-api exec tsx src/c5.ts cleanup-previews
```

## Verification

Provider-free focused checks:

```sh
pnpm --filter @interior-design/model-operations lint
pnpm --filter @interior-design/model-operations typecheck
pnpm --filter @interior-design/model-operations test:unit
pnpm --filter @interior-design/platform-api lint
pnpm --filter @interior-design/platform-api typecheck
pnpm --filter @interior-design/platform-api test:unit -- test/c5
git diff --check
```

For live PostgreSQL evidence, use a disposable loopback database and set `C5_TEST_DATABASE_URL`:

```sh
C5_TEST_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design' \
  pnpm --filter @interior-design/platform-api test:integration -- \
  test/c5/postgres.integration.test.ts
```

The live suite applies C1–C5, proves same-key replay, raw-amendment denial, preview non-mutation,
atomic snapshot/commit/operation/audit/outbox counts, stale conflicts, cursor history, restore,
deterministic replay and immutable triggers. It is explicitly skipped when the environment variable
is absent; a skip is not database evidence.

## Safe operations and limitations

Structured logs contain bounded error/finding codes, status and correlation IDs. App redaction covers
authorization, idempotency keys, operation bodies, preview IDs, snapshot bodies, URLs and storage
locators. Outbox payloads contain only bounded event/operation types, domain IDs, revisions and hashes;
they never contain snapshot bodies, preview IDs or credentials.

C5 is a typed 2.5D information editor, not survey, structure, regulatory, price or professional
approval. It has no broker requirement; outbox consumers poll deterministically in ID/time order in a
later checkpoint. Preview expiry cleanup and replay verification are manual admin commands until
scheduling/alerting is integrated.

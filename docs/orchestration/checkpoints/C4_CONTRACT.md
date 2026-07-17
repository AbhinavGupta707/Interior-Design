# C4 Contract — Canonical multi-level home model

## Status and outcome

- Checkpoint: C4
- Contract version: `c4-canonical-home-v1`
- Frozen from: C3 ledger-close commit
- Outcome: an authorised project can persist and retrieve deterministic, provenance-aware canonical snapshots for separate existing, proposed and as-built profiles; the same snapshot validates identically across package, API and fixture processes.
- Scope boundary: C4 is the canonical 2.5D information and validation kernel. It does not yet provide typed editing operations (C5), infer a plan (C6), ingest RoomPlan/reconstruction geometry (C7–C9), compile glTF (C10), or claim survey, structural, regulatory or professional truth.

## Frozen representation decisions

1. Canonical JSON, not IFC, glTF, USD/USDZ, GeoJSON, a mesh, scan, NeRF or Gaussian splat, is the internal system of record. Those remain versioned exchange, evidence or appearance boundaries.
2. Canonical linear values and local coordinates are signed integers in millimetres. Angles are integer milli-degrees. Decimal metres/radians are derived only at renderer/export boundaries.
3. The local system is right-handed, `+X east`, `+Y north`, `+Z up`, with a project-local modelling origin. A global anchor is either explicitly absent or an attributed `EPSG:27700` integer-millimetre anchor. An address or C3 identity point is never copied into this field as interior geometry authority.
4. Existing, proposed and as-built are separate `modelProfile` snapshots and current pointers. A snapshot cannot mix those states. Proposed and as-built snapshots require `derivedFromSnapshotSha256`; an existing snapshot must not claim that derivation.
5. Opaque UUIDs are stable model, snapshot, element, claim and evidence-reference IDs. They carry no business meaning and are part of canonical content where present.
6. The frozen snapshot represents levels, spaces, surfaces, walls, openings/doors/windows, stairs, fixed objects, furnishings, finishes, lights and cameras. Level/host/target references use stable element IDs. Unsupported or absent elements remain empty collections; unknown measurements use the explicit attributed `knowledge: unknown` form rather than a plausible default.
7. Every knowledge-bearing value has one claim and method. Known states are `observed`, `source-derived`, `fused`, `inferred` or `user-asserted`; unknown is separate. Observed/source-derived/fused/inferred values require evidence. Fused and inferred values require 0–10,000 confidence basis points. User assertions require the actor. Review is purpose-specific and carries limitations; C4 has no generic `verified: true`.
8. A renderer may later use a display-only wall thickness, ceiling height or material fallback, but fallback configuration is never written into the snapshot as fact.
9. Canonicalisation follows the RFC 8785 JSON Canonicalization Scheme principles over the validated I-JSON subset: UTF-8, no non-finite numbers, no duplicate keys, deterministic property ordering and ECMAScript JSON primitive serialisation. Entity collections and reference sets sort by stable ID; limitation/finding collections sort by their deterministic key; geometric point sequences retain their authored order. No timestamps, database sequence, actor, snapshot ID or transport envelope are injected into the hashed snapshot.
10. The SHA-256 is computed over the exact UTF-8 canonical snapshot bytes. Schema version, model/project/property IDs, profile, coordinate contract, attributed values, evidence references, limitations and elements are included. Database metadata and the API record envelope are excluded. A stored canonical byte length and hash must be recomputable after process restart and JSONB round-trip.
11. Direction or polygon-start changes are not silently treated as geometric equivalence in C4. Stable hashing proves exact canonical state; the geometry kernel separately reports topology and geometric findings.
12. TypeScript is the initial kernel implementation. Its public boundary and golden fixtures stay portable so a future WASM/native implementation can replace algorithms only after licence, correctness and performance evidence.

Primary standards checked for this prelude:

- [RFC 8785](https://www.rfc-editor.org/info/rfc8785/) defines deterministic JSON property sorting and primitive serialisation over the I-JSON subset for repeatable hashes.
- [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) defines a right-handed, metre/radian runtime delivery format. C10 must perform an explicit millimetre/axis boundary transform; glTF is not the C4 canonical store.
- [RFC 7946](https://www.rfc-editor.org/info/rfc7946/) fixes GeoJSON to WGS 84 longitude/latitude decimal degrees. It is not a container for the project-local integer-millimetre model.

## Frozen shared schemas and API

The orchestrator owns `packages/contracts/src/c4.ts`, `packages/contracts/test/c4.test.ts`, root/package manifests, the lockfile, the migration registry, accepted ADR/contract text and the ledger. Workers consume but do not edit them.

`canonicalHomeSnapshotSchema` freezes the full public shape and limits. The domain/provenance package owns canonicalisation, ordering, attribution invariants and round-trip functions. The geometry kernel consumes the frozen snapshot and emits deterministic, located findings without mutating it.

Frozen routes:

| Method | Route                                                           | Permission and behavior                                                                                            |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/v1/projects/:projectId/models`                                | owner/editor/viewer; return exactly existing/proposed/as-built profile summaries, including explicit empty states  |
| `GET`  | `/v1/projects/:projectId/models/:profile`                       | owner/editor/viewer; return the immutable current snapshot record or a non-disclosing empty/not-found public state |
| `GET`  | `/v1/projects/:projectId/models/:profile/snapshots/:snapshotId` | owner/editor/viewer; retrieve one immutable project/profile snapshot                                               |
| `POST` | `/v1/projects/:projectId/models/:profile/snapshots`             | owner/editor; idempotent validation/canonicalisation/persistence with explicit expected current hash               |

The create request carries `expectedCurrentSnapshotSha256`, which is `null` only for the first snapshot, plus the canonical snapshot. Route project/profile and authenticated tenant are authoritative and must match the body. Every mutation uses the established 8–128 character `Idempotency-Key`. A stale current hash returns a machine-readable revision conflict; same-key/same-body replays one record; same-key/different-body conflicts.

## Frozen geometry and validation contract

The geometry kernel performs integer-safe validation and returns a sorted immutable array of findings with code, severity, affected stable IDs, message and an optional level-local integer location. At minimum it must detect:

- duplicate/invalid IDs and missing level/host/target references;
- degenerate or self-intersecting space/surface polygons;
- zero-length, repeated or self-intersecting wall paths;
- openings outside their host extent, overlapping openings and invalid sill/height relationships;
- disconnected or inconsistent `boundedByElementIds` room topology;
- stairs with identical/missing levels, invalid rise/run/count relationships or endpoints inconsistent with level elevations;
- impossible dimensions or unsafe integer arithmetic;
- fixed/furniture/light/camera references outside a level or non-finite derived calculations; and
- explicit unknown thickness/height as information/warning where applicable, never as a fabricated error-free dimension.

All calculations must remain within JavaScript safe-integer bounds or emit a resource/range finding. Validation is deterministic, total for every schema-valid snapshot, side-effect-free and bounded by the schema collection limits. C4 does not repair geometry automatically.

## Frozen persistence and migration

- Migration allocation: `services/platform-api/migrations/0004_canonical_models.sql`, exclusively C4-L3 owned and registered as `0004` before launch.
- Persistence separates tenant/project/model profile, immutable snapshots and a current profile pointer. Every key and query includes tenant/project identity.
- A snapshot stores validated canonical JSONB, SHA-256, canonical byte length, schema version, actor/time and a monotonically increasing project/profile version. Historical rows are append-only; current pointers advance with optimistic locking.
- Database constraints/triggers enforce profile separation, hash/byte-length shape, immutable snapshot history and a current pointer that references the same tenant/project/model/profile. Raw object-store credentials or internal locators never enter public DTOs or logs.
- C4 snapshots may remain transactionally inline in Postgres within the frozen request/record ceiling. Future content-addressed object offload must preserve the same public snapshot/hash contract and is not allowed to create a second canonical representation.

## Adaptive isolated lanes

C4 uses four project-scoped Codex worktree tasks from one frozen committed base. The decomposition is adaptive but retains the active-plan four-lane shape because all four risks are independently substantial and their writes are exclusive. Every task uses exact model `gpt-5.6-sol`.

| Lane                           | Model / reasoning       | Exclusive editable paths                                                                                                                                                                                                                                                                                                          | Required output                                                                                                                                                                                             |
| ------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C4-L1 domain/provenance        | `gpt-5.6-sol` / `xhigh` | `packages/domain-model/src/**`, `packages/domain-model/test/**`, `packages/provenance/src/**`, `packages/provenance/test/**`, `docs/adr/ADR-003-coordinate-units.md`, `docs/adr/ADR-006-provenance.md`; package manifests and frozen contracts are read-only                                                                      | RFC-8785-style canonical serialisation/hash, deterministic collection ordering, attribution validation/transitions, profile separation, round-trip and retained golden-hash tests                           |
| C4-L2 geometry/topology kernel | `gpt-5.6-sol` / `xhigh` | `packages/geometry-kernel/src/**`, `packages/geometry-kernel/test/**`, `docs/adr/ADR-004-geometry-kernel.md`; package manifest and frozen contracts are read-only                                                                                                                                                                 | integer predicates/primitives, multi-level references, polygon/wall/opening/stair/room validation, located sorted findings, bounded property/adversarial tests                                              |
| C4-L3 persistence/API          | `gpt-5.6-sol` / `xhigh` | `services/platform-api/src/modules/models/core/**`, `services/platform-api/src/c4.ts`, `services/platform-api/test/c4/**`, `services/platform-api/migrations/0004_canonical_models.sql`, `docs/runbooks/development/c4-canonical-model-api.md`; minimal allocated composition edits to `src/app.ts`, `src/server.ts`, `README.md` | tenant-safe immutable profile/snapshot API, idempotency/optimistic concurrency, migration/trigger invariants, clean/live Postgres tests and reproducible runbook                                            |
| C4-L4 fixtures/evaluation      | `gpt-5.6-sol` / `xhigh` | `packages/test-fixtures/src/models/**`, `packages/test-fixtures/test/**`, `tests/geometry/canonical/**`, `docs/evaluation/canonical-model.md`; package manifest, frozen contracts and producer roots are read-only                                                                                                                | small valid multi-level home plus adversarial degeneracy/host/topology/stair/unknown/profile fixtures, cross-process stable-hash/round-trip/property tests, evaluation matrix and retained expected results |

Merge order is L1, L2, L3, L4. Workers must not edit another lane, root manifests, the lockfile, shared contracts/authz, migration registry, accepted contract/ADR files outside their allocation, `.github`, `.codex`, `AGENTS.md` or the ledger. The orchestrator resolves integration only after all four workers finish.

## Required checkpoint gate

1. Prelude and integrated `UV_CACHE_DIR=.cache/uv pnpm verify` pass formatting, lint, strict typecheck, unit tests and all production builds across the enlarged workspace.
2. Shared C4 contract/authz tests prove integer units, explicit unknowns, evidence/confidence/actor rules, profile separation, UUID integrity, strict DTOs and owner/editor/viewer permissions.
3. Domain canonicalisation golden tests prove identical UTF-8 bytes/SHA-256 across insertion order, process restarts and JSON round-trips; semantically relevant changes alter the hash; unsupported numbers/keys/orderings fail closed.
4. Geometry unit/property/adversarial suites cover every required finding and valid multi-level fixtures. Independent reference checks recompute areas/intersections/bounds where practical. Failures and severe errors remain in denominators.
5. A clean disposable PostGIS database applies C1–C4 in sequence. Live integration proves profile separation, immutable history, same-key replay, different-key concurrency, stale expected hash, tenant/role isolation, exact hash/byte recomputation and trigger enforcement.
6. Public DTOs and API logs are scanned for raw internal locators, credentials, snapshot bodies in logs and cross-tenant identifiers. Request URLs remain redacted by the platform logger.
7. Because C4 has no user-facing web/iOS surface, no browser or simulator journey is manufactured. User-perspective acceptance is the public API journey through a real authenticated BFF-independent client: create/list/read current/read historical, viewer read-only, foreign/unknown nondisclosure and understandable located findings/limitations. C5 provides the first model UI.
8. The ledger records task IDs, exact model/reasoning, worker/merge SHAs, test/property counts, clean/live database evidence, integration repairs, residual TypeScript/2.5D/professional limits and final C4 SHA before C5 opens.

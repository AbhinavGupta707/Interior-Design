# C3 Contract — Honest property and home dossier

## Status and outcome

- Checkpoint: C3
- Contract version: `c3-property-v1`
- Frozen from: C2 ledger-close commit
- Outcome: an authorised user can search deterministic synthetic property identities or enter one manually, select a project property, and inspect a source-aware dossier that separates source observations, user assertions, estimates, inferences and unknowns.
- Hard boundary: an address, UPRN, point, EPC/context record or planning-data response never establishes the current interior, a legal boundary, structural truth, planning clearance or professional approval.
- Scope boundary: web/API only. C3 does not create exterior/interior geometry, query a paid provider, expose a real address fixture, or modify the C4 canonical model.

## Frozen evidence and provider decisions

1. The provider-neutral boundary is `@interior-design/provider-adapters/property`. Development and test default to a deterministic, repository-owned synthetic fixture adapter. Production defaults to the disabled/manual path until an adapter, credentials, licence, privacy notice, retention policy and data-processing decision are explicitly approved.
2. No live address, EPC or planning request is made in C3. No query may silently fall back from unavailable to fixture output. Fixture, disabled, unavailable, ambiguous, no-match and manual states remain visibly distinct. A provider result uses `providerState: fixture`; a deliberately disabled or failed provider returns `status: unavailable` with the corresponding `disabled` or `unavailable` provider state.
3. UPRNs are stored as one-to-twelve digit strings so leading zeroes survive. They identify an addressable GB location and may link datasets; they are not postal addresses, land parcels, building shells or interiors. A point may represent multiple UPRNs, including flats.
4. Address search returns alternatives when ambiguous. Candidate IDs and resolution IDs are opaque UUIDs; a client cannot submit provider payload or source/licence metadata as authority. Candidate resolutions expire after 15 minutes.
5. A manual selection stores no invented UPRN or coordinate. It produces a user-provided source record and explicit unknown context. Location tuples are easting/northing for `EPSG:27700` and longitude/latitude for `EPSG:4326`.
6. Every established dossier item references an immutable normalised source record with provider, dataset, dataset version, retrieval time, licence, coverage and processing/sharing/training permissions. Raw provider responses are not exposed or logged; only a normalised-payload SHA-256 is retained.
7. Training use is always denied by the C3 source contract. Service processing and project-participant sharing remain explicit, separate fields.
8. Planning context is `not-reviewed`. No-result responses are never rendered as “no constraints”; every dossier carries at least one coverage warning.
9. Property identity, source records and dossier versions are project/tenant scoped. Owners and editors may resolve, select and refresh; viewers may read only. Foreign and unknown IDs return the same non-disclosing `404`.
10. Dossier items use only `source-observation`, `user-assertion`, `estimate`, `inference` or `unknown`. Estimates/inferences require a 0–100 confidence value; unknowns carry an explicit unknown value; every item carries `interiorClaim: none`.

The contract follows current primary-source constraints:

- [OS Open UPRN technical specification](https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-uprn/os-open-uprn-technical-specification) defines the open product as UPRN plus address-point position for linking datasets.
- [The UK government UPRN standard](https://www.gov.uk/government/publications/open-standards-for-government/identifying-property-and-street-information) records GB scope, OGL identifier/grid-reference availability and the fact that multiple UPRNs may share a grid point.
- [Planning Data documentation](https://www.planning.data.gov.uk/docs) states that coverage varies, absence is not clearance, WGS84/UPRN queries are supported and the API remains beta.
- [The official EPC data service](https://get-energy-performance-data.communities.gov.uk/) covers England and Wales, requires account-based access for developer/bulk data, and warns that certificates may be expired or superseded. It is an inactive future adapter in C3.

## Frozen shared schemas and routes

The orchestrator owns `packages/contracts/src/index.ts`, `packages/contracts/test/c3.test.ts`, `packages/authz/**`, root/package manifests, the lockfile, migration registry and this contract. Workers treat them as read-only.

Shared schemas include property/address/UPRN/location/source/candidate/resolution/selection/identity/dossier-item/source-record/dossier DTOs. The frozen routes are:

| Method | Route                                              | Permission and behavior                                                                                       |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST` | `/v1/projects/:projectId/property/resolutions`     | owner/editor; query deterministic adapter; ambiguous/no-match/outage remain typed                             |
| `PUT`  | `/v1/projects/:projectId/property`                 | owner/editor plus idempotency and expected version; select an unexpired candidate or explicit manual identity |
| `GET`  | `/v1/projects/:projectId/property/dossier`         | owner/editor/viewer; return identity, dossier items, sources and warnings without raw provider payload        |
| `POST` | `/v1/projects/:projectId/property/dossier/refresh` | owner/editor plus idempotency and expected version; create/replay one immutable normalised dossier version    |
| `GET`  | `/v1/projects/:projectId/property/source-records`  | owner/editor/viewer; list normalised source metadata/hashes only                                              |

All endpoints inherit C1 bearer authentication, correlated problem details, non-disclosing tenant/project lookup and server-side role authority. Mutations require an 8–128 character `Idempotency-Key`. Stale `expectedVersion` returns the established safe `REVISION_CONFLICT` shape.

## Frozen persistence and fixture behavior

- Migration allocation: `services/platform-api/migrations/0003_property_dossier.sql`; only C3-L1 owns it. It must be additive and recorded as `0003_property_dossier`.
- Required persistence: one current project property identity with optimistic version; immutable source records; append-only dossier versions; opaque time-bounded resolution snapshots or a cryptographically equivalent server-owned candidate mechanism; user/system audit events; no raw provider response.
- Source and dossier immutability must be enforced by database constraints/triggers where practical. Every foreign key/predicate includes tenant and project identity.
- The deterministic fixture catalog contains no real address, person or customer data. It must cover exact match, two-candidate ambiguity with shared point/different UPRNs, no match and injected outage. The accepted display identity is `14 Example Mews, Testford, ZZ1 1ZZ` with synthetic UPRN `000000000014`.
- A selected fixture dossier demonstrates every classification without overclaim: sourced property identity/context, C1 intake assertions, bounded estimate/inference examples with sources/confidence, and explicit unknown current layout/wall thickness/structure/boundary status.
- Refresh is deterministic for identical inputs and provider versions. Concurrent or repeated refreshes create one effect and return the same public representation.

## Adaptive isolated lanes

C3 uses two project-scoped Codex worktree tasks from the committed prelude. Every task is explicitly launched on `gpt-5.6-sol`; model and reasoning are passed at creation and recorded in the ledger.

| Lane                           | Model / reasoning       | Exclusive editable paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Required output                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3-L1 dossier backend/adapters | `gpt-5.6-sol` / `xhigh` | `packages/provider-adapters/src/property/**`, `packages/provider-adapters/test/**`, `services/platform-api/src/modules/property/**`, `services/platform-api/src/c3.ts`, `services/platform-api/test/c3/**`, `services/platform-api/migrations/0003_property_dossier.sql`, `tests/fixtures/c3/property/**`, `docs/runbooks/development/c3-property-api.md`; minimal composition edits to `services/platform-api/src/app.ts`, `services/platform-api/src/server.ts`, `services/platform-api/README.md` | provider-neutral fixture/disabled adapter, expiry/ambiguity/outage behavior, tenant-safe idempotent persistence/API, immutable source/dossier records, migration and live Postgres tests/runbook                                               |
| C3-L2 dossier UX/comprehension | `gpt-5.6-sol` / `high`  | `apps/web/src/features/property/**`, `apps/web/src/app/property/**`, `apps/web/src/app/api/c3/**`, `apps/web/test/c3/**`, `tests/contract/property/**`, `tests/e2e/property/**`, `docs/evaluation/property-dossier-comprehension.md`; minimal allocated edits to `apps/web/src/features/projects/projects-screen.tsx`, `apps/web/src/app/globals.css`                                                                                                                                                | accessible search/ambiguity/manual/select/dossier/source/refresh flows, clear epistemic labels and warnings, viewer restrictions, loading/empty/offline/outage/conflict states, desktop/mobile browser acceptance and comprehension evaluation |

Workers must not edit one another's paths or orchestrator-owned files. C3-L1 produces the API; C3-L2 consumes only the frozen shared contract and may use a deterministic mock server for independent browser development. Merge order is L1 then L2.

## Required checkpoint gate

1. Prelude and integrated `UV_CACHE_DIR=.cache/uv pnpm verify` pass formatting, lint, strict typecheck, unit tests and all production builds.
2. Shared C3 contract/authz tests prove UPRN string integrity, strict resolution cardinality, opaque/manual selection, source/licence/training metadata, source-linked classifications, explicit unknowns and viewer read-only policy.
3. A clean disposable PostGIS database applies C1, C2 and C3 migrations. Live integration proves exact/ambiguous/no-match/manual/outage, tenant isolation, candidate expiry, idempotent/stale/concurrent selection and refresh, append-only source/dossier rows, no raw provider payload and zero real addresses.
4. API logs and public DTOs are scanned for address-query/raw-source leakage, bearer credentials and provider internals. Only safe correlation/UUID/status codes may be logged.
5. Playwright covers owner and viewer journeys at desktop/mobile sizes: exact match, explicit choice on ambiguity, manual fallback, outage/offline recovery, refresh conflict, all five epistemic labels, source details, keyboard navigation, responsive overflow and zero console/network errors.
6. The in-app browser exercises the integrated local BFF/API with a synthetic project and visually verifies hierarchy, source/coverage copy, unknown-interior boundary, manual fallback and responsive behavior.
7. No Xcode or physical-device gate applies because C3 has no native changes. The ledger records task IDs, exact model/reasoning, worker/merge SHAs, test counts, live database/browser evidence, integration repairs, residual provider/licence/privacy limitations and final checkpoint SHA before C4 opens.

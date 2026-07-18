# C13 specification threat model

## Protected assets and trust boundaries

C13 protects tenant/project scope, immutable C12/C5 provenance, catalog and rights hashes, stable element identity and placement, immutable specification history, exact substitution candidates, idempotency results, scene bindings, notes/decisions, and artifact/right metadata.

Trust boundaries are:

- authenticated HTTP caller to strict specification routes;
- C13 service to authoritative C12/catalog/C5 repository reads;
- one atomic C13/C5 PostgreSQL transaction;
- post-commit C13 to injected C10 scene request; and
- optional root-owned C10 enrichment to the read-only immutable scene-binding resolver.

C4/C5 remains canonical geometry. C13 lines are a versioned projection, and C10 is derived output. Neither a catalog payload nor rendered media can establish dimensional, rights, availability, price, structural, regulatory, or professional truth.

## Principal threats and controls

| Threat                                                                                  | Control and evidence                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged confirmation, brief, bundle, branch, commit, snapshot, release, version, or hash | Creation accepts only confirmation/release pins and performs the complete server-side C12/C5/catalog join. Strict bodies reject extra model pins. Persistence rechecks under locks.                                                         |
| Cross-tenant IDOR or foreign-key oracle                                                 | Authentication and project action checks precede reads; repository predicates include tenant/project; transaction-local tenant context; forced RLS; non-owner `NOBYPASSRLS` live test; `23503` becomes generic 404 without database detail. |
| Duplicate schedule truth or mutable history                                             | Only immutable `specification_lines` are persisted per revision. All four schedules are pure projections. Append-only triggers reject revision/line mutation.                                                                               |
| Stable-ID/type/placement corruption                                                     | Only `design.element.replace.v1` is emitted. The kernel requires the existing line/element, same kind, stable ID/type/level/placement/target/attribution, and exact catalog-derived replacement fields. Cross-kind tests reject mutation.   |
| Geometry bypass or unit confusion                                                       | Canonical integer millimetres/milli-degrees, bounded quantities, pure reducer replay, canonical validation, conservative containment/collision logic, and exact 1 mm severe tests. Appearance never establishes geometry.                   |
| Catalog rights time-of-check/time-of-use                                                | Selectability and all release/version/C12/rights/projection hashes are checked at preview and again at confirmation under transaction locks. Withdrawal/expiry after preview conflicts. Historical rows remain readable.                    |
| Stale or concurrent confirmation                                                        | Fixed project → specification → substitution → C5 branch/profile lock order; exact expected spec/candidate/branch pins; one-step heads; same preview can confirm once. Live and in-memory concurrent tests allow one winner.                |
| Partial C5 without C13, or C13 without C5                                               | Canonical snapshot, C5 commit/envelope/audit/outbox, branch/profile, next C13 revision/lines/confirmation/scene link/idempotency effect share one transaction. Injected after-C5 failure proves rollback.                                   |
| Same idempotency key with changed body                                                  | Tenant-scoped operation and canonical request hash are retained. Same body replays exact result; different operation/body conflicts.                                                                                                        |
| C10 failure corrupts canonical state                                                    | C10 request starts only after commit. Failure records `retry-required` and never rolls back valid C5/C13 state. Retry resolves an immutable binding and verifies URL specification/revision before dispatch.                                |
| Scene-job substitution or stale metadata                                                | `sceneJobId` resolves to one immutable specification revision, branch revision, snapshot, release hash, revision hash, and exact lines. Mismatched URL specification/revision is non-disclosing 404.                                        |
| Sensitive note/artifact/licence/token leakage                                           | Telemetry allowlist drops note, schedule, operations, payloads, manifests, paths, licence/source receipts, credentials/tokens, signed URLs and locators. SQL audit/outbox checks prohibit private keys.                                     |
| Fabricated price, stock, delivery, supplier, or training permission                     | Schema and SQL require `not-provided` commercial values and `trainingAllowed: false`; fixtures are creator-owned synthetic.                                                                                                                 |
| Machine principal confirmation                                                          | Confirmation and scene retry routes reject `machine:` and `service:` subjects; owner/editor authorisation remains server-side.                                                                                                              |

## Database role assumptions

All C13 tenant tables have forced RLS with symmetric read/write tenant predicates. Application execution must use a role that is not the table owner, is not superuser, and lacks `BYPASSRLS`. Every repository operation creates a transaction and sets `app.tenant_id` locally before tenant data access. Broad migration credentials must not be reused by the running API.

The live RLS test checks the effective role flags, tenant-filtered read, cross-tenant write denial, and same-tenant missing composite FK code. Static tests also cover every owned table's forced policy and transaction-local repository pattern. C1–C12 owner hardening is inherited and remains outside this lane.

## Residual risks and non-claims

- Root composition must connect real authn/authz, L1 catalog publication, and C10 dispatch without weakening the ports. This lane deliberately does not edit those owners.
- Catalog creator/right assertions depend on C13-L1 validation and accountable review; schema completeness alone is not proof of third-party rights.
- Parametric geometry and 1 mm computational checks are not survey, structural, code, safety, comfort, procurement, or professional evidence.
- There is no external provider, customer dataset, GPU/browser/device, live stock/price, or training-permission evidence in this lane.
- The read-only scene resolver enables exact derived metadata, but root-owned C10 compiler integration must separately prove GLB inclusion without changing canonical snapshots or C10 v1 contracts.

# C5 model operations, branch policy and audit threat model

## Status and scope

This document is the C5 security contract for typed model operations, branches, preview/commit confirmation and model audit visibility. It covers the defence-in-depth policy in `packages/authz/src/model/**` and the immutable public audit projection in `services/platform-api/src/modules/audit/**`.

It does not claim that the C5 migration, operation reducers, HTTP routes or application composition are secure before C5-L1 and the orchestrator integrate and exercise these boundaries. C5 changes canonical 2.5D information only. Plan inference, native capture, reconstruction, 3D rendering, structure, regulation, professional issue and arbitrary AI tools remain out of scope.

## Protected assets and objectives

Protected assets are immutable canonical snapshots; tenant/project/model/profile/branch identity; branch heads and revisions; ordered operation envelopes; expiring previews; commit and restore records; idempotency state; transactional audit/outbox history; current memberships; machine-service credentials; support grants; and correlation records.

The objectives are:

1. allow canonical amendments only through the frozen typed registry and server-selected core actions;
2. require exact tenant, project, model, profile and branch identity on every lookup, preview, commit, replay, comparison, restore and audit read;
3. recheck current membership and role on every request, including idempotent replay and preview confirmation;
4. keep preview non-mutating and bind confirmation to the exact resource and authorised human actor;
5. let a separately authenticated machine propose public operations only on behalf of a named active owner/editor, never confirm or mutate by itself;
6. retain committed history and domain audit as append-only records with no update/delete interface;
7. paginate audit newest-first with bounded pages and signed, expiring, resource-bound cursors; and
8. expose only allow-listed audit fields, with actor identifiers removed from temporary support views.

Availability against volumetric denial of service remains a platform concern. C5 nevertheless bounds an operation batch to 50, an audit page to 100 plus one look-ahead row, a cursor to 500 characters and all public strings/identifiers through runtime schemas.

## Trust boundaries

1. **Client to HTTP boundary:** route parameters, preview IDs, branch IDs, operation envelopes, actor-like objects, action names, hashes, revisions and cursors are untrusted. TypeScript types are not validation.
2. **Human authentication boundary:** the session verifier establishes a subject and tenant. The server then reloads one current membership. The operation-attributed actor, authenticated actor and current membership must agree exactly on tenant, user and role.
3. **Machine authentication boundary:** machine proposals use a separate internal service-authentication boundary. It establishes service ID, tenant, expiry and the single allowed preview action. A request-body `kind: machine` object is not machine authentication.
4. **Resource boundary:** the route supplies requested identifiers; the store returns persisted tenant/project/model/profile/branch identity. The model policy compares every component before applying the core role/action matrix. IDs identify candidates; they never grant access.
5. **Preview/commit boundary:** preview metadata is store-owned and includes exact branch scope, proposer, named human confirmer, operation types, expiry and consumption state. Commit reloads it and rechecks membership, branch head/revision/hash and actor linkage inside the transactional flow.
6. **Reducer boundary:** reducers receive only a parsed registered operation and a schema-valid immutable snapshot. Metadata/provenance corrections use enumerated collection/field pairs. No client property path, JSON Patch pointer, script, generic transform or prototype key reaches dynamic assignment.
7. **Persistence boundary:** every query and uniqueness/foreign-key predicate includes tenant/project/model/profile/branch scope. Policy does not repair an unscoped SQL query. Branch-head locking and revision/hash predicates are still required after authorisation.
8. **Audit projection boundary:** the read port may return only append-only events, newest-first. The projection reparses every row, rejects any foreign or misordered row, removes tenant ID from public records, and removes actor ID from temporary support records.
9. **Telemetry boundary:** structured logs and public audit records cross a disclosure boundary. Bodies, tokens, preview secrets, canonical JSON, database locators and free-form commit/reason text do not.

## Frozen authorisation behavior

The C5 model layer calls the existing frozen core action registry; it does not create a second general permission system.

| Action                    | Owner | Editor | Viewer | Machine                                                               |
| ------------------------- | ----- | ------ | ------ | --------------------------------------------------------------------- |
| `model:branch:create`     | allow | allow  | deny   | deny                                                                  |
| `model:branch:read`       | allow | allow  | allow  | deny                                                                  |
| `model:branch:compare`    | allow | allow  | allow  | deny                                                                  |
| `model:operation:preview` | allow | allow  | deny   | allow only through internal auth, delegated to an active owner/editor |
| `model:operation:commit`  | allow | allow  | deny   | deny                                                                  |
| `model:branch:restore`    | allow | allow  | deny   | deny                                                                  |
| `model:operation:history` | allow | allow  | allow  | deny                                                                  |
| `model:audit:read`        | allow | allow  | allow  | deny                                                                  |

Unknown actions, malformed context, invalid identifiers, unexpected resource fields, target resources on non-compare actions and missing branch identity deny. Branch creation is the sole action in this layer that accepts no branch ID. Comparison requires both requested and stored target resources and requires the target to share the exact tenant/project/model/profile scope.

Human policy order is: validate action and exact resource pair; validate operation/preview shape; validate attributed actor against authenticated actor; reject revoked membership; compare current membership; compare tenant; apply the core role/action matrix; then, for commit, validate exact preview ID/resource/proposer/confirmer/expiry/consumption.

Machine policy additionally requires an unexpired authenticated machine principal, exact claimed/authenticated service/tenant/delegating-user linkage, an explicit preview capability, a current delegated human membership and public operation types. `snapshot.initialize.v1` and `snapshot.restore.v1` are internal store operations and cannot enter a public or machine preview batch.

The policy returns detailed internal denial reasons for tests and server decisions. Routes must not echo `cross-tenant`, `resource-mismatch` or preview linkage detail to a caller. Foreign and nonexistent project/model/profile/branch/preview resources use the same safe response shape.

## Preview, confirmation and concurrency

- A human preview is bound to that same human as confirmer. Another editor cannot steal and confirm it.
- A machine preview is bound to a named active human owner/editor. The machine cannot confirm; a different human cannot confirm.
- A successful commit consumes the preview. A consumed preview denies unless L1 returns the already-stored response as an exact, same-actor/same-key/same-operation/same-body idempotent replay.
- Expiry is checked at use, not only at preview creation.
- Authorisation is necessary but not sufficient: commit must still lock the branch and compare expected revision and exact head SHA-256 before writing.
- Membership is reloaded at confirmation. A preview made before role removal does not preserve authority.
- No stale request is auto-merged. A `409 BRANCH_REVISION_CONFLICT` may disclose the current revision/head only after the branch has been fully authorised.
- Restore is a new typed commit from an exact accessible historical snapshot. It never rewrites branch or snapshot history.

## Audit and support visibility

The internal immutable event schema contains only bounded identifiers, registered action/type codes, actor reference, outcome, request/trace IDs, optional commit/snapshot/revision and timestamp. It has no arbitrary metadata object or free-form prose field.

The public member projection includes stable domain IDs/codes, trace ID and actor IDs, but omits tenant and caller-controlled request IDs and cannot contain preview IDs/secrets, request bodies, canonical snapshots, hashes used as bearer-like confirmation material, database locators, SQL offsets, commit messages or operation reasons. It returns at most 100 records.

Cursor order is `(occurred_at DESC, event_id DESC)` and the cursor position is exclusive. The cursor payload is HMAC-SHA-256 signed, expires in at most one hour, and is bound to a SHA-256 fingerprint of tenant/project/model/profile/branch scope. Tampering, expiry or reuse for another scope fails as one generic invalid-cursor error. The persistence adapter must apply the same tuple predicate; it must not translate the public cursor into a caller-controlled raw SQL fragment or offset.

Support has no model action. Temporary support audit visibility requires all of:

- a separately authenticated support principal;
- one exact branch-scoped grant with a bounded purpose and expiry;
- exact support-agent linkage;
- current approval by an active tenant owner; and
- no revocation marker.

Tenant-wide, project-wide and model-wide support grants are invalid. Support output is `support-redacted` and omits actor IDs. A support grant never enables branch read, preview, commit, history, snapshot access or mutation. The integration must audit support reads themselves without recursively exposing broader data.

## Threat analysis

| Threat                                               | Required control                                                                                                                                                                               | Residual risk / integration evidence                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR through guessed project/model/profile/branch ID | Parse every ID; load with full tenant scope; compare requested and persisted resource tuples; authorise before disclosure; normalise foreign and missing responses.                            | Live route/SQL tests must prove every query has the full composite predicate and compare response bodies/logs for missing versus foreign IDs. |
| Foreign comparison branch                            | Load and validate both requested/stored target resources; require the same tenant/project/model/profile as the base branch.                                                                    | L1/L4 must test branches with colliding display names and IDs across every scope component.                                                   |
| Forged actor, role or machine marker                 | Construct authentication context server-side; compare attributed and authenticated principals; reload current membership; require separate expiring machine credentials.                       | Compromise of session/service signing keys or membership storage remains an operational threat.                                               |
| Revoked membership after preview                     | Recheck membership on every request and again at confirmation; no authority is cached in preview or idempotency state.                                                                         | Integration must race revocation against preview/commit and exact idempotent replay.                                                          |
| TOCTOU on branch head                                | In one transaction, reauthorise current membership, lock branch, compare revision and head hash, validate unexpired preview, write snapshot/operations/commit/head/audit/outbox.               | Pure policy tests cannot prove SQL locking or transaction isolation; live races are mandatory.                                                |
| Preview theft                                        | Store exact proposer and named human confirmer; require the request preview ID and full resource tuple; never accept client-supplied authority metadata.                                       | URLs, browser history and logs still must redact preview IDs if the route treats them as confirmation material.                               |
| Machine self-confirmation                            | Machines may call only preview through internal auth and active human delegation; commit is human-only; internal operation types are excluded from proposal batches.                           | Future AI orchestration must reuse this boundary and cannot receive database/model-store credentials.                                         |
| Replay of preview or commit                          | One-time preview consumption plus actor/operation/body-bound idempotency; exact replay returns the stored response, while key/body/actor changes conflict.                                     | L1 must prove consumption and idempotency are atomic and survive restart.                                                                     |
| Stale or reordered operations                        | Pin revision/head; preserve ordered ordinals; reject duplicates/gaps/unknown versions; deterministic replay must reproduce each snapshot hash.                                                 | Independent L4 sequence and corruption tests remain required.                                                                                 |
| Unsafe dynamic paths / prototype pollution           | Frozen discriminated operation registry; strict schemas; enumerated metadata/provenance collection/field pairs; reducer lookup tables; no dynamic property path, JSON Patch, `eval` or script. | Reducer implementation and static inspection belong to L1/L4; later registry extensions require new allow-list review.                        |
| Direct raw snapshot amendment                        | Integrated C5 composition removes the public C4 snapshot POST and records initialise/restore as internal typed operations.                                                                     | Static/live route inventory must prove no alternate mutation route remains.                                                                   |
| Audit cursor tampering or cross-scope reuse          | Signed, expiring, resource-fingerprinted cursor; exclusive tuple position; schema and length limits; no raw offset/path.                                                                       | Secret rotation needs an operational policy; current codec supports one active secret.                                                        |
| Malicious or buggy audit adapter                     | Projection reparses every event, rejects foreign scope, excess rows, duplicates and non-descending order before returning data.                                                                | The SQL adapter and immutable database triggers belong to L1/integration.                                                                     |
| Log or audit leakage                                 | Structured allow-list only; no raw URL/body/token/preview/canonical JSON/commit prose/database locator; support actor redaction.                                                               | Capture logs on success and every denial/error path, including validation exceptions and SQL failures.                                        |
| Support overreach                                    | No support model role; exact branch grant, active owner approval, short expiry, revocation, read-only redacted projection.                                                                     | Grant issuance/revocation UI and operational approval are later composition work.                                                             |
| Error oracle / enumeration                           | Map internal reasons to uniform `404` for unknown/foreign resources and bounded generic cursor/preview errors; rate-limit systematic probes.                                                   | Exact timing equality is not guaranteed; monitor distributed probes.                                                                          |
| Denial of service                                    | Batch/page/string/body ceilings; reducer and geometry resource budgets; rate limiting at API/edge; bounded log fields.                                                                         | Representative latency and production-scale load evidence remain checkpoint/release work.                                                     |
| Future AI tool escalation                            | Model gateway supplies typed proposals only; service principal has preview-only capability; named human confirmation; no raw store, generic path or professional-issue tool.                   | Every future AI operation/type must be explicitly registered, threat-modelled and evaluated before activation.                                |

## Logging contract

Security events may log timestamp, authenticated actor kind and stable ID, tenant-scoped target IDs after authorisation, server-selected action, safe denial/result code, revision, registered operation types, request ID and trace ID. Use parameterised route names, not raw URLs.

Logs and public audit records must not contain:

- bearer/session/service credentials, cookies, support-grant material or signing secrets;
- preview secrets or full confirmation request bodies;
- canonical snapshot JSON, operation arguments, attributed values, evidence content or hashes used as confirmation material;
- free-form reason, commit message, model metadata/provenance values or user-entered names;
- database DSNs, table/row locators, SQL text, stack traces containing payloads or raw cursor payloads; or
- a client-visible distinction between unknown and foreign resources.

Structured error handlers should log safe codes, not validation values. Tracing attributes follow the same allow-list. A test that merely searches application responses is not log-redaction evidence; capture the actual logger sink for success, rejection and server-error paths.

## Executable evidence in this lane

The provider-free model policy suite covers the exact action/operation registries, all owner/editor/viewer actions, every role against foreign tenants, invalid project/model/profile/branch tuples, foreign compare targets, unknown actions, forged actors, stale roles, revoked memberships, machine delegation/capability/expiry/tenant rules, internal operation rejection, machine self-confirmation denial, human and machine preview theft, preview expiry/consumption and exact support-grant rules.

The provider-free audit suite covers signed cursor round-trip, tampering, truncation, malformed encoding, expiry, cross-project/branch reuse, newest-first exclusive pages, no duplicates, 100-row public bounds, redaction-safe member/support records, support expiry recheck, malformed access, adapter over-return, foreign tenant/project/model/profile/branch rows, duplicate/misordered rows and the absence of update/delete methods on the in-memory append-only port.

## Integration exit criteria

C5 is not complete until merged integration also proves:

1. every C5 route selects the expected core action in server code and supplies persisted resource identity;
2. identity and current membership are reloaded on every preview, commit, restore, history, compare, audit and idempotent replay;
3. every database statement includes tenant/project/model/profile/branch scope and foreign/missing resources have the same safe response;
4. preview is non-mutating and commit atomically applies branch-head predicates, snapshot, operations, commit, audit and outbox;
5. preview theft, membership revocation, stale/racing commits, consumed preview and same-key/different-body or actor replays fail with no partial effect;
6. immutable triggers prevent update/delete of operation, commit, snapshot and audit history;
7. the production audit adapter implements exclusive `(occurred_at, event_id)` cursor order and never accepts raw offsets/fragments;
8. static and live route inventory finds no integrated public raw-snapshot mutation path;
9. captured logs contain none of the forbidden fields above across success, denial, validation, conflict and server failure; and
10. future AI lanes import the preview-only machine policy and named-human confirmation path instead of creating a parallel tool or persistence boundary.

Until those gates pass, this lane establishes a policy kernel, safe audit projection and precise integration contract; it does not claim database immutability, route coverage, transactionality, deployment security or production support operations.

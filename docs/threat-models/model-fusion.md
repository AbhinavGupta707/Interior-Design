# C9 model-fusion threat model

## Scope and authority

This model covers C9 source registration references, independent fusion evaluation, discrepancy decisions, exact C5 operation drafts, worker leases/publication and the synthetic acceptance workspace. C9 authority ends at proposal-only geometry and a branch/revision/head-hash-pinned operation draft. It cannot preview or commit C5 operations, advance a branch, write a canonical snapshot, erase discrepancies, infer exact occluded interiors or establish survey/professional truth.

## Protected assets

- tenant, project, model, existing-profile base snapshot, job, attempt, proposal and branch identity;
- immutable source reference/schema/hash, provenance, coordinate/scale state and processing rights;
- training permission, which is separate and fixed to denied;
- exact anchors, transforms, residuals, connected components, coverage, discrepancies and unknown regions;
- cancellation, retry, lease epoch/token/expiry/version and atomic publication fences;
- attributable decision actor/version/reason and exact operation-draft pins;
- canonical snapshots, branches and C5 preview/commit endpoints outside C9 authority;
- credentials, local paths, object keys, signed URLs, headers, worker topology and private diagnostics;
- evaluation fixture isolation, denominators, severe errors, calibration and evidence class; and
- customer evidence and identifiers, none of which belong in repository fixtures or logs.

## Trust boundaries

1. **Actor/session to public route:** server context supplies tenant/project/role; foreign scope denies before existence disclosure.
2. **Public request to exact source graph:** source IDs resolve server-side to one project/model, immutable reference/schema/hash, existing base snapshot and current rights. Public input supplies no path, URL, token or command.
3. **Durable job to registration/fitting workers:** a bounded private envelope carries exact attempt/version and a short-lived hashed lease capability.
4. **Registration to semantic fitting:** fixed-point transforms/residuals and explicit components cross the boundary; appearance output has no dimensional authority.
5. **Worker to publication:** tenant/project/job/attempt/version/lease epoch/token/expiry, cancellation and current rights are rechecked atomically.
6. **Proposal to human review:** claims remain source-specific; conflict/unknown labels, residuals and optimistic proposal version survive presentation.
7. **Decision to C5 draft:** only exact typed operations and branch/revision/head/base pins are emitted; no C5 preview/commit or canonical write is reachable.
8. **Producer to independent evaluation:** producers may emit strict observations but cannot import, identify or tune against the C9 fixture catalog.

## Threats and mitigations

| Threat                                                            | Mitigation and independent evidence                                                                                                                 | Residual/live requirement                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Cross-tenant/project IDOR or existence disclosure                 | scope check precedes role/lifecycle checks for every action; exact reference bundle validation                                                      | merged API/Postgres/BFF tests                                |
| Cross-model, stale base or proposed/as-built base                 | exact model/base snapshot ID/hash and `existing` profile; source graph pins project/model                                                           | live repository lookups and transaction isolation            |
| Source/reference/hash substitution or duplicate source            | strict exact keys, lowercase SHA-256, exact eligible set and duplicate-reference denial                                                             | storage/object hash revalidation                             |
| Rights withdrawal or missing consent                              | service consent required at request, lease and publication; rights-active fence                                                                     | atomic database recheck                                      |
| Training permission escalation                                    | strict rights object permits only `trainingUseConsent: denied`; unknown fields rejected                                                             | downstream storage/provider policy audit                     |
| Viewer mutation                                                   | viewer read only; owner/editor action/lifecycle matrix; mock removes decision controls                                                              | real session/BFF route tests                                 |
| Direct canonical/C5 mutation                                      | exact draft schema, non-empty typed operations, branch/revision/head pins, forbidden commit/preview/canonical fields/routes, before/after invariant | production call graph and database mutation audit            |
| Lease theft, concurrent worker or expired lease                   | hashed worker/token, attempt, epoch, expiry and version; live lease denies second holder; explicit reclaim increments epoch                         | database locking/lease transaction tests                     |
| Cancel race or late publication                                   | cancellation removes lease; publication checks cancelled and terminal state                                                                         | atomic cancel/publish race under Postgres                    |
| Retry replay or stale attempt                                     | terminal-only, maximum three attempts, expected attempt/version and hashed idempotency key; new attempt fenced                                      | durable idempotency record and concurrent retry test         |
| Stale proposal decision                                           | optimistic proposal version; UI blocks and reloads before resubmit                                                                                  | live concurrent-review test                                  |
| Partial/disconnected result relabelled full                       | component count, coverage, status and unknowns remain explicit; hidden component is severe                                                          | integrated producer/browser journey                          |
| Conflict averaged away                                            | required discrepancy kinds and source claims remain visible; hidden discrepancy is severe                                                           | merged discrepancy persistence and UX tests                  |
| Occluded/unsupported geometry fabricated                          | required unknowns are exact; covered unknown, extra room/region/topology or hidden unknown is severe                                                | semantic fitter and C4 validator integration                 |
| Non-finite/overflow/type confusion                                | safe integers, explicit mm/microdegree/ppm bounds, strict records and actual NaN/Infinity tests                                                     | producer codecs/property fuzzing                             |
| Degenerate anchors or reflection                                  | three non-collinear points verified with integer cross product; non-positive determinant rejected                                                   | L1 numerical/property suites                                 |
| Count/depth/string/resource bomb                                  | source/anchor/element/array/node/depth/string/latency/memory limits and worker timeout                                                              | scheduler CPU/RAM/disk quotas                                |
| Path, URL, object-key, token, executable, flag or shell injection | recursive public-key/value denial; public manifests are location-free                                                                               | private staging/symlink/TOCTOU review                        |
| Log/trace leakage                                                 | allowlisted codes/counts only; stable IDs one-way hashed; untrusted payload omitted                                                                 | service logger, error middleware and collector configuration |
| Fixture laundering into a producer                                | production-root static scan rejects fixture paths and identifying exports                                                                           | preserve test isolation after lane merges                    |
| Missing/failed case removed from evaluation                       | exact expected denominator; missing, failed and abstained observations cannot become zero success                                                   | producer-live report review                                  |
| Synthetic result promoted as live/human/hardware evidence         | fixed evidence class, promotion false, representative claim false, human `NOT_MEASURED`, explicit `NOT RUN` list                                    | orchestrator ledger/evidence review                          |

## Logging policy

Allowed fields are bounded event/safe codes, attempt, stage, duration/resource/source counts, hashes and one-way SHA-256 of stable tenant/project/job IDs. Forbidden fields include request bodies, anchors, source claims, room/element labels from customer data, source bytes, customer identifiers, filenames, local paths, object keys, URLs, query strings, signed access, authorization/cookies, credentials, lease tokens, private worker envelopes, tool output, exception text containing untrusted data and operation parameters.

## Mutation and publication invariant

A worker result is publishable only under the exact live tenant/project/job/attempt/version/lease epoch/token before expiry, with rights still active, cancellation false and no terminal result. Publication is immutable and atomic. The proposal remains `proposal-only`. Review stores attributable optimistic decisions. Draft creation returns exact C5 operations pinned to the existing base, branch revision and head hash while branch revision and canonical snapshot hash remain unchanged.

## Open risks and unavailable evidence

- C9 L1/L2/L3 producers are not merged in this lane; live API/database/worker/BFF checks remain **NOT RUN**.
- Static/reference tests cannot prove production SQL locking, atomic publication, storage isolation, worker credentials or real log collectors.
- Physical RoomPlan, real COLMAP/Open3D, neural/GPU/CUDA and provider execution remain **NOT RUN**.
- Representative homes and human correction studies are absent; correction time is **NOT MEASURED**.
- Euler microdegrees are an independently checkable synthetic evaluation representation; production durable transforms remain the C9 fixed-point quaternion E9 contract.
- Production semantic fitting and C4 validation need severe-error/property testing against the same unknown/discrepancy invariants after merge.

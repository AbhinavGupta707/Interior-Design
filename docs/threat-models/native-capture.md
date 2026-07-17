# Native capture threat model

## Scope and safety boundary

C7 creates a server-pinned capture session, preserves immutable RoomPlan-derived evidence, uploads checksum-bound artifacts and produces either a canonical-shaped existing-state proposal or explicit abstention. It does not retain camera frames, send `ARWorldMap`, infer hidden construction, establish survey accuracy, mutate canonical state or confirm a professional conclusion.

The model covers the native app, protected local resume state, Keychain authentication, public capture API, signed multipart storage boundary, source bucket, queue/lease, converter worker, proposal publication and redacted telemetry.

## Protected assets

- tenant/project/session identity and authorisation;
- service-processing rights and separately denied training permission;
- immutable Apple encodings, normalized JSON, quality manifest and optional USDZ;
- source/package/converter/proposal hashes and exact version linkage;
- local protected resume metadata, checksums and optional local-only world map;
- authentication tokens, object keys, signed URLs and multipart upload state;
- worker attempt/lease fences, terminal proposal or abstention and immutable audit events.

Camera frames are outside C7 retention. A world map is local resume state only and must never enter a server package, log, crash report or analytics event.

## Trust boundaries and attacker goals

1. **User/app to API:** a malicious or compromised client can forge IDs, roles, rights, device claims, artifacts, sizes, hashes, states and idempotency keys.
2. **API to object storage:** signed URLs are bearer capabilities subject to expiry, checksum, byte, kind, session and tenant binding.
3. **API/storage to worker:** source bytes and normalized JSON are hostile; queue payloads and attempt numbers can be stale, replayed or substituted.
4. **Worker to proposal store:** output can contain invalid geometry, foreign references, unsafe strings, excessive counts or an attempt to mutate canonical state.
5. **Process to telemetry:** errors can exfiltrate tokens, URLs, object keys, raw JSON, local paths, world maps or identifiers.
6. **Device lifecycle:** interruption, background termination, offline operation and rights withdrawal can leave stale protected state or cause incompatible world spaces to be joined.

Likely attacks include IDOR, tenant enumeration, validation-order disclosure, hostile/oversized JSON and strings, prototype/confusing keys, path/object-key/URL confusion, artifact substitution, JSON/USDZ signature mismatch, checksum collision claims, duplicate/out-of-order/replayed parts, expired signed URLs, interrupted completion, stale retry publication, cancellation races, rights withdrawal, incompatible structure space, non-finite/extreme transforms, count/memory/CPU exhaustion and log injection.

## Required controls

### Identity, rights and disclosure

- Authenticate before resource lookup. Resolve tenant/project/session scope before role/body/state detail. Foreign and absent resources return the same bounded `404` shape.
- Owner/editor may create, upload, finalise, cancel and retry. Viewer and machine actors are read-only for sessions/proposals. No machine actor can confirm canonical mutation.
- A server-issued brief pins project, session, mode, expiry, instruction version and exact rights. Missing, expired, revoked or changed service-processing rights fail before upload finalisation, worker lease and publication.
- Training use is independent and fixed to `denied`; a client cannot upgrade it.

### Local device and lifecycle

- Tokens live in Keychain. Resume files use iOS data protection. Raw artifacts, signed URLs, object keys and world maps are excluded from preferences, analytics and crash messages.
- Background resumption uses persisted descriptors/checksums and server reconciliation. It never pretends to resume an authoritative live sensor session after termination.
- Relocalisation is bounded. Failure offers explicit restart and invalidates rooms that cannot share the new world origin. Incompatible rooms abstain rather than merge.
- Unsupported/denied/restricted devices retain plan/photo/manual fallback with honest copy.

### API and upload

- Parse bounded UTF-8 JSON before allocation-heavy validation; reject excessive bytes/depth/strings, malformed input, unknown fields and confusing keys.
- Never accept object keys, signed URLs, local paths or world maps in public request schemas. Generate internal keys from validated opaque IDs; prohibit traversal, separators, encodings and control characters.
- Bind every artifact to ID, tenant/project/session, kind, media type, exact byte size and SHA-256. Verify bytes and media signature before immutable publication. USDZ requires ZIP signature and safe archive inspection by the producer worker.
- Bind every signed part to upload/artifact/session, part number, exact checksum, byte range and short expiry. Exact replay is idempotent; conflicting replay fails. Completion parts are unique, consecutive and ordered.
- Interrupted completion remains non-terminal until storage and persistence agree. Terminal completion and proposal/abstention are immutable; different replays conflict.

### Worker and output

- Lease payloads contain only scoped opaque references and one attempt fence. Workers have least-privilege source-read/derived-write access, no broad tenant credentials and no public mutation capability.
- Recheck identity, rights, cancellation and attempt immediately before lease and immediately before publication.
- Stream artifacts; enforce 512 MiB per artifact, 2 GiB package, 64 rooms, 10,000 surfaces, 10,000 objects, 10,000 parts and evaluator CPU/memory ceilings. Timeout/OOM stays in the failure denominator.
- Strictly reject non-integer/non-finite/out-of-range transforms, duplicate IDs, missing parents, unknown rooms and incompatible world space.
- Output is one immutable proposal or abstention linked to source/package/normalized/converter hashes. C5 preview/commit is unavailable to the converter capability.

### Telemetry

- Log only bounded codes, status, route templates, actor class, attempt and hashed correlation values.
- Redact request URLs. Never log tokens, idempotency keys, project/session/artifact IDs, raw bodies, filenames, local paths, object keys, signed URLs, world maps or Apple encodings.
- Test redaction with seeded canaries and inspect process output separately; absence from a reference logger alone is insufficient live evidence.

## Acceptance evidence mapping

| Threat                                                   | Independent test                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| IDOR/disclosure order                                    | `tests/security/capture/api-scope.security.test.ts` and opt-in live API probes |
| JSON/string/path/URL confusion                           | API scope security suite                                                       |
| artifact substitution/signature mismatch                 | `upload.security.test.ts`                                                      |
| duplicate/order/replay/expiry/interruption               | multipart ledger suite                                                         |
| rights/cancel/retry/world-space/count/transform ceilings | `worker.security.test.ts`                                                      |
| log disclosure                                           | seeded-canary log test plus required live log inspection                       |
| mobile interruption/offline/state honesty                | `tests/mobile/capture` and C7 XCUITests                                        |
| failure-inclusive quality                                | `tests/evaluation/roomplan`                                                    |

## Residual risks and release blockers

- No physical LiDAR device was connected on 17 July 2026. Camera permission, real RoomPlan capture, tracking, relocalisation, thermal behaviour and background transfer remain **NOT RUN** and block C7/C18 release.
- Synthetic USDZ signature checks do not prove a complete hostile ZIP/USD archive parser. The integrated media worker must demonstrate entry/path/count/compression/resource limits.
- Reference security machines do not prove live API/storage/database/worker ordering. The opt-in live suite and post-merge disposable stack are mandatory.
- Simulator accessibility inspection does not replace VoiceOver use on a physical device.

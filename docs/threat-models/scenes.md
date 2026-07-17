# C10 deterministic scene threat model

## Scope and security objective

This model covers the web viewer, its same-origin BFF, short-lived scene access grant and browser-side GLB verification. The security objective is to let an authorised project member inspect a derived visualisation without turning a signed URL, malformed artifact, display name or generated appearance into canonical dimensional truth or a cross-tenant capability.

Canonical home data, source evidence and scene publication remain backend responsibilities. The browser can request operations but cannot authorise itself, commit geometry or broaden the meaning of derived output.

## Assets

- Tenant and project identity, role and session state.
- Exact source tuple: project, model profile, model ID, snapshot ID, schema version and snapshot SHA-256.
- Immutable scene/job IDs, attempt/fencing state, manifest and GLB checksums.
- Short-lived signed artifact URLs and their expiry.
- Canonical element IDs and element-to-node mappings.
- Browser availability, memory and render budget.
- Honest evidence classification and professional-boundary language.

## Trust boundaries

1. Browser to same-origin `/api/c10`: cookie-authenticated, CSRF/idempotency-aware application boundary.
2. BFF to C10 API: bearer-authenticated server boundary; tenant, role and state enforcement belongs here and upstream.
3. C10 API to immutable artifact store: a narrowly scoped, short-lived read capability.
4. Signed artifact bytes to GLTFLoader/GPU: hostile binary/content boundary even after transport success.
5. Canvas to DOM inspection: visual picking is advisory; canonical identity comes from the manifest mapping and DOM list.

The synthetic browser server crosses none of the deployed service boundaries and is never real-backend evidence.

## Threats and controls

| Threat                                    | Failure mode                                                                | Required control                                                                                                                                                    | Residual risk / follow-up                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| IDOR / tenant swap                        | Attacker substitutes project, job or scene IDs                              | Strict UUID parsing; exact route allow-list; server-side session/authz; upstream project scoping; not-found response for foreign resources; tuple verification      | Run deployed two-tenant tests against real policy and audit events                                                        |
| Role escalation                           | Viewer invokes create/cancel/retry                                          | UI removes mutation actions; BFF still forwards authenticated intent only; upstream is authoritative; role suites require viewer denial                             | UI is not a security boundary; deployment test must prove upstream denial                                                 |
| Stale/fenced mutation                     | Old tab cancels/retries a newer attempt                                     | Strict expected-state/attempt body plus required idempotency key; upstream optimistic transition                                                                    | Real concurrency and replay tests remain required                                                                         |
| Signed URL disclosure                     | URL leaks through logs, diagnostics, cache or persistence                   | Access response is `no-store`; no console/log/storage path; URL is held only for direct fetch; safe problem response allow-lists fields                             | Browser/network tooling can observe an in-use capability; TTL and object-store scope must remain narrow                   |
| Malicious redirect/origin                 | Signed URL redirects to an attacker-controlled endpoint                     | Artifact fetch uses `redirect: error`; no external glTF dependencies are allowed                                                                                    | Validate deployed signer origin policy and response headers                                                               |
| Manifest/artifact substitution            | Valid scene metadata paired with wrong bytes or snapshot                    | Exact job/scene/access/source tuple; manifest canonical hash; GLB SHA-256; byte count/content type; expiry                                                          | A compromised authorised backend can still sign malicious content; immutable publication controls are upstream            |
| Parser confusion                          | Truncated/oversized/extra chunks or malformed accessors reach GLTFLoader    | Verify GLB header, declared length, alignment, exactly one JSON and one BIN chunk, glTF 2.0, primitive modes and accessor counts before loading                     | GLTFLoader/Three/browser defects remain dependency risks; keep patched and retain renderer error boundary                 |
| External URI / active content             | GLB loads remote/data content or carries scriptable payload markers         | Recursively reject any `uri`, active-content markers and unsupported required extensions before GLTFLoader                                                          | Marker scanning is defence in depth, not a general content scanner; frozen compiler profile must also reject these inputs |
| Resource exhaustion                       | Huge asset stalls UI/GPU or allocates excessive memory                      | Public/server cap plus stricter client budget: 20 MiB, 5,000 nodes, 1.5M vertices, 750k triangles; streaming byte ceiling; DOM fallback                             | GPU driver allocation can exceed logical counts; require real hardware stress evidence                                    |
| Canvas identity spoofing                  | Display names or arbitrary nodes impersonate canonical elements             | Selection derives only from canonical manifest mappings; stable canonical IDs synchronize canvas, DOM list and inspector                                            | Picking precision is visual assistance; DOM list remains authoritative for inspection                                     |
| Canvas focus trap / inaccessible controls | Keyboard or assistive-technology users lose navigation                      | Canvas `tabindex=-1`; global walk keys ignore form/contenteditable targets; labelled DOM controls; visible instructions; button alternatives; DOM summary/inspector | Physical keyboard, switch-control and screen-reader acceptance remain required                                            |
| Context loss / render exception           | App presents stale success or blank canvas                                  | Context-loss handler, React error boundary, explicit renderer fallback and fresh-access retry; success announced only after verified render readiness               | Browser/driver-specific recovery needs hardware coverage                                                                  |
| False professional certainty              | Visual output is presented as survey/structure/compliance/traversable truth | Persistent derived-only language; bounds view says not a floor plan; no claims of survey, structure, cost, availability, compliance or professional approval        | Product copy and downstream exports must preserve the same boundary                                                       |
| Fixture laundering                        | Synthetic tests are reported as production evidence                         | Environment classification in strict workspace schema; prominent fixture banner; acceptance record separates local, browser, real-backend and hardware evidence     | Reviewers must reject screenshots without classification and command provenance                                           |

## Logging, caching and observability rules

- Never log or persist the signed URL, raw bearer token, cookie, GLB bytes or unredacted upstream error payload.
- Emit operation/job/scene IDs, safe status codes and bounded error codes only where the upstream observability contract allows it.
- BFF responses use `cache-control: no-store`; deployed artifact responses must match the frozen private-cache policy and MIME/length contract.
- A renderer performance metric is evidence only when the production WebGL gate accepts the browser. A fallback or skipped run must not emit fabricated FPS.

## Abuse and recovery cases

- Expired grants request new short-lived access; they do not reuse or refresh the old URL client-side.
- Offline, checksum, content, semantic, over-budget, renderer and context-loss failures preserve the exact DOM scene summary and do not announce interactive success.
- Cancel and retry are explicit operations; retry creates a fenced new attempt and never mutates a succeeded immutable artifact in place.
- Unknown and foreign identifiers use bounded not-found responses without leaking whether another tenant owns the resource.

## Required deployment evidence

Before C10 production acceptance, run the suites against real owner/editor/viewer users in at least two tenants, verify audit events and idempotent replay, inspect object-store headers/expiry, exercise a real compiler-published GLB, measure supported desktop/mobile GPU budgets, and validate screen-reader/keyboard/context-loss behaviour on physical devices.

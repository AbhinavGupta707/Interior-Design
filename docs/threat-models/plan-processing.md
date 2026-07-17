# Plan-processing threat model

## Scope and security objective

C6 takes one exact C2-ready plan page and may publish an immutable typed proposal or explicit abstention. It does not survey a home, infer structure or regulation, train on customer uploads, mutate the canonical model or bypass C5 preview/commit.

The security objective is fail-closed processing: only the exact authorised tenant/project/asset/page/source hash with retained service-processing consent and training denial may be leased; hostile or resource-exhausting content cannot execute, fetch, escape isolation, expose credentials or publish unvalidated geometry; and cancellation, retries or direct parser actions cannot create an unauthorised canonical mutation.

## Assets

- immutable source bytes, source SHA-256 and C2 rights/status records;
- tenant, project, asset, job, proposal and normalized-input identities;
- parser/normalizer/tool versions and proposal hashes;
- proposal geometry, confidence, findings and unresolved regions;
- calibration evidence and operation-draft candidate mapping;
- C5 branch revision/head hash, operation preview and immutable commit history;
- platform, storage, database and provider credentials, which must never enter the parser process;
- safe workflow/audit/log records; and
- holdout fixture identities and hashes, which producers must not access.

## Trust boundaries and principals

1. Browser to BFF/API: untrusted request bodies, identifiers, idempotency keys and current authentication state.
2. API/workflow to C2 source store: exact tenant/project/asset/hash/status/rights checks precede disclosure or lease.
3. Source store to spatial normalizer: hostile bytes cross into a credential-free, no-egress, generated-path temporary workspace.
4. Spatial normalizer to parser: only a bounded normalized manifest and rewritten grayscale raster cross the boundary; extracted text is untrusted label data.
5. Parser to workflow: untrusted JSON is size-bounded, strict-schema parsed, source scoped and geometry validated before transactional publication.
6. Proposal/calibration/draft to C5: parser identity may propose only. A current authorised person explicitly previews and commits exact typed operations through C5.
7. Evaluation to producer: holdout catalogs are test-only and cannot be imported or enumerated by producer code.

Human roles are owner, editor and viewer. Owner/editor may create, cancel, retry, calibrate and draft; viewer reads only. Machine parser identity may emit a proposal but cannot calibrate, draft, preview, commit, restore or execute database/state tools.

## Threat and control matrix

| Threat                                                                | Required control                                                              | Independent verification                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| SVG DTD/entity/XXE                                                    | reject DTD/entity before parsing                                              | creator-owned XXE fixture                                                           |
| SVG script/style/event/foreign object                                 | reject active DOM/CSS constructs                                              | script, style-import and event-handler fixtures                                     |
| SVG/PDF external resources                                            | no URL/file/data resource resolution; no egress                               | SVG image/style and PDF URI fixtures; explicit egress-denial tests                  |
| PDF JavaScript, launch, embedded file, rich media, XFA/object streams | reject unsafe actions/containers before rendering                             | JavaScript, launch and embedded-file fixtures plus token denylist                   |
| Raster bombs and malformed headers                                    | bounded byte/pixel dimensions before decode; isolated decode                  | 10-billion-pixel header, truncation and polyglot fixtures                           |
| Text/prompt injection                                                 | discard text from policy/tool control; retain only safe label treatment       | prompt-like SVG text remains accepted only as discarded untrusted label data        |
| Malformed/oversized parser JSON                                       | 5 MiB maximum, strict JSON/schema, unknown-field rejection                    | malformed, 5 MiB+1 and unknown-version/field attacks                                |
| Raw source, path, object key, URL, stderr or secret in result         | forbidden-field recursion plus strict proposal schema                         | direct-mutation, object-key, signed-URL and stderr attacks                          |
| Tenant/project/asset/hash mismatch                                    | reauthenticate membership, bind every identifier and source hash              | foreign tenant/project/asset/hash cases                                             |
| Rights/status mismatch                                                | require `ready`, service consent true and training denied at lease time       | non-ready, withdrawn consent and non-denied training cases                          |
| Path traversal/object-key confusion                                   | generated temporary names; exact scoped object key; no user paths             | traversal, absolute path, URL and foreign-key cases                                 |
| Parser credential theft                                               | construct a minimal child environment without platform/cloud/provider secrets | environment allowlist and secret-name scan                                          |
| Parser egress                                                         | process/network sandbox denies every outbound target                          | HTTP, loopback database, file and DNS targets                                       |
| Log/audit leakage                                                     | allowlisted IDs/hashes/versions/counts/safe codes only                        | raw prompt, object key, signed URL, stderr and API-key marker redaction             |
| Stale/cancelled lease publishes                                       | lease-token fencing; cancellation monotonic                                   | cancel/publish race and stale-token cases                                           |
| Retry duplicates or rewrites                                          | maximum three append-only attempts; prior terminal result retained            | failure/abstention retry sequence and terminal snapshot comparison                  |
| Idempotency confusion                                                 | 8–128 byte key; exact actor/action/body replay; mismatch conflicts            | actor, action and body conflict tests                                               |
| Parser direct canonical mutation                                      | one proposal-emission capability only; C5 remains sole commit boundary        | preview/commit/restore/calibrate/draft/database action denial                       |
| Hard-negative false acceptance                                        | 100% abstention and zero severe errors                                        | six declared hard-negative holdouts                                                 |
| Confidence laundering                                                 | all failures/abstentions remain denominators; ECE needs at least 20 samples   | missing/failure/abstention denominator and insufficient-sample tests                |
| Holdout leakage                                                       | no package export and producer-source import scan                             | fixture boundary unit test                                                          |
| Viewer or foreign disclosure                                          | server-side current membership and project scoping                            | reference viewer E2E plus named live opt-in; live gate remains NOT RUN when skipped |

## Race and state invariants

- A queued job may become cancelled without leasing. A processing job becomes cancel-requested before cancelled.
- A cancel-requested or cancelled attempt cannot publish, even with the formerly valid token.
- A stale lease cannot publish after retry or supersession.
- Proposed results are terminal and cannot be cancelled or retried.
- Only retryable abstained/failed attempts can append a retry, and no job exceeds three attempts.
- Prior terminal result hashes remain inspectable after a retry.
- Idempotent replay requires the exact actor, action, key and canonical body. Any mismatch conflicts.
- Parser output never calls C5 or a database tool. Authorised user action and current C5 revision/head preconditions remain mandatory.

## Safe observability

Permitted fields are bounded safe code, correlation/trace ID, fixture/job/proposal IDs only where policy permits, content/version hashes, parser/tool versions, state, counts, duration and resource observations. Public logs must not contain raw source bytes, customer filename, object key, signed URL, local path, extracted text, prompt content, parser stderr, idempotency key, cookie, bearer token, database URL or provider/cloud credential.

Evaluation reports may publish synthetic fixture IDs and SHA-256 values because the fixture catalog is creator-dedicated and contains no customer data. Producer/live tokens and locators must never be copied into an evaluation report.

## Residual risks and non-evidence

- Static/reference tests do not prove OS sandbox, container policy, production IAM, outbound firewall or database row-level isolation.
- The live producer, API/database and correction UI were unavailable in this independent lane. Their opt-ins skip by name and are `NOT RUN`, not passes.
- Small synthetic PDFs/SVGs/rasters cannot cover every decoder vulnerability or establish real-home accuracy.
- No malware engine, fuzzing campaign, customer media, provider, GPU or production cloud environment was used.
- Correction action/timing instrumentation is automated and cannot establish the 8/15-minute human target.
- The reference Playwright workspace proves acceptance assertions and selector semantics only; it is not product UI evidence.

Promotion is blocked until the real producer/live adapter passes the absolute and reference-comparison gates in `docs/evaluation/plan-parser-v1/promotion-rules.md` with no required live skips.

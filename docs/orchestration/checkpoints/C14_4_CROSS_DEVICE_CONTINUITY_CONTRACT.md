# C14.4 Contract — Cross-device design-studio continuity

## Authority, predecessor and outcome

- Checkpoint: C14.4, the next smallest shared checkpoint after C14.3. C15 remains closed.
- Immutable predecessor: clean `main` commit
  `e38b32783a08e026d31a8424210b429730393a79`.
- Integration branch: `codex/c14-cross-device-continuity`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Outcome: web and a future standalone iOS consumer can recover the exact persisted C12
  confirmation required by C13 and discover exact currently selectable C14 C10/C13/camera
  references without browser-local authority or client inference.
- Contract impact: two additive project-scoped read routes, shared response schemas and a pinned
  OpenAPI 3.1.2 source with deterministic TypeScript and Swift clients.
- Migration impact: none. Existing C12 confirmations, C10 scenes and C13 bindings remain the only
  persistence authorities.

This checkpoint closes only the two cross-device gaps documented by C14.3 acceptance and the Mac
handoff. It does not add a native C10–C14 UI, C15, physical-device evidence, C8/C9 production
routing, provider acceptance, render hardware acceptance or a new canonical mutation.

## Audited predecessor

The implementation audit was completed before freezing this contract:

1. `OptionConfirmation` is persisted under tenant/project/job/option scope, but its ID is returned
   only by `POST .../confirm`. C13 accepts only that opaque server-issued confirmation ID. The web
   therefore retained up to four confirmation records in project-scoped local storage, which cannot
   recover on another browser or device.
2. C14 `GET .../render-capabilities` is a host-only authority containing admission, enhancement,
   hardware and frozen-profile state. The web BFF incorrectly validates that response as a richer
   presentation schema containing sources, cameras and specifications, so host-live loading fails
   closed.
3. Exact C10 scene artifacts and manifests are server-owned. Camera IDs are mapped canonical C10
   camera element IDs. Exact C13 specification/catalog hashes and current rights state are resolved
   by the existing server-owned C13 authority. C14 job creation already re-resolves the selected
   scene, immutable GLB, embedded C13 binding, live rights and frozen profile before persistence.
4. `packages/api-contracts/openapi/README.md` is only a placeholder. No OpenAPI source or generated
   C10–C14 TypeScript/Swift client exists. The new surface therefore needs the smallest deterministic
   generation seam rather than another hand-written web/mobile contract.
5. Existing authorisation actions already express the correct read policy. No new permission or
   role is required.

## Frozen shared HTTP contract

### C12 exact confirmation recovery

`GET /v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId/confirmation`

- Authorisation: existing `design-option:proposal:read` action.
- Response: the unchanged `c12-option-confirmation-v1` record.
- Scope validation: the confirmation must match the authenticated tenant plus every route ID. A
  missing or foreign project, job, option or confirmation is an indistinguishable `404`.
- C13 continues to accept only `confirmation.id`; the client cannot construct, rebase or substitute
  a confirmation.
- Response caching is `private, no-store`. The endpoint is read-only and has no idempotency header.

### C14 exact eligible-source discovery

`GET /v1/projects/:projectId/render-eligible-sources`

- Authorisation: existing `render:job:read` action.
- Response schema version: `c14-render-eligible-sources-v1`.
- Each source contains a complete existing `RenderSourceReference`: project, C10 scene job/scene/
  artifact IDs, exact GLB/manifest/source-snapshot SHA-256 pins and, when bound, exact C13
  specification revision/catalog hashes. It also contains a bounded sorted list of mapped C10
  camera IDs. Labels are bounded presentation strings derived deterministically from retained IDs;
  they are not provenance.
- Only succeeded tenant/project C10 scenes with at least one mapped camera are considered. A bound
  C13 scene is returned only when its authoritative exact binding is resolvable and every referenced
  current catalog right remains active. An unbound C10 scene remains selectable only without a
  specification.
- The discovery result is a current eligibility snapshot, not a lease. C14 creation remains the
  final authority and re-reads the immutable GLB, verifies its hash and embedded C13 binding,
  rechecks rights and resolves the selected frozen profile before accepting a job. Stale selections
  therefore fail closed rather than being silently rebased.
- A valid but ineligible record is omitted. Malformed or unavailable authority fails the request
  safely; no partial record, storage locator, source byte, signed URL or credential is disclosed.
- Sources and cameras are deduplicated and deterministically sorted. Response caching is
  `private, no-store`.

The existing host-only `GET .../render-capabilities` contract is preserved. The web BFF composes
that validated host authority with the new validated eligibility response into its existing display
schema. Clients never infer eligibility from render-job history.

## Generated-client contract

- Canonical source: a checked-in OpenAPI `3.1.2` document under
  `packages/api-contracts/openapi/` containing these two GET operations and their complete response
  components.
- Generator: one repository-owned Node generator with a frozen generator version and only the
  already pinned repository formatter. Generated files embed the OpenAPI SHA-256 and generator
  version.
- Outputs: a strict TypeScript client exported through the existing shared contracts package and
  consumed by web, plus a Swift 6 package usable by standalone iOS 17+ code. Both percent-encode
  path IDs, issue only GET requests, request JSON, disable caching and expose typed decoded records.
  Swift uses ephemeral/no-cache URL loading and bearer
  `Authorization`; web maps the generated canonical operation through its server-owned BFF and never
  exposes the bearer token to browser storage.
- Drift gate: regeneration must be byte-stable and a checked-in test fails when OpenAPI or generated
  output diverges. No external generator download or unpinned dependency is introduced.
- Generated clients are transport/data infrastructure only. They are not wired into native screens
  in this checkpoint.

## Authorisation, security and failure rules

- Owner, editor and viewer read behavior remains exactly the accepted policy. C12 confirmation and
  C14 job creation permissions are unchanged.
- Authentication precedes project disclosure. Cross-tenant reads return the existing hidden-not-
  found behavior. Machine/service actors receive only what their existing read policy permits and
  gain no confirmation mutation path.
- Repository lookups include tenant, project, job and option/scene scope. All response payloads are
  parsed through strict shared schemas at the service route and again at the web trust boundary.
- No bearer token, address, source media, GLB bytes, object key, signed URL, provider payload or
  unredacted exception is retained in clients, logs or responses.
- An empty eligibility list is valid and honestly means no current selectable source. Authority or
  response corruption is an error, never fabricated empty success.

## Single-session orchestration decision

The mandatory parallelism gate is not satisfied. The two reads are tightly coupled through
orchestrator-owned shared contracts, one OpenAPI document, one generated-client package, platform
composition and the same web continuity consumers. Independent acceptance must consume the
integrated contract and is sequential. Splitting these paths would create overlapping ownership and
contract drift without reducing the critical path.

No task, subagent or worktree is spawned. The already registered historical worktrees are unrelated
and remain untouched. If a later audit finds a genuinely independent body with exclusive paths, the
ledger must record its model/reasoning, base, contract and ownership before any spawn.

## Required implementation and evidence

1. Add the shared schemas/routes and generated TypeScript/Swift clients without changing existing
   schema versions, dependency pins or mutation contracts.
2. Implement C12 repository/service/route/BFF recovery for in-memory and PostgreSQL adapters. Web
   recovery must discard local confirmation authority and fetch exact confirmed-option records from
   the server after every cold load.
3. Implement C14 authoritative discovery through the existing C10 and C13 authorities. Keep host
   capability separate and keep creation-time immutable-byte/binding/rights revalidation.
4. Add contract, generated-drift, service, route, PostgreSQL integration, web BFF/client, tenant/
   role/security and regression tests. Tests must cover foreign scope, missing state, malformed
   upstream data, inactive rights, binding/no-binding behavior, camera omission/deduplication,
   deterministic ordering and a stale discovery selection rejected at job creation.
5. Compile and test the Swift package on the Mac host. This is client-contract evidence only, not
   native UI, Simulator, device, camera, RoomPlan or LiDAR evidence.
6. Run focused gates, `git diff --check`, generated-drift verification and the full repository
   `pnpm verify` gate. Record exact counts, capability skips and limitations.
7. Update this contract, the active/master plans, ledger and C14.3 handoff/evaluation status with
   exact commits and evidence. Open a non-draft PR targeting `main`; do not merge it.

## Terminal rule

C14.4 closes only when both shared recovery routes are implemented end to end, web consumes the
generated TypeScript contract, the generated Swift package compiles/tests, tenant and fail-closed
behavior are proved, complete gates pass, documentation matches the exact evidence and a non-draft
PR targeting `main` is open. C15 and all excluded native/provider/hardware/reconstruction work stay
closed.

## Closeout — 2026-08-26

- Contract freeze: `aa3eb2f`; implementation: `aae3379`.
- The two frozen project-scoped GET routes are implemented through shared schemas, in-memory and
  PostgreSQL/platform authorities, strict BFF boundaries and generated TypeScript/Swift clients.
- OpenAPI `3.1.2` SHA-256 is
  `c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508`; generator version is
  `interior-design-continuity-generator-1.0.0`. Generation/check is byte-stable and part of the
  contracts test command. Root dependency versions and `pnpm-lock.yaml` are unchanged.
- C12 confirmation recovery is server-authoritative and exact-scoped. Browser recovery v2 retains
  only job/comparison selection and erases legacy locally retained confirmations on migration.
- C14 discovery returns only succeeded C10 scenes with mapped cameras and valid current C13 rights,
  while render creation independently revalidates the selected camera, immutable GLB/hash, embedded
  C13 binding, live rights and frozen profile. Malformed/unavailable authority fails the request;
  stale and forged selections are rejected.
- Focused contracts, platform, web, PostgreSQL, integration, security, evaluation and Playwright
  gates passed. Swift built and passed 2 tests. Final full
  `UV_CACHE_DIR=/tmp/c14-4-uv-cache CI=1 corepack pnpm verify` passed all 24 lint, 24 typecheck,
  45 unit dependency and 24 build tasks; Ruff/mypy passed; Python passed 157 with 2 optional
  capability skips.
- Durable evidence:
  `docs/evaluation/homeowner-journey/C14_4_CROSS_DEVICE_CONTINUITY_ACCEPTANCE_2026-08-26.md`.
- Review vehicle: non-draft PR
  [#7](https://github.com/AbhinavGupta707/Interior-Design/pull/7) targets `main` and is deliberately
  left unmerged.
- Native C10–C14 UI, Xcode/Simulator/physical-device evidence, C8/C9 production, provider/render
  hardware acceptance, representative-home evidence and C15 were not run or opened.

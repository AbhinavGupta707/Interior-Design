# C14.4 Cross-device Continuity Acceptance — 2026-08-26

## Acceptance position

C14.4 closes the two shared continuity gaps retained by C14.3. Persisted C12 confirmation state is
now recoverable by exact tenant/project/job/option scope, and C14 exposes a separate current
eligibility snapshot derived from authoritative succeeded C10 scenes, mapped cameras and exact C13
bindings/rights. Web consumes both reads through the same generated TypeScript contract available
to a future standalone iOS consumer.

This is shared-contract, platform, web and generated-client acceptance. It is not native C10–C14 UI,
an Xcode/Simulator or physical-device run, RoomPlan/LiDAR evidence, C8/C9 production evidence, a
representative home, an enabled provider, or render-hardware acceptance. C15 remains closed.

## Revision and orchestration trail

- Authoritative predecessor: clean `main`
  `e38b32783a08e026d31a8424210b429730393a79`.
- Contract freeze: `aa3eb2f` (`docs(c14.4): freeze cross-device continuity contract`).
- Implementation: `aae3379` (`feat(c14.4): add cross-device continuity authorities`).
- Integration branch: `codex/c14-cross-device-continuity`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Parallelism: the mandatory gate was recorded as unsatisfied before implementation. The two reads
  share one OpenAPI source, generated clients, platform authority and web consumers, so no task,
  subagent or worktree was spawned. Historical worktrees were untouched.

## Frozen shared surface

- `GET /v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId/confirmation`
  uses `design-option:proposal:read`, returns the unchanged `c12-option-confirmation-v1` record and
  hides missing/foreign state as `404` after authenticated project scoping.
- `GET /v1/projects/:projectId/render-eligible-sources` uses `render:job:read` and returns
  `c14-render-eligible-sources-v1`: exact C10 scene job/scene/artifact IDs, GLB/manifest/source
  snapshot hashes, optional exact C13 specification/catalog hashes and sorted mapped camera IDs.
- Both responses are strict and `private, no-store`. No source bytes, object keys, signed URLs,
  provider payloads or credentials are returned.
- Discovery is not a lease. Render creation re-reads the immutable GLB, verifies its exact hash and
  embedded C13 binding, rechecks current catalog rights, verifies the requested mapped camera and
  resolves the frozen render profile. Stale or forged selections fail closed.
- The existing raw host `render-capabilities` route remains separate. Web composes it with strict
  eligible-source data only after both responses validate.

## Generated client evidence

- Canonical OpenAPI: `3.1.2`, exactly the two additive GET operations.
- Generator version: `interior-design-continuity-generator-1.0.0`.
- Frozen OpenAPI SHA-256:
  `c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508`.
- Generation is byte-stable, uses only the repository-pinned formatter and is checked before the
  shared contracts unit suite. The generator refuses an OpenAPI byte change without a versioned
  generator update.
- The generated TypeScript client rejects unknown keys, invalid UUID/hash/time/scope/order data,
  non-2xx status, invalid UTF-8, payloads over 1 MiB and insecure non-loopback origins.
- The generated Swift 6 package targets iOS 17/macOS 13, uses an ephemeral no-cache session,
  validates the same exact records and boundaries, and keeps bearer authentication out of persisted
  state. It is transport/data infrastructure only and is not wired into a native screen here.

## Verification evidence

The following final gates passed from implementation commit `aae3379` plus the documentation
closeout diff:

- deterministic generator write/check and `git diff --check`;
- shared contracts: 15 files / 85 tests;
- focused platform C12/C14: 5 files / 34 tests; full platform unit run: 54 files passed,
  19 capability-gated files skipped, 252 tests passed and 51 capability-gated tests skipped;
- web unit run: 57 files / 230 tests;
- homeowner design-studio integration: 1 file / 4 tests; security: 1 file / 4 tests; additional
  render security: 2 files / 5 tests; render evaluation: 1 file / 4 tests;
- live loopback PostgreSQL C12 suite: 1 file / 2 tests, including exact lookup and cross-tenant
  isolation;
- Swift package: build succeeded and 2 tests passed with isolated `/tmp` module/build caches;
- Playwright C12: 12 passed; C14: 22 passed; integrated homeowner design studio: 1 passed. The
  rendered C14 acceptance continues to label hardware evidence `deferred` even when a configured
  host fixture accepts a software profile;
- package lint and typecheck for contracts, platform API and web all passed; and
- `UV_CACHE_DIR=/tmp/c14-4-uv-cache CI=1 corepack pnpm verify` exited 0: 24 lint tasks,
  24 typecheck tasks, 45 unit dependency tasks and 24 builds passed; Ruff and mypy were clean;
  Python finished with 157 passed and 2 optional capability skips.

The first repository-wide run exposed formatter drift between the generator's programmatic
Prettier call and the repository CLI configuration; the generator now resolves the pinned repository
configuration, after which generation and formatting agree byte-for-byte. A second run reached
Python and was blocked only by the sandboxed user UV cache; the final command used an isolated
`/tmp` cache and passed. An initial parallel Playwright invocation contended for Next's single
`.next/dev` lock; every suite was then run sequentially and passed. None of these initial attempts is
counted as acceptance evidence.

## Contract, migration and capability impact

- Contract impact: two additive GET routes, strict shared schemas, one OpenAPI source and generated
  TypeScript/Swift clients.
- Migration impact: none. Existing C12 confirmation, C10 scene and C13 binding persistence remains
  authoritative.
- Dependency impact: none. Package versions and `pnpm-lock.yaml` are unchanged.
- Native impact: no `apps/ios-capture/**` file changed; standalone native consumption remains later
  work.
- Provider/hardware state: no provider was enabled and no render hardware, physical Apple device,
  camera, RoomPlan, LiDAR, C8/C9 production or representative-property evidence was run or claimed.

## Review vehicle

Non-draft PR [#7](https://github.com/AbhinavGupta707/Interior-Design/pull/7) targets `main` and is
deliberately left unmerged. C14.4 is terminally closed by this review vehicle; it does not authorise
C15 or any excluded native/device/provider/hardware/reconstruction work.

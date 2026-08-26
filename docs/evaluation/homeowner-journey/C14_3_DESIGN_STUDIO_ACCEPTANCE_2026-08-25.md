# C14.3 Homeowner Design Studio Acceptance — 2026-08-25

## Acceptance position

C14.3 closes the Windows/WSL-testable web continuity checkpoint from a confirmed exact-current
twin into useful design outputs. From normal project navigation, an owner can now resume one
ordered journey through:

1. accepted C11 renovation/design brief;
2. two exact-source C12 alternatives and explicit proposed-only confirmation;
3. C13 working specification and a bounded, explicitly confirmed material substitution;
4. the resulting exact proposed C10 scene with accessible DOM fallback; and
5. an exact-source C14 geometry-safe still job and locally hash-verified PNG artifact.

Persisted service records, not URL visits or browser flags, drive the stage state after reload.
Existing, proposed and as-built profiles remain distinct. C8 reconstruction and C9 fusion remain
proposal inputs until separate C5 validation and commit. C15 remains closed.

This is software acceptance using a creator-owned synthetic England-based, one-floor,
one-bedroom-apartment fixture. It is not evidence of a real property, RoomPlan/LiDAR capture,
survey accuracy, deployed material availability, supplier pricing, professional approval, a
configured production render host or a representative-home result.

## Revision and orchestration trail

- Authoritative predecessor: `5b719f9ab83616affc0eeb7de2ba73279bd93d5f`, clean and
  GitHub-synchronised `main` at checkpoint opening.
- Contract freeze: `15e0d159f9a22493c0ee664dfc6f75b64e2e5bc7`.
- Single-session replan: `b74ed40d61ad42a814a22861260cdc0b20be5be1`.
- Product integration: `9d88d1c` (`feat(c14.3): connect twin to design outputs`).
- Independent browser/integration/security acceptance: `bd3f1d3`
  (`test(c14.3): prove homeowner design loop`).
- Full-gate lint review repair: `408b809` (`fix(c14.3): remove redundant source guard`).
- Model/reasoning: one primary `gpt-5.6-sol` session, `xhigh`.

The orchestrate-worktrees workflow was evaluated because the original request allowed genuine
parallel lanes. Codex desktop reported the valid WSL checkout as `isGitRepository=false` and
rejected managed worktree creation/handoff before any implementation worker or child worktree
started. `git worktree list --porcelain` continued to show only this primary checkout. Product
implementation and acceptance were also sequential in substance, so the contract was explicitly
replanned and all work continued here. No unrelated changes were discarded.

## Executable product changes

- `/home/:projectId` now loads persisted C11, C12, C13 and C14 state and presents two phases with
  twelve ordered stages. The primary action advances into C11 after the exact confirmed C10 twin.
- C11 continuation checks both the exact current existing snapshot and its changed C5 branch.
  An accepted brief referencing an older model is stale and cannot launch C12.
- C12 launch carries the accepted brief ID/revision/hash and current model ID/snapshot ID/hash/
  version. Old option jobs remain inspectable but do not advance the current journey.
- C12 same-browser reload recovery retains at most four fully validated, opaque server-issued
  confirmation records in an 8,000-character project-scoped envelope. The UI revalidates the job,
  option status and project before using a recovered confirmation for C13.
- C13 accepts an exact C12 confirmation, retains its immutable catalog/source pins, and guides the
  homeowner through an explicit material substitution. Confirmation creates a new specification
  revision and requests the corresponding proposed C10 scene through the existing server boundary.
- C10 proposed exploration is considered current only when its proposed snapshot ID and SHA-256
  match the current C13 revision. The DOM fallback is reported honestly and never as WebGL proof.
- C14 deep links now carry an exact scene plus an optional paired specification ID/revision. The
  page preselects only that eligible source; it does not silently substitute another source.
- C14 artifact bytes are fetched only through fresh access records and independently checked for
  media type, length and SHA-256 in the browser. Optional enhancement remains separate.
- Owner/editor mutations stay behind the accepted service permissions. Viewer progress remains
  readable, while mutation actions stay unavailable.

## Stateful rendered acceptance

The pinned Playwright Chromium test starts at `/projects`, follows `Resume home journey`, and uses
the actual Next pages and feature clients. A stateful request interceptor supplies creator-owned
synthetic service responses and records mutations. It does not seed state through local storage,
start at a specialist route or make any C8-v2 request.

Accepted mutation order:

1. `c11.brief.accept`
2. `c12.option.confirm`
3. `c13.specification.create`
4. `c13.substitution.preview`
5. `c13.substitution.confirm`
6. `c14.render.create`

The fixture contains two deliberately different C12 directions. It then verifies specification
revision 2, requests the exact C13-created C10 scene, exercises the accessible DOM scene summary,
launches C14 from the journey, verifies both geometry-safe and segmentation PNG bytes, and reloads
the journey with all five design stages restored. Unexpected browser console errors fail the test.

Screenshot:

- `/tmp/c14-3-homeowner-design-studio-final.png`
- 1440 × 3409 RGB PNG, 890,389 bytes
- SHA-256 `6f549b673f454ac391f17e4e7a33ec85863f5ede99d4305cf04b1928616e9de0`
- visually inspected in the Codex app on 2026-08-25

## Focused verification

WSL inherited Windows `TEMP` and `TMP` values under
`/mnt/c/Users/abhin/AppData/Local/Temp`. Vitest/tsx initially tried to create a transient runner
there and failed before test execution. Direct Vitest accepted `TMPDIR=/tmp`; the Turbo child task
also required `TEMP=/tmp TMP=/tmp`. Pinning all three variables uses the WSL-native temporary
directory and resolves that host-boundary problem. This is an environment issue, not a product
failure. Next.js localhost binding was also blocked by the default sandbox; the acceptance run used
the narrow approved Playwright/localhost permission.

```bash
env TMPDIR=/tmp corepack pnpm exec vitest run \
  test/homeowner-journey test/design-consultation test/design-options \
  test/materials-products test/viewer-3d test/render-stills
```

Result: 34 files, 141 tests passed.

```bash
env TMPDIR=/tmp corepack pnpm exec vitest run \
  --config tests/integration/homeowner-design-studio/vitest.config.ts
env TMPDIR=/tmp corepack pnpm exec vitest run \
  --config tests/security/homeowner-design-studio/vitest.config.ts
```

Result: integration 1 file / 4 tests passed; security 1 file / 4 tests passed.

```bash
env TMPDIR=/tmp NODE_OPTIONS=--conditions=development \
  corepack pnpm exec playwright test \
  --config tests/e2e/homeowner-design-studio/playwright.config.ts
```

Result: 1 desktop workflow passed at 1440 × 960 in 16.3 seconds. The emitted `NO_COLOR` warning is
development-process noise; there were no page errors or unexpected console errors.

```bash
env TMPDIR=/tmp corepack pnpm exec tsc -p apps/web/tsconfig.json --noEmit --pretty false
env TMPDIR=/tmp corepack pnpm exec tsc \
  -p tests/integration/homeowner-design-studio/tsconfig.json --pretty false
env TMPDIR=/tmp corepack pnpm exec tsc \
  -p tests/security/homeowner-design-studio/tsconfig.json --pretty false
```

Result: all three configurations exited 0 with no diagnostics. Next's generated
`apps/web/next-env.d.ts` development-path drift was restored and is not part of the change.

```bash
env TEMP=/tmp TMP=/tmp TMPDIR=/tmp UV_CACHE_DIR=.cache/uv corepack pnpm verify
```

Result: exit 0. All 24 lint tasks, 24 typecheck tasks and 24 builds passed; all 45 JS unit/build
dependency tasks passed, including web 57 files / 227 tests and spatial worker 30 files / 150 tests
with 3 database capability skips. Ruff and mypy passed; Python finished with 157 passed and 2
optional host-capability skips. `git diff --check` passed separately. The first full-gate attempt
with only `TMPDIR` reached web unit collection and failed all 57 files before tests because Turbo
fell back to the inherited Windows temp path; no product assertion failed in that attempt.

## Independent audit findings and claim boundary

### Production C8/C9 routing

- C8 v1 contracts, API, spatial-worker and inference-worker paths are unchanged from the
  authoritative predecessor.
- C8-v2 remains an acceptance-only sibling. Its checked-in exposure has
  `PRODUCTION_ROUTING_ENABLED = False` and fails with `C8_V2_ACCEPTANCE_ONLY`; production worker
  protocol imports only the accepted adapter registry.
- C9 remains correct to abstain unless it has enough distinct semantic evidence. No reconstruction
  output was routed directly to canonical truth in this checkpoint.

### Provisional shared/mobile gaps

The Windows web continuity checkpoint is accepted, but the audit found two existing API continuity
gaps that must remain provisional until the Mac audit:

1. C12 returns the opaque `OptionConfirmation` only from `POST .../confirm`. `listOptions` exposes
   confirmed status but no confirmation record/ID, while C13 creation requires `confirmationId`.
   Same-browser recovery now works, but a fresh browser, another device or a standalone mobile
   client cannot reliably resume C12 → C13 when no C13 specification exists.
2. Platform C14 `GET /render-capabilities` returns host capability only
   (`acceptingNewJobs`, provider/hardware flags and profiles). The existing web schema expects that
   plus exact eligible C10 scene/C13 specification/camera choices. The web BFF currently validates
   the raw platform response as the richer schema, so a host-live C14 workspace fails closed rather
   than composing exact sources. The authoritative C13 scene binding is server-held and not
   externally discoverable after reload, so this cannot be safely inferred client-side.

No shared contract, service, BFF route, generated client or native iOS change was made to guess at
either solution. The exact decision and Mac cases are in
`docs/runbooks/ios/C14_3_DESIGN_STUDIO_MAC_HANDOFF.md`.

### C14.4 resolution — 2026-08-26

The two shared gaps above are closed by C14.4 implementation commit `aae3379` without changing any
C14.3 mutation contract. C12 now has an exact tenant/project/job/option confirmation read and web
stores no confirmation authority locally. C14 now has a separate strict eligible-source read derived
from authoritative C10 scene/camera and C13 binding/rights state; the raw host capability route
remains separate, and render creation still revalidates exact immutable bytes, hashes, bindings,
rights, mapped camera and frozen profile.

The generated TypeScript contract is consumed by web and an equivalent Swift 6 package is checked
in for a later standalone iOS consumer. This resolves shared discovery only. Native C10–C14 UI,
Simulator/physical-device cases, C8/C9 production evidence, providers, render hardware and C15 remain
unrun and unopened. Durable C14.4 evidence is in
`docs/evaluation/homeowner-journey/C14_4_CROSS_DEVICE_CONTINUITY_ACCEPTANCE_2026-08-26.md`.

## Remaining path to the complete one-bedroom-apartment product

1. Consume the frozen C14.4 Swift client from a later authorised standalone iOS C10–C14 flow and
   run the remaining Mac/Simulator/device authentication, lifecycle, interruption and accessibility
   cases without changing the shared contract by inference.
2. Complete standalone iOS C10–C14 navigation, persisted/offline recovery,
   background behavior and accessible degraded states without embedding web-only assumptions.
3. Capture a consented representative one-bedroom apartment on a named LiDAR-capable Apple device;
   preserve RoomPlan, depth and appearance as immutable evidence/proposals.
4. Exercise accepted production C8-v1 routing and C9 multi-source fusion, explicitly validate and
   correct proposals, and commit only through C5 before rebuilding C10.
5. Run C11–C14 against that exact confirmed twin with a published catalog and authorised render
   host; retain full provenance, uncertainty, rights, capability and artifact evidence.
6. Add approval and implementation-handoff packaging after the design loop is real and stable.
   Only then reopen C15 video/walkthrough work.

## Contract and migration impact

Shared contracts, authz actions, OpenAPI/generated clients, migrations, service/worker protocols,
root manifests, lockfiles and native iOS paths are unchanged. C14.3 composes accepted C10–C14
features in the web client and adds independent acceptance only.

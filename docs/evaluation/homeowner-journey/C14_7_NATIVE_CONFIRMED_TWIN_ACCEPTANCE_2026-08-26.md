# C14.7 Native Confirmed-Twin Integration Acceptance — 2026-08-26

## Accepted outcome

C14.7 completes the remaining native software path before physical-device validation. From the
ordinary homeowner hub, an authorised owner or editor can now use fresh platform state to:

1. acknowledge a server-created unmeasured existing-model workspace when no C4 snapshot exists;
2. choose an exact ready C2 plan source, inspect the C6 proposal and calibration, and explicitly
   accept, correct, exclude or leave every proposal candidate unresolved;
3. choose exact rights-cleared image/video sources for C8 and inspect geometry and appearance as
   separate proposal outputs;
4. optionally choose exact eligible C6/C7/C8 source descriptors for C9, provide non-collinear
   correspondences and explicitly resolve every discrepancy;
5. submit the exact C6 or C9 operation draft to C5, inspect a separate preview and explicitly
   confirm its unexpired, non-blocking result;
6. reload the persisted C4/C5 state, compile the exact committed snapshot through C10 and continue
   only when the matching job is succeeded; and
7. enter the existing C11-C14 native design studio, which independently revalidates the same exact
   snapshot, branch and C10 scene.

This is a software and Simulator acceptance. It is not physical-device, representative-home,
production-provider, real CUDA/C8/C9, render-hardware, deployment or C15 acceptance.

## Authority and revisions

- Requested and verified base: `main` at
  `f97f61dc0139dc68fd47469bc700e84313ae9764`.
- Contract/audit freeze: `4a8263a`.
- Verified implementation: `08d5de02b9d83dfdcaa58cb8f713523521b9ea75`.
- Branch: `codex/c14-7-native-confirmed-twin-integration`.
- Non-draft PR: [#10](https://github.com/AbhinavGupta707/Interior-Design/pull/10), targeting
  `main` and intentionally left unmerged by this session.
- Runtime: one `gpt-5.6-sol` / `xhigh` primary session. No subagent, separate task or worktree was
  used.
- The pre-existing user-owned root `AGENTS.md` modification remained unstaged, uncommitted and
  untouched by this checkpoint.

## Exact authority preserved

- The C5 initialization request is exactly `{ confirmUnmeasuredInterior: true }`. The platform
  derives the actor, selected property, deterministic unknown placeholder, provenance, audit data
  and canonical content/version hashes. Native submits no invented dimensions or geometry.
- The C9 discovery response is derived from persisted C6/C7/C8 records and rights-eligible C2
  assets. Job creation re-verifies every selected exact descriptor; discovery is not authority or a
  lease.
- C6 parser candidates begin unresolved. Accepted source values remain source-derived, corrected
  values are explicit user assertions, excluded candidates produce no operation, and unresolved
  values remain unknown.
- C8 appearance output is optional visual context and never enters canonical dimensional
  operations. Geometry remains proposed until reviewed and committed.
- C9 requires at least two distinct source kinds and at least three distinct non-collinear
  correspondences. A blank or zero-valued input is not treated as identity calibration.
- C5 preview and commit retain exact snapshot, branch revision/head, operation, result-hash and
  expiry pins. C10 is submitted only for the exact reloaded committed snapshot and the design handoff
  requires a matching succeeded job.
- Project switching, sign-out, role downgrade, branch change and request cancellation discard local
  intent. Late responses are rejected against request/project identity. Offline or relaunch state is
  display-only; no recovery cache grants membership, eligibility or mutation authority.

## Verification evidence

| Gate                                                                               | Result                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Focused C5/C9 platform, BFF and contract tests                                     | 7 files / 50 tests passed                                                                                                             |
| Focused C9, homeowner integration and security tests                               | 11 files / 51 tests passed                                                                                                            |
| Live repository PostgreSQL C4/C5/C6/C8/C9/C10 checks                               | 6 files / 18 tests passed                                                                                                             |
| `pnpm test:contract`                                                               | platform 54 files / 258 passed / 51 optional-runtime skipped; worker 30 files / 150 passed / 3 optional-runtime skipped               |
| `pnpm test:integration`                                                            | passed across the platform/worker integration selection                                                                               |
| `pnpm test:security`                                                               | 921 tests passed                                                                                                                      |
| `TEMP=/tmp TMP=/tmp TMPDIR=/tmp UV_CACHE_DIR=/tmp/c14-7-uv-cache CI=1 pnpm verify` | formatting, 24 lint, 24 typecheck, 45 unit dependency, 24 build, Ruff and mypy passed; Python 157 passed / 2 optional-runtime skipped |
| `pnpm test:c14`                                                                    | passed; unavailable live provider/render profiles skipped explicitly                                                                  |
| `pnpm api:check`                                                                   | 4 files / 21 tests passed                                                                                                             |
| `pnpm dependency:boundaries`                                                       | 1 file / 3 tests passed                                                                                                               |
| `node packages/api-contracts/scripts/generate.mjs --check`                         | passed with zero generated-client drift                                                                                               |
| Generated Swift contract tests                                                     | 3/3 passed                                                                                                                            |
| Signed native unit suite                                                           | 183 logical tests passed on iPhone Air Simulator, iOS 26.4                                                                            |
| C14.5 downstream journey UI regression                                             | 3/3 passed on iPhone Air Simulator                                                                                                    |
| C14.6 onboarding/readiness UI regression                                           | 6/6 passed on iPad Pro 13-inch (M5) Simulator                                                                                         |
| C14.7 terminal UI acceptance                                                       | 3/3 passed on iPhone Air and 3/3 passed on iPad Pro 13-inch (M5), iOS 26.4                                                            |
| XcodeGen reproducibility                                                           | regenerate was byte-stable; project SHA-256 `c04f8b4f2f14ee7dd738a43438766c55bf1907876c0e4e12f46f4bb7a2139887`                        |
| Native build matrix                                                                | generic Simulator Debug, generic Simulator Release and unsigned generic physical-iOS Release compilation passed                       |
| Release analysis and fixture exclusion                                             | `xcodebuild analyze` passed; no `C14_7_UI_TEST_MODE`, fixture title or fixture-view identifier was present in the Release executable  |

The final C14.7 xcresult summaries recorded 3/3 tests on each named Simulator. The iPhone suite
covered compact Accessibility XXXL navigation; the iPad suite covered the regular-width stage
sidebar. Both suites traversed explicit proposal review, C5 confirmation, matching C10 success and
the existing design brief, then separately verified viewer, stale-refresh, cold-offline and
relaunch behavior.

The attempted `supabase start` gate did not replace or alter the repository database: it could not
start because the repository's local PostgreSQL already occupied the configured port. The
checkpoint therefore records that CLI profile as unavailable and relies on the successful live
repository-PostgreSQL C4-C10 tests above. No production provider or deployment claim is inferred.

## Retained visual artifacts

- iPhone Air, 1260 × 2736:
  `docs/evaluation/homeowner-journey/artifacts/c14-7-native/iphone-confirmed-twin.png`, SHA-256
  `7c1c1074ed54139325a916abbc3368924d92ea3ca3c46642a50e5b343c9fcf7a`.
- iPad Pro 13-inch (M5), 2064 × 2752:
  `docs/evaluation/homeowner-journey/artifacts/c14-7-native/ipad-confirmed-twin.png`, SHA-256
  `9b30144690ab6bb43001bbeb0286b5c7d4138cab4e61c1ddfe5229dc00f2b8ee`.

These are Simulator fixture captures for layout and journey evidence only. They do not depict a
representative home or prove real proposal producers, cameras, LiDAR, reconstruction or rendering.

## Changed surfaces and contract impact

- `packages/contracts/src/c5.ts` and `packages/contracts/src/c9.ts`: additive acknowledgement and
  eligible-source routes.
- `services/platform-api/src/modules/models/operations/**` and
  `services/platform-api/src/modules/model-fusion/**`: platform-owned initialization/source
  composition, permissions, persistence and re-verification.
- `apps/web/src/app/api/c5/**` and `apps/web/src/app/api/c9/**`: BFF delegation to the shared
  platform authority, removing duplicate deterministic source/model construction.
- `apps/ios-capture/HomeDesignCapture/Features/TwinIntegration/**` plus app/hub/navigation
  composition: strict transport, proposal review, exact preview/commit/C10 handoff and adaptive UI.
- Native, platform, web, contract and integration tests cover the new path and the affected C14.5/
  C14.6 regressions.

Contract impact is additive. Database migrations, root manifests, lockfiles, OpenAPI and generated
clients are unchanged. Existing C4-C10 routes and schemas remain authoritative.

## Residual limits and next gate

- Physical iPhone/iPad testing remains required for camera permission, background transfer,
  interruption, RoomPlan/ARKit/LiDAR capability and real-device accessibility behavior.
- Representative-home ingestion and human review are not run.
- Production C6/C8/C9 workers, CUDA, render hosts, identity/property providers and deployment remain
  unconfigured or unaccepted.
- No survey, structural, boundary, planning, regulatory, cost, availability or professional
  certainty is claimed.
- C15 remains unopened. The next allowed work is physical-device/field acceptance of the completed
  native software path, not another proposal-readiness checkpoint.

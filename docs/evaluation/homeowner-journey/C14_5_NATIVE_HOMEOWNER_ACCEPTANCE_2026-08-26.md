# C14.5 Native Homeowner Acceptance — 2026-08-26

## Acceptance decision

C14.5 is accepted as a software-and-Simulator checkpoint for an adaptive native homeowner hub and
the server-authoritative C10-C14 design loop. An authorised homeowner can create or continue a
server project, choose capture as an optional branch, enter design when fresh server prerequisites
prove the exact confirmed twin, complete the persisted design stages and verify a geometry-safe
render result without depending on the web for C10-C14.

This is not acceptance of a wholly standalone C1-C14 iOS product. Native structured intake,
property context, proposal generation/reconciliation and the C4/C5 confirmation path needed to
produce the confirmed twin remain absent. The full audited dependency map is
`docs/evaluation/homeowner-journey/C14_5_NATIVE_APP_AUDIT_2026-08-26.md`.

## Frozen scope and revisions

- Base: clean `main` at `0f4018befecda80488b9fa72e2116f621a9ef57c`.
- Branch: `codex/c14-native-homeowner-studio`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Contract freeze and audit: `e1f72b5`.
- Native implementation: `79186d6`.
- Verified degraded-state hardening: `ca415f9`.
- Review vehicle: non-draft PR targeting `main`; URL is recorded in the ledger after creation.
- Orchestration: the frozen mandatory-parallelism gate was unsatisfied because navigation,
  authenticated authority, recovery, generated-client integration and the SwiftUI journey share
  one target and critical path. No task, subagent or worktree was spawned.

## Post-checkpoint native journey

| Product stage                    | Native result after C14.5                | Authority and remaining dependency                                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production sign-in               | Partial                                  | A Keychain-backed short-lived bearer provider, one invalidation/retry and fail-closed non-local refresh are preserved. A production OIDC sign-in surface remains absent.                                                                                         |
| Create project                   | Native                                   | `POST /v1/projects` uses server authorisation, bounded typed decoding and one pending idempotency key reused after an uncertain outcome. No local row is authoritative.                                                                                          |
| Continue project                 | Native                                   | The app lists server projects and opens an adaptive homeowner hub rather than forcing capture. Project membership and progress reload from the server.                                                                                                           |
| C1 structured intake             | Missing                                  | Renovation goals, household constraints and evidence availability remain web-only. This is part of the next native gap.                                                                                                                                          |
| C3 property context              | Missing                                  | Resolve/select/dossier/source-record workflows remain web-only. Address context still never establishes the interior.                                                                                                                                            |
| C2 evidence                      | Native                                   | Existing rights, consent, resumable upload, inventory and fresh-access behavior are preserved as one optional hub branch.                                                                                                                                        |
| C7 RoomPlan and C8 media capture | Native with deferred hardware acceptance | Existing protected capture recovery remains reachable from the hub. Physical-device, RoomPlan/LiDAR and background-relaunch acceptance are not claimed. Media upload is not a production C8 reconstruction run.                                                  |
| C6 plan proposal                 | Missing                                  | Start/calibrate/review/correct flows remain web-only.                                                                                                                                                                                                            |
| C8 reconstruction proposal       | Missing                                  | Native captures and uploads media but does not submit or review a production reconstruction job.                                                                                                                                                                 |
| C9 fusion/reconciliation         | Missing                                  | Source selection, anchors, discrepancy review and persisted operation-draft creation remain web-only.                                                                                                                                                            |
| C4/C5 workspace and confirmation | Missing                                  | Native cannot initialise the unmeasured model, manage branches or preview and explicitly commit the correction operation. It cannot independently produce a confirmed twin.                                                                                      |
| Exact confirmed-twin gate        | Native read authority                    | Fresh project-scoped reads require the exact current C4 snapshot, a changed C5 branch whose head matches that snapshot but not its immutable source, and a succeeded C10 scene pinned to the same snapshot ID and SHA-256. Cached or partial state never passes. |
| C10 exploration                  | Native                                   | Shows bounded geometry, mapped camera, finding and exact scene/model/manifest/source pins as derived exploration state. It does not claim an interactive renderer or treat appearance as dimensional truth.                                                      |
| C11 brief                        | Native                                   | Owner/editor can create, revise and accept attributable structured intent with optimistic revision/hash pins. Viewer is read-only; intent never mutates geometry.                                                                                                |
| C12 options                      | Native                                   | At least two server-persisted directions are generated, compared and explicitly confirmed with exact brief/job/set/snapshot pins. Cold/cross-device confirmation recovery uses the generated C14.4 client. Proposed state remains distinct.                      |
| C13 specification/materials      | Native                                   | Current catalog rights and releases drive specification creation. Substitution preview and confirmation retain branch/specification/candidate pins and do not infer cost or availability.                                                                        |
| C14 render                       | Native                                   | Generated-client eligible sources remain separate from raw host capability. Creation is revalidated server-side; result access is refreshed and bytes are verified before viewing.                                                                               |

The next coherent native product gap is therefore production authentication plus native C1/C3/C4-
C9 completion: structured intake, property context, C6/C8 proposal jobs, C9 reconciliation and the
exact C5 preview/commit path. Until that closes, a homeowner still needs another client to create
the confirmed twin that unlocks this checkpoint's native design loop.

## Authority, security and recovery evidence

- New native continuity calls use the existing Keychain-backed bearer. A `401` invalidates and
  retries once; clients never submit tenant, user or role as authority.
- Reads use ephemeral/no-cache sessions, strict allowed origins, bounded response lengths and
  typed DTO validation. UUIDs, hashes, versions, scope relations, ordering and non-finite geometry
  fail closed.
- Every mutable stage retains server action checks, exact version/hash/source pins, optimistic
  revision and idempotency semantics. Offline mutation is neither queued nor inferred complete.
- C12 recovery uses the checked-in generated Swift contract. C14 discovery uses the generated
  eligible-source contract and remains distinct from host capability.
- Render viewing requests fresh signed access, enforces final origin and expiry, caps the native
  artifact at 64 MiB, streams through an ephemeral session and verifies declared byte count,
  content type, SHA-256, PNG signature and decoded dimensions before constructing an image.
- Local recovery is a protected convenience cache capped at 4096 bytes. It stores only safe stage
  labels, timestamps, IDs, hashes and statuses; it excludes tokens, signed URLs, prose, addresses,
  file paths, source/render bytes and eligibility/confirmation authority.
- Cold launch always reloads authority. Offline cold launch stays locked. If a later refresh fails,
  only the last already-verified in-memory workspace remains visible as explicitly stale and
  read-only; reconnecting must complete a fresh reload before any action is enabled.
- Owners and editors receive allowed mutations; viewers remain read-only. Forbidden/not-found,
  expired, conflict/stale, gone, validation, throttled, offline and unavailable states remain
  distinct.

## Adaptive and accessibility evidence

- Compact width uses an accessible stage picker; regular width uses an iPad navigation sidebar.
- Critical actions have accessibility labels/hints, status is not colour-only and the UI observes
  Dynamic Type and reduced motion.
- The UI suite exercises the real production hub and studio views through a Debug-only injected
  service. Release output contains neither the scenario selector nor fixture homeowner strings.
- iPhone Air and iPad Pro 13-inch (M5), both iOS 26.4, passed the eligible journey, verified-result
  viewing, offline cache lockout and Accessibility XXXL action-operability checks.

Evidence captures:

- [iPhone homeowner hub](artifacts/c14_5/iphone-air-homeowner-hub.png)
- [iPhone authoritative render stage](artifacts/c14_5/iphone-air-render-stage.png)
- [iPhone verified geometry-safe result](artifacts/c14_5/iphone-air-verified-result.png)
- [iPad homeowner hub](artifacts/c14_5/ipad-pro-13-homeowner-hub.png)
- [iPad authoritative render stage](artifacts/c14_5/ipad-pro-13-render-stage.png)
- [iPad verified geometry-safe result](artifacts/c14_5/ipad-pro-13-verified-result.png)

## Verification ledger

### Native and generated-contract gates

- XcodeGen regeneration was byte-stable. The tracked `project.pbxproj` SHA-256 is
  `d9992c3d461b584e152ca0f91a752b09699bc131c590bfb8bbd401fbefc56507`.
- Generated OpenAPI/client regeneration produced zero drift. The consumed OpenAPI is `3.1.2`,
  SHA-256 `c5f4876952f321898ce4d8cda845bda73bb17b30f4e492bc3c43d3ebad4a2508`, generated by
  `interior-design-continuity-generator-1.0.1`.
- `swift test --package-path packages/api-contracts/generated/swift --scratch-path
/tmp/C14_5SwiftContractBuild`: 3 passed, 0 failed.
- iPhone Air unit suite via `xcodebuild ... -only-testing:HomeDesignCaptureTests test`: 136 passed,
  0 failed, 0 skipped.
- iPhone Air C14.5 UI suite: 3 passed, 0 failed.
- iPad Pro 13-inch (M5) C14.5 UI suite: 3 passed, 0 failed.
- Generic iOS Simulator Debug and Release builds passed with Swift 6 strict concurrency and code
  signing disabled. `xcodebuild ... analyze` passed.
- Release-binary fixture-exclusion scan found no `C14_5_UI_SCENARIO` or fixture homeowner text.

### Repository, integration and security gates

- Focused homeowner-design-studio integration: 4 passed; focused security: 4 passed.
- `corepack pnpm test:c14` passed: render-scene 15, renderer 18, platform C14 27 with 8
  unavailable-capability skips, worker 6, web 12, evaluation 8, standalone
  evaluation/performance/security 18, Python boundary 22, API seam 21 and dependency boundaries 3.
  The disposable full C1-C14 production control-plane test was skipped because its live services
  were unavailable, so this is not a production database/runtime claim.
- `TEMP=/tmp TMP=/tmp TMPDIR=/tmp UV_CACHE_DIR=/tmp/c14-5-review-uv-cache CI=1 corepack pnpm
verify` passed all 24 lint, 24 typecheck, 45 unit dependency and 24 build tasks; Ruff and mypy
  were clean; Python passed 157 with 2 optional-runtime skips.
- `git diff --check` and changed-source review passed.

## Change and contract impact

The implementation changes only `apps/ios-capture/**` plus the C14.5 audit, contract, evidence,
plans and ledger. It adds the generated Swift package as a local Xcode target dependency but does
not modify that package.

- Backend HTTP/shared schema/OpenAPI changes: none.
- Database migrations: none.
- Root manifest or lockfile changes: none.
- Generated-client changes: none; C14.4 outputs are consumed unchanged.
- Authentication, tenant/project scoping, action authorisation, audit/provenance, source-state
  separation and exact pins are preserved.

## Limitations and explicit non-claims

- No physical-device, camera, RoomPlan/LiDAR or background capture acceptance.
- No representative-home evidence and no survey, structure, regulation, cost, availability or
  professional-approval claim.
- No production C8 reconstruction or C9 fusion acceptance.
- No provider enhancement, render GPU/hardware or production render-host acceptance.
- No interactive native 3D renderer claim; C10 native exploration is a pinned geometry summary.
- No C15 implementation or acceptance.
- Simulator fixtures and their embedded PNG prove UI behavior only. They are not property,
  provider, camera or render-hardware evidence.

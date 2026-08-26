# C14.6 Native Homeowner Readiness Acceptance — 2026-08-26

## Acceptance decision

C14.6 is accepted as a software-and-Simulator checkpoint for the native cold-launch-to-capture/
proposal-readiness journey. A new homeowner can restore or start a production-shaped session,
create or select a server-authorised project, save renovation intake, resolve or manually record an
England property identity, inspect source-aware context, upload rights-cleared evidence and receive
fresh prerequisite guidance without using the website.

This is not acceptance of native proposal generation or confirmed-twin creation. “Plan ready” means
only that fresh C1/C2/C3 state proves an eligible input for a later C6 request. C6 processing and
review, production C8 reconstruction, C9 fusion, C4/C5 initialise/preview/commit and the C14.5
confirmed-twin gate remain separate.

## Frozen scope and revisions

- Base: clean `main` at `4d12e9ce16c0a94b741051f1f50cff8cef2afd0b`.
- Branch: `codex/c14-6-native-homeowner-readiness`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Contract/audit freeze: `6e8dfc8`.
- Native implementation revision: `0e3ab58266dd21e877944433a64f9651ff23e810`.
- Independent-review correction revision:
  `dfcdb31c671925e86ca9c17b08b23188af5910e7`.
- The implementation phase used one primary session because authentication, Keychain/session
  recovery, project switching, setup composition and adaptive navigation share one target and state
  graph. The independent PR review used the user-authorised single-checkout subagent protocol: the
  primary `gpt-5.6-sol` / `xhigh` reviewer retained every materiality, correction and acceptance
  decision while one Luna/medium evidence mapper and one Terra/high contract reviewer performed
  bounded read-only work. No separate task or worktree was created.

## Independent PR review reconciliation

PR #9 was independently reviewed from exact head
`66f3a4250949e30d74de9d1d867b4931a75fbc21` against the frozen C14.6 contract, this acceptance
record, repository instructions and both governing plans. The review found and corrected material
isolation and evidence defects before final acceptance:

- Late project-list, inventory, upload, preview, file-selection and C1/C3 mutation completions can
  no longer repopulate a reset or newly selected project. Reset also clears pending mutation bodies,
  idempotency identities and mutation presentation state.
- A same-project role downgrade now reactivates the setup boundary and immediately removes stale
  owner/editor authority. Unknown roles fail closed and clear prior project state.
- OAuth token exchange and foreground C2 traffic use ephemeral, no-cache sessions and explicit
  `no-store` requests. Readiness validates bounded, project-matching evidence DTOs rather than
  accepting cached or foreign asset state.
- Project selection now resets every project-scoped model. The regular-width setup is a genuine
  persistent sidebar/detail composition, and the UI evidence now covers intake, ambiguous/manual
  England property selection, separate/default-denied consent, offline recovery and a real
  Accessibility XXXL setup action on both form factors.

The accepted claim remains only native homeowner onboarding and proposal readiness. This review is
not a confirmed-twin, physical-device, production-provider/deployment, C6 execution/review, C8
reconstruction or C9 fusion acceptance.

## Audited dependency result

The full audit is
`docs/evaluation/homeowner-journey/C14_6_NATIVE_WEB_DEPENDENCY_AUDIT_2026-08-26.md`. It found that
the repository already had the required server authorities and native evidence path; the missing
dependency was native composition rather than a new shared contract:

| Stage                | C14.6 native result                                                                                                | Preserved authority and boundary                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-in and recovery | Authorization Code + PKCE through `ASWebAuthenticationSession` when configured; conspicuous local fixture in Debug | Access/refresh credentials are ThisDeviceOnly Keychain items; `GET /v1/session` establishes actor, tenant and role; invalid configuration fails closed |
| Projects             | Create, list, select and relaunch recovery                                                                         | Server membership/actions remain authoritative; the protected cache stores only one UUID and fresh listing must revalidate it                          |
| C1 intake            | Native read/save/recover with exact version                                                                        | Owner/editor uses the frozen optimistic payload and stable idempotency; viewer is read-only; stale state is never silently rebased                     |
| C3 property context  | England postcode/address resolve, explicit candidate selection, manual fallback, dossier and sources               | Fixture/disabled/unavailable/no-match/ambiguous/expired/stale remain distinct; manual entry invents no provider fact                                   |
| C2 evidence          | Existing rights/consent, resumable immutable upload and fresh inventory are composed into setup                    | Service processing and training consent remain separate; training defaults denied; only fresh `ready` evidence can pass                                |
| Guidance             | Native capture routes and exact later-C6 eligibility explanation                                                   | No C6/C8/C9 job is submitted and no C4/C5 or confirmed-twin state is inferred                                                                          |

No backend route, shared TypeScript schema, OpenAPI, generated client, database migration, root
manifest, lockfile or third-party dependency changed. Apple `AuthenticationServices` is the only
new framework link. The generated C14.4 Swift client remains narrow and unchanged.

## Authentication, isolation and recovery evidence

- The non-local sign-in request uses a random PKCE verifier, S256 challenge, random state, exact
  configured authorization/token endpoints and the registered callback
  `com.homedesignstudio.capture.auth:/oauth/callback`. No client secret or invented provider exists.
- Token exchange validates callback origin/path/state and bounded bearer responses. Refresh-token
  rotation is persisted before the access credential so a partial Keychain failure cannot retain a
  new access token with an obsolete refresh credential.
- Cold launch recovers protected credentials, performs at most one refresh/retry after `401`, and
  then requires a valid bounded `GET /v1/session` response. Missing/rejected refresh credentials
  return to sign-in. Sign-out clears credentials and project-scoped presentation state; remote
  revocation is not claimed because no backend revocation route exists.
- Project reads use an ephemeral/no-cache session. Selection waits for protected persistence;
  switching or signing out invalidates in-flight identities, clears every project-scoped model and
  rejects or compensating-erases late results from the previous session.
- New C1/C3 calls send no tenant, user, actor, role or action field. They retain server membership,
  action authorisation, tenant predicates, exact project scope, optimistic versions and stable
  pending idempotency identities.
- Protected recovery excludes tokens, authorization state, addresses, intake prose, signed URLs,
  local paths, source bytes and readiness/confirmation authority. Offline/stale state is
  explanatory and read-only; no mutation is queued or inferred successful.

## Truthful property and readiness behavior

- Resolution is England-first with `countryCode: GB`. Ambiguous candidates require an explicit
  choice; expired resolution, stale selection, forbidden/not-found, validation, throttling,
  unavailable and offline responses remain distinguishable.
- The manual path stores a user-asserted England identity without fabricating a UPRN, coordinate,
  provider observation, EPC, mapping result, planning result or building form.
- Dossier values are validated with bounded units/ranges and retain observation, user assertion,
  estimate, inference and unknown labels plus exact source/licence/version metadata and coverage
  warnings. Planning remains `not-reviewed`.
- Address, postcode, UPRN, coordinate and property context never become interior geometry,
  canonical dimensions, legal boundary, survey, structure or planning certainty.
- Onboarding readiness requires fresh saved intake and a selected dossier. Later plan-processing
  eligibility additionally requires a fresh `ready` plan asset with service-processing consent.
  Pending, processing, quarantined, rejected, aborted, missing-rights and cached-only evidence do
  not pass.

## Adaptive and accessibility evidence

- Compact iPhone uses ordered setup sections and a step picker; regular-width iPad uses a stable
  setup sidebar/detail composition. Critical actions remain operable at Accessibility XXXL and
  status is not colour-only.
- The UI suite drives the production root/hub/setup views through a Debug-only fixture. It covers a
  cold journey to later-C6 eligibility, relaunch where only a freshly revalidated project UUID is
  restored, real large-text action operability, intake, ambiguous/manual England property
  selection, consent separation/default denial and offline failure-closed behavior. The relaunch UI
  test uses a fresh project repository/listing to revalidate the cached UUID; signed unit evidence,
  not the fixture, proves the real Keychain restoration path.
- Final named runs passed on iPhone Air and iPad Pro 13-inch (M5), both iOS 26.4. Release output was
  scanned for the C14.6 scenario flags, fixture property string and fixture view symbol; none were
  present.

Retained captures:

- [Final iPhone Air readiness](artifacts/c14_6/iphone_air/review_final/26D00898-13AA-4934-A683-72FCF24276C6.png)
- [Final iPad Pro 13-inch readiness](artifacts/c14_6/ipad_pro_13/review_final/2B05C36D-D98F-4F2A-8920-E681296097A6.png)

These final-review captures supersede the original pre-review layout captures for C14.6 acceptance.

## Verification ledger

### Native and generated-contract gates

- `xcodegen generate --spec project.yml` was byte-stable before and after implementation. The final
  tracked `project.pbxproj` SHA-256 is
  `3b5a8346332757bc9190a293503e73cf5c5574356e8a009c35da4b666efa875a`.
- Generated OpenAPI/TypeScript/Swift regeneration produced zero drift. The unchanged generated Swift
  package passed `swift test --package-path packages/api-contracts/generated/swift`: 3 passed.
- The final locally signed native suite passed 174 logical tests, 181 device invocations, 0 failed
  and 0 skipped. Its result is
  `apps/ios-capture/.build/C14_6ReviewSignedFull/Logs/Test/Test-HomeDesignCapture-2026.08.26_13-47-48-+0100.xcresult`.
- The final affected authentication/setup/fixture/evidence group passed 32/32. Its result is
  `apps/ios-capture/.build/C14_6ReviewTests/Logs/Test/Test-HomeDesignCapture-2026.08.26_13-52-16-+0100.xcresult`.
  The first intentionally unsigned full-suite attempt
  showed that a real Keychain round-trip cannot run without app entitlements; the required locally
  signed rerun above passed and supersedes that invocation.
- `xcodebuild ... -only-testing:HomeDesignCaptureUITests/C14_6HomeownerReadinessUITests test`
  passed 6/6 on iPhone Air and 6/6 on iPad Pro 13-inch (M5), both iOS 26.4. Final full result bundles
  are
  `apps/ios-capture/.build/C14_6ReviewUI-iPhone/Logs/Test/Test-HomeDesignCapture-2026.08.26_13-35-06-+0100.xcresult`
  and
  `apps/ios-capture/.build/C14_6ReviewUI-iPad/Logs/Test/Test-HomeDesignCapture-2026.08.26_13-21-18-+0100.xcresult`.
  After the final manual-source parity adjustment, the affected intake/property case passed 1/1 on
  each form factor in the corresponding `13-48-46` iPhone and `13-47-48` iPad result bundles.
- Generic iOS Simulator Debug/Release builds, unsigned generic physical-iOS Release compilation and
  Release `xcodebuild analyze` passed. Debug Info.plist contained the exact callback URI. Release
  fixture-exclusion scans returned no match.

### Repository, integration and security gates

- Focused C1-C3 platform tests passed 27; focused contracts/authorisation/evidence tests passed 586
  with 2 optional live-provider skips.
- The C14.5 homeowner integration and security regressions passed 4/4 and 4/4.
- `corepack pnpm test:c14` passed all locally available C14 source/control-plane suites. Eight API
  capabilities and one disposable full-production control-plane case were explicitly skipped
  because their external/live services were unavailable; skips are not acceptance evidence.
- `TEMP=/tmp TMP=/tmp TMPDIR=/tmp UV_CACHE_DIR=/tmp/c14-6-review-uv-cache CI=1 corepack pnpm verify`
  passed 24 lint, 24 typecheck, 45 unit-dependency and 24 build tasks; Ruff and mypy were clean; the
  Python suite passed 157 with 2 optional-runtime skips.
- Final `git diff --check`, changed-source review and repository formatting gates passed.

## Changed surface

The checkpoint changes only `apps/ios-capture/**`, its C14.6 tests and the audit/contract/
acceptance/plans/ledger evidence. The native changes comprise configuration and Info.plist callback
registration; authentication/session and Keychain recovery; safe project recovery; intake,
property and readiness contracts/service/view; app-root/hub composition; project-scoped model reset
hooks; Debug-only UI fixtures; unit/UI coverage; XcodeGen output; and this README.

- Backend HTTP/shared schema/OpenAPI changes: none.
- Database migrations: none.
- Generated-client changes: none.
- Root manifest/lockfile changes: none.
- Authentication, tenant isolation, server action checks, provenance, immutable evidence and exact
  confirmed-twin pins are preserved.

## Limitations, risks and explicit non-claims

- No live OIDC provider activation, account provisioning, production deployment or remote token
  revocation evidence. Local fixture sign-in proves Simulator behavior only.
- No live address, UPRN, EPC, planning or mapping provider and no approval of property-data licence,
  privacy or retention terms. Fixture/manual behavior is explicit.
- No physical-device, camera, background transfer, RoomPlan/LiDAR or representative-home evidence.
- No C6 proposal execution/acceptance, production C8 reconstruction, C9 fusion, C4/C5
  confirmation or confirmed-twin creation.
- No provider enhancement, render GPU/hardware/host, survey, structure, boundary, regulation, cost,
  availability or professional approval claim.
- No C15 implementation or acceptance. No later checkpoint is opened by this record.

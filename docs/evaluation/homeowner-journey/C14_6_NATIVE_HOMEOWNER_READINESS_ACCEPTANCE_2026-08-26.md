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
- The mandatory-parallelism gate was unsatisfied because authentication, Keychain/session recovery,
  project switching, setup composition and adaptive navigation share one target and state graph. No
  task, subagent or worktree was spawned.

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
  restored, and large-text action operability.
- Final named runs passed on iPhone Air and iPad Pro 13-inch (M5), both iOS 26.4. Release output was
  scanned for the C14.6 scenario flags, fixture property string and fixture view symbol; none were
  present.

Retained captures:

- [iPhone Air readiness](artifacts/c14_6/iphone_air/6A7D8A93-A0ED-440D-9C7D-596B2BD6769A.png)
- [iPad Pro 13-inch readiness](artifacts/c14_6/ipad_pro_13/AEE7C579-94A4-4CBD-875A-8D27D1A81CD5.png)

## Verification ledger

### Native and generated-contract gates

- `xcodegen generate --spec project.yml` was byte-stable before and after implementation. The final
  tracked `project.pbxproj` SHA-256 is
  `3b5a8346332757bc9190a293503e73cf5c5574356e8a009c35da4b666efa875a`.
- Generated OpenAPI/TypeScript/Swift regeneration produced zero drift. The unchanged generated Swift
  package passed `swift test --package-path packages/api-contracts/generated/swift`: 3 passed.
- The final locally signed iPhone Air suite passed 166 logical tests, 173 device invocations, 0
  failed and 0 skipped. Its result is
  `apps/ios-capture/.build/C14_6SignedKeychain/Logs/Test/Test-HomeDesignCapture-2026.08.26_11-50-10-+0100.xcresult`.
- The affected C14.6 unit group passed 27/27. The first intentionally unsigned full-suite attempt
  showed that a real Keychain round-trip cannot run without app entitlements; the required locally
  signed rerun above passed and supersedes that invocation.
- `xcodebuild ... -only-testing:HomeDesignCaptureUITests/C14_6HomeownerReadinessUITests test`
  passed 3/3 on iPhone Air and 3/3 on iPad Pro 13-inch (M5), both iOS 26.4. Final result bundles are
  `apps/ios-capture/.build/C14_6UI-iPhone/Logs/Test/Test-HomeDesignCapture-2026.08.26_11-47-46-+0100.xcresult`
  and
  `apps/ios-capture/.build/C14_6UI-iPad/Logs/Test/Test-HomeDesignCapture-2026.08.26_11-49-00-+0100.xcresult`.
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
- `TEMP=/tmp TMP=/tmp TMPDIR=/tmp UV_CACHE_DIR=/tmp/c14-6-uv-cache CI=1 corepack pnpm verify`
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

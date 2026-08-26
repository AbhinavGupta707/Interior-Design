# C14.5 Native App Audit — 2026-08-26

## Audit position

The existing iOS target is a capable native evidence and capture companion, not yet a complete
standalone homeowner product. It starts by listing projects and sends every selection directly to
capture eligibility. That is an audit finding, not the target architecture.

C14.5 may make the confirmed-twin-to-render design loop native, but it must not describe the whole
app as standalone while native project creation, intake, property context, proposal production and
canonical confirmation remain absent. The product-level target is an adaptive homeowner hub where
capture is one branch, design is another branch, and every branch is enabled only by fresh
server-authoritative state.

## Baseline and method

- Audited commit: clean `main` at `0f4018befecda80488b9fa72e2116f621a9ef57c`.
- Audit branch: `codex/c14-native-homeowner-studio`.
- Runtime: one primary `gpt-5.6-sol` session with `xhigh` reasoning.
- Read set: both `AGENTS.md` files, active/master plans, orchestration ledger, current iOS source and
  tests, C14.3 Mac handoff, C14.4 contract/acceptance, the integrated homeowner-journey state
  derivation, and the relevant C1-C14 platform routes.
- Baseline XcodeGen regeneration produced no tracked diff.
- The unmodified app built successfully with Xcode 26.4 for generic `iOS Simulator`, Swift 6 strict
  concurrency and code signing disabled. This is build evidence only, not rendered Simulator,
  physical-device, camera, RoomPlan or LiDAR evidence.

## Existing native architecture

- `HomeDesignCaptureApp` validates environment and API origin before constructing the root view.
  Non-local environments require HTTPS; credentials, query and fragment data are rejected.
- `AppRootView` owns one `NavigationStack`, project/evidence repositories, C7 capture state and C8
  media state. There is no native C3-C6 or C9-C14 feature module.
- `CaptureFlowModel.selectProject` computes device capture eligibility and replaces the path with
  `.eligibility`. Project selection therefore makes capture the mandatory opening funnel.
- The C1 project client authenticates as the deterministic local homeowner and lists projects, but
  retains that token only inside the call. C2/C7/C8 use a separate Keychain-backed short-lived token
  provider with one invalidation/refresh attempt. C14.5 must use the latter pattern for every new
  native API call.
- C2 implements project-scoped evidence inventory, rights, service-processing consent, default-
  denied training consent, local hashing, resumable multipart upload and fresh preview access.
- C7 implements native RoomPlan eligibility/capture, protected journalling, typed server sync and
  explicit unsupported/manual routes.
- C8 implements native still/video capture, protected local media, bounded quality observations and
  immutable C2 upload. It does not submit or review a server C8 reconstruction job.
- Debug-only C7/C8 fixture roots are selected before the real app. Release builds exclude those
  branches. C14.5 must preserve that separation and exercise real production views through injected
  services rather than build a parallel demo UI.

## Complete native journey and remaining web dependencies

| Product stage | Native state before C14.5 | Authoritative dependency and exact gap |
| --- | --- | --- |
| Sign in / restore session | Partial | Local fixture refresh plus Keychain-backed bearer reuse exists. No production OIDC sign-in surface exists; staging/production refresh deliberately fails closed. |
| Create project | Missing | `POST /v1/projects` exists and is audited/idempotent, but native only calls `GET /v1/projects`. Empty state explicitly instructs the homeowner to create on web. |
| Continue project | Partial | Native lists server projects, but has no server-derived whole-journey summary, no last-project restoration and no adaptive hub. Local fixture projects must never unlock live design. |
| Renovation goals / intake | Missing | C1 `GET/PUT .../intake` and optimistic revision contract are web-only. Native cannot create, edit or review structured goals/evidence availability. |
| Property context | Missing | C3 resolve/select/dossier/source-record flows are web-only. Native cannot confirm manual/provider-disabled property context. Address context must still never establish an interior. |
| Rights-cleared evidence | Present | C2 inventory, upload, rights and consent are native. It remains evidence handling, not geometry confirmation. |
| RoomPlan / photo / video capture | Present with limits | C7 and C8 capture branches are native with protected recovery. Simulator/device capability is honest. Physical-device, RoomPlan/LiDAR and background-relaunch acceptance remain unproved. |
| C6 plan proposal | Missing | Native cannot start processing, calibrate, review candidates or create a typed operation draft from a ready plan. |
| C8 reconstruction proposal | Missing | Native uploads media but cannot start, monitor or inspect server reconstruction results. Production C8 is not accepted. |
| C9 fusion proposal | Missing | Native cannot select sources/anchors, start fusion, review discrepancies or create the exact persisted operation draft. Production C9 is not accepted. |
| C4/C5 workspace and confirmation | Missing | Native cannot initialize the unmeasured existing model, create/list branches, preview typed operations, or explicitly commit a C6/C9 draft. It therefore cannot independently reach a confirmed twin. |
| Confirmed-twin gate | Read-only target in C14.5 | The truthful gate is a changed C5 branch whose head equals the exact current existing snapshot and differs from its immutable source, plus a succeeded C10 job pinned to that snapshot ID and SHA-256. Local recovery cannot satisfy this gate. |
| C10-C14 design loop | Missing before C14.5 | C14.4 generated Swift reads exist but are not linked to the app. All exploration, brief, options, specification/material decisions, render eligibility, submission and result viewing remain web-only. |

## Frozen corrective direction

C14.5 replaces capture-first routing with a native homeowner hub that can:

1. continue an authorised server project;
2. create a project through the existing C1 server route, while honestly showing intake/property
   as not yet available natively;
3. resume evidence, RoomPlan or media capture as one branch;
4. read fresh server prerequisite state and enter the native C10-C14 design studio only when the
   exact confirmed-twin gate is satisfied; and
5. show a precise prerequisite checklist otherwise, without fabricating progress or deep-linking to
   web as though that were native completion.

The first post-C14.5 native gap is therefore C1/C3/C4-C9 journey completion: structured intake,
property context, C6/C8 proposal jobs, C9 reconciliation, and exact C5 preview/commit. C14.5 does
not close those stages and its acceptance must say so.

## Security and recovery findings

- Project/evidence/capture APIs authenticate and scope through the server; no client-supplied
  tenant, user or role is authority.
- New project creation must use the existing server action and idempotency contract. A local
  project row is never authoritative.
- The C14.4 generated Swift package is the required consumer for exact C12 confirmation recovery
  and C14 eligible-source discovery. Those records must not be reimplemented or widened natively.
- Cold launch and cross-device recovery must re-fetch server state and exact pins. A protected,
  bounded cache may retain last-verified display summaries and IDs for offline explanation only.
- The cache must not retain bearer tokens, signed URLs, source/render bytes, confirmation authority
  or render eligibility authority. Offline state is read-only and visibly stale.
- `401`, `403/404`, `409`, `410`, `422`, `429` and `503` require distinct fail-closed presentation.
  No stale request is silently rebased or retried as a mutation.

## Baseline limitations

This audit contains no physical-device, RoomPlan/LiDAR, representative-home, production C8/C9,
provider, render-hardware or C15 evidence. It does not prove background transfer relaunch on a real
device. Those non-claims remain binding for C14.5.

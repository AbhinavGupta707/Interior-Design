# C14.7 Native Proposal-to-Twin Integration Audit — 2026-08-26

## Audited baseline

- Exact requested base: `main` at `f97f61dc0139dc68fd47469bc700e84313ae9764`.
- The root `AGENTS.md` has a pre-existing user-owned modification. It is preserved untouched and is
  outside this checkpoint.
- C14.5 already provides the adaptive homeowner hub and a fresh exact gate into the complete native
  C10-C14 design loop.
- C14.6 already provides production-shaped authentication/session recovery, project creation and
  switching, structured C1 intake, C3 property selection/dossier, C2 evidence and honest proposal
  readiness.

## Remaining native dependency map

| Stage                | Existing server authority                                             | Existing native surface                       | Remaining integration                                                       |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| C4/C5 initialization | C5 integrated one-time C4 bridge, typed branches, preview and commit  | C14.5 can read the exact gate                 | acknowledgement-only platform initialization and full review/confirm UI     |
| C6 plan proposal     | job/proposal/calibration/review-to-draft routes                       | ready plan assets only                        | start, poll, calibrate, explicit candidate review and exact operation draft |
| C8 reconstruction    | rights-verified job/result routes with geometry/appearance separation | immutable photo/video capture and upload only | exact source selection, start/poll/result inspection                        |
| C9 fusion            | source verification, anchors, discrepancy review and operation draft  | none                                          | platform source discovery, explicit selection/anchors/review/draft          |
| C10 handoff          | exact snapshot-pinned scene jobs                                      | fresh exact scene gate and downstream design  | create/poll exact committed snapshot and continue into existing studio      |

## Authority issue found before freeze

The accepted web C14.2 initialization route constructs its unmeasured snapshot inside the Next.js
BFF after loading the authenticated session and selected property. Sending the same constructed
snapshot from native would move deterministic IDs, property binding and placeholder geometry into a
client and would violate the accepted authority boundary. C14.7 therefore adds an acknowledgement-
only platform route and moves the existing builder to the platform composition boundary.

The accepted web C9 workspace also calculates persisted-source descriptors and hashes in the BFF.
Native must not reproduce those hash rules. C14.7 therefore adds a platform discovery route backed
by the same persistence verification used again at C9 job creation. The web BFF will consume that
route as well, removing two independent source-description implementations.

## Orchestration decision

This checkpoint is intentionally one primary `gpt-5.6-sol` / `xhigh` session. Navigation, proposal
state, exact optimistic pins, role/project invalidation and downstream C14.5 activation are one
tightly coupled state graph; the user explicitly prohibited subagents, separate tasks and
worktrees. No delegation is used.

## Baseline claim boundary

This audit establishes software integration scope only. It is not physical-device, representative-
home, production-provider, real CUDA/C8/C9, render-hardware or C15 evidence.

## Closeout reconciliation

Implementation revision `08d5de02b9d83dfdcaa58cb8f713523521b9ea75` closes every software gap
listed in the dependency map without moving authority into the native client. The platform now owns
acknowledgement-only C5 initialization and exact rights-filtered C9 source discovery; the web BFFs
delegate to those authorities. Native integrates the existing C6/C8/C9 proposal surfaces, explicit
C4/C5 review/correction/preview/confirmation and exact C10 compilation into the homeowner hub, then
hands the matching confirmed snapshot to the existing C11-C14 studio.

No migration, OpenAPI/generated-client, root manifest or lockfile change was required. The durable
software and Simulator evidence is recorded in
`C14_7_NATIVE_CONFIRMED_TWIN_ACCEPTANCE_2026-08-26.md`. Physical-device, representative-home,
production-provider, real CUDA/C8/C9, render-hardware, deployment and C15 boundaries remain open
external gates rather than hidden implementation gaps.

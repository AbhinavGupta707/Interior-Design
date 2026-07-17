# C9 model-fusion closure evidence — 2026-07-17

## Outcome

C9 is complete locally and on `main`. It now accepts exact C6 plan and C7 RoomPlan proposals,
requires explicit measured registration for source-local inputs, runs the real geometry and
bounded Python semantic producers, publishes an uncertainty-labelled proposal, records
attributable decisions and creates an exact branch-pinned C5 operation draft without mutating the
canonical model.

Product completion SHA: `e0aa7c0`.

## Integrated production-path proof

The final disposable local journey used PostgreSQL 16, the real C1-C9 migrations and repositories,
the real Fastify API, Next same-origin BFF, C9 spatial worker, geometry kernel and
`python -m inference_worker.scan_to_model`. The inputs were repository-generated and visibly
synthetic: one exact C6 plan proposal, one exact C7 RoomPlan proposal and one existing snapshot
whose first wall was deliberately offset by 25 mm.

At 1440×960 the owner:

1. selected both immutable source versions;
2. supplied three measured, non-collinear identity correspondences for each source-local input;
3. created a durable job;
4. received a seven-discrepancy partial proposal;
5. reviewed the exact 25 mm base/candidate wall conflict; and
6. created a draft containing `wall.translate.v1` with `xMm: 25`.

At 390×844 the Alpha viewer saw the same evidence and proposal with no mutation control. Both
journeys passed without horizontal overflow, unexpected console/page error, failed C9 request or
secret-shaped output. The final database assertion observed `snapshot_count=1`,
`branch_revision=0`, five terminal jobs/proposals accumulated during repeated diagnostic runs and
three operation drafts. Repeated counts are not product metrics; the invariant is that no C5
preview/commit, branch advance or canonical snapshot write occurred.

## Verification matrix

| Gate                                              | Result                                             |
| ------------------------------------------------- | -------------------------------------------------- |
| Full `UV_CACHE_DIR=.cache/uv pnpm verify`         | pass                                               |
| Platform API unit/contract pack                   | 117 pass; 25 declared live-provider/database skips |
| Spatial worker pack                               | 96 pass; three declared live-database skips        |
| Web pack                                          | 74 pass                                            |
| Geometry kernel pack                              | 43 pass                                            |
| Python Ruff / strict mypy / pytest                | pass / pass / 117 pass, two runtime skips          |
| C9 web-focused tests                              | 14/14                                              |
| C9 worker-focused tests                           | 24/24                                              |
| C9 disposable PostgreSQL schema suite             | 3/3                                                |
| Independent fusion evaluation                     | 6/6                                                |
| Independent fusion security                       | 28/28                                              |
| Synthetic desktop/mobile/keyboard Playwright      | 9/9                                                |
| Real BFF/API/worker desktop/mobile Playwright     | 2/2                                                |
| E2E/evaluation/security TypeScript no-emit checks | pass                                               |

The synthetic browser pack additionally covers cancel/retry, full/partial/disconnected/abstained
states, every decision choice, stale conflicts, offline/error recovery, viewer denial, keyboard
flow and mobile containment. It is not relabelled as producer-live evidence.

## Closure repairs

- The default worker composition now uses the real C9 registration and Python semantic producers.
- Source-local inputs require three explicit measured control-point pairs; blank, fractional,
  out-of-range and collinear inputs fail closed.
- Base-versus-candidate wall comparison produces exact attributed discrepancies and deterministic
  `wall.translate.v1` suggestions, with a regression proving aligned walls do not generate a false
  position conflict.
- The live harness proves the same path a user invokes: BFF → API → Postgres queue → worker →
  geometry/Python producer → immutable publication → review → operation draft.

## Honest limitations

The following are `NOT RUN` and are not implied by C9 completion:

- physical iPhone/iPad RoomPlan capture or accuracy;
- real C8 COLMAP/Open3D reconstruction and inline parametric semantic observations;
- neural rendering, GPU, NVIDIA or CUDA execution;
- representative-property geometric accuracy or production capacity;
- cloud object storage, provider credentials or public deployment; and
- measured human correction time or professional/survey/regulatory fitness.

C8 results remain registered evidence, but the current immutable C8 result contract does not
embed parametric semantic geometry. The C9 adapter therefore abstains when fewer than two
registered source kinds supply explicit semantic observations. No paid service, customer data,
training permission or fabricated hardware/provider evidence was used.

C10 is deliberately not activated because the user instructed the orchestrator to pause after C9.

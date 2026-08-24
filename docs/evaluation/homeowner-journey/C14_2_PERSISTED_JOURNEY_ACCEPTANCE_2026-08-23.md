# C14.2 Persisted Homeowner Journey Acceptance — 2026-08-23

## Acceptance position

C14.2 is software-complete for the Windows-testable core homeowner journey. A
homeowner can start from ordinary local sign-in and project creation, confirm a
manual property identity, persist renovation goals and evidence availability,
upload rights-cleared evidence with service-processing consent and training
denied, explicitly acknowledge an unmeasured existing-model workspace, review a
source-pinned C6 plan proposal, calibrate and accept its candidates, run a
separate C5 preview and explicit commit, and explore a C10 scene compiled from
the exact committed current snapshot.

Two different evidence classes support that statement:

1. **Local host-live production-path evidence** used the built platform API,
   web app, spatial worker, PostgreSQL/PostGIS and object storage. Its input was
   a manual synthetic address and creator-owned synthetic SVG plan. The state is
   persisted and server-authorised, not browser-local or fixture-only.
2. **Deterministic rendered acceptance evidence** starts from an empty stateful
   acceptance backend and exercises the production web/BFF code through normal
   UI navigation. It independently asserts exact mutation order and security
   boundaries. It is still fixture evidence, not a deployed service or real
   property.

Neither class proves a representative home's interior. Public/manual property
context remains linkage only. The initial workspace contains one explicitly
user-asserted placeholder level with unknown name, elevation and storey height,
and no rooms, boundaries or dimensions. The C6 output remains a proposal until
reviewed, previewed and committed through C5.

## Revision and orchestration trail

- L1 worker `616a1770200aa052466c189d62ae01a7c928ec29`; reviewed integration
  `6dd78a86e75c36fdcf3dc7949b36156fbe31a56c`.
- L2 worker `486d9fbde9149181831a0623faafea67536137e8`; reviewed integration
  `030e294a84b830ddd4b85880b1aba7804cb0e422`.
- Production repair/live-evidence revision: `076901d42e5fa381ed0f04d003061e4b00c56ba8`.
- Formatting-only integration revision with full repository verification:
  `fac7fe661602fe8c3937de36c19ea10a7b8aad12`.
- Authoritative replacement L3 task:
  `01a03087-5fcf-7311-88cc-7a18ce9ae13f`, worktree
  `C:/Users/abhin/.codex/worktrees/8a48/interior-design`, model
  `gpt-5.6-sol`, reasoning `xhigh`, base `076901d`.
- The task stopped only at the usage limit. Its ten preserved acceptance files
  were recovered without rewriting as worker commit
  `eb8b3f6e3dbc45a9fef9477110b8b5e720848c64`.
- Recovery integration commit on the primary branch:
  `ea5d0f77ce11add5e049eb4f9c57e93eb8b85736`.
- Orchestrator review/repair and passing acceptance commit:
  `49faeb2869c9b4e3d9622c3bd1075112d37881bf`.
- Initial durable evaluation commit:
  `7f77329f47384526ec5eda43c1822f87a13ca75c`.
- Final reviewed product/evidence integration revision:
  `dd225fa6b3d8baa7340f8236162bfa2860d4add0`.
- Stale duplicate task `01a03070-7dfc-7c13-b684-9fa80c879e97` at
  `6919cea` was not resumed, merged or used as an integration source.

## Rendered persisted acceptance

The browser starts at `/sign-in`, selects the ordinary local homeowner persona,
observes an empty project list, creates a project and follows the normal
post-create redirect to `/home/{projectId}`. It never injects JSON, seeds a
canonical model, starts from a specialist route or advances a stage from hidden
browser state.

The final stateful fixture asserts this accepted mutation order:

1. `project.create`
2. `property.manual`
3. `intake.persist`
4. `evidence.upload-start`
5. `evidence.ready`
6. `model.acknowledged-setup`
7. `c6.proposal`
8. `c6.calibration`
9. `c6.draft`
10. `c5.preview`
11. `c5.commit`
12. `c10.scene`

The browser body at the setup boundary is exactly
`{ confirmUnmeasuredInterior: true }`. The same-origin product adapter obtains
the actor and selected property server-side and constructs the C4 request. The
acceptance backend begins with no property, intake, asset, model, branch,
proposal, commit or scene state.

Independent assertions prove:

- manual property mode and `unknown-without-evidence` interior status;
- immutable ready plan source with service processing allowed and training use
  denied;
- setup attribution bound to the authenticated actor with empty evidence IDs;
- unknown placeholder level fields and a non-established global anchor;
- current snapshot unchanged at initialization revision 1, draft and preview;
- seven reviewed C6 candidates, zero unresolved candidates and 0 mm synthetic
  calibration residual;
- branch revision 2 only after the explicit C5 commit, with the immutable setup
  snapshot retained as branch source;
- C10 job source equal to the exact current existing snapshot ID and SHA;
- zero C8 v2 route invocations.

The headless host intentionally disables WebGL. The viewer therefore exercises
the production accessible DOM fallback and does not claim a rendered canvas.
Expected initial C5 `MODEL_NOT_FOUND` and empty C1/C3 204 responses are tracked
as explicit unavailable/empty states; all other HTTP failures, failed requests,
console errors, page errors and unexpected origins fail the test.

## Focused commands and results

The repository-pinned package manager was used through Corepack (`pnpm
10.33.0`); manifests and the lockfile were unchanged.

```bash
corepack pnpm exec tsc -p tests/e2e/homeowner-setup/tsconfig.json --noEmit
corepack pnpm exec tsc -p tests/integration/homeowner-setup/tsconfig.json --noEmit
corepack pnpm exec tsc -p tests/security/homeowner-setup/tsconfig.json --noEmit
```

Result: three exit-0 configurations, zero diagnostics.

```bash
NODE_OPTIONS=--conditions=development corepack pnpm exec vitest run \
  --config tests/integration/homeowner-setup/vitest.config.ts
NODE_OPTIONS=--conditions=development corepack pnpm exec vitest run \
  --config tests/security/homeowner-setup/vitest.config.ts
```

Result: integration 1 file / 4 tests passed; security 1 file / 4 tests passed.

```bash
NODE_OPTIONS=--conditions=development corepack pnpm exec playwright test \
  --config tests/e2e/homeowner-setup/playwright.config.ts
```

Result: 1 rendered desktop journey passed at 1440×960 in 29.4 seconds using the
pinned Playwright Chromium. Next.js emitted a development-only
`MaxListenersExceededWarning` while proxying repeated fixture calls; it did not
produce a browser page error or failed accepted mutation. Next dev's generated
`apps/web/next-env.d.ts` drift was restored and is absent from the commit.

`git diff --check` also passed. C14.1 regression and full repository gates are
recorded in the checkpoint/ledger closeout at the final integration head.

## Host-live database and object evidence

The repaired clean host-live journey used database
`homeowner_journey_20260823` and project
`9731c398-70c2-4dd5-a3ab-6474153a1795` (`C14 Clean Journey`).

| Record          | Exact evidence                                                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C5 branch       | `98fb6b22-4dd6-474f-a63c-0607720c0f9a`; source snapshot `83f7446f-04ce-4781-a1a8-ae59ea14c75b`; head/current snapshot `b68e48e9-9a09-40cd-ad27-6c4efde47d52`; revision 2; current SHA-256 `4b0938c61747fcfed87d913671b410c4cc62b3046f9e60f36cc840a013703d23`                             |
| Source asset    | `2cf910c8-6679-4776-9a9d-e3dd569d52fe`; `creator-owned-clean-plan.svg`; 162 bytes; SHA-256 `c8eb8a219afc1ebca6c24aa9fb2900614b530bb96824f057461829aa0ac077a5`; object key `sources/66883b22-2e7d-488f-b434-58349ada10f1`; ready; owned by user; service processing true; training denied |
| C10 job/scene   | job `bd196964-a7d7-457d-b20b-7cd1e2816b28`; scene `7d1c62b3-285d-44f6-b907-ce0b25945f4e`; 1,856-byte GLB; GLB SHA-256 `886534b9e719a19c3e5b27cad0eedbb1d97391a2dacebd1eb2173534869a45f1`; manifest SHA-256 `ce98e9a1a195f9248fd77f12259fe19a70a99ab8ea622792dcb5db7dbd99cd9b`            |
| Derived preview | 704 bytes; SHA-256 `a72035ba5985ba6986d2d6804ee44af6077703e884d4e8b799778e558af8927e`                                                                                                                                                                                                    |

The source, preview and GLB were re-downloaded from local object storage and
rehash-verified. Database queries found zero C8 reconstruction jobs and zero C9
fusion jobs. No C8/C9 live run or C8 v2 production route is claimed.

## Screenshot evidence

Host-live production-path screenshots retained from the clean run:

- `/tmp/c14-clean-home-final.png`: 1440×2258, 534,860 bytes, SHA-256
  `8b4c7996f659da140524e6e093d3c4f02fc09580966b36a369bb583ada4c0714`.
- `/tmp/c14-clean-viewer.png`: 1440×2006, 217,800 bytes, SHA-256
  `cd4227d2cc06ada74c2f7d4723017c99338c20b373f1340bc7dda818287079ba`.

Final deterministic rendered acceptance screenshots:

- `/tmp/c14-2-persisted-home.png`: 1440×2258, 534,510 bytes, SHA-256
  `652a484e4440d1640a9837f2e016a446e345f02ed135872f080cb0febd202906`.
- `/tmp/c14-2-persisted-viewer.png`: 1440×1930, 193,302 bytes, SHA-256
  `c79b495faef028923f988476746dbf418a02a47ead3e32c3f8a6035070c0ae5b`.

The in-app Browser was attempted against the healthy local services but failed
before any page action because the managed Windows sandbox returned
`helper_unknown_error` while establishing its runner. The pinned standalone
Playwright Chromium fallback produced the rendered evidence above. The same
sandbox helper prevented the image-view tool from reopening the WSL PNGs in
this closeout session, so no new in-app visual-inspection claim is made.

## What remains experimental or externally deferred

- C8 v2 remains acceptance-only. It has no production product adapter or route
  in this slice and was not exercised.
- C8 v1 provider/GPU reconstruction and C9 multi-source fusion were not run.
  A real C9 run still requires at least two eligible distinct source kinds.
- The property and plan are synthetic inputs. No deployed provider,
  representative property, survey-grade measurement, professional review,
  WebGL canvas or physical reconstruction-quality claim is made.
- Xcode, iOS Simulator, RoomPlan, LiDAR, camera capture, background transfer and
  physical Apple device validation were not run on Windows/WSL. The precise
  handoff remains `docs/runbooks/ios/C14_1_APPLE_HANDOFF.md`.
- Postgres/PostGIS and object-storage volumes retain the host-live evidence.
  API, web and worker processes are disposable and may be stopped after final
  verification without deleting those volumes.

## Contract and migration impact

Shared contracts, OpenAPI/generated clients, authz registries, migrations,
worker protocols, manifests and lockfiles are unchanged. C14.2 uses the existing
C3, C4/C5, C2, C6 and C10 authorities. The only production repairs were the
authenticated attribution binding and bounded acknowledgement-only web adapter
already integrated in L1/L2; L3 owns tests and this evidence document only.

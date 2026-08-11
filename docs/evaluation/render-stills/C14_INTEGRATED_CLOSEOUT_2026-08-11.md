# C14 integrated local close-out — 2026-08-11

## Decision

**C14 implementation-ready / hardware-gate-deferred**

Session A closed every locally available C14 implementation, control-plane, repository and browser
gate from starting `main` commit `7f4280273e0dd1c86e434e1555cbe6baafbcbf69`, which was 21
commits ahead of `origin/main`. The 21 commits and all user-owned/untracked inputs were preserved.
C15 was not opened.

No Blender executable, version command, capability probe, renderer, host-acceptance script, GPU
workload or real-render acceptance was invoked on this Mac. Every local renderer-shaped artifact in
this record is explicitly frozen/inert synthetic fixture evidence. The ignored
`docs/evaluation/render-stills/artifacts/c14-local-host-acceptance-20260722/` bundle is not accepted
evidence and was neither changed nor used.

## Integrated changes

- Registered `pnpm test:c14` as a source-only, generated-output-excluding C14 gate spanning the
  render-scene, inert renderer, API, worker, web, enhancement, evaluation, performance, security,
  typecheck and disposable-live layers.
- Made `api:check` execute 13 focused API/BFF seam tests and `dependency:boundaries` execute three
  static render-job boundary tests.
- Added the project-list navigation link to `/render-stills/:projectId` and retained its keyboard
  and mobile onboarding coverage.
- Corrected C14 source authority for real C13 substitutions: the immutable C12 source-confirmation
  origin must belong to the same model, while current revision/model pins must equal the exact C10
  snapshot. A regression test locks this distinction.
- Hardened exact S3 reads, GLB/EXR inspection, renderer-script typing and portable host acceptance.
  The acceptance entrypoint now requires an explicit absolute path and contains no hard-coded Mac
  executable or host fingerprint.
- Added a repeatable production-composed C1-C14 integration using Postgres, S3-compatible storage,
  exact C10/C13 sources, the real queue/lease/publication/access code and only
  `FrozenInertRenderer` for synthetic output bytes.
- Made the focused C14 PostgreSQL suite reuse-safe: it applies migrations only to an empty
  disposable database, otherwise requires exactly 0001-0014, removes stale fixed-name probe roles
  defensively, and makes teardown safe after partial setup failure.
- Raised only the external-process PDF fixture test timeout from five to 15 seconds after two
  concurrent repository gates caused the same 5.01-second timeout; the unchanged assertions passed
  in 583 ms and 509 ms in the final serial contract/integration runs.

## Disposable Postgres/S3 evidence

The isolated Compose project was `interior-design-c14-closeout-20260811`. It used Postgres 18.4 on
`127.0.0.1:55414` and SeaweedFS 4.29 S3 on `127.0.0.1:18333`, with dedicated disposable volumes.
Existing Docker projects and volumes were not changed.

Two brand-new databases were used:

- `c14_closeout_final_api_20260811`
- `c14_closeout_final_control_20260811`

Both applied exactly 14 registered migrations, from `0001_identity_projects_intake` through
`0014_render_stills`. The control-plane test starts from empty state, but repeat runs accept only the
exact complete migration set and reject a partially migrated database.

The final production-composed control-plane chain produced:

| Record                         | Exact value                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Tenant                         | `10000000-0000-4000-8000-000000000001`                                                         |
| Project                        | `0fa26e34-457b-46a3-8ab4-cfcbbd53d1fd`                                                         |
| Source model                   | `e9866ec1-4c9b-4d87-80bf-64a772941a4b`                                                         |
| Source snapshot                | `cd5b1837-1151-419e-8633-7cc2c1a23201`, version 3                                              |
| Source snapshot SHA-256        | `9a98edfe47bb4425f96ae5c0c7f3056208423942bea5037a9a2c27e84922ab98`                             |
| Scene job                      | `1f69aaa2-b1b1-44bb-b048-fee4ab24f65f`                                                         |
| Scene/artifact                 | `e56ec7fc-7e88-49c4-bcd8-9ecaac98efdc` / `b8d8e940-9e84-4197-96df-9e37217a043a`                |
| Scene compiler                 | `interior-design-scene-compiler` 1.0.0                                                         |
| GLB                            | 3,968 bytes; SHA-256 `ad0abe02303cf32dc45c60a6a82a7291d4831bcf79a65e2c2653052a9c3ec8b9`        |
| Scene manifest SHA-256         | `2d75fbb27ec163c2f5269f54235b07f42406018c76f84c4a3a8d3bcbe76b94e3`                             |
| Specification                  | `c11c50ab-22b2-4179-b77e-814cad914b43`, revision 2                                             |
| Specification revision SHA-256 | `bf8cd16147b5e713d3fd0672b5fb0d56fca81f7278cb1302ec1c7962ce72a563`                             |
| Catalog release                | `e42ea23e-7d72-528a-8f4f-63b4e42829a8`                                                         |
| Catalog release SHA-256        | `40ad8e2619809950de745a22e9c96e1bd4d7a67a7eec373566b207b483102aec`                             |
| Render job/result              | `433ab4c0-bed5-4fd0-9e7e-7c9b780452b8` / `63cd9dc8-73c1-4d04-8b41-5fe546082db7`                |
| Required capability            | `render.cycles.cpu.v1` (synthetic control-plane declaration only)                              |
| Result manifest SHA-256        | `ba876d4a9d006b90cd172c77388224d2df18d2add07223c0c32f185861588ed2`                             |
| Durable evidence               | state `succeeded`; attempt 1; version 7; five artifacts; seven audit events; two outbox events |

The five artifacts were generated by `FrozenInertRenderer`, are 64×64 synthetic fixtures, and are
not Blender/Cycles/pass-quality evidence:

| Role                | Bytes | SHA-256                                                            |
| ------------------- | ----: | ------------------------------------------------------------------ |
| `geometry-safe-png` |   180 | `6ee8aa0cbe89accd64606c66de63eb0debd621dfa68ba7e3be571d7029fb06ef` |
| `multilayer-exr`    |   213 | `0cd10e0254778acadf604d09635f311935ca7dad01982449a968f7946c42df84` |
| `depth-exr`         |   117 | `45f90ea7cb16514971fbeb530a0e47fbf62d3e037c3f153d833dcd024d63afb9` |
| `normal-exr`        |   174 | `f49d18421145fcd9c6a42dd95176e33c6340076b9641e3e9bcb1c0ba7176f51f` |
| `segmentation-png`  |   178 | `239b9aa27653dd9e6c7a07c338e4f15754b2033ee7973e6a206a301f2db4329d` |

The integration re-downloaded all five objects through freshly brokered access and independently
checked exact bytes, SHA-256, media type, dimensions and PNG/EXR signatures. It also covered exact
source authority, IDOR/tenant/role denial, idempotency, concurrency, lease fencing, cancellation,
retry, stale work, disk reservations, immutable publication, audit/outbox records, log redaction and
unchanged canonical model mutation counts. The same target test passed twice consecutively on a
reused exact-migration database before the final from-empty run.

## Verification results

All final commands ran on Node 22.22.2 and pnpm 10.33.0 without Blender:

- `UV_CACHE_DIR=.cache/uv pnpm verify`: passed. Prettier and lint passed; all 24 workspace
  typecheck tasks passed; workspace unit tests passed; all 24 build tasks passed; Ruff passed; mypy
  passed 90 source files; pytest passed 130 and skipped two runtime-capability cases.
- live `pnpm test:c14` with both disposable database URLs and the isolated S3 endpoint: passed.
  Render-scene 2 files/15 tests; renderer boundary 6/13; platform API 6/26; spatial worker 2/6; web
  4/9; render evaluation 2/8; standalone evaluation/performance/security 6/18; six standalone
  TypeScript configurations; C14 Python Ruff; mypy nine source files; enhancement/security pytest
  22; disposable C1-C14 integration 1/1; API seam 4/13; dependency boundary 1/3.
- final same-database repeatability proof: focused PostgreSQL 1 file/8 tests passed, followed by the
  complete live `pnpm test:c14` gate with platform API 6 files/26 tests and disposable chain 1/1
  passing again against the same explicit databases and S3 scope.
- `pnpm test:contract`: passed. Spatial worker 30 files/147 tests with three Postgres-capability
  skips; platform API 54 files/233 tests with 51 live-service skips.
- `pnpm test:integration`: passed with the same 147/3 and 233/51 package results. The final PDF
  external-process case completed in 509 ms.
- `pnpm test:security`: 2 files/921 tests passed.
- `pnpm test:geometry`: 6 files/43 tests passed.
- `pnpm api:check`: 4 files/13 tests passed.
- `pnpm dependency:boundaries`: 1 file/3 tests passed.
- `pnpm exec playwright test --config apps/web/playwright.config.ts`: 6/6 onboarding tests passed
  on Chromium desktop/mobile, including actual persona keyboard order and the C14 navigation link.
- `pnpm exec playwright test --config tests/e2e/render-stills/playwright.config.ts`: 22/22 passed
  across Chromium, Firefox and WebKit desktop plus 390×844 mobile configurations.
- final focused Chromium `@workflow` rerun: 1/1 passed and produced the final screenshot.
- `git diff --check`: required again immediately before commit.

The 51 platform and three spatial package skips are environment-gated legacy live suites; they are
not used to claim C14 live coverage. The registered live C14 gate separately ran its Postgres/S3
tests against the disposable services and passed with no C14 skip.

## Browser evidence

- C14 inert workflow: `/tmp/c14-render-stills-playwright-evidence/chromium-desktop-inert-workflow.png`
  (PNG, 1440×4243, 410,118 bytes), visually inspected after the passing test. It visibly labels the
  fixture capability, unavailable/deferred hardware gate and synthetic result.
- Onboarding desktop: `/tmp/c1-playwright-evidence/desktop-chromium-intake.png` (88,679 bytes).
- Onboarding mobile: `/tmp/c1-playwright-evidence/mobile-chromium-intake.png` (196,732 bytes).

The Codex in-app Browser controller was attempted twice but failed during controller bootstrap with
`Cannot redefine property: process` before any tab was created. It is `NOT RUN` as product evidence;
the complete Playwright engine/device matrix is the accepted browser evidence. No browser failure
was hidden or treated as render evidence.

## Contract, migration and dependency impact

- No frozen public schema version or generated client changed.
- No new migration was added. Existing migration `0014_render_stills` was applied from empty state
  after 0001-0013 on both disposable databases.
- The C14 public route inventory is unchanged. Root scripts gained `test:c14`; `api:check` and
  `dependency:boundaries` now run concrete tests.
- The production render-scene authority now accepts the valid C13 substitution lineage described
  above without weakening exact current snapshot, revision, release, rights, GLB or hash checks.
- No manifest, lockfile, shared OpenAPI/generated client or accepted ADR changed.

## Deferred evidence and owner action

`NOT RUN`: authorised-host Blender/Cycles execution, renderer build and executable attestation,
real OpenEXR channel-pixel validation, CPU/GPU/Metal/CUDA/OptiX performance, representative-home
perceptual/geometry review, external image-enhancement provider, physical LiDAR/camera hardware and
production deployment. No provider key, model download, network image service or customer data was
used. Enhancement remained disabled except for explicit deterministic fixtures.

The remaining C14 owner action is Session B on an explicitly authorised renderer host checked out at
the exact pushed Session A commit. Until that separate acceptance succeeds, production capability
must remain unavailable and the checkpoint status must remain
`implementation-ready / hardware-gate-deferred`.

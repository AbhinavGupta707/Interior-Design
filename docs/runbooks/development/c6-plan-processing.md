# C6 plan-processing development runbook

## Boundary and safety contract

C6 accepts one exact C2 `ready` asset with `kind=plan`, a supported detected MIME type, a retained service-processing grant, a supported rights basis and `trainingUseConsent=denied`. The source fingerprint is pinned when the job is created and is checked again in the create transaction, on retry and before a worker lease. A changed source, readiness state or rights state fails closed.

C6 produces an immutable proposal or abstention. A calibration and an operation draft are also immutable. The draft contains exact public C5 operations pinned to the current branch revision and head hash, but C6 never invokes preview or commit. The user must send the draft through the existing C5 preview and commit routes, where C5 repeats canonical validation and concurrency checks.

The supported v1 box is one selected page, at most 20 PDF pages, 25 MiB source bytes, 20 megapixels of raster work, 200 candidates, 5 MiB parser output, 30 seconds of total per-page source/normalization/parser work and three immutable attempts. Curves, freehand/perspective plans, sections/elevations, stairs, objects, structure and regulatory conclusions remain unsupported or unknown.

## Database and readiness

Migration `services/platform-api/migrations/0006_plan_processing.sql` requires C2 and C5 to be present. It creates:

- tenant/project-scoped jobs with immutable source/attempt identity and fenced leases;
- append-only proposal/abstention, calibration and operation-draft records;
- composite foreign keys that prevent cross-job proposal/calibration substitution;
- safe plan audit and transactional-outbox tables; and
- triggers that reject terminal-job rewriting and mutation/deletion of immutable records.

Apply it from the repository root:

```sh
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/platform-api exec tsx src/c6.ts migrate
```

The API readiness route includes `c6-database` and is not ready until the `0006_plan_processing` marker exists. Migration `0006` is registered in the shared migration registry.

Database URL lookup is `C6_DATABASE_URL`, then `C5_DATABASE_URL`, `C2_DATABASE_URL`, then `C1_DATABASE_URL`. Production requires one of them. Development otherwise uses the existing loopback database default.

## Public routes and permissions

The frozen routes are:

- `GET|POST /v1/projects/:projectId/plan-processing-jobs`
- `GET /v1/projects/:projectId/plan-processing-jobs/:jobId`
- `POST /v1/projects/:projectId/plan-processing-jobs/:jobId/cancel`
- `POST /v1/projects/:projectId/plan-processing-jobs/:jobId/retry`
- `GET /v1/projects/:projectId/plan-processing-jobs/:jobId/proposal`
- `POST /v1/projects/:projectId/plan-processing-jobs/:jobId/proposal/calibrations`
- `POST /v1/projects/:projectId/plan-processing-jobs/:jobId/proposal/operation-drafts`

Every request authenticates again and loads the project inside the current session tenant before resource disclosure. Owner/editor can create, cancel, retry, calibrate and draft. Viewer can list/read jobs and read proposals only. Every mutation requires an 8–128 character `Idempotency-Key`; a matching actor/action/key/body replays one response, while any actor/action/body mismatch conflicts.

Calibration uses exact rational affine arithmetic and half-away-from-zero integer rounding. A residual above 25 mm is rejected. Draft creation requires one decision for every candidate, explicit handling of low-confidence candidates, acknowledgement of every warning, no unresolved/severe region, exact candidate-to-operation ownership and a pure C5 reduction with no blocking topology finding. The repository locks and rechecks the branch revision/head again before storing the draft.

## Job states, retries and cancellation

The public states are `queued`, `processing`, `proposed`, `abstained`, `cancel-requested`, `cancelled` and `failed`.

- A lease changes queued or expired processing work to `processing` with a new owner/token/expiry fence.
- Publication locks the job and succeeds only for the exact live token before expiry.
- Cancellation changes queued work directly to `cancelled`; processing work becomes `cancel-requested` and therefore cannot publish.
- Worker acknowledgement, including expired abandoned cancellation, changes `cancel-requested` to `cancelled` with audit/outbox evidence.
- Failure/abstention is retryable only when the safe code permits it and the root attempt count is below three.
- Retry creates a new job row for the next attempt. It never clears or rewrites the prior terminal row/result.

Public/audit/workflow metadata contains IDs, source/normalized/parser/result hashes, versions, counts, states and safe codes only. It excludes object keys, signed URLs, local paths, raw bytes, extracted labels, parser stdout/stderr, credentials and operation bodies. Terminal result content is canonical-hashed without its volatile `createdAt` timestamp into the append-only result row and publish event.

## Spatial-worker boundary

Set `C6_PLAN_WORKER_ENABLED=true` to run the C6 runner alongside the existing C2 worker. It reuses the existing loopback/database/object-storage configuration only to fetch the immutable source, then writes it to a mode-0700 isolated workspace. Normalizer/parser subprocesses receive only `LANG`, `LC_ALL` and `PATH`; they receive no platform/cloud credentials and no shell.

Optional tool configuration:

- `C6_PDFTOCAIRO_PATH` (default `pdftocairo`)
- `C6_POPPLER_VERSION` (recorded version label; default `local-poppler`)
- `C6_PLAN_PARSER_COMMAND` (direct executable; default `python3`)
- `C6_PLAN_PARSER_PYTHONPATH` (inference service source root; default `services/inference-worker/src` from the process working directory)
- existing `C2_PDFINFO_PATH`, `C2_PDFTOPPM_PATH`, temporary-root/quota and worker lease settings

Normalization is vector first:

1. SVG is rejected if it contains DTD/entity, script/style, event handler, external reference, embedded active/media or CSS URL/import constructs. Straight line/rect/polygon/polyline geometry becomes the frozen normalized JSON envelope; label text is replaced by its SHA-256 marker. Unsupported groups, transforms, inline styling, paths or curves fall back to the grayscale raster baseline in automatic mode and fail explicitly in vector-only mode.
2. PDF page count and selected page are checked. `pdftocairo` attempts a vector SVG manifest first. A page without safe vector geometry falls back to raster unless vector-only mode was explicitly requested.
3. Before PDF rasterization, page dimensions at 150 dpi are checked against 20 megapixels. PDF raster, PNG and JPEG input is decoded with Sharp limits, orientation-normalized and flattened, then encoded as one row-major grayscale byte per pixel in the frozen JSON envelope; EXIF/ICC/XMP and other source metadata cannot cross the parser boundary.
4. Source streaming stops at the exact C2 byte count and hash. Source and normalized hashes are deterministic and the entire source/normalization/parser boundary shares the 30-second deadline. Workspaces are cleaned in `finally`.

Parser output is size-bounded and reparsed at the worker boundary. Job/project/source fields, rights, normalized hash, mode and normalizer versions must exactly match the input. Proposal geometry is checked for one level, in-bounds regions, valid level/host references, hosted opening segments, closed non-self-intersecting space boundaries and explicit low-confidence regions before the terminal transaction can publish it.

The production runner uses the shell-free `IsolatedPlanParserPort` and the deterministic Python fixture/vector/CPU-raster parser. The request pins the normalizer/version chain, normalized hash and source manifest; the returned parser manifest must echo that chain before publication. `LocalPlanParserFake` is retained only for bounded unit/repository tests.

## Focused verification

Materialize dependencies without network or lockfile changes:

```sh
pnpm install --frozen-lockfile --offline
```

Run package checks with the supported bundled Node runtime:

```sh
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/platform-api typecheck
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/platform-api exec vitest run --exclude 'dist/**' test/c6
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/spatial-worker typecheck
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/spatial-worker exec vitest run --exclude 'dist/**' test/plan-processing
```

The live suite is guarded and must be reported as skipped, not passed, when the variable is absent:

```sh
C6_TEST_DATABASE_URL='postgresql://…' \
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/platform-api exec vitest run test/c6/postgres.integration.test.ts
C6_TEST_DATABASE_URL='postgresql://…' \
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/spatial-worker exec vitest run \
  test/plan-processing/postgres.integration.test.ts
```

## Integrated live user gate

The synthetic live harness is deliberately production-shaped: it creates a local authenticated project,
initialises a C4/C5 branch, stores one rights-cleared SVG source and preview in S3-compatible storage,
creates the C6 job through the API, leases it from Postgres, normalizes it, invokes the real isolated
Python parser without a shell, publishes the immutable proposal, and prints only the identifiers and
hashes needed to open the review UI. It never writes a canonical revision itself.

With the C1-C6 migrations applied, the platform API running on `127.0.0.1:3001`, and the local PostGIS
and object-storage services running, execute:

```sh
C6_LIVE_API_URL='http://127.0.0.1:3001' \
C6_LIVE_DATABASE_URL='postgresql://localdev:local-development-only@127.0.0.1:54321/interior_c6_api' \
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm --filter @interior-design/spatial-worker exec \
  tsx --conditions=development test/plan-processing/live-system-seed.ts
```

Use the printed `projectId` to open `/projects/<projectId>/plan-import`, sign in with the local
`homeowner-alpha` persona, and complete the visible user flow: review every candidate, calibrate,
correct or exclude uncertain geometry, create the immutable operation draft, send it through C5
preview, inspect all findings, and explicitly commit. Accepted geometry remains `source-derived`.
Corrected geometry becomes a current-user `user-asserted`, `not-reviewed` claim linked to the exact
source asset; fields that the plan did not establish remain explicitly unknown. C5 rejects a draft if
those epistemic or topology guarantees are lost.

After creating a temporary Playwright storage-state file through the same local sign-in flow, run the
two live viewport checks:

```sh
C6_LIVE_PLAN_URL='http://127.0.0.1:3000' \
C6_LIVE_PLAN_PATH='/projects/<projectId>/plan-import' \
C6_LIVE_PLAN_STORAGE_STATE='/tmp/c6-live-plan-storage-state.json' \
PATH='/Users/abhinavgupta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin':$PATH \
  pnpm exec playwright test --config tests/e2e/plan-processing/playwright.live.config.ts
```

The live browser gate fails on any warning/error, page exception, failed request, HTTP response at or
above 400, missing plan heading, or horizontal overflow at 1440x960 and 390x844. The retained reference
Playwright pack additionally covers keyboard operation, candidate abstention/manual fallback, viewer
restrictions, recovery and C5 conflict behavior. A headless pass does not replace the in-app Browser
desktop/mobile visual and interaction inspection.

No paid provider, API key, outbound inference, GPU, customer plan, structural/regulatory analysis or canonical commit is used by these checks.

# C13 integration acceptance — 2026-07-18

## Decision

Accepted with no C13 blocker at product commit `fd1f64108119b046677cc74b7f641ca8c8089d6d`.
Evidence uses deterministic creator-authored synthetic fixtures and local infrastructure only. No customer data, external provider, paid service, GPU, physical device, product availability, procurement, cost, regulatory, structural or professional-certification claim is made.

## Identity and isolated lanes

- Frozen activation: `ab9498dc45c45de8f6a155227ab01a6fb0203a6b`.
- C13-L1 catalog worker/merge: `39051d5a244b2ec93b6c87385f3bf531eab1f054` / `4f52ce9298fe50163c37db447dad02d9b8803cdf`.
- C13-L2 specification worker/merge: `314a3e950c425398654edc12d49ef8267e712ab4` / `5022143a0fd9c946b90b9db40a58910ac83828ce`.
- C13-L3 UX worker/merge: `0f9918a40854ca988d9e947be88f108c7257f8b2` / `d19b05875e4fb418234e9382a65e97915b76c0f2`.
- Every lane used exact `gpt-5.6-sol` with `xhigh` reasoning and its frozen exclusive paths.
- Browser matrix: Chromium 149.0.7827.55, Firefox 151.0 and WebKit 26.5 on desktop and 390 × 844 mobile projects.

## Real catalog publication

A built `services/spatial-worker/dist/src/catalog/command.js` ran against a fresh disposable C1–C13 database and loopback S3-compatible storage:

- first publication: 11 assets, release `bca5a238-9b84-535c-ac16-2baedcda8178`, manifest `967044cd15e2224093414638fa45fbc835ff32e021f561b953e013f23a48ff87`, `replayed:false`;
- identical second publication: the same release and manifest with `replayed:true`;
- downloaded manifest SHA-256 matched `967044cd15e2224093414638fa45fbc835ff32e021f561b953e013f23a48ff87` and its S3 checksum/metadata;
- downloaded creator-authored GLB was 2,224 bytes and matched SHA-256 `5eae24d7dcefc1ed3a110dd4792fbb7ca59cf48c243ddb8a5cdc5598dae95284`;
- pinned Khronos validator 2.0.0-dev.3.10 reported zero errors and zero warnings. Its independent report contained one informational `UNUSED_OBJECT` code, which is not an error or warning;
- the disposable database was dropped after verification. Content-addressed local fixture objects remain safe to replay.

The hostile-ingestion, security and concurrency suites cover malformed/truncated GLB, bounded resources, URI/traversal/symlink rejection, MIME/signature and PNG rules, axis/pivot/bounds, missing artifacts/rights, withdrawn versions, SPDX/`LicenseRef`, immutable overwrite conflict, conditional publication, cancellation and crash-before-head behavior.

## Production-composed homeowner journey

The visible in-app Browser completed the real local Next BFF → authenticated API → PostgreSQL → C5 → C10 path:

- project `066d4993-faeb-46fa-ad8b-956b6db9c341`;
- immutable source confirmation `5f817fff-cda7-4a67-a7f1-21ae93087db5`, C12 job `f0b32cd7-ecaf-4b0b-957e-894634aac7d1`, option `c1200000-0000-4000-8000-000000000051`, option-set hash `1420710032911ad166e98d4f00ad2505b8aa1df4e5b1396245cddaf675f7cd14`;
- specification `5ce097ba-cc28-4e23-a4c3-f722039e8b9c`, five immutable revisions, current revision/hash `5` / `e35dc7a1674632d5083d9531bcfe20d16b7e82cffa90677d9c1e882461795c5b`;
- an owner selected a distinct catalog version, previewed the bounded proposal, explicitly confirmed it, and received the exact scene job `d296fc0d-34c0-4b5d-8f24-ef96dd50f785`;
- scene `76349d87-7c8b-4ffa-96b2-b43a6e0e0661`, artifact `89ff6dd5-2e44-4b54-b267-c23527954af2`, attempt 2, GLB SHA-256 `d593a6df291bb1096130eec256bf96255bdefbca2c605e5a640c57889956435c`, manifest SHA-256 `26314dd4fd7a4614a790b5039da6734084bd395c05bdc5c87976a1b4be803421`;
- the 3,284-byte GLB was downloaded independently and its SHA-256 matched. Browser-side checksum and semantic verification also passed before rendering;
- the GLB retained stable element ID `c1200000-0000-4000-8000-000000000007`, exact specification/release/version/rights hashes and `parametric-bounded-not-vendor-fidelity`; it contained no note, schedule, address or confirmation identifier;
- the materials workspace visibly showed revision 5, five immutable revisions, unique version identities, truthful creator-owned/rights/commercial-data boundaries and all four schedules;
- the exact viewer reached `Ready to inspect`, passed signed-access and GLB verification, and rendered interactive 3D.

The initial visible fixture has one furnishing line, so finish and light were not fabricated into that household journey. The production mutation kernel now explicitly previews and reduces furnishing, finish and light substitutions through the real C5 reducer, preserving stable ID/kind and exact specification pins; the C10 compiler test verifies all three bindings in validator-clean GLB output. Catalog/API/evaluation tests exercise all three kinds and finish quantities remain honestly unknown in C13.

## Canonical-state proof

The final synthetic project has:

- existing profile snapshot `af1289f1-68eb-4831-9e4d-1379e0157803`, hash `da742cafb9f02f336ee6b42ee569b1a44f0934707e54a26e0494d290a630d310`, version 1;
- proposed profile snapshot `f5d16c41-80ff-4ad2-a8da-cf0a0ea32e9f`, hash `8ad8123c725c72ef2d8c03f44a33ac98c0dc6605c5cdbb3bd5cb842f92b08887`, version 5;
- existing branch source and head still identical at revision 1; all C13-driven commits are on the proposed branch;
- no as-built profile was created or mutated;
- the C12 confirmation/source rows remain immutable. C13 retains their exact IDs/hashes rather than rewriting them.

The live non-owner RLS/lifecycle gate passed against a fresh C1–C13 database: forced RLS, tenant context, append-only history, generic foreign-key failure, replay, stale/expiry/rights fencing, injected rollback and exactly-one-winner concurrent confirmation all passed.

## Browser and failure matrix

Playwright passed 18/18 across Chromium, Firefox and WebKit desktop plus 390 × 844 mobile coverage. The matrix included owner/editor/viewer/foreign-tenant behavior, keyboard operation, pagination and schedules, missing artifacts/rights, stale state, offline, session expiry, service error, interruption, retry and retry failure, document-width containment and zero unexpected console/page/network errors.

The visible browser additionally verified the production-composed disclosure, selection, confirmation, revision, exact scene link and 3D inspection path. No connected Chrome-specific session was needed because the in-app Browser controller was available and completed the required visible path.

## Structured-log proof

The built API received a synthetic request containing distinct private markers in its query, bearer header, note, object key and signed-URL fields. Its process output contained only the method, `url:"[REDACTED]"`, loopback host/address, request ID, status and duration; none of the five private markers appeared. The catalog and specification telemetry security suites independently reject artifact bytes/paths, locators, rights/source receipts, notes, schedules, operations, tokens and signed URLs.

## Verification record

| Gate                                           | Result                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UV_CACHE_DIR=.cache/uv pnpm verify`           | pass: 21/21 lint, 21/21 typecheck, 39/39 unit tasks, 21/21 builds; Ruff and strict MyPy pass; pytest 117 passed / two honest unavailable COLMAP/Open3D skips |
| `pnpm test:contract`                           | pass: spatial worker 140 passed / three guarded DB-runtime skips; platform API 215 passed / 43 guarded integration skips                                     |
| `pnpm test:integration`                        | pass with the same guarded environment-only skips; required C13 PostgreSQL/S3 cases were run separately with their variables set                             |
| `pnpm test:security`                           | pass: independent identity matrix 861/861; focused C13 catalog/specification suites also pass                                                                |
| `pnpm test:geometry`                           | pass: 43/43                                                                                                                                                  |
| Fresh C1–C13 migration + C13 Postgres/RLS      | pass: 4/4                                                                                                                                                    |
| Built catalog worker + local storage replay    | pass: first publication plus exact replay and post-download hashes                                                                                           |
| C10 contextual Postgres/S3 regression          | pass: 3/3                                                                                                                                                    |
| Specification / scene compiler focused         | pass: 9/9 substitution and 16/16 compiler cases                                                                                                              |
| Web materials focused                          | pass: 27/27                                                                                                                                                  |
| Playwright specification matrix                | pass: 18/18                                                                                                                                                  |
| `git diff --check`                             | pass                                                                                                                                                         |
| `pnpm dependency:boundaries`, `pnpm api:check` | commands exit zero but execute zero tasks; explicitly not counted as evidence                                                                                |

One catalogue concurrency test initially exceeded Vitest's generic five-second default under repository-wide load even though the operation was progressing correctly. The two real-validator concurrency cases now declare a bounded 20-second ceiling; they complete in approximately 5–7 seconds in the full contract/integration suites and continue to assert exactly one immutable release head.

## Residual limits and follow-up ownership

- C13 proves creator-owned generic local assets, exact rights/version identity, editable specifications and bounded parametric C10 output. It does not prove vendor-model appearance fidelity, product availability, procurement, cost or finish quantities.
- No external provider, GPU, Blender, Xcode, physical device, LiDAR, camera, assistive-technology pairing or customer/third-party licensed data was required or claimed.
- Retrospective `FORCE ROW LEVEL SECURITY` for C1–C12 owner-created tables remains inherited hardening work; all new C13 tenant tables force RLS and use a constrained probe role.
- Root `dependency:boundaries` and `api:check` aliases remain zero-task tooling debt and must not be represented as passing architectural checks.

Reviewer decision: **accept C13**. C14 may open only from the pushed C13 ledger-close state.

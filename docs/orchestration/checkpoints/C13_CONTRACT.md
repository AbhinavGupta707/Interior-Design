# C13 Contract — Rights-aware Catalog and Room Specification

## Authority, predecessor and outcome

- Active plan: `ai_native_architecture_blue_sky/docs/implementation/08_ACTIVE_BLUE_SKY_M1_EXECUTION_PLAN.md`.
- Continuation authority: `docs/orchestration/C11_C15_CONTINUATION.md`; C13 is active, C14 remains closed.
- Immutable predecessor: pushed C12 ledger close `c8f266e68fdd31402d49a9f12b80b5af21644ae6`.
- Outcome: an owner/editor can turn one exact confirmed C12 option into a revisioned, rights-aware room specification, inspect generic alternatives, safely replace a furnishing/finish/light through C5, and open the exact confirmed result through C10.
- Truth boundary: C4/C5 remain canonical geometry. C13 is an exact product/material projection keyed by stable element IDs; it never becomes a second model. Existing, as-built, the originating C12 option and sibling option branches remain immutable.
- Commercial/professional boundary: M1 has no price, stock, supplier availability, delivery or branded-product claim. A specification is `working`, not approved, issued, purchased or professionally certified. Finish quantities remain `not-derived-in-c13`; C17 owns model-derived implementation quantities.

## Frozen C12 → C13 → C5 → C10 flow

1. The API resolves a C12 confirmation server-side, joins its option set, bundle, accepted brief, branch, commit and exact result snapshot, and requires that snapshot to remain the branch head at initial specification creation.
2. The initial specification contains one sorted line per exact C12 asset placement. It pins every C12 asset/hash and the richer catalog release/version/rights/projection hashes. C12 v1 schemas and history are never broadened or rewritten.
3. Notes, decision states and explicit room assignments create immutable specification revisions only. Four schedules—room, element, product/light and finish—are projections from the same lines, never independently persisted copies.
4. An asset change creates an expiring non-mutating C13 preview containing one existing `design.element.replace.v1` operation and an exact C5 candidate snapshot hash. The pre-confirmation visual is labelled `bounded-catalog-preview-only`; it is not canonical C10 evidence.
5. Confirmation locks project → specification head → substitution head → C5 branch/profile, revalidates every source/catalog/rights/hash pin, reruns integer geometry constraints, previews/commits through C5 and requires the committed hash to match the candidate hash. It atomically appends the next specification revision and confirmation.
6. A C10 scene job is requested idempotently after that transaction. Scene failure leaves the valid model/specification committed and reports a truthful retry state; it never rolls back or claims a current scene.

## Frozen shared contracts and limits

The orchestrator-owned `packages/contracts/src/c13.ts` freezes:

- artifacts, reviewed rights, material definitions, C12 placement projections, immutable asset versions and releases;
- exact C12 confirmation source references;
- specification, revision, line and selection-board records;
- substitution preview/confirmation contracts; and
- the 15 project-scoped catalog/specification routes in `c13RouteContract`.

Resource ceilings are contract data: 2 MiB/512 assets per release; 16 artifacts and 64 MiB per asset; 32 MiB GLB; 512 nodes; 128 meshes/materials; 32 textures; 500,000 vertices; 250,000 triangles; 4,096 px/8 MiB PNG; 60 seconds and 512 MiB per ingestion. There is no archive extraction, runtime URL fetch, scraping or public/user-facing ingestion route.

All local lengths are integer millimetres. glTF uses metres, right-handed `+Y` up and `+Z` front. The named transform is `gltf-front-positive-z-to-interior-forward-positive-y-v1`, scale is exactly 1,000 and the asset pivot is floor-centred. Creator-authored GLB world bounds must match the declared envelope within 2 mm.

## Catalog, artifacts and rights

- C13 wraps all eight immutable C12 starter references and adds creator-authored alternatives; no C12 ID/content/metadata/policy/rights hash changes.
- Published asset versions/releases are content-addressed and immutable. Changed bytes, metadata, rights or placement policy require a new version/hash.
- A selectable asset requires exact model, thumbnail, licence-text and source-receipt artifacts; a reviewed active rights record; explicit integer scale/envelope; and a valid C12 placement projection. Withdrawn, expired, quarantined, incomplete or mismatched records remain readable historically but block new selection/confirmation.
- Initial published assets are generic creator-owned synthetic fixtures only. Schema support for locally licensed third-party assets is not evidence that any third-party asset is available.
- Custom `LicenseRef-*` expressions require pinned licence text. Declared metadata is separate from the service's concluded rights. Service processing, derivatives, raw redistribution, rendered output, thumbnail display and training are separate decisions; training is always denied in this checkpoint.
- `price`, `liveAvailability`, `supplier` and `delivery` are all exactly `not-provided`. Catalog metadata, glTF `asset.copyright` and `KHR_xmp_json_ld` never establish the service's concluded rights alone.

Primary sources checked on 2026-07-18:

- [SPDX 3.0.1 licence expressions](https://spdx.github.io/spdx-spec/v3.0.1/annexes/spdx-license-expressions/) defines standard IDs, custom `LicenseRef-*` and expression syntax; the [SPDX licensing model](https://spdx.github.io/spdx-spec/v3.0.1/model/Licensing/Licensing/) distinguishes declared from concluded licensing.
- [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) defines metre units, right-handed axes, PBR colour-space rules and embedded artifact constraints. The official [glTF Validator](https://github.com/KhronosGroup/glTF-Validator) is necessary but supplemented by product resource/rights/geometry rules.
- [OWASP File Upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) supports allowlisted types, signature/content validation, generated storage names, isolation and decompressed/resource ceilings.
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) confirms table-owner bypass unless RLS is forced; [transaction-local configuration](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SET) supports scoped tenant context.

## Deterministic local ingestion

The worker accepts repository-local manifests/raw artifacts only. It hashes quarantined bytes; validates bounded canonical JSON and rights first; checks extension, IANA type, magic, size and content hash; parses bounded GLB chunks before large allocation; rejects every URI/data URI, unapproved required extension, archive, animation, skin, morph, camera, embedded light, negative determinant, non-finite accessor or unsafe extras; runs the pinned Khronos validator; checks triangles, bounds, normals, UVs, pivot, floor contact and forward direction; re-encodes PNG deterministically without metadata; regenerates/validates the C12 projection and 512 px thumbnail; publishes all content-addressed objects before one atomic sorted release head.

Same input must reproduce identical bytes and hashes across ordering, locale, time zone and process. A crash/cancel before release publication leaves no visible partial release.

## Specification and substitution invariants

- Creation accepts only a confirmation ID plus an exact published release pin. The server derives all option, bundle, brief, model and snapshot fields; URL/body claims never substitute for authoritative joins.
- Every line stores stable line/element IDs, element kind/level/room-or-review state, exact catalog release/version and C12 content/metadata/placement/rights hashes, source confirmation, decision state, bounded note and quantity state.
- Furnishing/light quantity is exactly one per canonical element. Finish quantity is explicitly unknown in C13.
- Room assignment uses the C12 `spaceId` where present. Inference is allowed only when uniquely provable from exact geometry/level; ambiguity remains `review-required`.
- Replacement preserves stable element ID, type, placement/target and source attribution while replacing catalog-derived furnishing dimensions, finish material or light properties. Cross-kind, walls/fixed objects, existing/as-built and direct snapshot mutation are forbidden.
- The existing `c12-design-element-operation-v1`/`design.element.replace.v1` remains the only mutation envelope. No new reducer operation version is introduced.
- Same idempotency key/body replays exactly; changed body conflicts. Stale spec/branch/catalog/rights/preview, concurrency loss or injected failure causes zero partial C5/specification effect.

## Authorisation, privacy and persistence

Frozen actions are `catalog:asset:read`, `specification:create`, `specification:read`, `specification:history:read`, `specification:update`, `specification:substitution:propose` and `specification:substitution:confirm`. Owner/editor may mutate; viewer is inspect-only; foreign tenants fail before disclosure; machine/service principals cannot confirm.

Migration `0013_specifications.sql` is exclusively C13-L2. It owns immutable catalog release/version snapshots as needed for historical reference, specification heads/revisions/lines, substitution proposals/heads/confirmations, scene links, idempotency effects, audit events and privacy-minimised outbox. Tenant tables use composite tenant/project foreign keys, bounded JSONB, `RESTRICT`, indexed references, append-only triggers and monotonic one-step head advancement.

C13 tenant tables must `ENABLE` and `FORCE ROW LEVEL SECURITY`. Every repository transaction immediately sets `app.tenant_id` transaction-locally and retains explicit tenant/project predicates. Tests use a non-owner, non-superuser, no-`BYPASSRLS` application role and map referential errors without disclosure. C1–C12 table-owner hardening remains a named inherited risk for a dedicated hardening checkpoint; it is not silently expanded here.

Logs may contain safe stages, counts, durations, bounded codes and approved correlation/hash fields. They must exclude notes, schedules, operations, artifact bytes/paths, manifests, licence text, attribution contacts, raw rights/source receipts, bearer/lease tokens, signed URLs and object locators.

## Adaptive isolated lanes

Three lanes are retained. All use exact `gpt-5.6-sol` with `xhigh` reasoning because untrusted artifacts/rights, transactional C5 persistence/RLS and cross-surface exact-version integration are complex.

| Lane                               | Exclusive editable paths                                                                                                                                                                                                                                                                                                             | Required output                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C13-L1 catalog pipeline            | `packages/catalog/**`; `services/spatial-worker/src/catalog/**`; `services/spatial-worker/test/catalog/**`; `services/platform-api/src/modules/catalog/**`; `services/platform-api/test/c13/catalog/**`; `tests/security/catalog/**`; `docs/runbooks/development/c13-catalog.md`                                                     | real creator-authored GLB/PNG/text starter release, deterministic validator/publisher, catalog repository/routes/signed artifacts, hostile/resource/right/determinism tests |
| C13-L2 specification domain        | `packages/specification/**`; `services/platform-api/src/modules/specifications/**`; `services/platform-api/test/c13/specifications/**`; `services/platform-api/migrations/0013_specifications.sql`; `tests/security/specification/**`; `docs/runbooks/development/c13-specifications.md`; `docs/threat-models/C13_SPECIFICATIONS.md` | immutable lines/revisions/schedules, exact C12 join, proposal/confirmation/C5 bridge, forced-RLS persistence, idempotency/concurrency/redaction tests                       |
| C13-L3 selection UX/independent QA | `apps/web/src/features/materials-products/**`; `apps/web/src/app/materials-products/**`; `apps/web/src/app/api/c13/**`; `apps/web/test/materials-products/**`; `tests/{e2e,evaluation,performance}/specification/**`; `docs/evaluation/specification/**`                                                                             | accessible board/catalog/preview/schedule UX, explicit generic/rights/missing/unknown states, owner/viewer/mobile/keyboard/degraded browser matrix                          |

Merge order is L1 → L2 → L3. The orchestrator alone owns shared C13 contracts/tests and authz, migration registry, root/central manifests and lockfile, central platform/spatial/web composition, C5/C10/C12 files, scene compiler integration, navigation/C12 handoff/viewer exact-job seam, accepted contract, ledger, `.github`, `.codex` and `AGENTS.md`. L3 uses an isolated CSS module and cannot edit global CSS/shared UI or C10/C12 features.

## Exhaustive integration gate

C13 cannot close until all of the following pass:

1. full `UV_CACHE_DIR=.cache/uv pnpm verify`, `git diff --check`, package boundaries and focused C13 contracts;
2. real built worker ingestion of creator-authored GLB/PNG/text into local object storage, zero Khronos validator errors, post-download hashes and deterministic replay;
3. malformed/truncated/overlapping GLB, accessor overflow/non-finite data, resource bomb, URI/traversal/symlink/object-key injection, MIME/signature mismatch, PNG bomb/multiframe, axis/pivot/scale/bounds, missing artifact/UV/rights, SPDX/LicenseRef, duplicate/version overwrite, withdrawal and crash-before-publication cases;
4. clean C1–C13 migration plus explicit/forced non-owner RLS, IDOR, role, append-only, foreign-key non-disclosure and tenant-context tests;
5. production Next BFF → API → Postgres → catalog worker → C5 → C10 journey beginning with one real confirmed C12 option;
6. exact initial lines/schedules with zero model mutation, then furnishing, finish and light substitutions preserving stable IDs and changing exact catalog bindings only after confirmation;
7. source C12 option/confirmation, existing/as-built and sibling branches unchanged; C5 replay equals declared result; committed C10 GLB retains exact stable IDs and catalog/material metadata while honestly remaining parametric/bounded rather than vendor-fidelity evidence;
8. forged source/hash, cross-kind, 1 mm containment/collision/clearance, stale spec/branch/catalog, withdrawn rights after preview, expiry, concurrency, replay/changed-body and injected rollback tests;
9. structured composed-process log scan proving private and credential/artifact fields absent;
10. Playwright Chromium/Firefox/WebKit desktop/mobile/keyboard, owner/editor/viewer/foreign, loading/empty/offline/session-expiry/stale/error/retry/missing-model/thumbnail/scale/rights, no overflow and no unexpected console/network failure;
11. visible in-app Browser attempt, with connected Chrome recorded separately if the controller remains unavailable; and
12. durable evaluation/ledger evidence, worker/merge/product SHAs, clean primary worktree and pushed `main`.

No GPU, Blender, Xcode, physical device, external provider, paid service, customer data or training permission is required or claimed for C13. Catalog appearance fidelity, live product data, procurement, professional sign-off and finish quantities remain explicitly unmeasured/not integrated.

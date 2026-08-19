# C14-L4 render-stills UX and independent evaluation

## Outcome

The owned C14-L4 lane provides an accessible `/render-stills/:projectId` workspace, an isolated strict-schema C14 BFF, fresh artifact access and byte verification, and an independent Sharp-backed artifact evaluator.

This lane record is retained as focused UX/evaluator evidence. The integrated 2026-08-11 checkpoint result, live control-plane IDs/hashes and repository-wide gates are recorded in `C14_INTEGRATED_CLOSEOUT_2026-08-11.md`. The exact authorised-host Session B acceptance and real production publication are recorded in `C14_AUTHORISED_HOST_ACCEPTANCE_2026-08-12.md`; that record supersedes the hardware deferral for the accepted Linux CPU profile.

The product truth boundary is explicit:

- “Geometry-locked deterministic render” is derived visualisation only.
- “Illustrative optional enhancement” is never canonical.
- The Session A Mac remained a real-render hardware hold. No Blender process was invoked there and no fixture image from that session is presented as a real render.
- The safe result remains visible when enhancement is disabled, fails, or is rejected.

No frozen contract, generated client, migration, shared navigation, global CSS, render worker, or provider configuration changed.

## Evidence boundary

The browser matrix uses only deterministic synthetic PNG and bounded EXR-header fixtures created by `tests/e2e/render-stills/mock-c14-backend.mjs`. Fixture capability is labelled `synthetic-fixture` and states that no Blender process or real render is involved. Product code obtains capability state and frozen C14 data through the isolated BFF; it contains no deterministic render fallback.

Independent evaluation provides:

- PNG signature, declared bytes, SHA-256, dimensions, and complete Sharp pixel decode;
- EXR magic, bounded attribute parsing, channel metadata, data-window shape, declared bytes, and SHA-256;
- exact segmentation-palette contamination reporting;
- bounded edit-mask, changed-pixel, protected-edge, and segmentation-IoU comparisons;
- aggregate encoded-byte and decoded-pixel budgets for the five-image geometry comparison.

EXR evaluation is deliberately labelled `container-header-only-no-pixel-validation`. Image comparisons are deliberately labelled `bounded-png-pixel-comparison-no-camera-or-blender-validation`. These checks do not validate Blender, camera projection, scene geometry, or EXR channel pixels.

## Accessibility and responsive review

Automated Playwright inspection confirmed:

- one main landmark and no duplicate IDs;
- exact job focus after keyboard selection;
- polite lifecycle updates and focused alerts;
- inspect-only viewer controls and owner/editor action boundaries;
- reduced-motion handling;
- no horizontal overflow at 390×844 in Chromium, Firefox, or WebKit;
- visible controls and the checkbox label target are at least 43 CSS pixels high in the browser matrix;
- safe and segmentation object images decode to the declared 96×64 fixture dimensions;
- no page console warnings or errors during the independent render-workspace inspection.

Final inert-workflow screenshot evidence: `/tmp/c14-render-stills-playwright-evidence/chromium-desktop-inert-workflow.png` (1440×4243, 410,118 bytes). The UI itself labels the fixture capability and hardware gate honestly.

The Codex in-app Browser controller was attempted during integrated close-out but failed before tab creation with `Cannot redefine property: process`; it supplied no product evidence. The cross-engine Playwright matrix is the accepted browser automation evidence for this session.

The static website-quality audit reported no P0/P1 findings and five P2 tight-gap heuristics. Those gaps bind eyebrow/title or title/metadata pairs rather than independent touch targets; browser checks confirmed the interactive target sizing and overflow requirements.

## Security and privacy findings

- The BFF accepts only the HTTP-only C1 session cookie, exact frozen C14 routes, strict request bodies, and UUID idempotency keys.
- Caller-supplied authority, traversal-shaped routes, extra path segments, foreign-tenant data, malformed responses, oversized JSON, and private upstream detail fail closed.
- Artifact access permits HTTPS or explicit loopback development only and rejects credentials/fragments.
- Type, declared byte length, SHA-256, role, manifest hash, and dimensions are checked before object URL creation.
- Verification is generation-fenced; stale async work cannot publish state after job/artifact switching.
- Object URLs are revoked on switch, retry, decode failure, and unmount.
- Signed URLs, blobs, private artifacts, and source payloads are not persisted in local storage, session storage, or IndexedDB.

## Performance and resource findings

- Browser preview verification is capped at 64 MiB and streams only up to the immutable declared byte length.
- The independent evaluator defaults to 64 MiB encoded input, 16,777,216 aggregate comparison pixels, a 1 MiB EXR-header ceiling, and 128 EXR channels.
- The independent regression suite keeps a 1024×1024 PNG inspection and a five-image 256×256 geometry comparison below a 3-second local ceiling; heap growth is capped below 128 MiB.
- The workspace polls only non-terminal durable jobs, does not load artifact bytes until verification is requested, and creates no persistent client cache.

## Verification

- `pnpm --filter @interior-design/render-evaluation lint`: passed.
- `pnpm --filter @interior-design/render-evaluation typecheck`: passed.
- `pnpm --filter @interior-design/render-evaluation test:unit`: 2 files, 8 tests passed.
- `pnpm --filter @interior-design/render-evaluation build`: passed.
- `pnpm --filter @interior-design/web lint`: passed.
- `pnpm --filter @interior-design/web typecheck`: passed.
- `pnpm exec vitest run apps/web/test/render-stills`: 4 files, 9 tests passed.
- independent evaluation/performance/security TypeScript checks: passed.
- `pnpm exec vitest run tests/evaluation/render-stills tests/performance/render-stills tests/security/render-stills`: 3 files, 10 tests passed.
- `pnpm --filter @interior-design/editor-core build && pnpm --filter @interior-design/web build`: passed; `/render-stills/[projectId]` and `/api/c14/[...segments]` are present in the production route table.
- `pnpm exec playwright test --config tests/e2e/render-stills/playwright.config.ts`: 22 passed across Chromium, Firefox, and WebKit desktop plus 390×844 mobile projects.
- `git diff --check`: required at final handoff.

The Playwright matrix covers exact deep links, all durable lifecycle stages, keyboard workflow, owner/editor/viewer/foreign access, provider disabled, enhancement failed/rejected, offline, session expiry, stale jobs, malformed/private responses, tampered bytes, expired access, decode failure, diagnostics, fresh access, and responsive overflow/target sizing. No Blender executable or render provider is called.

## Integrated status and remaining limitations

1. Project navigation links to `/render-stills/:projectId`, and the production API/worker composition passed focused and disposable-live tests.
2. Session B accepted the exact Blender 5.2.0 LTS build `fbe6228777e7` with CPU Cycles and complete executable/script/inspector/OCIO/host/acceptance pins. The real API -> worker -> accepted Blender -> object-store journey published and independently revalidated all five artifacts.
3. `synthetic-fixture` and `FrozenInertRenderer` remain labelled test-only evidence classes and were not used for the production publication. CUDA, OptiX, GPU, Metal and all unconfigured profiles remain unavailable and unclaimed.
4. Pixel-level OpenEXR and Blender/scene/camera validation remain outside this focused L4 evaluator, but the separate authorised-host record contains the required finite-pixel, channel, scene, camera, geometry and exact-byte replay evidence. Those results must not be inferred from L4 fixtures alone.

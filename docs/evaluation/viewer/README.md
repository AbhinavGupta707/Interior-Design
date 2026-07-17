# C10 viewer acceptance

This directory records independent acceptance evidence for the C10 deterministic-scene viewer. The browser fixture is presentation evidence only: it exercises the real web BFF and client verification code against a synthetic C10 API and a generated compact GLB, but it is not evidence that a deployed backend, worker, object store, GPU or physical device passed.

## Suites

- Web unit tests: strict BFF routing and response validation, viewer API behaviour, lifecycle presentation, DOM fallback and frozen metrics.
- `tests/security/scenes`: hostile GLB/manifest handling, external URI and active-content rejection, hash/tuple checks, role/IDOR boundaries and publication redaction.
- `tests/e2e/viewer`: Chromium actual-canvas path when the browser satisfies the production WebGL performance gate, Chromium mobile/fallback behaviour, and Firefox/WebKit semantic workflows.
- `tests/performance/viewer`: fixture load time, median sampled FPS, renderer-call ceiling and demand-idle behaviour, only when the production capability gate accepts the browser.

Run from the repository root:

```sh
pnpm --filter @interior-design/web lint
pnpm --filter @interior-design/web typecheck
pnpm --filter @interior-design/web test:unit
pnpm --filter @interior-design/web build
pnpm exec tsc -p tests/security/scenes/tsconfig.json --noEmit
pnpm exec vitest run --config tests/security/scenes/vitest.config.ts
pnpm exec tsc -p tests/e2e/viewer/tsconfig.json --noEmit
pnpm exec playwright test --config tests/e2e/viewer/playwright.config.ts
pnpm exec tsc -p tests/performance/viewer/tsconfig.json --noEmit
pnpm exec playwright test --config tests/performance/viewer/playwright.config.ts
git diff --check
```

The Playwright configurations start the labelled synthetic API and the Next.js application with `C10_VIEWER_EVIDENCE_CLASSIFICATION=fixture-presentation`. They never classify fixture results as real-backend evidence. Performance tests skip when WebGL is absent or reports a major performance caveat; skipped measurements must not be substituted with unit-test or synthetic values.

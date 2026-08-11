#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmEntrypoint = process.env.npm_execpath;

if (pnpmEntrypoint === undefined || !pnpmEntrypoint.endsWith("pnpm.cjs")) {
  throw new Error("Run the repeatable C14 verification through pnpm: pnpm test:c14.");
}

const pnpm = (label, ...args) => ({
  args: [pnpmEntrypoint, ...args],
  command: process.execPath,
  label,
});

const steps = [
  pnpm("render-scene source tests", "--filter", "@interior-design/render-scene", "test:unit"),
  pnpm(
    "inert renderer boundary tests",
    "--filter",
    "@interior-design/blender-renderer",
    "test:unit",
  ),
  pnpm(
    "C14 platform API tests",
    "--filter",
    "@interior-design/platform-api",
    "exec",
    "vitest",
    "run",
    "test/c14",
    "--exclude",
    "dist/**",
  ),
  pnpm(
    "C14 spatial-worker tests",
    "--filter",
    "@interior-design/spatial-worker",
    "exec",
    "vitest",
    "run",
    "test/render-stills",
    "--exclude",
    "dist/**",
  ),
  pnpm(
    "C14 web source tests",
    "--filter",
    "@interior-design/web",
    "exec",
    "vitest",
    "run",
    "test/render-stills",
    "--exclude",
    ".next/**",
  ),
  pnpm(
    "independent render evaluation tests",
    "--filter",
    "@interior-design/render-evaluation",
    "test:unit",
  ),
  pnpm(
    "standalone C14 evaluation, performance, and security tests",
    "exec",
    "vitest",
    "run",
    "tests/evaluation/render-stills",
    "tests/performance/render-stills",
    "tests/security/render-jobs",
    "tests/security/render-stills",
    "--exclude",
    "**/dist/**",
  ),
  ...[
    "tests/e2e/render-stills/tsconfig.json",
    "tests/evaluation/render-stills/tsconfig.json",
    "tests/integration/render-stills/tsconfig.json",
    "tests/performance/render-stills/tsconfig.json",
    "tests/security/render-jobs/tsconfig.json",
    "tests/security/render-stills/tsconfig.json",
  ].map((configuration) =>
    pnpm(`typecheck ${configuration}`, "exec", "tsc", "--noEmit", "-p", configuration),
  ),
  {
    args: [
      "run",
      "ruff",
      "check",
      "workers/blender-renderer/renderer",
      "services/inference-worker/src/inference_worker/image_enhancement",
      "services/inference-worker/test/image_enhancement",
      "tests/security/image-enhancement",
    ],
    command: "uv",
    label: "C14 Python lint",
  },
  {
    args: [
      "run",
      "mypy",
      "workers/blender-renderer/renderer",
      "services/inference-worker/src/inference_worker/image_enhancement",
    ],
    command: "uv",
    label: "C14 Python strict typing",
  },
  {
    args: [
      "run",
      "pytest",
      "services/inference-worker/test/image_enhancement",
      "tests/security/image-enhancement",
    ],
    command: "uv",
    label: "C14 enhancement boundary tests",
  },
  pnpm(
    "C1-C14 disposable control-plane integration",
    "exec",
    "vitest",
    "run",
    "tests/integration/render-stills/live-production.integration.test.ts",
    "--exclude",
    "**/dist/**",
  ),
  pnpm("C14 API seam check", "api:check"),
  pnpm("C14 dependency boundary check", "dependency:boundaries"),
];

for (const step of steps) {
  process.stdout.write(`\n[c14] ${step.label}\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: repositoryRoot,
    env: { ...process.env, UV_CACHE_DIR: path.join(repositoryRoot, ".cache/uv") },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\n[c14] source/control-plane verification passed\n");

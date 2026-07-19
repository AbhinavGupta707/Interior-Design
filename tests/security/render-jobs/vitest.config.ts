import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/security/render-jobs/**/*.security.test.ts"],
    testTimeout: 15_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/security/model-fusion/**/*.security.test.ts"],
    testTimeout: 15_000,
  },
});

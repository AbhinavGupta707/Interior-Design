import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/evaluation/model-fusion/**/*.test.ts"],
    testTimeout: 15_000,
  },
});

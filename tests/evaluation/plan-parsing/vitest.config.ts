import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/evaluation/plan-parsing/**/*.test.ts"],
    testTimeout: 15_000,
  },
});

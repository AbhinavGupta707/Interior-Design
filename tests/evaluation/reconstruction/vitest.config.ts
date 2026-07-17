import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/evaluation/reconstruction/**/*.test.ts"],
    testTimeout: 15_000,
  },
});

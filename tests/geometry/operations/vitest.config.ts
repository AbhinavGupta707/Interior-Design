import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/geometry/operations/**/*.test.ts"],
    testTimeout: 15_000,
  },
});

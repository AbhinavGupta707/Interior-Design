import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/geometry/canonical/**/*.test.ts"],
    testTimeout: 10_000,
  },
});

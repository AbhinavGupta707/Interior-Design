import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/model-operations/**/*.test.ts"],
    testTimeout: 30_000,
  },
});

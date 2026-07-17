import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/security/reconstruction/**/*.security.test.ts"],
    testTimeout: 15_000,
  },
});

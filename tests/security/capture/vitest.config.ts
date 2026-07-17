import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/security/capture/**/*.security.test.ts"],
    testTimeout: 20_000,
  },
});

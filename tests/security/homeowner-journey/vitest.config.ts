import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/homeowner-journey/**/*.security.test.ts"],
  },
});

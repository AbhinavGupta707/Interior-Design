import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/homeowner-setup/**/*.security.test.ts"],
  },
});

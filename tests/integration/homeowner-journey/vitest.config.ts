import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/homeowner-journey/**/*.test.ts"],
  },
});

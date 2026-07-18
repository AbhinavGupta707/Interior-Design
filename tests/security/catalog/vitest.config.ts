import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@interior-design/catalog": resolve(process.cwd(), "packages/catalog/src/index.ts"),
      "@interior-design/contracts": resolve(process.cwd(), "packages/contracts/src/index.ts"),
      "@interior-design/domain-model": resolve(process.cwd(), "packages/domain-model/src/index.ts"),
      "@interior-design/interior-assets": resolve(
        process.cwd(),
        "packages/interior-assets/src/index.ts",
      ),
    },
  },
  test: {
    include: ["tests/security/catalog/**/*.security.test.ts"],
    testTimeout: 15_000,
  },
});

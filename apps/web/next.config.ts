import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: [
    "@interior-design/config",
    "@interior-design/contracts",
    "@interior-design/domain-model",
    "@interior-design/editor-core",
    "@interior-design/geometry-kernel",
    "@interior-design/model-operations",
    "@interior-design/provenance",
    "@interior-design/ui",
  ],
  webpack(config) {
    // Workspace packages use NodeNext-correct `.js` specifiers in TypeScript
    // source. Webpack's extension aliases preserve those production imports
    // while resolving the corresponding `.ts`/`.tsx` files during local HMR.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;

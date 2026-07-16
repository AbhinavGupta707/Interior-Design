import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@interior-design/ui"],
};

export default nextConfig;

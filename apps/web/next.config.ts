import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@meshferry/core"],
  typedRoutes: true
};

export default nextConfig;

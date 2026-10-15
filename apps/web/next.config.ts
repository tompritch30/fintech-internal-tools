import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fit/core", "@fit/db", "@fit/ui"],
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
};

export default nextConfig;

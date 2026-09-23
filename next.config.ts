import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./data/**/*"],
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;

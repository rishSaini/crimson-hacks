import path from "node:path";
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  async rewrites() {
    const origin = (process.env.API_ORIGIN ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${origin}/:path*` }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;

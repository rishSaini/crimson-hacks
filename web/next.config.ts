import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const origin = (process.env.API_ORIGIN ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${origin}/:path*` }];
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;

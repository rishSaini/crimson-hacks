import path from "node:path";
import type { NextConfig } from "next";

// Repo root, so web/ can import the shared contract in ../fixtures. Turbopack doesn't
// resolve files outside its root, and it would otherwise pick web/ (its lockfile).
const repoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack does not walk up to an unrelated lockfile.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;

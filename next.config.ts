import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Embedded Postgres (local dev) loads its WASM files from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // The fast-gate model and the SQL migrations are read from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/data/gate-model.json", "./drizzle/**/*"],
  },
  // Lets you open the dev server from a phone on the same Wi-Fi.
  allowedDevOrigins: ["*.local", "192.168.*.*", "10.*.*.*", "*.trycloudflare.com"],
};

export default nextConfig;

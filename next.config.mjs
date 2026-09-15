/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // pdf-parse ships ~35MB of test fixtures. It is only used in the Inngest
  // background path (services/material.service.ts), so keep it external:
  // Next must not trace/bundle it, otherwise builds and dev compiles crawl.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
    // Trim client-side JS for the few heavier client imports.
    optimizePackageImports: ["@supabase/supabase-js", "@supabase/ssr"],
  },
};

export default nextConfig;

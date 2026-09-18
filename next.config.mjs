/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // pdf-parse ships ~35MB of test fixtures. It is only used in the Inngest
  // background path (services/material.service.ts), so keep it external:
  // Next must not trace/bundle it, otherwise builds and dev compiles crawl.
  // sharp (native) + tesseract.js (WASM + worker_threads) + pdfjs-dist
  // (page rendering) + @napi-rs/canvas (prebuilt canvas backend) must also
  // stay external so Vercel serverless runs them in Node, not bundled.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "sharp", "tesseract.js", "pdfjs-dist", "@napi-rs/canvas"],
    // Trim client-side JS for the few heavier client imports.
    optimizePackageImports: ["@supabase/supabase-js", "@supabase/ssr"],
  },
};

export default nextConfig;

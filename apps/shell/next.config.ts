import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Reserved seam: when a satellite is extracted to its own service, add a
  // rewrite here so /projects/<slug>/* proxies to it. Not needed yet (ADR-0002).
  // async rewrites() {
  //   return [{ source: "/projects/<slug>/:path*",
  //             destination: "https://<slug>.example.com/:path*" }];
  // },
};

export default nextConfig;
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // The release is the only deployment value exposed to browser diagnostics.
    NEXT_PUBLIC_RUNESPACE_RELEASE_ID: process.env.RUNESPACE_RELEASE_ID ?? "",
  },
  ...(process.env.RUNESPACE_RELEASE_ID ? { deploymentId: process.env.RUNESPACE_RELEASE_ID } : {}),
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    // The release is the only deployment value exposed to browser diagnostics.
    NEXT_PUBLIC_RUNESPACE_RELEASE_ID: process.env.RUNESPACE_RELEASE_ID ?? "",
    NEXT_PUBLIC_RUNESPACE_E2E_PLAY_ERROR:
      process.env.RUNESPACE_E2E_PLAY_ERROR === "true" ? "true" : "",
  },
  ...(process.env.RUNESPACE_RELEASE_ID ? { deploymentId: process.env.RUNESPACE_RELEASE_ID } : {}),
  // Only the two-build release-update E2E sets this, to hold two production
  // builds side by side (issue #412). It is unset in every deployment.
  ...(process.env.RUNESPACE_E2E_DIST_DIR ? { distDir: process.env.RUNESPACE_E2E_DIST_DIR } : {}),
};

export default nextConfig;

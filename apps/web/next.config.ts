import type { NextConfig } from 'next';

// 127.0.0.1 rather than localhost: Node resolves localhost to ::1 first, which the API may not bind.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  // Standalone output (for container images) creates symlinks, which Windows refuses without Developer Mode;
  // `next start` doesn't need it, so it's opt-in.
  output: process.env.NEXT_STANDALONE === 'true' ? 'standalone' : undefined,
  transpilePackages: ['@teamsphere/shared'],
  // Same-origin /api keeps the refresh cookie first-party for the browser and the desktop app.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;

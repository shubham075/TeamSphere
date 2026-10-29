import type { NextConfig } from 'next';

// 127.0.0.1 rather than localhost: Node resolves localhost to ::1 first, which the API may not bind.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@teamsphere/shared'],
  // Same-origin /api keeps the refresh cookie first-party for the browser and the desktop app.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    outputFileTracingIncludes: {
      '/api/internal/context/chat': ['./src/lib/prompt/templates/**/*'],
      '/api/setup': ['./src/lib/prompt/templates/**/*'],
    },
  },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@chitin/shared'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000', 'aphori.st'],
    },
  },
};

module.exports = nextConfig;

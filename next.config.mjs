/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/jira/:path*',
        destination: '/api/jira/:path*',
      },
    ]
  },
}

export default nextConfig

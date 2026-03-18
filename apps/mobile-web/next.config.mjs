/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@codex-remote/protocol"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8787/:path*"
      }
    ];
  }
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/aria-api/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
  // Allow Replit proxy domains
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  // Required for Replit's proxied iframe preview
  allowedDevOrigins: ["*"],
};

export default nextConfig;

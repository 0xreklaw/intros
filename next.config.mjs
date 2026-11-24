/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg is a Node-only package: keep it out of the bundle.
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ]
  },
  // Open the dev server as 127.0.0.1 as well as localhost (hot reload websocket).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Do not let `next dev` write AGENTS.md into the repo.
  agentRules: false,
}

export default nextConfig

import type { NextConfig } from "next";

/** En-têtes de sécurité appliqués à toutes les réponses. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  experimental: {
    agentFeedback: true,
    serverActions: {
      // Photos (≤ 3 Mo) envoyées par Server Action ; plafond de la plateforme Vercel : 4,5 Mo.
      // Les vidéos, plus lourdes, seront téléversées directement vers Cloudinary (envoi signé).
      bodySizeLimit: "4mb",
    },
  },
  images: {
    // Images Cloudinary servies par URL signée : pas d'optimisation ni de mise en cache par Next.
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com" }],
    unoptimized: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [{ source: "/", destination: "/tableau-de-bord", permanent: false }];
  },
};

export default nextConfig;

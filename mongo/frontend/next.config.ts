import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directorio de esta app (evita que Turbopack use el lockfile del monorepo y resuelva desde la raíz sin tailwindcss). */
const appDir = path.dirname(fileURLToPath(import.meta.url));

/** Imagen Docker propia del front: `NEXT_STANDALONE=1 npm run build` */
const standalone =
  process.env.NEXT_STANDALONE === "1" ? ({ output: "standalone" as const } satisfies NextConfig) : {};

const nextConfig: NextConfig = {
  ...standalone,
  turbopack: {
    root: appDir,
  },
  experimental: {
    viewTransition: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/guia/metodo-dos-apps",
        destination: "/#revista",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;

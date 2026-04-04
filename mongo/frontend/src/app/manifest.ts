import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Puro Flusso",
    short_name: "Puro Flusso",
    description:
      "El fin de la obesidad digital. Menos ruido, más flujo. Revista y guías en español.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#1a1612",
    lang: "es",
    orientation: "portrait-primary",
    icons: [
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "32x32", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

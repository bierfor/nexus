import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import "./globals.css";
import { ApolloAppProvider } from "@/components/ApolloProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AdminAuthProvider } from "@/contexts/AdminAuthContext";
import { JsonLdSite } from "@/components/JsonLdSite";
import { PageViewTransition } from "@/components/PageViewTransition";
import { siteUrl } from "@/lib/site-url";

const canonicalBase = siteUrl().replace(/\/$/, "");

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Puro Flusso — Tu tiempo es puro",
    template: "%s · Puro Flusso",
  },
  description:
    "El fin de la obesidad digital. Diez horas a la semana recuperando lo esencial. Sin apps complejas.",
  openGraph: {
    siteName: "Puro Flusso",
    locale: "es_ES",
    type: "website",
    url: canonicalBase,
  },
  twitter: {
    card: "summary",
    title: "Puro Flusso — Tu tiempo es puro",
    description:
      "El fin de la obesidad digital. Diez horas a la semana recuperando lo esencial. Sin apps complejas.",
  },
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Puro Flusso",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="flex min-h-full w-full max-w-full min-w-0 flex-col overflow-x-hidden bg-[var(--bg)] font-sans text-[var(--body)] antialiased">
        <a href="#contenido-principal" className="skip-to-content">
          Saltar al contenido
        </a>
        <JsonLdSite />
        <ApolloAppProvider>
          <AdminAuthProvider>
            <SiteHeader />
            <main
              id="contenido-principal"
              tabIndex={-1}
              className="mx-auto min-w-0 w-full max-w-6xl flex-1 overflow-x-hidden px-5 py-6 outline-none focus:outline-none md:px-6 md:py-8"
            >
              <PageViewTransition>{children}</PageViewTransition>
            </main>
            <SiteFooter />
          </AdminAuthProvider>
        </ApolloAppProvider>
      </body>
    </html>
  );
}

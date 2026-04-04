import Link from "next/link";
import { FooterAdminLink } from "@/components/FooterAdminLink";

function SocialLinks() {
  const ig = process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM?.trim();
  const x = process.env.NEXT_PUBLIC_SOCIAL_X?.trim();
  const li = process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN?.trim();

  if (!ig && !x && !li) return null;

  const iconClass =
    "text-stone-500 transition-colors hover:text-stone-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500";

  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
      {ig && (
        <a href={ig} target="_blank" rel="noopener noreferrer" className={iconClass} aria-label="Instagram">
          <svg className="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 16.648a4.648 4.648 0 1 1 0-9.296 4.648 4.648 0 0 1 0 9.296zm6.406-11.845a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z" />
          </svg>
        </a>
      )}
      {x && (
        <a href={x} target="_blank" rel="noopener noreferrer" className={iconClass} aria-label="X">
          <svg className="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M18.244 3H21l-7.5 8.59L21 21h-5.41l-4.93-5.86L5.99 21H3l8.03-9.15L3 3h5.41l4.46 5.14L18.244 3Zm-1.08 16.2h1.87L7.91 4.78H5.97l11.183 14.42Z" />
          </svg>
        </a>
      )}
      {li && (
        <a href={li} target="_blank" rel="noopener noreferrer" className={iconClass} aria-label="LinkedIn">
          <svg className="size-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
        </a>
      )}
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto w-full min-w-0 overflow-x-hidden border-t border-stone-800/80 bg-[#0c0c0c] text-stone-400">
      <div className="mx-auto max-w-6xl min-w-0 px-5 py-16 text-center sm:py-20">
        <p className="font-display text-lg font-medium leading-snug tracking-tight text-stone-100 sm:text-xl">
          Puro Flusso. Menos ruido, más flujo. Leído en todas partes.
        </p>

        <p className="mx-auto mt-8 max-w-md text-sm leading-relaxed text-stone-500">
          ¿Te has quedado con ganas de más flujo? Recibe la revista y las guías en tu bandeja.
        </p>
        <Link
          href="/#regalo"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-stone-100 px-5 py-2.5 text-sm font-medium text-stone-900 transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
        >
          Suscribirme al boletín
        </Link>

        <SocialLinks />

        <nav className="mt-12 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-stone-500">
          <Link href="/legal/aviso-legal" className="rounded-md px-2 py-1 transition-colors hover:bg-stone-900/80 hover:text-stone-300">
            Aviso legal
          </Link>
          <Link href="/legal/privacidad" className="rounded-md px-2 py-1 transition-colors hover:bg-stone-900/80 hover:text-stone-300">
            Privacidad
          </Link>
          <a
            href="/feed.xml"
            className="rounded-md px-2 py-1 transition-colors hover:bg-stone-900/80 hover:text-stone-300"
          >
            RSS
          </a>
          <FooterAdminLink />
        </nav>

        <p className="mt-10 text-xs text-stone-700">puroflusso.com</p>
      </div>
    </footer>
  );
}

import Link from "next/link";

const linkClass =
  "rounded-md px-2 py-1 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/35";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full min-w-0 overflow-x-hidden border-b border-white/10 bg-[#0a0a0a]/92 backdrop-blur-md supports-[backdrop-filter]:bg-[#0a0a0a]/88">
      <div className="mx-auto flex min-h-[4rem] max-w-6xl min-w-0 items-center justify-between gap-4 px-5 py-4 sm:gap-6 sm:px-6 md:min-h-[4.25rem] md:py-5">
        <Link
          href="/"
          className="shrink-0 rounded-md font-display text-base font-medium tracking-tight text-white outline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40 sm:text-lg"
        >
          PURO FLUSSO
        </Link>

        <nav
          className="flex min-w-0 shrink items-center justify-end gap-4 sm:gap-6 md:gap-8"
          aria-label="Navegación principal"
        >
          <Link href="/revista" className={linkClass}>
            Revista
          </Link>
          <Link href="/#regalo" className={linkClass}>
            Boletín
          </Link>
        </nav>
      </div>
    </header>
  );
}

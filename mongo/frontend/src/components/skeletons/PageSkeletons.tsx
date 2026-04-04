import type { ReactNode } from "react";

function Shell({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      className="min-h-[min(70vh,48rem)] w-full min-w-0"
    >
      {children}
    </div>
  );
}

function Bar({
  className,
  dark,
}: {
  className?: string;
  dark?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`rounded-md motion-safe:animate-pulse ${dark ? "bg-white/[0.12]" : "bg-[var(--surface)]"} ${className ?? ""}`}
    />
  );
}

/** Portada: hero oscuro + bloque revista (coincide con Home + sección #revista). */
export function HomePageSkeleton() {
  return (
    <Shell label="Cargando portada">
      <div className="min-w-0">
        <section
          className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 overflow-x-hidden border-b border-white/[0.08] bg-[#0a0a0a]"
          aria-hidden
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/35 to-transparent md:h-40" />
          <div className="relative mx-auto w-full min-w-0 max-w-6xl px-5 py-16 sm:py-20 md:px-6 md:py-24 lg:py-28">
            <div className="grid w-full min-w-0 grid-cols-1 items-center justify-items-center gap-12 md:min-h-[min(42rem,calc(100svh-6.5rem))] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:justify-items-stretch md:gap-14 lg:min-h-[min(44rem,calc(100svh-6.5rem))] lg:gap-16">
              <div className="mx-auto w-full min-w-0 max-w-2xl space-y-5 md:mx-0 md:max-w-none md:pr-6">
                <Bar dark className="h-2.5 w-28 rounded-full" />
                <Bar dark className="h-12 w-full max-w-xl rounded-lg sm:h-14" />
                <Bar dark className="h-10 w-11/12 max-w-lg rounded-lg opacity-80" />
                <div className="space-y-3 pt-2">
                  <Bar dark className="h-3.5 w-full max-w-lg rounded-full" />
                  <Bar dark className="h-3.5 w-full max-w-md rounded-full opacity-90" />
                  <Bar dark className="h-3.5 w-4/5 max-w-sm rounded-full opacity-70" />
                </div>
                <div className="mt-9 space-y-3">
                  <Bar dark className="h-[52px] w-full max-w-[550px] rounded-lg" />
                  <Bar dark className="h-3 w-40 rounded-full opacity-60" />
                </div>
              </div>
              <div className="flex min-w-0 max-w-full justify-center md:justify-end">
                <div className="w-full min-w-0 max-w-[min(100%,20rem)] md:max-w-[min(100%,28rem)]">
                  <div className="overflow-hidden rounded-[2rem] bg-neutral-900/90 ring-1 ring-white/[0.08]">
                    <div className="relative aspect-[4/5]">
                      <Bar dark className="absolute inset-0 rounded-none bg-white/[0.08]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="scroll-mt-[calc(4.25rem+0.75rem)] overflow-x-hidden border-t border-[var(--border)] bg-[var(--bg)] pb-28 pt-20 md:pb-32 md:pt-24">
          <div className="mx-auto max-w-4xl px-1 sm:px-0">
            <Bar className="h-2.5 w-32 rounded-full" />
            <div className="mt-4 space-y-2">
              <Bar className="h-3.5 w-full max-w-xl rounded-full" />
              <Bar className="h-3.5 w-full max-w-lg rounded-full opacity-80" />
            </div>

            <div className="mt-12 space-y-14 md:mt-14 md:space-y-20">
              <div>
                <Bar className="mb-4 h-2.5 w-24 rounded-full" />
                <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm dark:shadow-none md:flex md:min-h-[min(22rem,52vw)]">
                  <div className="relative aspect-[16/10] w-full shrink-0 md:aspect-auto md:w-[44%] md:max-w-md">
                    <Bar className="absolute inset-0 rounded-none bg-[var(--tag-bg)]" />
                  </div>
                  <div className="flex flex-col justify-center space-y-4 px-8 py-12 md:flex-1 md:px-12 md:py-14">
                    <Bar className="h-8 w-full max-w-md rounded-lg" />
                    <Bar className="h-3.5 w-full rounded-full" />
                    <Bar className="h-3.5 w-11/12 rounded-full opacity-80" />
                    <Bar className="h-3 w-48 rounded-full opacity-70" />
                  </div>
                </div>
              </div>
              <div>
                <Bar className="mb-5 h-2.5 w-28 rounded-full" />
                <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="flex min-w-0 gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm dark:shadow-none sm:flex-col sm:gap-3"
                    >
                      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-[var(--tag-bg)] sm:aspect-[16/10] sm:h-auto sm:w-full">
                        <Bar className="absolute inset-0 rounded-none opacity-80" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
                        <Bar className="h-4 w-full rounded-md" />
                        <Bar className="h-3.5 w-4/5 rounded-full opacity-80" />
                        <Bar className="h-2.5 w-32 rounded-full opacity-60" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

/** Artículo: max-w-3xl, portada 2:1, cabecera y cuerpo. */
export function ArticlePageSkeleton() {
  return (
    <Shell label="Cargando artículo">
      <article className="mx-auto min-w-0 w-full max-w-3xl">
        <Bar className="h-4 w-24 rounded-sm" />
        <header className="mt-6 space-y-8">
          <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl bg-[var(--tag-bg)]">
            <Bar className="absolute inset-0 rounded-none opacity-90" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Bar className="h-4 w-40 rounded-full" />
            <Bar className="h-4 w-28 rounded-full opacity-80" />
          </div>
          <div className="space-y-3">
            <Bar className="h-10 w-full max-w-2xl rounded-lg sm:h-12" />
            <Bar className="h-10 w-4/5 max-w-xl rounded-lg opacity-90 sm:h-12" />
          </div>
          <div className="space-y-2.5">
            <Bar className="h-4 w-full rounded-full" />
            <Bar className="h-4 w-11/12 rounded-full opacity-85" />
          </div>
          <div className="flex gap-2 pt-2">
            <Bar className="h-7 w-16 rounded-full" />
            <Bar className="h-7 w-20 rounded-full opacity-80" />
            <Bar className="h-7 w-14 rounded-full opacity-70" />
          </div>
          <Bar className="h-11 w-full max-w-xs rounded-lg" />
        </header>
        <div className="prose-wrap mt-12 space-y-4 border-t border-[var(--border)] pt-10">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Bar
              key={i}
              className={`h-3.5 rounded-full ${i % 3 === 2 ? "w-4/5" : "w-full"} ${i % 3 === 0 ? "opacity-90" : i % 3 === 1 ? "opacity-80" : "opacity-75"}`}
            />
          ))}
          <Bar className="mt-8 h-32 w-full rounded-xl opacity-80" />
          {[0, 1, 2, 3].map((i) => (
            <Bar key={`b-${i}`} className="h-3.5 w-full rounded-full opacity-80" />
          ))}
        </div>
      </article>
    </Shell>
  );
}

/** Revista archivo: cabecera + filtros + rejilla de tarjetas. */
export function RevistaPageSkeleton() {
  return (
    <Shell label="Cargando revista">
      <div>
        <div className="mx-auto max-w-4xl px-1 sm:px-0">
          <Bar className="h-4 w-28 rounded-sm" />
          <Bar className="mt-6 h-2.5 w-20 rounded-full" />
          <Bar className="mt-3 h-10 w-48 max-w-[85%] rounded-lg sm:h-11" />
          <div className="mt-4 space-y-2">
            <Bar className="h-3.5 w-full max-w-xl rounded-full" />
            <Bar className="h-3.5 w-3/4 max-w-lg rounded-full opacity-80" />
          </div>

          <div className="mt-12 space-y-8">
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Bar key={i} className="h-8 w-16 rounded-full opacity-90" />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex min-w-0 gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm dark:shadow-none sm:flex-col sm:gap-3"
                >
                  <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-[var(--tag-bg)] sm:aspect-[16/10] sm:h-auto sm:w-full">
                    <Bar className="absolute inset-0 rounded-none opacity-80" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3 pt-0.5">
                    <Bar className="h-4 w-full rounded-md" />
                    <Bar className="h-3.5 w-11/12 rounded-full opacity-80" />
                    <Bar className="h-2.5 w-36 rounded-full opacity-60" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

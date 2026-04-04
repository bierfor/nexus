import { Fragment } from "react";

/** `**negrita**` en texto plano. */
function InlineBold({ text, strongClassName }: { text: string; strongClassName: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className={strongClassName}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/**
 * Párrafos separados con línea en blanco (`\n\n`).
 * El primer bloque usa `paragraphClassName`; los siguientes añaden `mt-4`.
 */
export function HeroRichParagraphs({
  text,
  paragraphClassName,
  strongClassName = "font-semibold text-[var(--ink)]",
}: {
  text: string;
  paragraphClassName: string;
  /** Clases para `**negrita**` (p. ej. hero oscuro: `font-medium text-white`). */
  strongClassName?: string;
}) {
  const blocks = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map((block, i) => (
        <p key={i} className={i === 0 ? paragraphClassName : `${paragraphClassName} mt-4`}>
          <InlineBold text={block} strongClassName={strongClassName} />
        </p>
      ))}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Aviso legal",
};

export default function AvisoLegalPage() {
  return (
    <article className="mx-auto max-w-2xl py-8">
      <Link href="/" className="text-sm font-medium text-[var(--accent)] hover:underline">
        ← Inicio
      </Link>
      <h1 className="font-display mt-8 text-3xl text-[var(--ink)]">Aviso legal</h1>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-[var(--body)]">
        <p>
          Este sitio es editado con fines informativos y editoriales. La información no constituye asesoramiento
          profesional, fiscal ni financiero.
        </p>
        <p>
          Los contenidos y marcas citadas pertenecen a sus titulares. Puro Flusso no se responsabiliza del uso
          que terceros hagan de la información publicada.
        </p>
        <p>
          Para consultas sobre este aviso o el sitio, utiliza los canales de contacto que habilites oficialmente
          para Puro Flusso.
        </p>
        <p className="text-xs text-[var(--muted)]">
          Documento marco. Completa con titular, NIF/CIF, domicilio y legislación aplicable según tu situación.
        </p>
      </div>
    </article>
  );
}

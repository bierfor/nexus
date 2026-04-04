import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de privacidad",
};

export default function PrivacidadPage() {
  return (
    <article className="mx-auto max-w-2xl py-8">
      <Link href="/" className="text-sm font-medium text-[var(--accent)] hover:underline">
        ← Inicio
      </Link>
      <h1 className="font-display mt-8 text-3xl text-[var(--ink)]">Política de privacidad</h1>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-[var(--body)]">
        <p>
          Cuando te suscribes al boletín o dejas tu email, tratamos ese dato para enviarte artículos y
          comunicaciones de la revista Puro Flusso, novedades editoriales cuando las haya, y mejorar la
          relación con la comunidad.
        </p>
        <p>
          La base del tratamiento es tu consentimiento, que puedes retirar en cualquier momento (por ejemplo,
          mediante el enlace de baja en los emails o escribiéndonos).
        </p>
        <p>
          Conservamos los datos el tiempo necesario para esas finalidades y cumplimos medidas de seguridad
          razonables. No vendemos tu email a terceros para su marketing.
        </p>
        <p>
          Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad
          cuando correspondan según la normativa aplicable (por ejemplo, el RGPD en la UE).
        </p>
        <p className="text-xs text-[var(--muted)]">
          Texto base. Añade responsable del tratamiento, delegado de protección de datos si aplica, encargados
          (hosting, email), transferencias internacionales y plazos concretos con tu asesor legal.
        </p>
      </div>
    </article>
  );
}

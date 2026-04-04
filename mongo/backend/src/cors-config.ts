import type { CorsOptions } from "cors";

/**
 * Producción: define `CORS_ORIGINS` (coma) con las URLs exactas del front (esquema + host, sin barra final).
 * Ej.: https://puroflusso.com,https://www.puroflusso.com
 * El cliente llama a GraphQL desde el navegador (p. ej. contador de vistas).
 *
 * Si pruebas desde el navegador contra el API (p. ej. AnythingLLM en http://localhost:3001),
 * añade ese origen a la lista. Las peticiones servidor→servidor (Docker/agent) suelen ir sin
 * `Origin` y no dependen de CORS.
 *
 * Sin variable: se refleja el `Origin` de la petición (útil en desarrollo).
 */
export function buildCorsOptions(): CorsOptions {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    return { origin: true, credentials: true };
  }

  const allowed = new Set(
    raw
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  };
}

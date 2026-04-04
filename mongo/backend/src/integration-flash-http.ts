export type ParseFlashBodyResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: string };

/**
 * Si el cliente envía el objeto completo del tool (AnythingLLM) con `cuerpo_json_flash`
 * como string JSON escapado, extrae el objeto interno.
 */
function unwrapAnythingllmToolArgs(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  const raw = o.cuerpo_json_flash;
  if (typeof raw !== "string") return v;
  try {
    let inner: unknown = JSON.parse(raw.trim());
    let guard = 0;
    while (typeof inner === "string" && guard++ < 8) {
      inner = JSON.parse((inner as string).trim());
    }
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return inner;
    }
  } catch {
    /* seguir con v */
  }
  return v;
}

/**
 * Lee el body crudo del POST (Buffer) para no depender de Content-Type ni de express.json().
 * Desempaqueta JSON envuelto en string (doble/triple escape típico de agentes).
 */
export function parseIntegrationFlashRequestBody(buf: unknown): ParseFlashBodyResult {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return {
      ok: false,
      error:
        "Cuerpo vacío: el POST no trae bytes. Suele ser el flow HTTP (AnythingLLM) sin asignar el JSON al body, no CORS. Revisa que el cuerpo sea la salida del LLM o {{cuerpo_json_flash}} y Content-Type application/json si el cliente lo permite.",
    };
  }
  const text = buf.toString("utf8").trim();
  if (!text) {
    return { ok: false, error: "Cuerpo vacío (solo espacios)." };
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "El cuerpo no es JSON válido." };
  }
  let guard = 0;
  while (typeof v === "string" && guard++ < 8) {
    const s = v.trim();
    if (!s) return { ok: false, error: "JSON anidado vacío (strings vacíos)." };
    try {
      v = JSON.parse(s);
    } catch {
      return { ok: false, error: "Capa interna del JSON no es válida." };
    }
  }
  if (typeof v === "string") {
    return { ok: false, error: "El cuerpo debe resolverse a un objeto JSON { title, summary, ... }, no a un string." };
  }
  v = unwrapAnythingllmToolArgs(v);
  return { ok: true, payload: v };
}

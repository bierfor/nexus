/**
 * Nexus Serialize — Lossless server→client data transport.
 *
 * The POJO Barrier problem:
 *   JSON.stringify(new Date())      → '"2026-04-03T..."'  (string, not Date)
 *   JSON.stringify(new Map(...))    → '{}'                (empty object!)
 *   JSON.stringify(new Set(...))    → '{}'                (empty object!)
 *   JSON.stringify(42n)             → throws TypeError
 *   JSON.stringify(/foo/gi)         → '{}'                (empty object!)
 *
 * Nexus Serialize encodes rich types into a tagged wire format and
 * reconstructs them faithfully on the client — with zero external deps.
 *
 * Wire format: JSON with tagged wrapper objects
 *   { __t: 'Date',    v: '2026-04-03T...' }
 *   { __t: 'Map',     v: [[key, value], ...] }
 *   { __t: 'Set',     v: [item, ...] }
 *   { __t: 'BigInt',  v: '9007199254740993' }
 *   { __t: 'RegExp',  v: { src: 'foo', flags: 'gi' } }
 *   { __t: 'URL',     v: 'https://nexusjs.dev' }
 *   { __t: 'Undef' }
 *   { __t: 'NaN' }
 *   { __t: 'Inf',     v: 1 | -1 }
 *   { __t: 'Buf',     v: '<base64>' }   (Uint8Array / Buffer)
 *   { __t: 'Err',     v: { msg, name, stack? } }
 *
 * Usage:
 *   // Server (frontmatter or Server Action)
 *   const wire = serialize({ user, createdAt: new Date(), tags: new Set(['a', 'b']) });
 *
 *   // Client (island)
 *   const { user, createdAt, tags } = deserialize(wire);
 *   createdAt instanceof Date // true ✓
 *   tags instanceof Set       // true ✓
 */

// ── Type tag registry ─────────────────────────────────────────────────────────

type WireTag =
  | 'Date' | 'Map' | 'Set' | 'BigInt' | 'RegExp'
  | 'URL'  | 'Undef' | 'NaN' | 'Inf' | 'Buf' | 'Err';

interface Tagged<T extends WireTag, V = unknown> {
  __t: T;
  v?: V;
}

// ── Serialize ─────────────────────────────────────────────────────────────────

/**
 * Serializes any JavaScript value to a JSON string.
 * Preserves: Date, Map, Set, BigInt, RegExp, URL, Uint8Array,
 *            undefined, NaN, Infinity, Error, nested objects/arrays.
 */
/**
 * Serializes to a JSON string safe to embed in `<script type="application/json">` or inline payloads.
 * Escapes `<` as `\u003c` in the **serialized text** so `</script>` cannot terminate the host tag;
 * `JSON.parse` still yields the original string values (round-trip preserves `<`).
 */
export function serialize(value: unknown): string {
  return escapeJsonForInlineScript(JSON.stringify(encode(value)));
}

/** Escape `<` in JSON text for HTML/script embedding (XSS / script-breakout hardening). */
function escapeJsonForInlineScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

/**
 * Encodes a value for the wire format (pre-JSON.stringify step).
 */
export function encode(value: unknown): unknown {
  if (value === undefined) return tag('Undef');
  if (value === null) return null;
  if (typeof value === 'bigint') return tag('BigInt', value.toString());
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return tag('NaN');
    if (!Number.isFinite(value)) return tag('Inf', value > 0 ? 1 : -1);
    return value;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return tag('Date', value.toISOString());
  if (value instanceof RegExp) return tag('RegExp', { src: value.source, flags: value.flags });
  if (value instanceof URL) return tag('URL', value.href);
  if (value instanceof Map) return tag('Map', [...value.entries()].map(([k, v]) => [encode(k), encode(v)]));
  if (value instanceof Set) return tag('Set', [...value.values()].map(encode));
  if (value instanceof Error) return tag('Err', { msg: value.message, name: value.name, stack: value.stack });
  if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
    return tag('Buf', uint8ToBase64(value as Uint8Array));
  }
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = encode(v);
    }
    return result;
  }
  return value;
}

// ── Deserialize ───────────────────────────────────────────────────────────────

/**
 * Deserializes a Nexus wire-format JSON string back to rich JavaScript values.
 */
export function deserialize<T = unknown>(json: string): T {
  return decode(JSON.parse(json)) as T;
}

/**
 * Decodes a pre-parsed wire-format value.
 */
export function decode(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) return value.map(decode);

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Check for tagged type
    if ('__t' in obj) {
      const t = obj['__t'] as WireTag;
      const v = obj['v'];

      switch (t) {
        case 'Date':   return new Date(v as string);
        case 'BigInt': return BigInt(v as string);
        case 'RegExp': {
          const { src, flags } = v as { src: string; flags: string };
          return new RegExp(src, flags);
        }
        case 'URL':    return new URL(v as string);
        case 'Map':    return new Map((v as Array<[unknown, unknown]>).map(([k, mv]) => [decode(k), decode(mv)]));
        case 'Set':    return new Set((v as unknown[]).map(decode));
        case 'NaN':    return NaN;
        case 'Inf':    return (v as number) > 0 ? Infinity : -Infinity;
        case 'Undef':  return undefined;
        case 'Buf':    return base64ToUint8(v as string);
        case 'Err': {
          const { msg, name, stack } = v as { msg: string; name: string; stack?: string };
          const err = new Error(msg);
          err.name = name;
          if (stack) err.stack = stack;
          return err;
        }
        default: return obj;
      }
    }

    // Plain object — recurse
    const result: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      result[k] = decode(val);
    }
    return result;
  }

  return value;
}

// ── Inline script generator ───────────────────────────────────────────────────

/**
 * Generates an inline <script> tag that injects server props into the page
 * for island hydration. The client runtime reads `window.__NEXUS_PROPS__`.
 *
 * Security: values are JSON-encoded with HTML entity escaping to prevent XSS.
 *
 * Usage in renderer:
 *   const propsScript = injectProps('island_a3f9c1', { user, createdAt });
 *   html = html.replace('</body>', propsScript + '</body>');
 */
export function injectProps(islandId: string, props: unknown): string {
  const encoded = serialize(props);
  return `<script id="__nx_props_${islandId}__" type="application/json">${encoded}</script>`;
}

/**
 * Reads injected props in the browser.
 * Called by island mount functions before hydration.
 */
export function readProps<T = unknown>(islandId: string): T | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(`__nx_props_${islandId}__`);
  if (!el) return null;
  try {
    return deserialize<T>(el.textContent ?? '{}');
  } catch {
    return null;
  }
}

// ── Streaming transport ───────────────────────────────────────────────────────

/**
 * Encodes a value for streaming (newline-delimited JSON chunks).
 * Used by the streaming SSR renderer for out-of-order flushing.
 */
export function encodeChunk(id: string, data: unknown): string {
  return escapeJsonForInlineScript(JSON.stringify({ id, data: encode(data) })) + '\n';
}

export function decodeChunk(line: string): { id: string; data: unknown } | null {
  try {
    const { id, data } = JSON.parse(line);
    return { id, data: decode(data) };
  } catch {
    return null;
  }
}

// ── Type-safe fetch wrapper ───────────────────────────────────────────────────

/**
 * Typed fetch for Server Actions — automatically serializes input and
 * deserializes the response using Nexus transport.
 */
export async function callAction<TInput, TOutput>(
  actionName: string,
  input: TInput,
): Promise<{ data: TOutput; error: null } | { data: null; error: string }> {
  const body = serialize(input);

  try {
    const res = await fetch(`/_nexus/action/${actionName}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nexus-action': actionName,
      },
      body,
    });

    const json = await res.text();
    const result = deserialize<{ data?: TOutput; error?: string }>(json);

    if (result.error) return { data: null, error: result.error };
    return { data: result.data as TOutput, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── XSS Protection ────────────────────────────────────────────────────────────

/**
 * Threat model (not a guarantee of total immunity — attack surfaces evolve):
 * - **Wire (`serialize` / `deserialize`)**: `escapeJsonForInlineScript` prevents breaking out of
 *   JSON-in-HTML/script contexts via `<` / `</script>` without changing parsed values after `JSON.parse`.
 * - **HTML text nodes / attributes**: use {@link sanitize} or {@link sanitizeDeep} when interpolating
 *   untrusted strings into templates. For rich HTML, use a vetted library (e.g. DOMPurify) instead.
 * - **Dev-only HMR / observability**: must never run in production; keep NODE_ENV checks in tooling.
 */

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a value for safe **HTML text** insertion (not for raw `innerHTML` of trusted markup).
 * Prefer {@link serialize} for server→client props; use this when rendering strings into HTML templates.
 *
 * @example
 * import { sanitize } from '@nexus_js/serialize';
 * // Template: <p>${sanitize(userBio)}</p>
 */
export function sanitize(input: unknown): string {
  if (input === null || input === undefined) return '';
  return escapeHtmlText(String(input));
}

/**
 * Recursively applies {@link sanitize} to every string in plain objects and arrays.
 * **Do not** use on payloads that will be passed through `serialize` for JSON (double-escaping risk).
 * Use when **all** string leaves are meant for HTML display (e.g. previewing pretext in a dev panel).
 */
export function sanitizeDeep<T = unknown>(value: T): T {
  return walkSanitize(value) as T;
}

function walkSanitize(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return escapeHtmlText(v);
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(walkSanitize);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = walkSanitize(val);
  }
  return out;
}

/**
 * Returns true if the string looks like it contains HTML/script-like markup (heuristic for dev / lint).
 * Not exhaustive; safe output still requires {@link sanitize} or proper parsing.
 */
export function looksLikeHtmlInjection(s: string): boolean {
  return /<\s*script|<\s*\/\s*script|on\w+\s*=|javascript\s*:|data\s*:\s*text\/html/i.test(s);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tag<T extends WireTag, V>(t: T, v?: V): Tagged<T, V> {
  return v !== undefined ? { __t: t, v } : { __t: t } as Tagged<T, V>;
}

function uint8ToBase64(buf: Uint8Array): string {
  const binary = Array.from(buf).map((b) => String.fromCharCode(b)).join('');
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf;
}

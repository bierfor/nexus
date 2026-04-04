/**
 * Compiler-time security hints for `.nx` island / client script.
 * Not exhaustive — defense in depth; review warnings in CI output.
 */

import type { CompileWarning } from './types.js';
import type { ParsedComponent } from './types.js';

/** References that must not appear in code that ships to the browser bundle. */
const PROCESS_ENV = /\bprocess\.env\b/;
const IMPORT_META_ENV = /\bimport\.meta\.env\b/;
const DENO_ENV = /\bDeno\.env\b/;
const BUN_ENV = /\bBun\.env\b/;

/** Inline HTML event attributes (discouraged — CSP / XSS footguns). */
const INLINE_ON_ATTR = /\s(on[a-z]+)\s*=\s*["'][^"']*["']/i;

/**
 * Scans island `<script>` block and template for patterns that often indicate
 * secret leakage or unsafe inline handlers.
 */
export function scanIslandSecurity(parsed: ParsedComponent): CompileWarning[] {
  const out: CompileWarning[] = [];
  const script = parsed.script?.content ?? '';
  const tmpl = parsed.template?.content ?? '';
  const loc = parsed.filepath;

  if (!script && !tmpl) return out;

  if (script) {
    if (PROCESS_ENV.test(script)) {
      out.push({
        message: `[security] Island script references process.env — server-only; do not ship secrets to the client (${loc})`,
      });
    }
    if (IMPORT_META_ENV.test(script)) {
      out.push({
        message: `[security] Island script references import.meta.env — only public Vite-style keys should be used here (${loc})`,
      });
    }
    if (DENO_ENV.test(script)) {
      out.push({
        message: `[security] Island script references Deno.env — not available in browser bundles (${loc})`,
      });
    }
    if (BUN_ENV.test(script)) {
      out.push({
        message: `[security] Island script references Bun.env — not available in browser bundles (${loc})`,
      });
    }
  }

  if (tmpl && INLINE_ON_ATTR.test(tmpl)) {
    const m = INLINE_ON_ATTR.exec(tmpl);
    const attr = m?.[1] ?? 'on*';
    out.push({
      message: `[security] Template uses inline ${attr}="..." — prefer bound handlers without string attribute JS (CSP-friendly) (${loc})`,
    });
  }

  return out;
}

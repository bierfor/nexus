// Simple ICU-style plural parser

/**
 * Extract the content of a named plural rule (one, other, few, many, zero)
 * handling nested braces correctly.
 */
function extractPluralRule(body: string, rule: string): string | null {
  const regex = new RegExp(`\\b${rule}\\s*\\{`);
  const match = body.match(regex);
  if (!match) return null;

  let depth = 1;
  let i = match.index! + match[0].length;
  const start = i;

  while (i < body.length && depth > 0) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') depth--;
    i++;
  }

  if (depth !== 0) return null;
  return body.slice(start, i - 1);
}

function selectPluralRule(body: string, count: number): string | null {
  // Exact match first: =N {}
  const exact = extractPluralRule(body, `=${count}`);
  if (exact !== null) return exact;

  if (count === 1) {
    const one = extractPluralRule(body, 'one');
    if (one !== null) return one;
  }

  const other = extractPluralRule(body, 'other');
  if (other !== null) return other;
  if (count === 0) {
    const zero = extractPluralRule(body, 'zero');
    if (zero !== null) return zero;
  }

  return null;
}

/**
 * Process ICU-style plural expressions from a template string.
 * Returns the template with plural blocks resolved.
 */
function processPlurals(
  template: string,
  vars: Record<string, string | number>
): string {
  let result = '';
  let i = 0;

  while (i < template.length) {
    const openBrace = template.indexOf('{', i);
    if (openBrace === -1) {
      result += template.slice(i);
      break;
    }

    result += template.slice(i, openBrace);
    i = openBrace + 1;

    // Check if this looks like an ICU expression: {key, type, ...}
    const commaAfterKey = template.indexOf(',', i);
    if (commaAfterKey === -1) {
      result += '{';
      continue;
    }

    const key = template.slice(i, commaAfterKey).trim();
    // Fast path: if key contains spaces or braces, it's not a simple key
    if (/[{\s]/.test(key)) {
      result += '{';
      i = openBrace + 1;
      continue;
    }

    // Look for " plural," after the first comma
    const pluralPos = template.indexOf('plural', commaAfterKey);
    if (pluralPos === -1 || pluralPos > commaAfterKey + 20) {
      // Not a plural expression, treat as literal
      result += '{';
      i = openBrace + 1;
      continue;
    }

    // Find the matching closing brace by counting
    let braceCount = 1;
    let j = pluralPos + 6; // after "plural"
    while (j < template.length && braceCount > 0) {
      if (template[j] === '{') braceCount++;
      else if (template[j] === '}') braceCount--;
      j++;
    }

    if (braceCount !== 0) {
      // Mismatched braces, treat as literal
      result += '{';
      i = openBrace + 1;
      continue;
    }

    const body = template.slice(pluralPos + 6, j - 1).trim();
    const count =
      typeof vars[key] === 'number'
        ? vars[key]
        : Number(vars[key] ?? 0);
    const resolved = selectPluralRule(body, count);

    if (resolved !== null) {
      // Interpolate remaining {vars} inside the resolved block
      result += interpolateSimple(resolved, vars);
    }
    i = j;
  }

  return result;
}

/**
 * Simple {var} interpolation (no nesting, no conditionals).
 */
function interpolateSimple(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{([a-zA-Z_]\w*)\}/g, (_match, key) => {
    return String(vars[key] ?? '');
  });
}

/**
 * Full interpolation: plurals first, then simple vars.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number>
): string {
  let result = processPlurals(template, vars);
  result = interpolateSimple(result, vars);
  return result;
}

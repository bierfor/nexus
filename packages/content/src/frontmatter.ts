/**
 * Parse YAML-like frontmatter from markdown files.
 * Supports the standard `---` delimited format.
 */
export function parseFrontmatter(content: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith('---')) {
    return { meta: {}, body: content };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { meta: {}, body: content };
  }

  const front = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trimStart();

  const meta = parseYaml(front);
  return { meta, body };
}

/**
 * Minimal YAML parser for simple frontmatter.
 * Supports: key: value, key: "value", key: 'value', key: [a, b, c], numeric values, booleans.
 */
function parseYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Simple key: value parsing
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let rawValue = trimmed.slice(colonIndex + 1).trim();

    if (!key) continue;

    result[key] = parseYamlValue(rawValue);
  }

  return result;
}

function parseYamlValue(raw: string): unknown {
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;

  // Number
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d+\.\d+$/.test(raw)) return Number(raw);

  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  // Array: [a, b, c]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1);
    if (!inner.trim()) return [];
    return inner.split(',').map(s => parseYamlValue(s.trim()));
  }

  // Unquoted string
  return raw;
}

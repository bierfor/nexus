/**
 * Dev-only HTTP API to patch Vault-lite without restarting the server.
 * POST /_nexus/dev/vault — body: `{ patch: Record<string,string>, replace?: boolean }`
 * Optional auth: `NEXUS_DEV_VAULT_TOKEN` → require `Authorization: Bearer …` or `x-nexus-dev-vault-token`.
 */

import { nexusVault } from '@nexus_js/security';
import { emitDevRadar } from './devradar.js';

export async function handleDevVaultPost(request: Request): Promise<Response> {
  const token = process.env['NEXUS_DEV_VAULT_TOKEN'];
  if (token !== undefined && token !== '') {
    const auth = request.headers.get('authorization');
    const hdr = request.headers.get('x-nexus-dev-vault-token');
    const ok = auth === `Bearer ${token}` || hdr === token;
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized', status: 401 }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON', status: 400 }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (typeof body !== 'object' || body === null || !('patch' in body)) {
    return new Response(
      JSON.stringify({ error: 'Expected { patch: Record<string,string>, replace?: boolean }', status: 400 }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const rawPatch = (body as { patch: unknown }).patch;
  if (typeof rawPatch !== 'object' || rawPatch === null) {
    return new Response(JSON.stringify({ error: 'patch must be an object', status: 400 }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const replace = (body as { replace?: unknown }).replace === true;
  const entries: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawPatch as Record<string, unknown>)) {
    if (typeof v === 'string') entries[k] = v;
    else if (v === null || v === undefined) entries[k] = '';
    else entries[k] = String(v);
  }

  if (replace) nexusVault.replaceAll(entries);
  else nexusVault.patch(entries);

  emitDevRadar({
    type: 'security:audit',
    payload: {
      kind: 'vault_updated',
      message: replace
        ? `Vault replaced (${Object.keys(entries).length} keys)`
        : `Vault patched (${Object.keys(entries).length} keys)`,
    },
  });

  return new Response(
    JSON.stringify({ ok: true, keys: Object.keys(entries).length, replace }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

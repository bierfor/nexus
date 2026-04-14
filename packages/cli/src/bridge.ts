import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  bridgeDir,
  bridgeSourcesPath,
  canonicalModelPath,
  securityReportPath,
  readBridgeSources,
  writeBridgeSources,
  buildSecurityReport,
  generateAppFiles,
  parseCanonicalModel,
  hasBlockingFindings,
  type BridgeSourcesFile,
  type BridgeSourceConfig,
} from '@nexus_js/bridge';

import { discoverPostgres } from '@nexus_js/bridge-postgres';

function isLoopbackHost(host: string | undefined): boolean {
  const h = (host ?? '').split(':')[0] ?? '';
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function writeJson(filePath: string, obj: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function readJson(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

export async function runBridge(opts: { root: string; argv: string[] }): Promise<void> {
  const { positionals, values } = parseArgs({
    args: opts.argv,
    options: {
      'dsn-env': { type: 'string' },
      schema:    { type: 'string', multiple: true },
      port:      { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const sub = positionals[0] as string | undefined;
  const sub2 = positionals[1] as string | undefined;

  const sourcesPath = bridgeSourcesPath(opts.root);
  const modelPath = canonicalModelPath(opts.root);
  const reportPath = securityReportPath(opts.root);

  if (sub === 'add') {
    const kind = sub2 ?? '';
    if (kind !== 'postgres') {
      throw new Error('[Bridge] Usage: nexus bridge add postgres --dsn-env BRIDGE_POSTGRES_URL --schema public');
    }

    const dsnEnv = typeof values['dsn-env'] === 'string' ? values['dsn-env'] : 'BRIDGE_POSTGRES_URL';
    const schemas = (values['schema'] as string[] | undefined) ?? ['public'];
    const existing = await readBridgeSources(sourcesPath);
    const next: BridgeSourcesFile = existing ?? { version: 1, sources: [] };
    const name = `postgres:${schemas.join(',')}`;
    next.sources = next.sources.filter((s: BridgeSourceConfig) => !(s.kind === 'postgres' && s.name === name));
    next.sources.push({ kind: 'postgres', name, dsnEnv, schemas });
    await writeBridgeSources(sourcesPath, next);
    return;
  }

  if (sub === 'discover') {
    const sources = await readBridgeSources(sourcesPath);
    if (!sources || sources.sources.length === 0) {
      throw new Error('[Bridge] No sources configured. Run: nexus bridge add postgres --dsn-env BRIDGE_POSTGRES_URL');
    }

    const pg = sources.sources.find((s: BridgeSourceConfig) => s.kind === 'postgres');
    if (!pg) {
      throw new Error('[Bridge] No postgres source configured.');
    }

    const dsn = process.env[pg.dsnEnv] ?? '';
    if (!dsn) {
      throw new Error(`[Bridge] Missing env ${pg.dsnEnv}.`);
    }

    const model = await discoverPostgres(dsn, { schemas: pg.schemas ?? ['public'], name: pg.name });
    await mkdir(bridgeDir(opts.root), { recursive: true });
    await writeJson(modelPath, model);
    await writeJson(reportPath, buildSecurityReport(model));

    if (hasBlockingFindings(model.security.findings)) {
      throw new Error('[Bridge] Blocking security findings present. Resolve and re-run.');
    }

    return;
  }

  if (sub === 'verify') {
    const raw = await readJson(modelPath);
    const model = parseCanonicalModel(raw);
    if (model.tenancy.mode !== 'single') {
      const tenantField = model.tenancy.key?.type === 'field' ? model.tenancy.key.value : null;
      if (!tenantField) throw new Error('[Bridge] Tenancy enabled but no tenant key configured.');
      const anyTenant = model.entities.some((e: { fields: Array<{ tenantKey: boolean }> }) => e.fields.some((f: { tenantKey: boolean }) => f.tenantKey === true));
      if (!anyTenant) throw new Error('[Bridge] Tenancy enabled but no entity has tenantKey=true.');
    }
    if (hasBlockingFindings(model.security.findings)) {
      throw new Error('[Bridge] Blocking security findings present.');
    }
    return;
  }

  if (sub === 'generate') {
    const raw = await readJson(modelPath);
    const model = parseCanonicalModel(raw);
    const files = generateAppFiles(model);
    for (const f of files) {
      const outPath = join(opts.root, f.relativePath);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, f.content, 'utf8');
    }
    return;
  }

  if (sub === 'ui') {
    const port = typeof values['port'] === 'string' ? parseInt(values['port'], 10) : 4600;
    const token = sha256Hex(`${process.pid}:${Date.now()}`).slice(0, 24);

    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nexus Bridge</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:980px;margin:32px auto;padding:0 16px;color:#111}h1{margin:0 0 12px}pre{background:#0b1020;color:#d6e4ff;padding:16px;border-radius:10px;overflow:auto}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}small{color:#555}</style></head><body><h1>Nexus Bridge</h1><small>Local-only. Token required.</small><div id="root">Loading…</div><script type="module">const r=document.getElementById('root');const token=${JSON.stringify(token)};const res=await fetch('/api/model?token='+encodeURIComponent(token));if(!res.ok){r.textContent='Failed to load model';}else{const m=await res.json();r.innerHTML='';const pre=document.createElement('pre');pre.textContent=JSON.stringify(m,null,2);r.appendChild(pre);}</script></body></html>`;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const host = req.headers.host;
      if (!isLoopbackHost(host)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      const url = new URL(req.url ?? '/', `http://${host ?? 'localhost'}`);
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
        return;
      }
      if (url.pathname === '/api/model' && req.method === 'GET') {
        const t = url.searchParams.get('token') ?? '';
        if (t !== token) {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }
        try {
          const raw = await readJson(modelPath);
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(raw));
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Missing canonical-model.json. Run: nexus bridge discover');
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });

    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
    process.stdout.write(`Bridge UI: http://127.0.0.1:${port}/\n`);
    await new Promise<void>(() => {});
  }

  throw new Error('[Bridge] Usage: nexus bridge <add|discover|verify|generate|ui>');
}

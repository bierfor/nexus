/**
 * Nexus Studio — Real-time developer dashboard.
 *
 * Launched via `nexus studio`. Pair with `nexus dev`: the CLI registers the DevRadar
 * sink so Server Actions + pretext profiling stream here over WebSocket.
 * The browser UI connects to ws://localhost:${STUDIO_PORT}/_nexus/studio
 *
 * Panels:
 *   1. Layout Tree     — Visual nested layout hierarchy for the current route.
 *   2. Island Map      — All live islands on screen, their state, hydration strategy.
 *   3. Action Log      — Real-time stream of Server Action calls, payloads, timings.
 *   4. JS Cost         — Bundle analysis for the current route (mirrors nexus analyze).
 *   5. Cache Inspector — Current cache entries, TTLs, hit/miss ratio.
 *   6. Store Viewer    — Live snapshot of the Global State Store.
 *   7. Security Report — Snapshot from `nexus dev` (serialize, compiler scans, hardened mode, roadmap rows).
 *   8. Vault-lite      — Proxy to the dev app `/_nexus/dev/vault` (Vault tab).
 */

import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { STUDIO_DEFAULT_PORT } from '@nexus_js/server/constants';
import type { SecurityReportPayload } from '@nexus_js/server';

export const STUDIO_PORT = STUDIO_DEFAULT_PORT;
export const STUDIO_WS_PATH = '/_nexus/studio';

// ── Event types sent from the dev server to Studio clients ──────────────────

export type StudioEvent =
  | { type: 'route:change'; payload: RouteInfo }
  | { type: 'island:mounted'; payload: IslandInfo }
  | { type: 'island:destroyed'; payload: { id: string } }
  | { type: 'island:state'; payload: { id: string; state: unknown } }
  | { type: 'action:call'; payload: ActionCall }
  | { type: 'action:result'; payload: ActionResult }
  | { type: 'action:redirect'; payload: ActionRedirect }
  | { type: 'action:error'; payload: ActionError }
  | { type: 'devtools:pretext'; payload: { pattern: string; durationMs: number; parallelCount: number } }
  | { type: 'security:audit'; payload: { kind: string; message: string; action?: string } }
  | { type: 'security:report'; payload: SecurityReportPayload }
  | { type: 'rune:telemetry'; payload: { runeId: string; updatesPerSecond: number; label?: string } }
  | { type: 'cache:set'; payload: CacheEntry }
  | { type: 'cache:hit'; payload: { key: string } }
  | { type: 'cache:miss'; payload: { key: string } }
  | { type: 'store:update'; payload: { key: string; value: unknown } }
  | { type: 'hmr:update'; payload: { file: string; time: number } }
  | { type: 'build:complete'; payload: BuildInfo };

export interface RouteInfo {
  path: string;
  params: Record<string, string>;
  layouts: string[];
  page: string;
  cacheTtl: number;
  cacheStrategy: string;
  jsCost: { raw: number; gzip: number; budget: number; overBudget: boolean };
}

export interface IslandInfo {
  id: string;
  component: string;
  strategy: string;
  state: unknown;
  props: unknown;
  el?: string;
}

export interface ActionCall {
  id: string;
  name: string;
  islandId?: string;
  input: unknown;
  timestamp: number;
  idempotencyKey?: string;
}

export interface ActionResult {
  id: string;
  name: string;
  output: unknown;
  duration: number;
  cached: boolean;
}

export interface ActionRedirect {
  id: string;
  name: string;
  location: string;
  status: number;
  duration: number;
}

export interface ActionError {
  id: string;
  name: string;
  error: string;
  code?: string;
  duration: number;
}

export interface CacheEntry {
  key: string;
  tags: string[];
  ttl: number;
  size: number;
}

export interface BuildInfo {
  routes: number;
  islands: number;
  totalSize: number;
  duration: number;
}

// ── Simple broadcast bus ───────────────────────────────────────────────────────

type WsLike = { send: (data: string) => void; readyState: number };
const OPEN = 1;
const clients = new Set<WsLike>();

/** Last snapshot from `nexus dev` — replayed to new Studio tabs. */
let lastSecurityReport: SecurityReportPayload | null = null;

export function broadcast(event: StudioEvent): void {
  if (event.type === 'security:report') {
    lastSecurityReport = event.payload;
  }
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === OPEN) {
      try { client.send(payload); } catch { clients.delete(client); }
    }
  }
}

// ── WebSocket handshake (no external dependency, pure Node.js) ────────────────

function wsHandshake(req: import('http').IncomingMessage, socket: import('net').Socket): void {
  const key = req.headers['sec-websocket-key'] as string;
  if (!key) { socket.destroy(); return; }

  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n'));

  const ws: WsLike = {
    readyState: OPEN,
    send(data: string) {
      const buf = Buffer.from(data);
      const len = buf.length;
      const header = Buffer.alloc(len < 126 ? 2 : 4);
      header[0] = 0x81; // FIN + text opcode
      if (len < 126) {
        header[1] = len;
      } else {
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      }
      socket.write(Buffer.concat([header, buf]));
    },
  };

  clients.add(ws);
  socket.on('close', () => {
    (ws as { readyState: number }).readyState = 3;
    clients.delete(ws);
  });

  // Send a welcome snapshot so the client panel shows current state immediately
  ws.send(JSON.stringify({ type: 'studio:connected', timestamp: Date.now() }));
  if (lastSecurityReport) {
    ws.send(JSON.stringify({ type: 'security:report', payload: lastSecurityReport }));
  }
}

// ── HTML Dashboard (single-file, no bundler needed) ───────────────────────────

function studioHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nexus Studio</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Syne:wght@700;800&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0f;
      --surface: #111118;
      --border: #1e1e2e;
      --accent: #7c3aed;
      --accent2: #06b6d4;
      --green: #10b981;
      --red: #ef4444;
      --amber: #f59e0b;
      --text: #e2e8f0;
      --muted: #64748b;
      --mono: 'JetBrains Mono', monospace;
      --sans: 'Syne', system-ui, sans-serif;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--mono);
      font-size: 13px;
      height: 100vh;
      display: grid;
      grid-template-rows: 48px 1fr;
      overflow: hidden;
    }

    /* Header */
    header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .logo {
      font-family: var(--sans);
      font-weight: 800;
      font-size: 18px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--muted);
      transition: background 0.3s;
    }
    .status-dot.connected { background: var(--green); box-shadow: 0 0 8px var(--green); }

    .status-label { color: var(--muted); font-size: 11px; }

    nav { display: flex; gap: 4px; margin-left: auto; }
    nav button {
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font-family: var(--mono);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    nav button.active, nav button:hover {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }

    /* Main layout */
    .workspace {
      display: grid;
      grid-template-columns: 280px 1fr 300px;
      overflow: hidden;
    }

    /* Panels */
    .panel {
      border-right: 1px solid var(--border);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .panel:last-child { border-right: none; }

    .panel-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-family: var(--sans);
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      background: var(--surface);
      z-index: 1;
    }

    .panel-content { padding: 10px; flex: 1; }

    /* Island card */
    .island-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 8px;
      background: rgba(124, 58, 237, 0.04);
      transition: border-color 0.2s;
    }
    .island-card:hover { border-color: var(--accent); }

    .island-name {
      font-weight: 600;
      color: var(--accent2);
      margin-bottom: 4px;
      font-size: 12px;
    }

    .island-meta { color: var(--muted); font-size: 11px; }

    .badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .badge-load { background: rgba(16,185,129,0.15); color: var(--green); }
    .badge-idle { background: rgba(245,158,11,0.15); color: var(--amber); }
    .badge-visible { background: rgba(6,182,212,0.15); color: var(--accent2); }
    .badge-server { background: rgba(100,116,139,0.15); color: var(--muted); }

    /* Action log */
    .action-entry {
      border-bottom: 1px solid var(--border);
      padding: 8px 0;
      font-size: 11px;
    }

    .action-name { color: var(--accent); font-weight: 600; margin-bottom: 2px; }
    .action-duration { color: var(--green); }
    .action-error { color: var(--red); }

    .action-payload {
      margin-top: 4px;
      padding: 6px 8px;
      background: var(--bg);
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre;
      max-height: 80px;
      font-size: 10px;
      color: var(--text);
      display: none;
    }

    .action-entry.expanded .action-payload { display: block; }
    .action-entry { cursor: pointer; }

    /* Route info */
    .route-path {
      font-size: 18px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 12px;
      word-break: break-all;
    }

    .metric-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
      font-size: 11px;
    }

    .metric-label { color: var(--muted); }

    .metric-value { font-weight: 600; }
    .metric-value.good { color: var(--green); }
    .metric-value.warn { color: var(--amber); }
    .metric-value.bad { color: var(--red); }

    /* Progress bar */
    .budget-bar {
      height: 4px;
      border-radius: 2px;
      background: var(--border);
      margin-top: 4px;
      overflow: hidden;
    }

    .budget-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--green);
      transition: width 0.4s ease;
    }
    .budget-fill.over { background: var(--red); }
    .budget-fill.warn { background: var(--amber); }

    /* Cache inspector */
    .cache-entry {
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
      font-size: 11px;
    }

    .cache-key { color: var(--accent2); margin-bottom: 2px; }
    .cache-ttl { color: var(--muted); }

    /* Store viewer */
    .store-entry {
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
    }

    .store-key { color: var(--accent); font-size: 11px; margin-bottom: 2px; }
    .store-value {
      font-size: 10px;
      color: var(--text);
      background: var(--bg);
      padding: 4px 6px;
      border-radius: 4px;
      white-space: pre-wrap;
      max-height: 60px;
      overflow-y: auto;
    }

    /* Layout tree */
    .layout-node {
      padding: 5px 8px;
      margin: 2px 0;
      border-left: 2px solid var(--border);
      font-size: 11px;
      color: var(--muted);
    }

    .layout-node.active {
      border-color: var(--accent);
      color: var(--text);
    }

    /* Scrollbars */
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .empty-state {
      text-align: center;
      padding: 32px;
      color: var(--muted);
      font-size: 11px;
    }
  </style>
</head>
<body>
  <header>
    <span class="logo">Nexus Studio</span>
    <span style="font-size:10px;color:var(--muted);margin-left:8px">DevRadar</span>
    <div class="status-dot" id="statusDot"></div>
    <span class="status-label" id="statusLabel">Connecting...</span>
    <nav>
      <button class="active" data-panel="overview">Overview</button>
      <button data-panel="islands">Islands</button>
      <button data-panel="actions">Actions</button>
      <button data-panel="cache">Cache</button>
      <button data-panel="store">Store</button>
      <button data-panel="vault">Vault</button>
      <button data-panel="security">Security</button>
    </nav>
  </header>

  <div class="workspace">
    <!-- Left: Layout Tree -->
    <div class="panel" id="panelLeft">
      <div class="panel-header">
        <span>Layout Tree</span>
        <span id="routeCount">0 islands</span>
      </div>
      <div class="panel-content" id="layoutTree">
        <div class="empty-state">Navigate to a page to see the layout tree.</div>
      </div>
    </div>

    <!-- Center: Main Content -->
    <div class="panel" id="panelCenter" style="border-right:none">
      <div class="panel-header">
        <span id="centerPanelTitle">Route Overview</span>
      </div>
      <div class="panel-content" id="centerContent">
        <div class="empty-state">No route loaded yet. Open your browser to a Nexus page.</div>
      </div>
    </div>

    <!-- Right: Context -->
    <div class="panel" id="panelRight">
      <div class="panel-header">
        <span>Action Log</span>
        <button onclick="clearActions()" style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer">Clear</button>
      </div>
      <div class="panel-content" id="actionLog">
        <div class="empty-state">No actions fired yet.</div>
      </div>
      <div class="panel-header" style="border-top:1px solid var(--border)">
        <span>DevRadar</span>
      </div>
      <div class="panel-content" id="devradarStrip" style="font-size:10px">
        <div class="empty-state">Run <code>nexus dev</code> and open Studio — pretext + security stream here.</div>
      </div>
    </div>
  </div>

  <script>
    const WS_PORT = ${port};
    const state = {
      connected: false,
      route: null,
      islands: new Map(),
      actions: [],
      cache: new Map(),
      store: new Map(),
      pretextLast: null,
      securityTail: [],
      securityReport: null,
    };

    // ── WebSocket ────────────────────────────────────────────────────────────
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket('ws://localhost:' + WS_PORT + '/_nexus/studio');

      ws.onopen = () => {
        state.connected = true;
        document.getElementById('statusDot').classList.add('connected');
        document.getElementById('statusLabel').textContent = 'Connected';
        clearTimeout(reconnectTimer);
      };

      ws.onmessage = (e) => {
        const event = JSON.parse(e.data);
        handleEvent(event);
      };

      ws.onclose = () => {
        state.connected = false;
        document.getElementById('statusDot').classList.remove('connected');
        document.getElementById('statusLabel').textContent = 'Disconnected — retrying...';
        reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();

    // ── Event handlers ────────────────────────────────────────────────────────
    function handleEvent(event) {
      switch (event.type) {
        case 'route:change':
          state.route = event.payload;
          state.islands.clear();
          renderLayoutTree();
          renderOverview();
          break;

        case 'island:mounted':
          state.islands.set(event.payload.id, event.payload);
          document.getElementById('routeCount').textContent = state.islands.size + ' islands';
          renderIslandPanel();
          break;

        case 'island:destroyed':
          state.islands.delete(event.payload.id);
          document.getElementById('routeCount').textContent = state.islands.size + ' islands';
          renderIslandPanel();
          break;

        case 'island:state':
          const isl = state.islands.get(event.payload.id);
          if (isl) { isl.state = event.payload.state; renderIslandPanel(); }
          break;

        case 'action:call':
          state.actions.unshift({ ...event.payload, status: 'pending' });
          if (state.actions.length > 100) state.actions.pop();
          renderActionLog();
          break;

        case 'action:result':
          const a = state.actions.find(x => x.id === event.payload.id);
          if (a) { Object.assign(a, event.payload, { status: 'success' }); renderActionLog(); }
          break;

        case 'action:redirect':
          const ar = state.actions.find(x => x.id === event.payload.id);
          if (ar) { Object.assign(ar, event.payload, { status: 'redirect' }); renderActionLog(); }
          break;

        case 'action:error':
          const ae = state.actions.find(x => x.id === event.payload.id);
          if (ae) { Object.assign(ae, event.payload, { status: 'error' }); renderActionLog(); }
          break;

        case 'devtools:pretext':
          state.pretextLast = event.payload;
          renderOverview();
          renderDevRadarStrip();
          break;

        case 'security:audit':
          state.securityTail.unshift({ ...event.payload, t: Date.now() });
          if (state.securityTail.length > 24) state.securityTail.pop();
          renderDevRadarStrip();
          break;

        case 'security:report':
          state.securityReport = event.payload;
          if (document.querySelector('nav button.active')?.dataset.panel === 'security') {
            renderSecurityPanel();
          }
          break;

        case 'rune:telemetry':
          renderDevRadarStrip();
          break;

        case 'cache:set':
          state.cache.set(event.payload.key, event.payload);
          renderCachePanel();
          break;

        case 'cache:hit':
        case 'cache:miss':
          const ce = state.cache.get(event.payload.key);
          if (ce) { ce.lastAccess = event.type === 'cache:hit' ? 'HIT' : 'MISS'; renderCachePanel(); }
          break;

        case 'store:update':
          state.store.set(event.payload.key, event.payload.value);
          renderStorePanel();
          break;
      }
    }

    // ── Renderers ─────────────────────────────────────────────────────────────
    function renderLayoutTree() {
      const el = document.getElementById('layoutTree');
      if (!state.route) { el.innerHTML = '<div class="empty-state">No route.</div>'; return; }

      const layouts = state.route.layouts ?? [];
      let html = layouts.map((l, i) =>
        '<div class="layout-node" style="padding-left:' + (8 + i * 12) + 'px">' +
        '┣ ' + l.replace(/.*\\//, '') + '</div>'
      ).join('');
      html += '<div class="layout-node active" style="padding-left:' + (8 + layouts.length * 12) + 'px">◆ ' +
              (state.route.page ?? 'page').replace(/.*\\//, '') + '</div>';

      el.innerHTML = html;
    }

    function renderOverview() {
      const el = document.getElementById('centerContent');
      if (!state.route) return;
      const r = state.route;
      const jsCost = r.jsCost ?? {};
      const raw = jsCost.raw ?? 0;
      const budget = jsCost.budget ?? 50000;
      const pct = Math.min((raw / budget) * 100, 100);
      const colorClass = pct > 100 ? 'bad' : pct > 70 ? 'warn' : 'good';

      el.innerHTML = \`
        <div class="route-path">\${r.path || '/'}</div>
        <div class="metric-row">
          <span class="metric-label">Cache Strategy</span>
          <span class="metric-value">\${r.cacheStrategy || '—'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Cache TTL</span>
          <span class="metric-value \${r.cacheTtl > 0 ? 'good' : 'warn'}">\${r.cacheTtl > 0 ? r.cacheTtl + 's' : 'no-store'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">JS Budget</span>
          <span class="metric-value \${colorClass}">\${(raw/1024).toFixed(1)}kb / \${(budget/1024).toFixed(0)}kb</span>
        </div>
        <div class="budget-bar">
          <div class="budget-fill \${colorClass !== 'good' ? colorClass : ''}" style="width:\${pct}%"></div>
        </div>
        <div class="metric-row" style="margin-top:12px">
          <span class="metric-label">Active Islands</span>
          <span class="metric-value">\${state.islands.size}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Params</span>
          <span class="metric-value">\${Object.entries(r.params || {}).map(([k,v]) => k + '=' + v).join(', ') || '—'}</span>
        </div>
        \${state.pretextLast ? \`
        <div class="metric-row" style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
          <span class="metric-label">Pretext (nxPretext)</span>
          <span class="metric-value good">\${state.pretextLast.durationMs}ms · \${state.pretextLast.parallelCount} parallel</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Route pattern</span>
          <span class="metric-value" style="font-size:10px;word-break:break-all">\${state.pretextLast.pattern}</span>
        </div>\` : ''}
      \`;
    }

    function renderDevRadarStrip() {
      const el = document.getElementById('devradarStrip');
      if (!el) return;
      const sec = state.securityTail.slice(0, 8);
      el.innerHTML =
        (state.pretextLast
          ? '<div style="font-size:10px;color:var(--muted);margin-bottom:6px">Last pretext: <span style="color:var(--green)">' +
            state.pretextLast.durationMs + 'ms</span> · ' + state.pretextLast.pattern + '</div>'
          : '') +
        (sec.length
          ? '<div style="font-size:10px;color:var(--amber)">Security</div>' +
            sec.map(s =>
              '<div style="font-size:10px;margin:4px 0;padding:4px;background:var(--bg);border-radius:4px">' +
              '<span style="color:var(--red)">' + (s.kind || '') + '</span> · ' +
              (s.action ? s.action + ' — ' : '') + (s.message || '') + '</div>'
            ).join('')
          : '<div style="font-size:10px;color:var(--muted)">No security events yet.</div>');
    }

    function renderIslandPanel() {
      const el = document.getElementById('centerContent');
      const title = document.getElementById('centerPanelTitle');
      if (document.querySelector('nav button.active')?.dataset.panel !== 'islands') return;
      title.textContent = 'Live Islands (' + state.islands.size + ')';

      if (state.islands.size === 0) {
        el.innerHTML = '<div class="empty-state">No islands active on this page.</div>';
        return;
      }

      el.innerHTML = Array.from(state.islands.values()).map(isl => \`
        <div class="island-card">
          <div class="island-name">\${isl.component.replace(/.*\\//, '')}</div>
          <div class="island-meta" style="margin-bottom:6px">
            <span class="badge badge-\${isl.strategy?.replace('client:', '') ?? 'load'}">\${isl.strategy ?? 'client:load'}</span>
            <span style="margin-left:6px;color:var(--muted)">#\${isl.id?.slice(0,8)}</span>
          </div>
          <div style="font-size:10px;color:var(--muted)">State:</div>
          <div class="store-value">\${JSON.stringify(isl.state ?? {}, null, 2)}</div>
        </div>
      \`).join('');
    }

    function renderActionLog() {
      const el = document.getElementById('actionLog');
      if (state.actions.length === 0) {
        el.innerHTML = '<div class="empty-state">No actions fired yet.</div>';
        return;
      }

      el.innerHTML = state.actions.slice(0, 30).map(a => \`
        <div class="action-entry" onclick="this.classList.toggle('expanded')">
          <div class="action-name">\${a.name}</div>
          <div class="island-meta">
            \${a.status === 'pending' ? '<span style="color:var(--amber)">⏳ pending</span>' : ''}
            \${a.status === 'success' ? '<span class="action-duration">✓ ' + a.duration + 'ms</span>' : ''}
            \${a.status === 'error' ? '<span class="action-error">✗ ' + (a.error ?? 'error') + '</span>' : ''}
            \${a.islandId ? ' · ' + a.islandId.slice(0,8) : ''}
          </div>
          <div class="action-payload">\${JSON.stringify(a.input ?? {}, null, 2)}</div>
        </div>
      \`).join('');
    }

    function renderCachePanel() {
      const el = document.getElementById('centerContent');
      if (document.querySelector('nav button.active')?.dataset.panel !== 'cache') return;

      if (state.cache.size === 0) {
        el.innerHTML = '<div class="empty-state">No cache entries yet.</div>';
        return;
      }

      el.innerHTML = Array.from(state.cache.values()).map(c => \`
        <div class="cache-entry">
          <div class="cache-key">\${c.key}</div>
          <div class="cache-ttl">TTL: \${c.ttl}s · Size: \${(c.size/1024).toFixed(1)}kb \${c.lastAccess ? '· ' + c.lastAccess : ''}</div>
          \${c.tags?.length ? '<div class="cache-ttl">Tags: ' + c.tags.join(', ') + '</div>' : ''}
        </div>
      \`).join('');
    }

    function renderStorePanel() {
      const el = document.getElementById('centerContent');
      if (document.querySelector('nav button.active')?.dataset.panel !== 'store') return;

      if (state.store.size === 0) {
        el.innerHTML = '<div class="empty-state">No store entries yet.</div>';
        return;
      }

      el.innerHTML = Array.from(state.store.entries()).map(([k, v]) => \`
        <div class="store-entry">
          <div class="store-key">\${k}</div>
          <div class="store-value">\${JSON.stringify(v, null, 2)}</div>
        </div>
      \`).join('');
    }

    function statusIcon(st) {
      if (st === 'pass') return '<span style="color:var(--green)">✓</span>';
      if (st === 'warn') return '<span style="color:var(--amber)">⚠</span>';
      return '<span style="color:var(--muted)">○</span>';
    }

    function renderSecurityPanel() {
      const el = document.getElementById('centerContent');
      const title = document.getElementById('centerPanelTitle');
      if (document.querySelector('nav button.active')?.dataset.panel !== 'security') return;
      title.textContent = 'Security report';

      if (!state.securityReport) {
        el.innerHTML =
          '<div class="empty-state">No snapshot yet. Start <code>nexus dev</code> with Studio + DevRadar enabled.</div>';
        return;
      }

      const r = state.securityReport;
      const hardenedRow =
        '<div class="metric-row"><span class="metric-label">Hardened Mode</span>' +
        '<span class="metric-value ' + (r.hardened ? 'good' : 'warn') + '">' +
        (r.hardened ? 'enabled' : 'off — enable security.hardened in nexus.config') +
        '</span></div>';

      const rows = (r.checks || []).map(function (c) {
        return (
          '<div class="metric-row" style="align-items:flex-start;gap:8px">' +
          '<span style="min-width:1.2rem">' + statusIcon(c.status) + '</span>' +
          '<span class="metric-value" style="font-size:11px;line-height:1.4">' + c.label + '</span>' +
          '</div>'
        );
      }).join('');

      el.innerHTML =
        '<div class="route-path" style="margin-bottom:8px">Defense in depth</div>' +
        '<p style="font-size:10px;color:var(--muted);margin:0 0 12px;line-height:1.45">' +
        'Not a guarantee of total immunity — review compiler warnings on save and keep dependencies updated.' +
        '</p>' +
        hardenedRow +
        '<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;font-size:10px;color:var(--muted)">Active checks</div>' +
        rows;
    }

    function renderVaultPanel() {
      const el = document.getElementById('centerContent');
      const title = document.getElementById('centerPanelTitle');
      if (document.querySelector('nav button.active')?.dataset.panel !== 'vault') return;
      title.textContent = 'Vault-lite';
      const origin = localStorage.getItem('nexusStudioVaultAppOrigin') || 'http://127.0.0.1:3000';
      const tok = localStorage.getItem('nexusStudioVaultToken') || '';
      el.innerHTML =
        '<p style="font-size:10px;color:var(--muted);margin:0 0 12px;line-height:1.45">' +
        'Hot-reload secrets into the running dev server (<code>POST /_nexus/dev/vault</code>). ' +
        '<strong>Save (merge)</strong> overlays keys; <strong>Reset from env + apply</strong> reloads <code>process.env</code> then applies the textarea (empty value removes a key). ' +
        'Optional: set ' +
        '<code>NEXUS_DEV_VAULT_TOKEN</code> on the app and paste the same token below.</p>' +
        '<label style="display:block;font-size:10px;color:var(--muted);margin-bottom:4px">App origin</label>' +
        '<input id="vaultAppOrigin" type="text" value="" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:var(--mono);font-size:11px;margin-bottom:10px" />' +
        '<label style="display:block;font-size:10px;color:var(--muted);margin-bottom:4px">Dev token (optional)</label>' +
        '<input id="vaultToken" type="password" autocomplete="off" value="" placeholder="NEXUS_DEV_VAULT_TOKEN" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:var(--mono);font-size:11px;margin-bottom:10px" />' +
        '<label style="display:block;font-size:10px;color:var(--muted);margin-bottom:4px">KEY=value lines (empty value removes key)</label>' +
        '<textarea id="vaultLines" rows="12" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:var(--mono);font-size:11px;resize:vertical" placeholder="STRIPE_SECRET_KEY=sk_live_...\\nAPI_URL=https://api.example.com"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:10px;align-items:center">' +
        '<button type="button" id="vaultSavePatch" style="padding:8px 14px;border-radius:6px;border:none;background:var(--accent);color:#fff;font-family:var(--mono);font-size:11px;cursor:pointer">Save (merge)</button>' +
        '<button type="button" id="vaultSaveReplace" style="padding:8px 14px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);font-family:var(--mono);font-size:11px;cursor:pointer">Reset from env + apply</button>' +
        '</div>' +
        '<div id="vaultStatus" style="margin-top:12px;font-size:11px;color:var(--muted)"></div>';
      document.getElementById('vaultAppOrigin').value = origin;
      document.getElementById('vaultToken').value = tok;

      function parseLines(text) {
        const patch = {};
        for (const line of text.split(/\\r?\\n/)) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          const eq = t.indexOf('=');
          if (eq < 1) continue;
          const k = t.slice(0, eq).trim();
          patch[k] = t.slice(eq + 1);
        }
        return patch;
      }

      async function send(replace) {
        const status = document.getElementById('vaultStatus');
        status.textContent = '';
        const appOrigin = document.getElementById('vaultAppOrigin').value.trim().replace(/\\/$/, '');
        const token = document.getElementById('vaultToken').value;
        const patch = parseLines(document.getElementById('vaultLines').value);
        if (!appOrigin) {
          status.style.color = 'var(--red)';
          status.textContent = 'App origin is required.';
          return;
        }
        localStorage.setItem('nexusStudioVaultAppOrigin', appOrigin);
        localStorage.setItem('nexusStudioVaultToken', token);
        try {
          const r = await fetch('/_nexus/studio/vault', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ appOrigin, token: token || undefined, patch, replace }),
          });
          const text = await r.text();
          let j;
          try {
            j = JSON.parse(text);
          } catch {
            j = { error: text || 'Invalid response' };
          }
          if (!r.ok) {
            status.style.color = 'var(--red)';
            status.textContent = (j && j.error) ? j.error : 'Request failed (' + r.status + ')';
            return;
          }
          status.style.color = 'var(--green)';
          status.textContent = (j.ok ? 'OK — ' : '') + (j.keys != null ? j.keys + ' keys' : 'saved');
        } catch (e) {
          status.style.color = 'var(--red)';
          status.textContent = (e && e.message) ? e.message : String(e);
        }
      }

      document.getElementById('vaultSavePatch').onclick = function () { send(false); };
      document.getElementById('vaultSaveReplace').onclick = function () { send(true); };
    }

    // ── Nav ───────────────────────────────────────────────────────────────────
    const panelRenderers = {
      overview: renderOverview,
      islands: renderIslandPanel,
      actions: () => {},
      cache: renderCachePanel,
      store: renderStorePanel,
      vault: renderVaultPanel,
      security: renderSecurityPanel,
    };

    document.querySelectorAll('nav button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const panel = btn.dataset.panel;
        document.getElementById('centerPanelTitle').textContent = btn.textContent;

        if (panel === 'actions') {
          document.getElementById('panelRight').style.display = '';
          document.getElementById('centerContent').innerHTML = '<div class="empty-state">Click an action to expand its payload.</div>';
        } else {
          panelRenderers[panel]?.();
        }
      });
    });

    function clearActions() {
      state.actions = [];
      renderActionLog();
    }
  </script>
</body>
</html>`;
}

// ── Studio Server ──────────────────────────────────────────────────────────────

export interface StudioServer {
  port: number;
  close: () => void;
  broadcast: typeof broadcast;
}

export async function startStudio(preferredPort = STUDIO_PORT): Promise<StudioServer> {
  const port = await findFreePort(preferredPort);

  const server = createHttpServer((req, res) => {
    const pathOnly = (req.url ?? '/').split('?')[0] ?? '/';

    if (req.method === 'POST' && pathOnly === '/_nexus/studio/vault') {
      void (async () => {
        const chunks: Buffer[] = [];
        try {
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
        } catch {
          res.writeHead(400).end();
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        const o = parsed as {
          appOrigin?: string;
          token?: string;
          patch?: unknown;
          replace?: boolean;
        };
        const appOrigin =
          typeof o.appOrigin === 'string' ? o.appOrigin.replace(/\/$/, '') : '';
        if (!appOrigin) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'appOrigin required' }));
          return;
        }
        if (typeof o.patch !== 'object' || o.patch === null) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'patch object required' }));
          return;
        }
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (typeof o.token === 'string' && o.token !== '') {
          headers['authorization'] = `Bearer ${o.token}`;
          headers['x-nexus-dev-vault-token'] = o.token;
        }
        try {
          const r = await fetch(`${appOrigin}/_nexus/dev/vault`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ patch: o.patch, replace: o.replace === true }),
          });
          const body = await r.text();
          res.writeHead(r.status, { 'content-type': 'application/json' });
          res.end(body);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: msg,
              hint: 'Ensure nexus dev is running and the app origin matches (e.g. http://127.0.0.1:3000).',
            }),
          );
        }
      })();
      return;
    }

    if (req.url === '/_nexus/studio' && req.headers.upgrade?.toLowerCase() === 'websocket') {
      return; // Handled by upgrade event
    }

    if (req.url === '/' || req.url === '/studio') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(studioHtml(port));
      return;
    }

    res.writeHead(404).end();
  });

  server.on('upgrade', (req, socket, head) => {
    if (req.url === STUDIO_WS_PATH) {
      wsHandshake(req, socket as import('net').Socket);
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  console.log(`\n  ◆ Nexus Studio  http://localhost:${port}\n`);

  return {
    port,
    close: () => server.close(),
    broadcast,
  };
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await isPortFree(port);
    if (free) return port;
  }
  throw new Error('No free port found for Nexus Studio');
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

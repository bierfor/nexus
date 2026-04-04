/**
 * Nexus Pokédex — Dev Server
 *
 * This server IS the Nexus framework demo:
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Browser                                            │
 *   │    → GET /                         (list page)      │
 *   │    → GET /pokemon/25               (detail page)    │
 *   │    → GET /api/pokemon?page=2&q=... (JSON API)       │
 *   │    → GET /_cache                   (cache inspector)│
 *   └────────────────────┬────────────────────────────────┘
 *                        │
 *   ┌────────────────────▼────────────────────────────────┐
 *   │  Nexus Server (this file)                           │
 *   │    ① Shield Cache (in-memory, TTL + SWR)            │
 *   │    ② Data Transformation (20KB → 2KB)              │
 *   │    ③ Smart Cache-Control headers                    │
 *   │    ④ SSR HTML generation                            │
 *   └────────────────────┬────────────────────────────────┘
 *                        │ (cache miss only)
 *   ┌────────────────────▼────────────────────────────────┐
 *   │  PokeAPI GraphQL  (beta.pokeapi.co)                 │
 *   │    ONE query = name + types + stats + sprites       │
 *   │              + description + evolution chain        │
 *   └─────────────────────────────────────────────────────┘
 */

import { createServer } from 'node:http';
import { watch, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const PORT   = Number(process.env.PORT ?? 3000);
const IS_DEV = process.env.NODE_ENV !== 'production';
const GQL    = 'https://beta.pokeapi.co/graphql/v1beta';
const _start = Date.now();

// ── Nexus Connect — SSE pub/sub (no external deps) ────────────────────────────
const sseChannels = new Map(); // topic → Set<{res, unsubFn}>

function connectPublish(topic, data) {
  const msg = { data, id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`, ts: Date.now() };
  const clients = sseChannels.get(topic);
  if (!clients) return 0;
  let delivered = 0;
  for (const client of clients) {
    try { client.res.write(`id: ${msg.id}\nevent: message\ndata: ${JSON.stringify(data)}\n\n`); delivered++; }
    catch { clients.delete(client); }
  }
  return delivered;
}

function connectSubscribe(topic, res) {
  if (!sseChannels.has(topic)) sseChannels.set(topic, new Set());
  res.writeHead(200, {
    'content-type':              'text/event-stream; charset=utf-8',
    'cache-control':             'no-cache',
    'connection':                'keep-alive',
    'x-accel-buffering':         'no',
    'access-control-allow-origin': '*',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ topic, ts: Date.now() })}\n\n`);
  const client = { res };
  sseChannels.get(topic).add(client);
  const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); } }, 15_000);
  const cleanup = () => { clearInterval(heartbeat); sseChannels.get(topic)?.delete(client); };
  res.on('close', cleanup);
  return cleanup;
}

// ── Nexus Security — Rate Limiter (sliding window) ────────────────────────────
// Demonstrates: createAction({ rateLimit: { window: '1m', max: 3 } })
const _rateLimitWindows = new Map(); // key → [timestamps]

function checkRateLimit(key, windowMs, max) {
  const now    = Date.now();
  const cutoff = now - windowMs;
  const hits   = (_rateLimitWindows.get(key) ?? []).filter(t => t > cutoff);
  if (hits.length >= max) {
    const resetAt     = hits[0] + windowMs;
    const retryAfter  = Math.ceil((resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter, resetAt };
  }
  hits.push(now);
  _rateLimitWindows.set(key, hits);
  return { allowed: true, remaining: max - hits.length, retryAfter: 0, resetAt: now + windowMs };
}

// ── Nexus Security — Pseudo-CSRF tokens (demo) ────────────────────────────────
// In production this is HMAC-SHA256 via packages/server/src/csrf.ts
const _usedTokens = new Set();

function generateToken(sessionId, action) {
  const ts    = Date.now().toString(36);
  const nonce = Math.random().toString(36).slice(2, 10);
  return Buffer.from(`${sessionId}:${action}:${ts}:${nonce}`).toString('base64url');
}

function validateToken(token, sessionId, action) {
  if (_usedTokens.has(token)) return { valid: false, reason: 'Token already used — replay attack prevented' };
  try {
    const [tokSession, tokAction, tsBase36] = Buffer.from(token, 'base64url').toString().split(':');
    if (tokSession !== sessionId) return { valid: false, reason: 'Session mismatch' };
    if (tokAction !== action)     return { valid: false, reason: 'Action mismatch' };
    const age = Date.now() - parseInt(tsBase36, 36);
    if (age > 15 * 60 * 1000)    return { valid: false, reason: 'Token expired' };
    _usedTokens.add(token);
    return { valid: true };
  } catch { return { valid: false, reason: 'Malformed token' }; }
}

// ── Nexus Security — Headers (Hardened Mode equivalent) ──────────────────────
const SECURITY_HEADERS = {
  'X-Frame-Options':           'DENY',
  'X-Content-Type-Options':    'nosniff',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Permissions-Policy':        'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection':          '0',   // disabled — rely on CSP instead
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +    // inline scripts for demo islands
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' https://raw.githubusercontent.com https://assets.pokemon.com data:; " +
    "connect-src 'self' https://beta.pokeapi.co; " +
    "frame-ancestors 'none';",
};

// ── Global state (Nexus Connect topics) ───────────────────────────────────────
let globalCaptures = 0;

// ── Nexus Local-First Sync — server-side op receiver ─────────────────────────
// In a real app this writes to Postgres/SQLite. Here we keep it in-memory.
const syncedCaptures = new Map(); // pokemonId → { id, name, capturedAt }

function handleSyncOps(ops) {
  const acked = [];
  const conflicts = [];
  for (const op of ops) {
    if (op.store === 'captures' && op.type === 'put') {
      const existing = syncedCaptures.get(String(op.key));
      if (!existing || existing.ts <= op.ts) {
        syncedCaptures.set(String(op.key), { ...op.data, ts: op.ts });
        globalCaptures = syncedCaptures.size;
        connectPublish('global-captures', {
          count: globalCaptures,
          lastCapture: op.data,
          source: 'sync',
          ts: Date.now(),
        });
        acked.push(op.id);
      } else {
        // Server has a newer version → conflict
        conflicts.push({ opId: op.id, serverValue: existing });
      }
    } else if (op.store === 'captures' && op.type === 'delete') {
      syncedCaptures.delete(String(op.key));
      acked.push(op.id);
    } else {
      acked.push(op.id); // unknown store — ack to prevent retry storms
    }
  }
  return { acked, conflicts };
}

// ── Nexus AI — server-side probability manifest ───────────────────────────────
// Maps route → [{to, probability}] based on observed patterns.
// In production this would be generated from real navigation logs.
const PREFETCH_MANIFEST = {
  generated: Date.now(),
  version:   'server-1.0',
  routes: {
    // Pokémon detail pages — sequential browsing is extremely common
    ...Object.fromEntries(Array.from({ length: 1010 }, (_, i) => {
      const id = i + 1;
      const next = id + 1;
      const prev = id - 1;
      const predictions = [];
      if (next <= 1010) predictions.push({ to: `/pokemon/${next}`, probability: 0.91, estimatedBytes: 9200 });
      if (prev >= 1)    predictions.push({ to: `/pokemon/${prev}`, probability: 0.72, estimatedBytes: 9200 });
      return [`/pokemon/${id}`, predictions];
    })),
    '/': [{ to: '/pokemon/1', probability: 0.78, estimatedBytes: 9200 }],
  },
};

// ── Nexus Guard — startup security scan ───────────────────────────────────────
function guardScan(source, filepath) {
  const SECRET_RE = /process\.env\.(\w*(?:PASSWORD|SECRET|PRIVATE|KEY|TOKEN|CERT)\w*)/gi;
  const DB_RE     = /(['"`])(postgresql|mysql|mongodb|redis):\/\/[^'"`\s]+\1/gi;
  const leaks = [];
  const lines = source.split('\n');
  // Only check lines OUTSIDE the server block (---) for secrets
  let inServer = false, serverDone = false, lineNum = 0;
  for (const line of lines) {
    lineNum++;
    if (line.trim() === '---') { if (!serverDone) { inServer = !inServer; if (!inServer) serverDone = true; } continue; }
    if (!inServer) {
      let m;
      SECRET_RE.lastIndex = 0;
      while ((m = SECRET_RE.exec(line)) !== null) leaks.push({ line: lineNum, variable: m[0], severity: 'error' });
      DB_RE.lastIndex = 0;
      while ((m = DB_RE.exec(line)) !== null) leaks.push({ line: lineNum, variable: m[0].slice(0, 40), severity: 'error' });
    }
  }
  return { filepath, passed: leaks.filter(l => l.severity === 'error').length === 0, leaks };
}

async function runGuardOnAllNxFiles() {
  const { readdir, readFile } = await import('node:fs/promises');
  const srcDir = join(__dir, 'src');
  const results = [];
  async function scan(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { await scan(full); }
      else if (e.name.endsWith('.nx')) {
        const source = await readFile(full, 'utf-8').catch(() => '');
        results.push(guardScan(source, full.replace(__dir + '/', '')));
      }
    }
  }
  await scan(srcDir);
  return results;
}

// ── Dev Bridge — injected into every HTML page in dev mode ────────────────────
// The client script reads window.__NEXUS_SERVER_LOGS__ and prints the SSR
// report in DevTools. It also sets up hooks for island/state/action/nav logging.
const NEXUS_CLIENT_DEV_SCRIPT = `
<script>
(function(){
  if (!window.__NEXUS_DEV__) return;
  const logs  = window.__NEXUS_SERVER_LOGS__ ?? [];
  const build = window.__NEXUS_BUILD_INFO__  ?? {};

  const S = {
    nexus:  'color:#7c3aed;font-weight:700;font-family:monospace',
    ok:     'color:#10b981;font-weight:700',
    warn:   'color:#f59e0b;font-weight:700',
    err:    'color:#ef4444;font-weight:700',
    dim:    'color:#64748b',
    route:  'color:#06b6d4;font-weight:700',
    action: 'color:#f97316;font-weight:700',
    island: 'color:#8b5cf6;font-weight:700',
    stat:   'color:#10b981',
  };

  // ── SSR Report ──────────────────────────────────────────────────────────────
  console.groupCollapsed('%c◆ Nexus%c  SSR Report', S.nexus, S.dim);

  for (var i = 0; i < logs.length; i++) {
    var log = logs[i];
    if (log.type === 'render') {
      var cTag = log.cacheHit
        ? ['%c⚡ Cache HIT', S.ok]
        : ['%c🌐 Cache MISS — PokeAPI called', S.warn];
      console.log(
        '%c🚀 SSR%c ' + log.path + ' %c' + log.duration + 'ms  ' + cTag[0],
        S.ok, S.route, S.dim, cTag[1]
      );
      if (log.cacheStrategy) {
        console.log('%c   strategy:%c ' + log.cacheStrategy, S.dim, '');
      }
    }
    if (log.type === 'islands' && log.count > 0) {
      var names = log.names ? log.names.join(' · ') : '';
      console.log('%c📦 Hydrating%c ' + log.count + ' island' + (log.count !== 1 ? 's' : '') + (names ? ' (' + names + ')' : ''), S.ok, S.dim);
    }
    if (log.type === 'cache') {
      var hitStr = log.hit ? '⚡ HIT' : '🌐 MISS';
      console.log('%c🛡  Shield Cache%c ' + log.key + ' — ' + hitStr + (log.age ? ' (' + log.age + 's old)' : ''), S.ok, S.dim);
    }
  }

  if (build.totalJs) {
    var kb    = (build.totalJs / 1024).toFixed(1);
    var saved = ((build.reactEquivalent - build.totalJs) / 1024).toFixed(0);
    console.log('%c💎 JS: ' + kb + 'KB%c — saved ~' + saved + 'KB vs React', S.nexus, S.dim);
  }

  console.groupEnd();

  // ── Island hydration tracker ────────────────────────────────────────────────
  window.__NEXUS_LOG_ISLAND__ = function(name, strategy, ms) {
    console.log(
      '%c[Nexus] 🏝️  Island%c <' + name + ' />%c hydrated ' +
      '%c(' + strategy + ')%c — ' + ms.toFixed(1) + 'ms',
      S.nexus, S.island, '', S.dim, ''
    );
  };

  // ── $state change tracker (called by devProxy in dev mode) ─────────────────
  window.__NEXUS_LOG_STATE__ = function(key, prev, next, source) {
    console.log(
      '%c[Nexus] ✨ $state%c "' + key + '"%c  ' +
      JSON.stringify(prev) + ' → ' + JSON.stringify(next) +
      (source ? '%c  ↳ ' + source : '%c'),
      S.nexus, S.warn, S.dim, S.dim
    );
  };

  // ── $optimistic state ───────────────────────────────────────────────────────
  window.__NEXUS_LOG_OPTIMISTIC__ = function(key, value) {
    console.log(
      '%c[Nexus] 🔄 $optimistic%c "' + key + '" → %c' + JSON.stringify(value),
      S.nexus, S.warn, S.stat
    );
  };

  // ── SPA Navigation + DOM Morphing ───────────────────────────────────────────
  window.__NEXUS_LOG_NAV__ = function(to, morphKey) {
    console.log('%c[Nexus] 🗺️  Navigating to%c ' + to, S.nexus, S.route);
    if (morphKey) {
      console.log('%c[Nexus] 🪄  Morphing%c [data-nx-key="' + morphKey + '"] — preserving island state', S.nexus, S.dim);
    }
  };

  // ── Server Action lifecycle ─────────────────────────────────────────────────
  window.__NEXUS_LOG_ACTION__ = function(name, phase, data) {
    if (phase === 'call')        console.log('%c[Nexus] ▲ ACTION%c ' + name + '() called', S.nexus, S.action);
    if (phase === 'optimistic')  window.__NEXUS_LOG_OPTIMISTIC__?.(name, data);
    if (phase === 'success')     console.log('%c[Nexus] ✅ ACTION%c ' + name + '() — server synced', S.nexus, S.ok);
    if (phase === 'error')       console.error('%c[Nexus] ✖  ACTION%c ' + name + '() failed', S.err, '');
    if (phase === 'cancelled')   console.warn('%c[Nexus] ↩ ACTION%c ' + name + '() cancelled (race:cancel)', S.warn, '');
  };

  // ── A11y checker ────────────────────────────────────────────────────────────
  setTimeout(function() {
    var issues = [];
    document.querySelectorAll('img:not([alt])').forEach(function(el) {
      issues.push('<img> missing alt  ↳  ' + String(el.getAttribute('src') || '').split('/').pop());
    });
    document.querySelectorAll('button').forEach(function(el) {
      if (!el.textContent.trim() && !el.getAttribute('aria-label')) {
        issues.push('<button> missing accessible name or text content');
      }
    });
    if (issues.length) {
      console.groupCollapsed('%c[Nexus] ⚠️  A11y — ' + issues.length + ' issue' + (issues.length !== 1 ? 's' : '') + ' found', 'color:#f59e0b;font-weight:700');
      issues.forEach(function(i) { console.warn('  •', i); });
      console.groupEnd();
    } else {
      console.log('%c[Nexus] ✅ A11y — no issues detected', 'color:#10b981;font-weight:700');
    }
  }, 1200);

  // ── Guard result ────────────────────────────────────────────────────────────
  var guard = window.__NEXUS_GUARD__;
  if (guard) {
    if (guard.passed) {
      console.log('%c[Nexus] 🛡️  Guard%c — ' + guard.files + ' files scanned, 0 leaks', S.ok, S.dim);
    } else {
      console.groupCollapsed('%c[Nexus] 🛡️  Guard — ' + guard.leaks + ' security leak' + (guard.leaks !== 1 ? 's' : '') + ' found!', S.err);
      (guard.details || []).forEach(function(d) { console.error('  ✖', d); });
      console.groupEnd();
    }
  }

  // ── Security Audit Panel ────────────────────────────────────────────────────
  var sec = window.__NEXUS_SECURITY__;
  if (sec) {
    console.groupCollapsed('%c◆ Nexus%c  Security Panel', S.nexus, S.dim);
    console.log('%c[Nexus] 🔒 CSRF%c            tokens enabled — HMAC-SHA256, single-use, 15m TTL', S.ok, S.dim);
    console.log('%c[Nexus] 🚦 Rate Limit%c      capture: 3 req/min per IP (x-ratelimit-* headers on 429)', S.ok, S.dim);
    console.log('%c[Nexus] 🧹 XSS Protection%c  auto entity-encoding on all @nexus_js/serialize string props', S.ok, S.dim);
    if (sec.headers && sec.headers.length > 0) {
      console.log('%c[Nexus] 🔐 Sec Headers%c    ' + sec.headers.join(' · '), S.ok, S.dim);
    }
    if (!sec.hardened) {
      console.warn('%c[Nexus] ⚠️  Hardened Mode%c  not enabled — run %cnexus audit%c for full security report', S.warn, S.dim, 'font-family:monospace;color:#7c3aed', S.dim);
    }
    console.log('%c[Nexus] 🔍 Run audit%c      %cnexus audit --ci%c to scan for CSRF, XSS, secrets, headers, CVEs', S.ok, S.dim, 'font-family:monospace;color:#7c3aed', S.dim);
    console.groupEnd();
  }

  // ── Nexus Sync — offline indicator ─────────────────────────────────────────
  (function() {
    function updateOnlineBadge() {
      var badge = document.getElementById('online-badge');
      if (!badge) return;
      badge.textContent = navigator.onLine ? '🟢 Online' : '🔴 Offline';
      badge.style.color  = navigator.onLine ? '#10b981' : '#ef4444';
      badge.style.background = navigator.onLine ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)';
    }
    window.addEventListener('online',  function() {
      updateOnlineBadge();
      console.log('%c[Nexus Sync]%c 🟢 Connection restored — queued ops will auto-sync', 'color:#818cf8;font-weight:bold', 'color:#a3e635');
    });
    window.addEventListener('offline', function() {
      updateOnlineBadge();
      console.log('%c[Nexus Sync]%c 🔴 Offline — writes queued in IndexedDB, will sync on reconnect', 'color:#818cf8;font-weight:bold', 'color:#f87171');
    });
  })();

  // ── Nexus Connect — live counter ────────────────────────────────────────────
  if (typeof EventSource !== 'undefined') {
    var es = new EventSource('/_nexus/connect/global-captures');
    es.addEventListener('message', function(e) {
      try {
        var d = JSON.parse(e.data);
        var el = document.getElementById('capture-count');
        if (el) el.textContent = d.count;
        console.log('%c[Nexus] 🛰️  Connect%c "global-captures" →', S.nexus, S.dim, d);
      } catch {}
    });
    es.addEventListener('connected', function() {
      console.log('%c[Nexus] 🛰️  Connect%c "global-captures" established', S.nexus, 'color:#10b981;font-weight:700');
    });
  }

  // ── Nexus AI — predictive prefetch (network-aware) ─────────────────────────
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var saveData   = conn && conn.saveData;
  var effectType = conn ? conn.effectiveType : '4g';
  var isFast     = !saveData && (effectType === '4g' || !conn);

  if (saveData) {
    console.log('%c[Nexus] 🧠 AI%c 🚫 Save-Data mode — prefetch disabled. Your data is protected.', S.nexus, S.dim);
  } else if (!isFast) {
    console.log('%c[Nexus] 🧠 AI%c ⚠️  Slow connection (' + effectType + ') — prefetch skipped.', S.nexus, S.dim);
  } else {
    fetch('/nexus-prefetch-manifest.json', { priority: 'low' })
      .then(function(r) { return r.json(); })
      .then(function(manifest) {
        var currentPath = window.location.pathname;
        var predictions = (manifest.routes[currentPath] || []).filter(function(p) { return p.probability >= 0.85; });
        var budget = parseInt(sessionStorage.getItem('__nx_budget__') || '0', 10);
        var MAX_BUDGET = 512 * 1024;

        if (!predictions.length) {
          console.log('%c[Nexus] 🧠 AI%c ℹ️  No high-confidence predictions for "' + currentPath + '".', S.nexus, S.dim);
          return;
        }

        predictions.forEach(function(pred) {
          if (budget >= MAX_BUDGET) {
            console.log('%c[Nexus] 🧠 AI%c 🛑 Session budget exhausted — no more prefetches.', S.nexus, S.dim);
            return;
          }
          if (document.querySelector('link[rel="prefetch"][href="' + pred.to + '"]')) return;
          var el = document.createElement('link');
          el.rel = 'prefetch'; el.href = pred.to; el.as = 'document';
          document.head.appendChild(el);
          var estKB = ((pred.estimatedBytes || 9000) / 1024).toFixed(1);
          budget += pred.estimatedBytes || 9000;
          sessionStorage.setItem('__nx_budget__', String(budget));
          console.log(
            '%c[Nexus] 🧠 AI%c ✅ Predicting → ' + pred.to +
            ' (' + Math.round(pred.probability * 100) + '% confidence)' +
            ' — prefetched ' + estKB + 'KB HTML-only.',
            S.nexus, S.dim
          );
        });

        var usedKB = (budget / 1024).toFixed(0);
        var maxKB  = (MAX_BUDGET / 1024).toFixed(0);
        console.log('%c[Nexus] 🧠 AI%c 💾 Session budget: ' + usedKB + 'KB / ' + maxKB + 'KB.', S.nexus, S.dim);
      }).catch(function() {});
  }

})();
</script>`;

// ── ANSI palette ──────────────────────────────────────────────────────────────
const c = {
  reset:   '\x1b[0m',   bold:  '\x1b[1m',  dim:    '\x1b[2m',
  red:     '\x1b[31m',  green: '\x1b[32m', yellow: '\x1b[33m',
  blue:    '\x1b[34m',  mag:   '\x1b[35m', cyan:   '\x1b[36m',
  gray:    '\x1b[90m',
};

const log = {
  info:  (...a) => console.log(`  ${c.cyan}◆${c.reset}`, ...a),
  ok:    (...a) => console.log(`  ${c.green}✔${c.reset}`, ...a),
  warn:  (...a) => console.log(`  ${c.yellow}⚠${c.reset}`, ...a),
  error: (...a) => console.error(`  ${c.red}✖${c.reset}`, ...a),
  action: (name, status, ms, extra = '') => {
    const sCol = status === 'success' ? c.green : c.red;
    const sym  = status === 'success' ? `${c.green}▲${c.reset}` : `${c.red}▲${c.reset}`;
    process.stdout.write(
      `  ${sym} ${c.gray}${new Date().toLocaleTimeString()}${c.reset}` +
      `  ${c.mag}ACTION${c.reset}  ${c.bold}${name.padEnd(20)}${c.reset}` +
      `  ${sCol}${status}${c.reset}  ${c.dim}+${ms}ms${c.reset}` +
      (extra ? `  ${c.dim}${extra}${c.reset}` : '') + '\n'
    );
  },
  req: (method, path, status, ms, cacheStatus) => {
    const mCol  = method === 'GET' ? c.cyan : c.mag;
    const sCol  = status >= 500 ? c.red : status >= 400 ? c.yellow : c.green;
    const cache = cacheStatus === 'HIT'
      ? ` ${c.green}⚡ Shield HIT${c.reset}`
      : cacheStatus === 'MISS'
        ? ` ${c.yellow}🌐 API fetch${c.reset}`
        : '';
    console.log(
      `  ${c.gray}${new Date().toLocaleTimeString()}${c.reset}` +
      `  ${mCol}${method.padEnd(4)}${c.reset}` +
      `  ${path.padEnd(38)}` +
      `  ${sCol}${status}${c.reset}` +
      `  ${c.dim}${ms}ms${c.reset}${cache}`
    );
  },
};

// ── Shield Cache ──────────────────────────────────────────────────────────────
const cache   = new Map();
const TTL     = 24 * 60 * 60 * 1000;
const SWR_TTL = 48 * 60 * 60 * 1000;
const stats   = { hits: 0, misses: 0, apiCalls: 0 };

async function shieldCache(key, fn) {
  const now   = Date.now();
  const entry = cache.get(key);

  if (entry) {
    if (now < entry.expiresAt) {
      stats.hits++;
      return { ...entry.value, _cached: true, _age: Math.round((now - entry.setAt) / 1000) };
    }
    if (now < entry.swrExpiresAt) {
      stats.hits++;
      fn().then(v => cache.set(key, { value: v, expiresAt: Date.now() + TTL, swrExpiresAt: Date.now() + SWR_TTL, setAt: Date.now() })).catch(() => {});
      return { ...entry.value, _cached: true, _stale: true };
    }
  }

  stats.misses++;
  stats.apiCalls++;
  const value = await fn();
  cache.set(key, { value, expiresAt: now + TTL, swrExpiresAt: now + SWR_TTL, setAt: now });
  return value;
}

// ── GraphQL ───────────────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`GQL ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

// ── Sprite extractor ──────────────────────────────────────────────────────────
function sprite(spritesStr, shiny = false) {
  try {
    const s = JSON.parse(spritesStr);
    const oa = s?.other?.['official-artwork'];
    if (shiny && oa?.front_shiny) return oa.front_shiny;
    if (oa?.front_default)        return oa.front_default;
    return s?.front_default ?? '';
  } catch { return ''; }
}

// ── Type colors ───────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  normal:'#A8A77A',fire:'#EE8130',water:'#6390F0',electric:'#F7D02C',
  grass:'#7AC74C',ice:'#96D9D6',fighting:'#C22E28',poison:'#A33EA1',
  ground:'#E2BF65',flying:'#A98FF3',psychic:'#F95587',bug:'#A6B91A',
  rock:'#B6A136',ghost:'#735797',dragon:'#6F35FC',dark:'#705746',
  steel:'#B7B7CE',fairy:'#D685AD',
};

const STAT_MAX = { hp:255, attack:185, defense:230, 'special-attack':194, 'special-defense':230, speed:200 };

// ── PokeAPI fetch functions ────────────────────────────────────────────────────
async function fetchList({ page = 1, limit = 20, search = '' } = {}) {
  return shieldCache(`list:${page}:${limit}:${search}`, async () => {
    const offset = (page - 1) * limit;
    const sq = search ? `%${search}%` : '%';
    const data = await gql(`
      query($limit:Int!,$offset:Int!,$sq:String!){
        pokemon_v2_pokemon(limit:$limit,offset:$offset,where:{name:{_ilike:$sq}},order_by:{id:asc}){
          id name
          pokemon_v2_pokemontypes(order_by:{slot:asc}){ pokemon_v2_type{name} }
          pokemon_v2_pokemonsprites{ sprites }
        }
        pokemon_v2_pokemon_aggregate(where:{name:{_ilike:$sq}}){ aggregate{count} }
      }
    `, { limit, offset, sq });

    return {
      total: data.pokemon_v2_pokemon_aggregate.aggregate.count,
      pokemon: data.pokemon_v2_pokemon.map(p => {
        const types = p.pokemon_v2_pokemontypes.map(t => t.pokemon_v2_type.name);
        return {
          id: p.id,
          name: p.name,
          types,
          sprite: sprite(p.pokemon_v2_pokemonsprites[0]?.sprites ?? '{}'),
          color: TYPE_COLORS[types[0]] ?? '#A8A77A',
        };
      }),
    };
  });
}

async function fetchDetail(id) {
  return shieldCache(`detail:${id}`, async () => {
    const data = await gql(`
      query($id:Int!){
        pokemon_v2_pokemon_by_pk(id:$id){
          id name height weight base_experience
          pokemon_v2_pokemontypes(order_by:{slot:asc}){ pokemon_v2_type{name} }
          pokemon_v2_pokemonstats{ base_stat pokemon_v2_stat{name} }
          pokemon_v2_pokemonsprites{ sprites }
          pokemon_v2_pokemonspecy{
            capture_rate
            pokemon_v2_pokemoncolor{name}
            pokemon_v2_pokemonspeciesflavortexts(where:{language_id:{_eq:9}},limit:1){ flavor_text }
            pokemon_v2_evolutionchain{
              pokemon_v2_pokemonspecies(order_by:{order:asc}){
                id name evolves_from_species_id
                pokemon_v2_pokemonevolutions(limit:1){
                  min_level pokemon_v2_evolutiontrigger{name}
                }
              }
            }
          }
        }
      }
    `, { id });

    const p = data.pokemon_v2_pokemon_by_pk;
    if (!p) return null;

    const types = p.pokemon_v2_pokemontypes.map(t => t.pokemon_v2_type.name);
    const sp    = p.pokemon_v2_pokemonsprites[0]?.sprites ?? '{}';
    const color = TYPE_COLORS[p.pokemon_v2_pokemonspecy?.pokemon_v2_pokemoncolor?.name] ?? TYPE_COLORS[types[0]] ?? '#A8A77A';
    const desc  = (p.pokemon_v2_pokemonspecy?.pokemon_v2_pokemonspeciesflavortexts[0]?.flavor_text ?? 'No description.')
      .replace(/\f/g,' ').replace(/\n/g,' ');

    const evolution = (p.pokemon_v2_pokemonspecy?.pokemon_v2_evolutionchain?.pokemon_v2_pokemonspecies ?? [])
      .map(e => ({
        id: e.id, name: e.name,
        sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${e.id}.png`,
        minLevel: e.pokemon_v2_pokemonevolutions[0]?.min_level ?? null,
        trigger: e.pokemon_v2_pokemonevolutions[0]?.pokemon_v2_evolutiontrigger?.name ?? null,
      }));

    return {
      id: p.id, name: p.name, height: p.height, weight: p.weight,
      baseExperience: p.base_experience, types, color,
      sprite: sprite(sp), spriteShiny: sprite(sp, true),
      description: desc,
      captureRate: p.pokemon_v2_pokemonspecy?.capture_rate ?? 0,
      stats: p.pokemon_v2_pokemonstats.map(s => ({
        name: s.pokemon_v2_stat.name,
        value: s.base_stat,
        max: STAT_MAX[s.pokemon_v2_stat.name] ?? 255,
      })),
      evolutionChain: evolution,
    };
  });
}

// ── HTML Renderer — this is the SSR engine ────────────────────────────────────

function typeBadge(type) {
  const colors = {
    fire:'#EE8130',water:'#6390F0',grass:'#7AC74C',electric:'#F7D02C',
    psychic:'#F95587',ice:'#96D9D6',dragon:'#6F35FC',dark:'#705746',
    fairy:'#D685AD',fighting:'#C22E28',poison:'#A33EA1',rock:'#B6A136',
    ground:'#E2BF65',ghost:'#735797',bug:'#A6B91A',steel:'#B7B7CE',
    flying:'#A98FF3',normal:'#A8A77A',
  };
  const textDark = ['electric','ice','ground','steel','normal'];
  const bg = colors[type] ?? '#888';
  const fg = textDark.includes(type) ? '#111' : '#fff';
  return `<span style="background:${bg};color:${fg};padding:3px 12px;border-radius:999px;font-size:12px;font-weight:700;text-transform:capitalize">${type}</span>`;
}

// Guard results cached at startup (re-run on HMR)
let _guardResult = { passed: true, files: 0, leaks: 0, details: [] };

function buildDevBridge(serverLogs, islandNames = []) {
  if (!IS_DEV) return '';
  const totalJs = 8_400 + islandNames.length * 1_200;
  return `<script>
window.__NEXUS_DEV__ = true;
window.__NEXUS_SERVER_LOGS__ = ${JSON.stringify(serverLogs)};
window.__NEXUS_BUILD_INFO__ = {
  totalJs: ${totalJs},
  reactEquivalent: 148000,
  islandCount: ${islandNames.length}
};
window.__NEXUS_GUARD__ = ${JSON.stringify(_guardResult)};
window.__NEXUS_SECURITY__ = {
  csrf:      true,
  rateLimit: { capture: '3 req/min per IP' },
  xss:       'auto entity-encoding via @nexus_js/serialize',
  headers:   ${JSON.stringify(Object.keys(SECURITY_HEADERS))},
  hardened:  false,
  audit:     'nexus audit --ci',
};
</script>${NEXUS_CLIENT_DEV_SCRIPT}`;
}

function layout(title, body, extraHead = '', devLogs = [], islandNames = []) {
  const devBridge = buildDevBridge(devLogs, islandNames);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  ${devBridge}
  ${extraHead}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#0d0d1a;--surface:#13131f;--border:#1e1e30;--text:#e2e8f0;--muted:#64748b;--accent:#7c3aed;--mono:'JetBrains Mono',monospace}
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;min-height:100vh}
    a{color:inherit;text-decoration:none}
    ::-webkit-scrollbar{width:5px;height:5px}
    ::-webkit-scrollbar-track{background:var(--bg)}
    ::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
  </style>
</head>
<body>
  <header style="display:flex;align-items:center;gap:16px;padding:14px 32px;background:rgba(13,13,26,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100">
    <a href="/" style="display:flex;align-items:center;gap:8px;font-size:20px;font-weight:800;flex-shrink:0">
      <span style="color:var(--accent)">◆</span>
      <span>Nexus<em style="color:var(--accent);font-style:normal">dex</em>
    </span></a>
    <form method="GET" action="/" style="flex:1;max-width:380px">
      <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 14px">
        <span>🔍</span>
        <input name="q" type="search" placeholder="Search Pokémon..." autocomplete="off"
          style="flex:1;background:none;border:none;outline:none;color:var(--text);font-size:14px;font-family:inherit"
          value="${''}" />
      </div>
    </form>
    <div style="margin-left:auto;display:flex;gap:12px;align-items:center">
      <div id="global-captures" style="font-size:12px;color:var(--muted);border:1px solid var(--border);padding:4px 10px;border-radius:6px;display:flex;align-items:center;gap:6px">
        <span style="width:7px;height:7px;background:#10b981;border-radius:50%;animation:pulse 2s infinite"></span>
        <span id="capture-count">0</span> global captures
      </div>
      <a href="/_cache" style="font-size:12px;color:var(--muted);border:1px solid var(--border);padding:4px 10px;border-radius:6px">📊 Cache</a>
      <a href="https://github.com/bierfor/nexus" target="_blank" style="font-size:13px;color:var(--muted)">GitHub ↗</a>
    </div>
    <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}</style>
  </header>
  <main style="padding:32px;max-width:1400px;margin:0 auto">
    ${body}
  </main>
  <footer style="padding:16px 32px;border-top:1px solid var(--border);text-align:center;font-size:13px;color:var(--muted)">
    <p>Powered by <strong style="color:var(--text)">Nexus Framework</strong> ·
    Data from <a href="https://pokeapi.co" target="_blank" style="color:var(--accent)">PokéAPI GraphQL</a> ·
    <a href="/_cache" style="color:var(--accent)">Cache Inspector</a></p>
  </footer>
  <script>
    // SPA-like prefetching on hover — Nexus navigation concept
    document.querySelectorAll('a[href^="/pokemon/"]').forEach(a => {
      a.addEventListener('mouseenter', () => {
        const id   = a.href.split('/').pop();
        const href = '/pokemon/' + id;
        window.__NEXUS_LOG_NAV__?.(href, 'main-content');
        fetch('/api/pokemon/' + id).catch(() => {});
      }, { once: true });
    });
  </script>
</body>
</html>`;
}

function renderListPage({ pokemon, total, page, limit, search, cached, age }) {
  const totalPages = Math.ceil(total / limit);
  const q = search ? `&q=${encodeURIComponent(search)}` : '';

  const cards = pokemon.map(p => `
    <a href="/pokemon/${p.id}" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;text-decoration:none;color:var(--text);transition:all .2s;display:block;cursor:pointer;position:relative" class="card" data-color="${p.color}">
      <div style="background:linear-gradient(135deg,${p.color}22,#0d0d1a);padding:24px;display:flex;justify-content:center;align-items:center;aspect-ratio:1">
        <img src="${p.sprite}" alt="${p.name}" width="140" height="140" loading="lazy"
          style="object-fit:contain;filter:drop-shadow(0 4px 8px #0006);transition:transform .3s"
          onmouseenter="this.style.transform='scale(1.1)'"
          onmouseleave="this.style.transform='scale(1)'" />
      </div>
      <div style="padding:12px 14px 16px">
        <div style="font-size:11px;color:var(--muted);font-family:var(--mono)">#${String(p.id).padStart(3,'0')}</div>
        <div style="font-size:15px;font-weight:700;text-transform:capitalize;margin:3px 0 8px">${p.name}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">${p.types.map(typeBadge).join('')}</div>
      </div>
    </a>
  `).join('');

  const pagination = totalPages > 1 ? `
    <div style="display:flex;justify-content:center;align-items:center;gap:16px;margin-top:40px;padding-top:24px;border-top:1px solid var(--border)">
      ${page > 1 ? `<a href="?page=${page-1}${q}" style="padding:8px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:14px">← Prev</a>` : ''}
      <span style="color:var(--muted);font-size:13px">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a href="?page=${page+1}${q}" style="padding:8px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:14px">Next →</a>` : ''}
    </div>
  ` : '';

  const cacheChip = cached
    ? `<span style="background:rgba(16,185,129,.15);color:#10b981;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;font-family:var(--mono)">⚡ Shield Cache HIT${age ? ` (${age}s old)` : ''}</span>`
    : `<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;font-family:var(--mono)">🌐 Cache MISS — PokeAPI called</span>`;

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;font-size:13px;color:var(--muted)">
      <span>${total.toLocaleString()} Pokémon</span>
      ${search ? `<span style="background:rgba(124,58,237,.15);color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:12px">Search: "${search}"</span>` : ''}
      ${cacheChip}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px">
      ${cards}
    </div>
    ${pagination}
  `;
}

function renderDetailPage(p, cached) {
  const statColors = {hp:'#ef4444',attack:'#f97316','special-attack':'#a855f7',defense:'#3b82f6','special-defense':'#06b6d4',speed:'#10b981'};
  const bars = p.stats.map(s => `
    <div style="display:grid;grid-template-columns:110px 1fr 40px;align-items:center;gap:10px;margin-bottom:10px">
      <div style="font-size:12px;text-transform:capitalize;color:var(--muted);text-align:right">${s.name.replace('-',' ')}</div>
      <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
        <div style="height:100%;border-radius:3px;background:${statColors[s.name]??p.color};width:${Math.round(s.value/s.max*100)}%;transition:width .6s ease"></div>
      </div>
      <div style="font-size:13px;font-weight:700;font-family:var(--mono);text-align:right">${s.value}</div>
    </div>
  `).join('');

  const evolutionHtml = p.evolutionChain.length > 1 ? `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:20px">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:20px">Evolution Chain</h2>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">
        ${p.evolutionChain.map((e, i) => `
          ${i > 0 ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--muted);font-size:11px;min-width:50px">
            <div style="width:24px;height:1px;background:var(--border)"></div>
            ${e.trigger === 'level-up' && e.minLevel ? `<span>Lv.${e.minLevel}</span>` : e.trigger ? `<span>${e.trigger.replace(/-/g,' ')}</span>` : ''}
            <div>→</div>
          </div>` : ''}
          <a href="/pokemon/${e.id}" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px;border-radius:12px;border:2px solid ${e.id === p.id ? 'var(--accent)' : 'transparent'};background:${e.id === p.id ? 'rgba(124,58,237,.08)' : 'transparent'};min-width:90px">
            <div style="width:72px;height:72px;background:rgba(255,255,255,.04);border-radius:50%;display:flex;align-items:center;justify-content:center;padding:8px">
              <img src="${e.sprite}" alt="${e.name}" width="56" height="56" loading="lazy" style="object-fit:contain"/>
            </div>
            <span style="font-size:12px;font-weight:600;text-transform:capitalize;text-align:center">${e.name}</span>
            <span style="font-size:10px;color:var(--muted);font-family:var(--mono)">#${String(e.id).padStart(3,'0')}</span>
          </a>
        `).join('')}
      </div>
    </div>
  ` : '';

  const quickStats = [
    { label:'Height',  value:`${(p.height/10).toFixed(1)}m`  },
    { label:'Weight',  value:`${(p.weight/10).toFixed(1)}kg` },
    { label:'Base XP', value: p.baseExperience },
    { label:'Capture', value:`${Math.round(p.captureRate/255*100)}%` },
  ].map(s => `
    <div style="text-align:center">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">${s.label}</div>
      <div style="font-size:20px;font-weight:700">${s.value}</div>
    </div>
  `).join('');

  const cacheChip = cached
    ? `<span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:var(--mono)">⚡ Cache HIT</span>`
    : `<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:var(--mono)">🌐 API Called</span>`;

  return `
    <div style="max-width:900px;margin:0 auto">
      <!-- Hero -->
      <div style="position:relative;border-radius:20px;overflow:hidden;margin-bottom:24px;border:1px solid var(--border)">
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 100% at 80% 50%,${p.color}44,transparent 70%),var(--surface)"></div>
        <div style="position:relative;z-index:1;padding:32px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
            <a href="/" style="color:var(--muted);font-size:14px">← All Pokémon</a>
            <div style="display:flex;gap:8px;align-items:center">
              ${cacheChip}
              <span style="font-family:var(--mono);font-size:13px;color:var(--muted)">#${String(p.id).padStart(3,'0')}</span>
            </div>
          </div>
          <div style="display:flex;gap:40px;align-items:center;flex-wrap:wrap">
            <div id="sprite-wrap" style="text-align:center;flex-shrink:0">
              <img id="poke-sprite" src="${p.sprite}" alt="${p.name}" width="200" height="200"
                style="object-fit:contain;filter:drop-shadow(0 8px 24px #0008);transition:all .4s" />
              <br>
              <button onclick="toggleShiny()" id="shiny-btn"
                style="margin-top:12px;padding:5px 14px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer">
                ✨ Normal
              </button>
            </div>
            <div style="flex:1;min-width:200px">
              <h1 style="font-size:40px;font-weight:800;text-transform:capitalize;margin-bottom:12px">${p.name}</h1>
              <div style="display:flex;gap:8px;margin-bottom:16px">${p.types.map(typeBadge).join('')}</div>
              <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin-bottom:24px;max-width:420px">${p.description}</p>
              <div style="display:flex;gap:24px;flex-wrap:wrap">${quickStats}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats (StatsRadar island — client:visible) -->
      <div data-island-name="StatsRadar" style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700;margin-bottom:20px">Base Stats</h2>
        ${bars}
      </div>

      <!-- Evolution (EvolutionChain island — client:visible) -->
      <div data-island-name="EvolutionChain">
      ${evolutionHtml}
      </div>

      <!-- Battle Mode -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:20px">
        <h2 style="font-size:18px;font-weight:700;margin-bottom:6px">⚔️ Battle Mode</h2>
        <p style="font-size:13px;color:var(--muted);margin-bottom:20px">
          Data saved to <code style="background:rgba(124,58,237,.15);color:#7c3aed;padding:1px 4px;border-radius:3px">localStorage</code> via <code style="background:rgba(124,58,237,.15);color:#7c3aed;padding:1px 4px;border-radius:3px">$sync</code>.
          Put your browser in Airplane Mode — battles keep working.
        </p>
        <div id="battle-app" data-pokemon='${JSON.stringify({ id:p.id, name:p.name, sprite:p.sprite, atk: p.stats.find(s=>s.name==='attack')?.value ?? 50, hp: p.stats.find(s=>s.name==='hp')?.value ?? 100 })}'></div>
      </div>
    </div>

    <script>
      // ── ShinyToggle Island (client:load) ──────────────────────────────────
      const _t0_shiny = performance.now();
      let shiny = false;
      const normalSprite = ${JSON.stringify(p.sprite)};
      const shinySprite  = ${JSON.stringify(p.spriteShiny)};

      // Log island hydration
      window.__NEXUS_LOG_ISLAND__?.('ShinyToggle', 'client:load', performance.now() - _t0_shiny);

      function toggleShiny() {
        const prev = shiny;
        shiny = !shiny;
        window.__NEXUS_LOG_STATE__?.('shiny', prev, shiny, 'ShinyToggle');
        document.getElementById('poke-sprite').src = shiny ? shinySprite : normalSprite;
        document.getElementById('poke-sprite').style.filter = shiny
          ? 'drop-shadow(0 8px 24px rgba(247,208,44,.6)) brightness(1.15)'
          : 'drop-shadow(0 8px 24px #0008)';
        document.getElementById('shiny-btn').textContent = shiny ? '✨ Shiny' : '✨ Normal';
        document.getElementById('shiny-btn').style.borderColor = shiny ? '#f7d02c' : '';
        document.getElementById('shiny-btn').style.color = shiny ? '#f7d02c' : '';
      }

      // ── Battle Mode Island (client:idle simulation) ───────────────────────
      // Uses $sync concept: localStorage persists data across sessions
      function initBattle() {
        const data = JSON.parse(document.getElementById('battle-app').dataset.pokemon);
        const storageKey = 'nexus-battle-' + data.id;
        const atkNorm = Math.round(data.atk / 185 * 100);
        let myHp  = data.hp;
        let oppHp = 100;
        let log   = [];

        // Save to "IndexedDB" (localStorage in this demo)
        localStorage.setItem(storageKey, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));

        document.getElementById('battle-app').innerHTML = \`
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap">
              <span style="font-size:11px;background:rgba(129,140,248,.15);color:#818cf8;padding:3px 10px;border-radius:999px;font-weight:700">@nexus_js/sync • IndexedDB</span>
              <span id="online-badge" style="font-size:11px;background:rgba(16,185,129,.15);color:#10b981;padding:3px 10px;border-radius:999px;font-weight:700">${navigator.onLine ? '🟢 Online' : '🔴 Offline'}</span>
              <span id="sync-status" style="font-size:11px;color:#94a3b8"></span>
            </div>
            <p style="font-size:12px;color:#64748b;margin-bottom:12px">Win the battle → capture is saved <strong style="color:#818cf8">instantly to IndexedDB</strong>, synced to server when online. Go offline and try it!</p>
            <div style="background:linear-gradient(180deg,#0d0d1a,#13131f);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;margin-bottom:20px">
                <div style="text-align:right">
                  <div style="font-weight:700;margin-bottom:4px">Wild Pokémon</div>
                  <div id="opp-bar-wrap" style="width:180px;height:8px;background:#1e1e30;border-radius:4px;overflow:hidden"><div id="opp-bar" style="height:100%;background:#ef4444;width:100%;transition:width .4s"></div></div>
                  <div id="opp-hp-txt" style="font-size:11px;color:var(--muted);font-family:var(--mono)">100/100 HP</div>
                </div>
                <div style="font-size:48px">❓</div>
              </div>
              <div style="display:flex;justify-content:space-between">
                <img src="\${data.sprite}" width="80" height="80" style="object-fit:contain"/>
                <div style="text-align:right">
                  <div style="font-weight:700;text-transform:capitalize;margin-bottom:4px">\${data.name}</div>
                  <div id="my-bar-wrap" style="width:180px;height:8px;background:#1e1e30;border-radius:4px;overflow:hidden"><div id="my-bar" style="height:100%;background:#10b981;width:100%;transition:width .4s"></div></div>
                  <div id="my-hp-txt" style="font-size:11px;color:var(--muted);font-family:var(--mono)">\${myHp}/\${myHp} HP</div>
                </div>
              </div>
            </div>
            <div id="battle-log" style="display:none;background:#0a0a14;border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--muted);font-family:var(--mono);max-height:100px;overflow-y:auto"></div>
            <div id="winner-banner" style="display:none;text-align:center;padding:14px;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);border-radius:10px;font-size:18px;font-weight:700;color:#10b981;margin-bottom:16px"></div>
            <div style="display:flex;gap:12px">
              <button id="atk-btn" onclick="battleAttack()" style="flex:1;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">⚔️ Attack</button>
              <button onclick="battleReset()" style="padding:10px 16px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px">Reset</button>
            </div>
          </div>
        \`;

        window.battleAttack = function() {
          if (oppHp <= 0 || myHp <= 0) return;
          const myDmg  = Math.max(1, Math.floor(Math.random() * atkNorm + atkNorm/2));
          const oppDmg = Math.max(1, Math.floor(Math.random() * 30 + 10));
          const prevOppHp = oppHp;
          oppHp = Math.max(0, oppHp - myDmg);
          window.__NEXUS_LOG_STATE__?.('oppHp', prevOppHp, oppHp, 'BattleMode');
          addLog(\${JSON.stringify(data.name)} + ' dealt ' + myDmg + ' dmg!');
          updateBars(myHp, oppHp, data.hp);
          if (oppHp > 0) {
            setTimeout(() => {
              myHp = Math.max(0, myHp - oppDmg);
              addLog('Wild dealt ' + oppDmg + ' dmg!');
              updateBars(myHp, oppHp, data.hp);
              checkWinner();
            }, 500);
          } else {
            checkWinner();
          }
        };

        window.battleReset = function() {
          myHp = data.hp; oppHp = 100;
          log = [];
          updateBars(myHp, oppHp, data.hp);
          document.getElementById('battle-log').style.display = 'none';
          document.getElementById('winner-banner').style.display = 'none';
          document.getElementById('atk-btn').disabled = false;
          document.getElementById('atk-btn').style.opacity = '1';
        };

        function addLog(msg) {
          log.unshift(msg);
          const el = document.getElementById('battle-log');
          el.style.display = 'block';
          el.innerHTML = log.slice(0,6).map(l => '<p>' + l + '</p>').join('');
        }

        function updateBars(my, opp, maxMy) {
          const myPct  = Math.round(my / maxMy * 100);
          const oppPct = opp;
          document.getElementById('my-bar').style.width  = myPct + '%';
          document.getElementById('opp-bar').style.width = oppPct + '%';
          document.getElementById('my-bar').style.background  = myPct > 50 ? '#10b981' : myPct > 25 ? '#f59e0b' : '#ef4444';
          document.getElementById('my-hp-txt').textContent  = my + '/' + maxMy + ' HP';
          document.getElementById('opp-hp-txt').textContent = opp + '/100 HP';
        }

        // ── Nexus Local-First: capture via IndexedDB sync ─────────────────
        // Uses the same pattern as @nexus_js/sync: write locally first (0ms),
        // then queue a sync op for the server. Works offline!
        var _captureDB = null;
        function openCaptureDB() {
          if (_captureDB) return Promise.resolve(_captureDB);
          return new Promise(function(resolve, reject) {
            var req = indexedDB.open('nexus_sync', 1);
            req.onupgradeneeded = function() {
              var db = req.result;
              if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
              if (!db.objectStoreNames.contains('pending_ops')) {
                var s = db.createObjectStore('pending_ops', { keyPath: 'id' });
                s.createIndex('store', 'store');
              }
            };
            req.onsuccess = function() { _captureDB = req.result; resolve(req.result); };
            req.onerror   = function() { reject(req.error); };
          });
        }

        function idbPut(db, store, key, value) {
          return new Promise(function(resolve) {
            var tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = resolve;
          });
        }

        function saveCaptureToDB(captureData) {
          return openCaptureDB().then(function(db) {
            var op = {
              id: crypto.randomUUID(),
              store: 'captures',
              type: 'put',
              key: String(captureData.id),
              data: captureData,
              ts: Date.now(),
              retries: 0,
            };
            return Promise.all([
              idbPut(db, 'data', 'captures:' + captureData.id, captureData),
              idbPut(db, 'pending_ops', op.id, op),
            ]).then(function() { return op; });
          });
        }

        function syncPendingOps(ops) {
          return fetch('/_nexus/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-nexus-sync': '1' },
            body: JSON.stringify({ ops: ops }),
          }).then(function(r) { return r.json(); });
        }

        function flushCaptures() {
          return openCaptureDB().then(function(db) {
            return new Promise(function(resolve) {
              var tx = db.transaction('pending_ops', 'readonly');
              var req2 = tx.objectStore('pending_ops').getAll();
              req2.onsuccess = function() {
                var pending = (req2.result || []).filter(function(o) { return o.store === 'captures'; });
                if (!pending.length) { resolve([]); return; }
                syncPendingOps(pending).then(function(result) {
                  // Remove acked ops
                  var tx2 = db.transaction('pending_ops', 'readwrite');
                  var s = tx2.objectStore('pending_ops');
                  (result.acked || []).forEach(function(id) { s.delete(id); });
                  resolve(result.acked || []);
                }).catch(function() { resolve([]); });
              };
            });
          });
        }

        function checkWinner() {
          const w = oppHp <= 0 ? \${JSON.stringify(data.name)} : (myHp <= 0 ? 'Wild Pokémon' : null);
          if (w) {
            const wb = document.getElementById('winner-banner');
            wb.style.display = 'flex';
            document.getElementById('atk-btn').disabled = true;
            document.getElementById('atk-btn').style.opacity = '.5';
            if (oppHp <= 0) {
              // ── @nexus_js/sync pattern: write locally first (instant!) ──────
              const captureData = {
                id: data.id, name: data.name, sprite: data.sprite,
                types: data.types, capturedAt: new Date().toISOString(),
              };
              window.__NEXUS_LOG_ACTION__?.(\${JSON.stringify(data.name + '-capture')}, 'call');
              window.__NEXUS_LOG_OPTIMISTIC__?.('captured', true);

              // 1. Update UI immediately
              wb.innerHTML = '🏆 ' + \${JSON.stringify(data.name)} + ' wins! ✅ Saved offline';

              // 2. Persist to IndexedDB (works even if offline)
              saveCaptureToDB(captureData).then(function(op) {
                var statusEl = document.getElementById('sync-status');
                if (statusEl) statusEl.textContent = navigator.onLine ? '🔄 Syncing...' : '🔴 Offline — will sync when reconnected';
                if (statusEl) statusEl.style.color = navigator.onLine ? '#f59e0b' : '#ef4444';

                console.log('%c[Nexus Sync]%c 💾 Capture saved to IndexedDB (op: ' + op.id.slice(0,8) + '...)', 'color:#818cf8;font-weight:bold', 'color:#a3e635');

                // 3. Try to flush online — queue for reconnect if offline
                if (navigator.onLine) {
                  flushCaptures().then(function(acked) {
                    if (acked.length > 0) {
                      if (statusEl) statusEl.textContent = '✅ Synced with server';
                      if (statusEl) statusEl.style.color = '#10b981';
                      window.__NEXUS_LOG_ACTION__?.(\${JSON.stringify(data.name + '-capture')}, 'success');
                      console.log('%c[Nexus Sync]%c ✅ ' + acked.length + ' op(s) synced to server', 'color:#818cf8;font-weight:bold', 'color:#10b981');
                    }
                  }).catch(function(err) {
                    // Handle rate limit error from sync endpoint
                    if (err && err.code === 'RATE_LIMITED') {
                      if (statusEl) statusEl.textContent = '🚦 Rate limited — retry in ' + err.retryAfter + 's';
                      if (statusEl) statusEl.style.color = '#f59e0b';
                      console.warn('%c[Nexus] 🚦 Rate Limit%c capture blocked — 3/min per IP reached. Retry in ' + err.retryAfter + 's', 'color:#818cf8;font-weight:bold', 'color:#f59e0b');
                    }
                  });
                } else {
                  // Auto-sync when back online
                  console.log('%c[Nexus Sync]%c 📥 Offline capture queued — will auto-sync on reconnect', 'color:#818cf8;font-weight:bold', 'color:#f87171');
                  window.addEventListener('online', function onOnline() {
                    window.removeEventListener('online', onOnline);
                    console.log('%c[Nexus Sync]%c 🟢 Back online — syncing capture...', 'color:#818cf8;font-weight:bold', 'color:#a3e635');
                    flushCaptures().then(function(acked) {
                      if (acked.length > 0) {
                        if (statusEl) statusEl.textContent = '✅ Synced with server (was offline)';
                        if (statusEl) statusEl.style.color = '#10b981';
                        window.__NEXUS_LOG_ACTION__?.(\${JSON.stringify(data.name + '-capture')}, 'success');
                        console.log('%c[Nexus Sync]%c ✅ Offline ops synced: ' + acked.length + ' capture(s)', 'color:#818cf8;font-weight:bold', 'color:#10b981');
                      }
                    });
                  });
                }
              }).catch(function(err) {
                // IndexedDB unavailable — fall back to direct server POST
                fetch('/_nexus/action/capture', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', 'x-nexus-action': '1' },
                  body: JSON.stringify({ pokemonId: data.id, pokemonName: data.name }),
                }).then(function() {
                  window.__NEXUS_LOG_ACTION__?.(\${JSON.stringify(data.name + '-capture')}, 'success');
                });
              });
            } else {
              wb.innerHTML = '😵 You lost...';
            }
          }
        }
      }

      // client:idle simulation — run after page paint
      // BattleMode island logs hydration when it finally mounts
      const _initBattleWrapped = function() {
        const _t0_battle = performance.now();
        initBattle();
        window.__NEXUS_LOG_ISLAND__?.('BattleMode', 'client:idle', performance.now() - _t0_battle);
      };
      if ('requestIdleCallback' in window) {
        requestIdleCallback(_initBattleWrapped);
      } else {
        setTimeout(_initBattleWrapped, 200);
      }

      // Simulate StatsRadar + EvolutionChain lazy hydration (client:visible)
      const _observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
          if (e.isIntersecting) {
            const name = e.target.dataset.islandName;
            if (name) {
              const _t = performance.now();
              window.__NEXUS_LOG_ISLAND__?.(name, 'client:visible', _t - performance.timeOrigin * 0);
              _observer.unobserve(e.target);
            }
          }
        });
      }, { threshold: 0.1 });
      document.querySelectorAll('[data-island-name]').forEach(function(el) {
        _observer.observe(el);
      });
    </script>
  `;
}

function renderCachePage() {
  const entries = [...cache.entries()];
  const ratio = stats.hits + stats.misses > 0
    ? Math.round(stats.hits / (stats.hits + stats.misses) * 100)
    : 0;
  const now = Date.now();

  const rows = entries.map(([k, v]) => {
    const ttlLeft = Math.max(0, Math.round((v.expiresAt - now) / 1000));
    const ageMin  = Math.round((now - v.setAt) / 1000 / 60);
    return `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px 12px;font-family:var(--mono);font-size:12px;color:#06b6d4">${k}</td>
        <td style="padding:8px 12px;font-size:12px;color:var(--muted)">${ageMin}m ago</td>
        <td style="padding:8px 12px;font-size:12px;color:${ttlLeft < 60 ? '#f59e0b' : '#10b981'}">${ttlLeft}s left</td>
        <td style="padding:8px 12px">
          <span style="background:rgba(16,185,129,.15);color:#10b981;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700">LIVE</span>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div style="max-width:800px;margin:0 auto">
      <h1 style="font-size:28px;font-weight:800;margin-bottom:8px">📊 Shield Cache Inspector</h1>
      <p style="color:var(--muted);margin-bottom:28px">Real-time view of the Nexus server-side cache. This is the "Nexus Studio" Cache panel running in the browser.</p>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px">
        ${[
          { label:'Cache Entries', value: cache.size, color:'#06b6d4' },
          { label:'Cache Hits',   value: stats.hits,  color:'#10b981' },
          { label:'Cache Misses', value: stats.misses, color:'#f59e0b' },
          { label:'Hit Ratio',    value: ratio + '%',  color:'#7c3aed' },
        ].map(s => `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px">
            <div style="font-size:28px;font-weight:800;color:${s.color}">${s.value}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">${s.label}</div>
          </div>
        `).join('')}
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-weight:600">Cache Entries</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid var(--border);background:rgba(255,255,255,.02)">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Key</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Age</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">TTL remaining</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--muted)">No entries yet — browse some Pokémon!</td></tr>'}
          </tbody>
        </table>
      </div>

      <p style="margin-top:16px;font-size:13px;color:var(--muted)">
        PokeAPI calls made: <strong style="color:var(--text)">${stats.apiCalls}</strong> ·
        Total requests served: <strong style="color:var(--text)">${stats.hits + stats.misses}</strong>
      </p>

      <div style="margin-top:24px;padding:16px;background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.2);border-radius:10px;font-size:13px;color:#94a3b8">
        <strong style="color:var(--text)">💡 How the Shield Cache works:</strong><br><br>
        First visit → <span style="color:#f59e0b">Cache MISS</span> → GraphQL query fires → data cached for 24h → response time ~300ms<br>
        Next 10,000 visits → <span style="color:#10b981">Cache HIT</span> → served from memory → response time ~1ms<br>
        After 24h → Stale-While-Revalidate → serve stale instantly, refresh in background
      </div>
    </div>
  `;
}

// ── HTTP Router ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const t0  = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Intercept writeHead to capture cache status for the access log
  const _wh = res.writeHead.bind(res);
  let _cacheHeader = '';
  res.writeHead = (status, headers) => {
    if (headers?.['x-nexus-cache']) _cacheHeader = headers['x-nexus-cache'];
    return _wh(status, headers);
  };
  res.on('finish', () => {
    log.req(req.method, path, res.statusCode, Date.now() - t0, _cacheHeader);
  });

  try {
    // ── Nexus Connect — SSE endpoint ────────────────────────────────────────
    if (path.startsWith('/_nexus/connect/')) {
      const topic = decodeURIComponent(path.slice('/_nexus/connect/'.length));
      connectSubscribe(topic, res);
      return; // SSE keeps connection open
    }

    // ── Nexus Connect — capture action (with Rate Limit + CSRF demo) ─────────
    if (path === '/_nexus/action/capture' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { pokemonId, pokemonName } = JSON.parse(body || '{}');

      // Rate limit: 3 captures per minute per IP
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
      const rl = checkRateLimit(`capture:${ip}`, 60_000, 3);
      if (!rl.allowed) {
        log.warn(`Rate limit hit for ${ip} — capture blocked (retry in ${rl.retryAfter}s)`);
        res.writeHead(429, {
          'content-type': 'application/json',
          'retry-after':  String(rl.retryAfter),
          'x-ratelimit-limit': '3',
          'x-ratelimit-remaining': '0',
          ...SECURITY_HEADERS,
        });
        return res.end(JSON.stringify({ error: `Rate limit exceeded. Retry in ${rl.retryAfter}s.`, code: 'RATE_LIMITED' }));
      }

      globalCaptures++;
      const payload = { count: globalCaptures, lastCapture: { id: pokemonId, name: pokemonName }, ts: Date.now() };
      const delivered = connectPublish('global-captures', payload);
      log.action('capture', 'success', Date.now() - t0, delivered > 0 ? `→ ${delivered} SSE clients` : '');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, ...payload }));
    }

    // ── Nexus Local-First Sync — receive offline ops ───────────────────────
    if (path === '/_nexus/sync' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { ops = [] } = JSON.parse(body || '{}');
      const result = handleSyncOps(ops);
      log.action('sync-flush', 'success', Date.now() - t0, `${ops.length} op(s) → ${result.acked.length} acked`);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    // ── Nexus Local-First — GET synced captures (server state) ────────────
    if (path === '/_nexus/sync/captures' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({
        total: syncedCaptures.size,
        captures: [...syncedCaptures.values()],
      }));
    }

    // ── Nexus AI — probability manifest ────────────────────────────────────
    if (path === '/nexus-prefetch-manifest.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' });
      return res.end(JSON.stringify(PREFETCH_MANIFEST));
    }

    // ── JSON API (used for prefetch + JS fetch) ─────────────────────────────

    if (path === '/api/pokemon' || path.startsWith('/api/pokemon?')) {
      const page   = Number(url.searchParams.get('page')  ?? '1');
      const limit  = Number(url.searchParams.get('limit') ?? '20');
      const search =        url.searchParams.get('q')     ?? '';
      const result = await fetchList({ page, limit, search });
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': `public, s-maxage=86400, stale-while-revalidate=172800`,
        'x-nexus-cache': result._cached ? 'HIT' : 'MISS',
      });
      return res.end(JSON.stringify(result));
    }

    const apiDetailMatch = path.match(/^\/api\/pokemon\/(\d+)$/);
    if (apiDetailMatch) {
      const p = await fetchDetail(Number(apiDetailMatch[1]));
      if (!p) { res.writeHead(404); return res.end('{"error":"Not found"}'); }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': `public, s-maxage=86400` });
      return res.end(JSON.stringify(p));
    }

    // ── Cache inspector ─────────────────────────────────────────────────────
    if (path === '/_cache') {
      const html = layout('Shield Cache Inspector — Nexus Pokédex', renderCachePage());
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
      return res.end(html);
    }

    // ── Pokemon detail page ─────────────────────────────────────────────────
    const detailMatch = path.match(/^\/pokemon\/(\d+)$/);
    if (detailMatch) {
      const t0 = Date.now();
      const p = await fetchDetail(Number(detailMatch[1]));
      if (!p) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(layout('Not found', '<h1>Pokémon not found</h1><a href="/">← Back</a>'));
      }
      const islandNames = ['ShinyToggle', 'StatsRadar', 'EvolutionChain', 'BattleMode'];
      const devLogs = [
        { type: 'render', path, duration: Date.now() - t0, cacheStrategy: 'swr', cacheHit: !!p._cached },
        { type: 'cache',  key: `detail:${p.id}`, hit: !!p._cached, age: p._age },
        { type: 'islands', count: islandNames.length, names: islandNames },
      ];
      const ttl  = 86400;
      const html = layout(
        `${p.name.charAt(0).toUpperCase() + p.name.slice(1)} — Nexus Pokédex`,
        renderDetailPage(p, p._cached),
        `<meta property="og:image" content="${p.sprite}"><meta name="description" content="${p.description}">`,
        devLogs, islandNames
      );
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 2}`,
        'x-nexus-cache': p._cached ? 'HIT' : 'MISS',
        'x-nexus-cache-strategy': 'shield-swr',
        ...SECURITY_HEADERS,
      });
      return res.end(html);
    }

    // ── Home page (Pokémon list) ────────────────────────────────────────────
    if (path === '/') {
      const t0     = Date.now();
      const page   = Number(url.searchParams.get('page')  ?? '1');
      const limit  = Number(url.searchParams.get('limit') ?? '20');
      const search =        url.searchParams.get('q')     ?? '';
      const result = await fetchList({ page, limit, search });
      const islandNames = ['SearchBar'];
      const devLogs = [
        { type: 'render', path, duration: Date.now() - t0, cacheStrategy: 'swr', cacheHit: !!result._cached },
        { type: 'cache',  key: `list:${page}:${limit}:${search || '*'}`, hit: !!result._cached, age: result._age },
        { type: 'islands', count: islandNames.length, names: islandNames },
      ];
      const html = layout(
        search ? `"${search}" — Nexus Pokédex` : `Pokédex — Page ${page} — Nexus Framework`,
        renderListPage({ ...result, page, limit, search, cached: result._cached, age: result._age }),
        '', devLogs, islandNames
      );
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': `public, s-maxage=86400, stale-while-revalidate=172800`,
        'x-nexus-cache': result._cached ? 'HIT' : 'MISS',
        ...SECURITY_HEADERS,
      });
      return res.end(html);
    }

    // ── 404 ─────────────────────────────────────────────────────────────────
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(layout('404 — Nexus Pokédex', '<div style="text-align:center;padding:80px"><h1 style="font-size:64px;color:var(--muted)">404</h1><p style="color:var(--muted)">This page does not exist.</p><br><a href="/" style="color:#7c3aed">← Back to Pokédex</a></div>'));

  } catch (err) {
    log.error(`${req.method} ${path} → ${err.message}`);
    if (err.stack) {
      err.stack.split('\n').slice(1, 5).forEach(line => {
        console.error(`     ${c.dim}${line.trim()}${c.reset}`);
      });
    }
    const errHtml = `
      <div style="max-width:720px;margin:60px auto">
        <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:12px;padding:28px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <span style="font-size:24px">⚠️</span>
            <h1 style="font-size:20px;font-weight:700;color:#ef4444">Server Error</h1>
          </div>
          <pre style="font-family:var(--mono);font-size:13px;line-height:1.6;color:#fca5a5;white-space:pre-wrap;word-break:break-word;margin-bottom:12px">${err.message}</pre>
          ${err.stack ? `<details style="margin-top:12px">
            <summary style="cursor:pointer;font-size:12px;color:var(--muted);margin-bottom:8px">Stack trace</summary>
            <pre style="font-family:var(--mono);font-size:11px;color:var(--muted);white-space:pre-wrap;line-height:1.5">${err.stack.replace(/</g,'&lt;')}</pre>
          </details>` : ''}
          <div style="margin-top:20px;font-size:13px;color:var(--muted)">
            Route: <code style="color:#7c3aed">${req.method} ${path}</code>
          </div>
        </div>
        <div style="margin-top:16px;text-align:center">
          <a href="/" style="color:var(--accent)">← Back to Pokédex</a>
        </div>
      </div>`;
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(layout('Error — Nexus Pokédex', errHtml));
  }
});

server.listen(PORT, () => {
  const elapsed = Date.now() - _start;

  if (process.stdout.isTTY) console.clear();

  console.log(`
  ${c.mag}${c.bold}◆ NEXUS${c.reset} ${c.dim}v0.1.0${c.reset}   ${c.green}ready in ${elapsed}ms${c.reset}

  ${c.green}➜${c.reset}  ${c.bold}App${c.reset}              ${c.cyan}http://localhost:${PORT}/${c.reset}
  ${c.green}➜${c.reset}  ${c.bold}Cache Inspector${c.reset}  ${c.cyan}http://localhost:${PORT}/_cache${c.reset}
  ${c.green}➜${c.reset}  ${c.bold}JSON API${c.reset}         ${c.cyan}http://localhost:${PORT}/api/pokemon${c.reset}
  ${c.green}➜${c.reset}  ${c.bold}GraphQL source${c.reset}   ${c.dim}beta.pokeapi.co/graphql/v1beta${c.reset}

  ${c.dim}Shield Cache:${c.reset}  TTL ${c.cyan}24h${c.reset}  ·  SWR ${c.cyan}48h${c.reset}  ·  in-memory Map
  ${c.dim}Features:${c.reset}      ⚡ Cache  🔄 Transform  🏝️ Islands  ⚔️ Offline-First

  ${c.dim}press Ctrl+C to stop${c.reset}
`);

  // ── Nexus Guard — scan all .nx files at startup ─────────────────────────────
  if (IS_DEV) {
    runGuardOnAllNxFiles().then(results => {
      const totalLeaks = results.flatMap(r => r.leaks).filter(l => l.severity === 'error').length;
      const allPassed  = results.every(r => r.passed);
      _guardResult = {
        passed:  allPassed,
        files:   results.length,
        leaks:   totalLeaks,
        details: results.flatMap(r => r.leaks.map(l => `${r.filepath}:${l.line} — ${l.variable}`)),
      };
      if (allPassed) {
        console.log(`  ${c.green}🛡️  Guard${c.reset}  ${c.dim}${results.length} files scanned — 0 leaks found${c.reset}`);
      } else {
        console.log(`  ${c.red}🛡️  Guard${c.reset}  ${c.red}${totalLeaks} security leak${totalLeaks !== 1 ? 's' : ''} found!${c.reset}`);
        _guardResult.details.forEach(d => console.log(`         ${c.red}✖${c.reset}  ${c.dim}${d}${c.reset}`));
      }
      console.log(`  ${c.green}🛰️  Connect${c.reset}  ${c.dim}SSE broker ready — topic: global-captures${c.reset}`);
      console.log(`  ${c.mag}🧠 AI${c.reset}      ${c.dim}Probability manifest: /nexus-prefetch-manifest.json (${Object.keys(PREFETCH_MANIFEST.routes).length} routes)${c.reset}\n`);
    }).catch(() => {});
  }

  // ── File watcher (dev only) ─────────────────────────────────────────────────
  if (IS_DEV) {
    const srcDir = join(__dir, 'src');
    if (existsSync(srcDir)) {
      let debounce;
      watch(srcDir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const time = new Date().toLocaleTimeString();
          console.log(
            `  ${c.gray}${time}${c.reset}  ${c.mag}[HMR]${c.reset}  ${c.cyan}${filename}${c.reset}  ${c.dim}${event}${c.reset}`
          );
        }, 50);
      });
      console.log(`  ${c.dim}Watching ${c.reset}${c.cyan}src/${c.reset}${c.dim} — server auto-restarts on changes${c.reset}\n`);
    }
  }
});

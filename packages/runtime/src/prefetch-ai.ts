/**
 * Nexus AI Prefetch — Network-Aware Predictive Prefetching.
 *
 * Philosophy: "Spend better, not more."
 *
 * Pipeline:
 *   1. Network check (Network Information API)
 *      → Save-Data ON  → kill switch, log reason, exit
 *      → effectiveType 2g/3g → skip, log reason, exit
 *      → budget exhausted → skip, log reason
 *   2. Read server probability manifest (/nexus-prefetch-manifest.json)
 *      → Cached in sessionStorage, refreshed every 5min
 *   3. Look up predictions for current route
 *      → Only prefetch if probability ≥ threshold (default 0.85)
 *   4. Inject <link rel="prefetch"> for HTML only (Zero-JS prefetch)
 *      → Island JS is NOT prefetched until hover/focus
 *   5. Track session budget — stop when exceeded
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type PrefetchMode = 'aggressive' | 'smart' | 'conservative' | 'off';

export interface AIPrefetchConfig {
  /** Prefetch strategy (default: 'smart') */
  mode:            PrefetchMode;
  /** Confidence threshold 0–1 to trigger prefetch (default: 0.85) */
  threshold:       number;
  /** Max bytes to prefetch per browser session (default: 500KB) */
  budget:          number;
  /** Only prefetch on WiFi or 4G (default: true) */
  wifiOnly:        boolean;
  /** Respect navigator.connection.saveData (default: true) */
  respectSaveData: boolean;
  /** URL of the server-generated probability manifest */
  manifestUrl:     string;
}

export interface PrefetchPrediction {
  to:          string;
  probability: number;
  /** Estimated bytes of the prefetched resource */
  estimatedBytes?: number;
}

export interface PrefetchManifest {
  generated:   number;
  routes:      Record<string, PrefetchPrediction[]>;
  version:     string;
}

export interface PrefetchDecision {
  willPrefetch: boolean;
  reason:       SkipReason | null;
  predictions:  PrefetchPrediction[];
  prefetched:   string[];
}

export type SkipReason =
  | 'mode-off'
  | 'save-data'
  | 'slow-connection'
  | 'budget-exhausted'
  | 'no-predictions'
  | 'low-confidence'
  | 'already-prefetched';

// ── Network Information API types ─────────────────────────────────────────────
interface NetworkInformation {
  saveData?:      boolean;
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  downlink?:      number; // Mbps
  rtt?:           number; // ms
}

interface NexusNavigator extends Navigator {
  connection?:            NetworkInformation;
  mozConnection?:         NetworkInformation;
  webkitConnection?:      NetworkInformation;
}

// ── Internal state ─────────────────────────────────────────────────────────────

const SESSION_KEY_BUDGET    = '__nexus_prefetch_budget__';
const SESSION_KEY_PREFETCHED = '__nexus_prefetched__';
const SESSION_KEY_MANIFEST  = '__nexus_manifest__';
const MANIFEST_TTL_MS       = 5 * 60 * 1000; // 5 minutes

const DEFAULT_CONFIG: AIPrefetchConfig = {
  mode:            'smart',
  threshold:       0.85,
  budget:          500 * 1024, // 500KB
  wifiOnly:        true,
  respectSaveData: true,
  manifestUrl:     '/nexus-prefetch-manifest.json',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getConnection(): NetworkInformation | null {
  const nav = navigator as NexusNavigator;
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

function getEffectiveType(): string {
  return getConnection()?.effectiveType ?? 'unknown';
}

function isSaveDataEnabled(): boolean {
  return getConnection()?.saveData === true;
}

function isConnectionFast(wifiOnly: boolean): boolean {
  const type = getEffectiveType();
  if (type === '4g') return true;
  if (type === '3g' && !wifiOnly) return true;
  if (type === '2g' || type === 'slow-2g') return false;
  // Unknown — assume ok (desktop, no Network API)
  return true;
}

function getBudgetUsed(): number {
  return parseInt(sessionStorage.getItem(SESSION_KEY_BUDGET) ?? '0', 10);
}

function addBudgetUsed(bytes: number): void {
  sessionStorage.setItem(SESSION_KEY_BUDGET, String(getBudgetUsed() + bytes));
}

function getPrefetched(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SESSION_KEY_PREFETCHED) ?? '[]') as string[]);
  } catch { return new Set(); }
}

function markPrefetched(url: string): void {
  const set = getPrefetched();
  set.add(url);
  sessionStorage.setItem(SESSION_KEY_PREFETCHED, JSON.stringify([...set]));
}

function devLog(msg: string, data?: unknown): void {
  if (typeof window === 'undefined') return;
  const isDev = (window as unknown as Record<string, unknown>)['__NEXUS_DEV__'];
  if (!isDev) return;
  const args: unknown[] = [
    `%c[Nexus] 🧠 AI%c ${msg}`,
    'color:#7c3aed;font-weight:700',
    'color:#64748b',
  ];
  if (data !== undefined) args.push(data);
  console.log(...args);
}

// ── Manifest fetching ─────────────────────────────────────────────────────────

async function fetchManifest(url: string): Promise<PrefetchManifest | null> {
  try {
    const cached = sessionStorage.getItem(SESSION_KEY_MANIFEST);
    if (cached) {
      const parsed = JSON.parse(cached) as PrefetchManifest & { _cachedAt: number };
      if (Date.now() - parsed._cachedAt < MANIFEST_TTL_MS) return parsed;
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(url, { priority: 'low' } as RequestInit);
    if (!res.ok) return null;
    const manifest = await res.json() as PrefetchManifest;
    sessionStorage.setItem(SESSION_KEY_MANIFEST, JSON.stringify({ ...manifest, _cachedAt: Date.now() }));
    return manifest;
  } catch { return null; }
}

// ── Zero-JS HTML prefetch ─────────────────────────────────────────────────────

function injectPrefetchLink(href: string): void {
  if (document.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel  = 'prefetch';
  link.href = href;
  link.as   = 'document';
  document.head.appendChild(link);
}

// ── Main logic ────────────────────────────────────────────────────────────────

/**
 * Run the AI prefetch engine for the current route.
 * Call this after each navigation or on page load.
 *
 * @param currentPath - Current route pathname
 * @param config      - Optional config overrides (merged with defaults)
 * @returns PrefetchDecision — what was prefetched and why (or why not)
 */
export async function runAIPrefetch(
  currentPath: string,
  config: Partial<AIPrefetchConfig> = {},
): Promise<PrefetchDecision> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const noop = (reason: SkipReason): PrefetchDecision => ({
    willPrefetch: false, reason, predictions: [], prefetched: [],
  });

  if (typeof window === 'undefined') return noop('mode-off');
  if (cfg.mode === 'off') { devLog('Prefetch disabled (mode: off)'); return noop('mode-off'); }

  // ── Network checks ──────────────────────────────────────────────────────────
  if (cfg.respectSaveData && isSaveDataEnabled()) {
    devLog('🚫 Save-Data mode detected — prefetch disabled. Saved ~0MB (by policy).');
    return noop('save-data');
  }

  if (cfg.wifiOnly && !isConnectionFast(true)) {
    const type = getEffectiveType();
    devLog(`🚫 Slow connection (${type}) — prefetch skipped. Your data is safe.`);
    return noop('slow-connection');
  }

  if (!isConnectionFast(cfg.wifiOnly)) {
    devLog(`⚠️  Connection is ${getEffectiveType()} — conservative mode activated.`);
  }

  // ── Budget check ────────────────────────────────────────────────────────────
  const budgetUsed = getBudgetUsed();
  if (budgetUsed >= cfg.budget) {
    const usedKB  = (budgetUsed / 1024).toFixed(0);
    const maxKB   = (cfg.budget / 1024).toFixed(0);
    devLog(`🚫 Session budget exhausted (${usedKB}KB / ${maxKB}KB) — no more prefetches.`);
    return noop('budget-exhausted');
  }

  // ── Load manifest ───────────────────────────────────────────────────────────
  const manifest = await fetchManifest(cfg.manifestUrl);
  if (!manifest) { devLog('ℹ️  No probability manifest found — skipping AI prefetch.'); return noop('no-predictions'); }

  const predictions = (manifest.routes[currentPath] ?? [])
    .filter((p) => p.probability >= cfg.threshold)
    .sort((a, b) => b.probability - a.probability);

  if (predictions.length === 0) {
    devLog(`ℹ️  No high-confidence predictions for "${currentPath}".`);
    return noop(manifest.routes[currentPath] ? 'low-confidence' : 'no-predictions');
  }

  // ── Prefetch ────────────────────────────────────────────────────────────────
  const prefetched: string[] = [];
  const alreadyPrefetched   = getPrefetched();

  for (const pred of predictions) {
    if (alreadyPrefetched.has(pred.to)) continue;

    const estBytes = pred.estimatedBytes ?? 8_000; // ~8KB default for a Nexus HTML page
    if (getBudgetUsed() + estBytes > cfg.budget) {
      devLog(`🛑 Budget would be exceeded by prefetching "${pred.to}" — stopping.`);
      break;
    }

    injectPrefetchLink(pred.to);
    markPrefetched(pred.to);
    addBudgetUsed(estBytes);

    const pct     = Math.round(pred.probability * 100);
    const estKB   = (estBytes / 1024).toFixed(1);
    devLog(`✅ Predicting next hop → ${pred.to} (${pct}% confidence) — prefetched ${estKB}KB HTML-only.`);
    prefetched.push(pred.to);
  }

  const totalBudgetUsed = getBudgetUsed();
  const remaining       = cfg.budget - totalBudgetUsed;
  devLog(`💾 Session budget: ${(totalBudgetUsed / 1024).toFixed(0)}KB used / ${(cfg.budget / 1024).toFixed(0)}KB max — ${(remaining / 1024).toFixed(0)}KB remaining.`);

  return { willPrefetch: prefetched.length > 0, reason: null, predictions, prefetched };
}

// ── Markov-chain recorder (client-side training) ──────────────────────────────

const MARKOV_KEY = '__nexus_markov__';

type MarkovChain = Record<string, Record<string, number>>;

function loadMarkov(): MarkovChain {
  try { return JSON.parse(sessionStorage.getItem(MARKOV_KEY) ?? '{}') as MarkovChain; }
  catch { return {}; }
}

function saveMarkov(chain: MarkovChain): void {
  try { sessionStorage.setItem(MARKOV_KEY, JSON.stringify(chain)); } catch { /* quota */ }
}

/**
 * Record a navigation transition for the client-side Markov chain.
 * Call this on every route change: recordNavigation('/pokemon/25', '/pokemon/26').
 */
export function recordNavigation(from: string, to: string): void {
  if (typeof window === 'undefined') return;
  const chain = loadMarkov();
  if (!chain[from]) chain[from] = {};
  chain[from][to] = (chain[from][to] ?? 0) + 1;
  saveMarkov(chain);
}

/**
 * Build an in-browser probability manifest from observed navigation patterns.
 * Useful for apps that can't generate a server-side manifest.
 */
export function buildClientManifest(minConfidence = 0.5): PrefetchManifest {
  const chain   = loadMarkov();
  const routes: Record<string, PrefetchPrediction[]> = {};

  for (const [from, targets] of Object.entries(chain)) {
    const total = Object.values(targets).reduce((a, b) => a + b, 0);
    routes[from] = Object.entries(targets)
      .map(([to, count]) => ({ to, probability: count / total }))
      .filter((p) => p.probability >= minConfidence)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 3); // top 3 predictions per route
  }

  return { generated: Date.now(), routes, version: 'client-1.0' };
}

// ── nexus.config.ts integration helper ───────────────────────────────────────

/**
 * Creates a configured AI prefetch runner — use this in your nexus.config.ts.
 *
 * @example
 * // nexus.config.ts
 * import { defineAIPrefetch } from '@nexus/runtime/prefetch-ai';
 * export default defineNexusConfig({
 *   ai: defineAIPrefetch({
 *     mode: 'smart',
 *     budget: '500kb',
 *     wifiOnly: true,
 *   })
 * });
 */
export function defineAIPrefetch(config: Partial<AIPrefetchConfig> & { budget?: string | number } = {}): AIPrefetchConfig {
  const budget = typeof config.budget === 'string'
    ? parseBudget(config.budget)
    : (config.budget ?? DEFAULT_CONFIG.budget);

  return { ...DEFAULT_CONFIG, ...config, budget };
}

function parseBudget(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(kb|mb|b)?$/i.exec(s.trim());
  if (!m) return DEFAULT_CONFIG.budget;
  const n = parseFloat(m[1] ?? '0');
  switch (m[2]?.toLowerCase()) {
    case 'mb': return n * 1024 * 1024;
    case 'b':  return n;
    default:   return n * 1024; // kb
  }
}

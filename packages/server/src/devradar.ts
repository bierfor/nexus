/**
 * Nexus DevRadar — introspection sink for the Studio WebSocket (dev only).
 *
 * The CLI registers a sink (`registerDevRadarSink`) that forwards to `broadcast()`.
 * When no sink is registered, all emits are no-ops (production / `nexus start`).
 */

import { randomUUID } from 'node:crypto';

/** v1 wire protocol — keep in sync with `packages/cli/src/studio.ts` `StudioEvent` (incl. security:report). */
export type DevRadarEvent =
  | { type: 'action:call'; payload: ActionCallPayload }
  | { type: 'action:result'; payload: ActionResultPayload }
  | { type: 'action:error'; payload: ActionErrorPayload }
  | { type: 'devtools:pretext'; payload: PretextProfilePayload }
  | { type: 'security:audit'; payload: SecurityAuditPayload }
  | { type: 'security:report'; payload: SecurityReportPayload }
  | { type: 'rune:telemetry'; payload: RuneTelemetryPayload }
  | { type: 'brain:completion'; payload: BrainCompletionPayload };

export interface ActionCallPayload {
  id: string;
  name: string;
  islandId?: string;
  input: unknown;
  timestamp: number;
  idempotencyKey?: string;
}

export interface ActionResultPayload {
  id: string;
  name: string;
  output: unknown;
  duration: number;
  cached: boolean;
}

export interface ActionErrorPayload {
  id: string;
  name: string;
  error: string;
  code?: string;
  duration: number;
}

export interface PretextProfilePayload {
  /** Route pattern, e.g. `/news/[slug]` */
  pattern: string;
  durationMs: number;
  /** Layout + page modules that ran nxPretext in parallel */
  parallelCount: number;
}

export interface SecurityAuditPayload {
  kind: 'csrf_blocked' | 'rate_limited' | 'replay' | 'ghost_wall' | 'custom';
  message: string;
  action?: string;
}

/** Studio "Security Report" checklist (snapshot when `nexus dev` connects DevRadar). */
export interface SecurityReportCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'info';
}

export interface SecurityReportPayload {
  hardened: boolean;
  checks: SecurityReportCheck[];
}

/** Placeholder for client-originated rune stats (future: bridge from runtime). */
export interface RuneTelemetryPayload {
  runeId: string;
  updatesPerSecond: number;
  label?: string;
}

/** @nexus_js/brain — LLM completion telemetry (Studio / DevRadar). No raw prompts in payload. */
export interface BrainCompletionPayload {
  id: string;
  provider: 'openai' | 'groq';
  model: string;
  durationMs: number;
  cached: boolean;
  ok: boolean;
  /** Truncated prompt preview (sanitized). */
  promptPreview?: string;
  promptChars: number;
  contextChars: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  error?: string;
}

let sink: ((event: DevRadarEvent) => void) | null = null;

/** Register the Studio broadcast function (called once from `nexus dev`). */
export function registerDevRadarSink(fn: (event: DevRadarEvent) => void): () => void {
  sink = fn;
  return () => {
    sink = null;
  };
}

export function emitDevRadar(event: DevRadarEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    /* ignore dashboard errors */
  }
}

const SECRET_KEY = /secret|password|token|authorization|cookie|apikey|api_key|bearer|private_key/i;

/** Deep-clone-ish sanitizer for telemetry (arguments / results). */
export function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max depth]';
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') {
    const s = value as string;
    return s.length > 512 ? `${s.slice(0, 512)}…` : s;
  }
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return `${value}n`;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const cap = value.slice(0, 64);
    return cap.map((v) => sanitizeTelemetryValue(v, depth + 1));
  }
  if (t === 'object') {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(o)) {
      if (n++ > 64) {
        out['…'] = `${Object.keys(o).length - 64} more keys`;
        break;
      }
      if (SECRET_KEY.test(k)) out[k] = '[redacted]';
      else out[k] = sanitizeTelemetryValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function newTraceId(): string {
  return randomUUID();
}

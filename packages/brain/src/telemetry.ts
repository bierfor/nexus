/**
 * Emits sanitized Brain telemetry to DevRadar → Nexus Studio (when `nexus dev` registered the sink).
 */

import {
  emitDevRadar,
  sanitizeTelemetryValue,
  newTraceId,
  type BrainCompletionPayload,
} from '@nexus_js/server/devradar';

export function emitBrainTelemetry(payload: Omit<BrainCompletionPayload, 'id'> & { id?: string }): void {
  const id = payload.id ?? newTraceId();
  const promptPreview =
    payload.promptPreview !== undefined
      ? String(sanitizeTelemetryValue(payload.promptPreview))
      : undefined;

  const full: BrainCompletionPayload = {
    id,
    provider:     payload.provider,
    model:        payload.model,
    durationMs:     payload.durationMs,
    cached:       payload.cached,
    ok:           payload.ok,
    promptChars:  payload.promptChars,
    contextChars: payload.contextChars,
    ...(promptPreview !== undefined ? { promptPreview } : {}),
    ...(payload.usage !== undefined ? { usage: payload.usage } : {}),
    ...(payload.error !== undefined ? { error: payload.error } : {}),
  };

  emitDevRadar({ type: 'brain:completion', payload: full });
}

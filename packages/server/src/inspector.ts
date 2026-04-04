/**
 * Nexus Inspector — public entry for DevRadar / future middleware taps.
 *
 * Server Actions and the SSR pipeline call into `devradar.ts`; apps should not
 * import this in production code unless building dev-only tooling.
 */

export {
  emitDevRadar,
  registerDevRadarSink,
  sanitizeTelemetryValue,
  newTraceId,
} from './devradar.js';

export type {
  DevRadarEvent,
  ActionCallPayload,
  ActionResultPayload,
  ActionErrorPayload,
  PretextProfilePayload,
  SecurityAuditPayload,
  RuneTelemetryPayload,
} from './devradar.js';

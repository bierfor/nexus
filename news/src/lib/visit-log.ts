/**
 * In-memory visit log + Nexus Connect topic `pf-visits` for live analytics.
 * One Node process only; replace with Redis in multi-instance deployments.
 */

import { randomUUID } from 'node:crypto';
import { getChannel } from '@nexus_js/connect';

export type VisitEvent = {
  id: string;
  ts: number;
  path: string;
  referrer: string;
  host: string;
  ua: string;
  ip: string;
};

/** Same shape but SSE subscribers must not receive client IPs. */
export type VisitEventPublic = Omit<VisitEvent, 'ip'>;

const MAX = 2500;
const buffer: VisitEvent[] = [];

export function appendVisit(ev: Omit<VisitEvent, 'id'>): VisitEvent {
  const id = randomUUID();
  const row: VisitEvent = { ...ev, id };
  buffer.unshift(row);
  if (buffer.length > MAX) buffer.length = MAX;
  const { ip: _ip, ...rest } = row;
  getChannel<VisitEventPublic>('pf-visits').publish(rest);
  return row;
}

export function getRecentVisits(limit = 500): VisitEvent[] {
  return buffer.slice(0, Math.min(limit, buffer.length));
}

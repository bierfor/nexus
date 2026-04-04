const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 12;

const hitsByIp = new Map<string, number[]>();

function prune(now: number, times: number[]): number[] {
  const start = now - WINDOW_MS;
  return times.filter((t) => t > start);
}

/** Devuelve true si el intento está permitido; false si hay que rechazar (429). */
export function recordLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const prev = prune(now, hitsByIp.get(ip) ?? []);
  if (prev.length >= MAX_ATTEMPTS) {
    hitsByIp.set(ip, prev);
    return false;
  }
  prev.push(now);
  hitsByIp.set(ip, prev);
  return true;
}

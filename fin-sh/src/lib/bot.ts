/** Heuristic bot / preview UA — matches API `isLikelyBot` for SSR routing. */
export function isLikelyBotFromRequest(request: Request): boolean {
  const ua =
    request.headers.get('x-finsh-ua') ?? request.headers.get('user-agent') ?? '';
  return /bot|crawl|spider|preview|slack|twitter|facebook|linkedin|whatsapp/i.test(ua);
}

export function viewerRegionFromRequest(request: Request): string {
  const cf = request.headers.get('cf-ipcountry') ?? request.headers.get('x-vercel-ip-country');
  const c = (cf ?? 'US').trim().toUpperCase();
  return c.length === 2 ? c : 'US';
}

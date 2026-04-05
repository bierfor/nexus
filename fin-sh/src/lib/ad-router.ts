/**
 * Ad-router stub — swap for GeoIP + DB creatives (Nexus PayLinks scale path).
 */

const US_HIGH_CPM = 'Upgrade to Premium — remove ads and unlock dynamic QR.';
const LATAM_LOCAL = 'Patrocinado · Herramientas para creadores en tu región.';
const DEFAULT_COPY = 'Fin.sh Pro — analytics, API, white-label.';

export function adCopyForRegion(region: string): string {
  const r = region.toUpperCase();
  if (r === 'US' || r === 'CA' || r === 'GB') return US_HIGH_CPM;
  if (
    ['MX', 'AR', 'CO', 'CL', 'PE', 'BR', 'ES'].includes(r) ||
    r.startsWith('LATAM')
  ) {
    return LATAM_LOCAL;
  }
  return DEFAULT_COPY;
}

/** Best-effort country from edge headers (Vercel / Cloudflare style). */
export function regionFromRequest(request: Request): string {
  return (
    request.headers.get('cf-ipcountry') ??
    request.headers.get('x-vercel-ip-country') ??
    request.headers.get('x-appengine-country') ??
    'US'
  );
}

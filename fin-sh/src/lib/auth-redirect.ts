/**
 * Prevent open redirects after sign-in: only same-origin relative paths are allowed.
 */
export function safeAuthRedirectPath(raw: string | null | undefined): string {
  const p = String(raw ?? '/dashboard').trim();
  if (!p.startsWith('/') || p.startsWith('//')) return '/dashboard';
  if (p.includes('\\')) return '/dashboard';
  if (/[\u0000-\u001f\u007f]/.test(p)) return '/dashboard';
  return p.length > 512 ? '/dashboard' : p;
}

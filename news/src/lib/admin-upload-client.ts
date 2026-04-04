/**
 * Cliente (islas admin): sube un archivo al API `POST /media/upload` con el JWT de sesión.
 * No incluye secretos de servidor — el token sale de la cookie (mismo nombre que `admin-auth`).
 */
const ADMIN_COOKIE = 'pf_admin_token';

export function readAdminSessionTokenFromDocument(): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = ADMIN_COOKIE + '=';
  const parts = document.cookie.split(';');
  for (const p of parts) {
    const s = p.trim();
    if (s.startsWith(prefix)) {
      try {
        return decodeURIComponent(s.slice(prefix.length));
      } catch {
        return s.slice(prefix.length);
      }
    }
  }
  return null;
}

export async function uploadImageToMediaApi(
  file: File,
  uploadUrl: string,
  bearerToken: string,
): Promise<{ url: string; publicId?: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }
  try {
    return JSON.parse(text) as { url: string; publicId?: string };
  } catch {
    throw new Error(text || 'Invalid JSON from upload');
  }
}

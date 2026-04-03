/**
 * Nexus Request Context — passed to every page, layout and server action.
 * Inspired by SvelteKit's RequestEvent and Next.js's Request/Response pattern.
 */

export interface NexusContext {
  request: Request;
  params: Record<string, string>;
  url: URL;
  headers: Headers;
  locals: Record<string, unknown>;
  /** Set a response header */
  setHeader: (key: string, value: string) => void;
  /** Set a cookie */
  setCookie: (name: string, value: string, opts?: CookieOptions) => void;
  /** Get a cookie value */
  getCookie: (name: string) => string | undefined;
  /** Redirect — throws, so use `return redirect(...)` pattern */
  redirect: (location: string, status?: 301 | 302 | 303 | 307 | 308) => never;
  /** Return a not-found response */
  notFound: () => never;
}

export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** Internal redirect signal */
export class RedirectSignal {
  constructor(
    public readonly location: string,
    public readonly status: number,
  ) {}
}

/** Internal not-found signal */
export class NotFoundSignal {}

export function createContext(
  request: Request,
  params: Record<string, string> = {},
): NexusContext {
  const url = new URL(request.url);
  const responseHeaders = new Headers();
  const cookies = parseCookies(request.headers.get('cookie') ?? '');

  return {
    request,
    params,
    url,
    headers: request.headers,
    locals: {},

    setHeader(key, value) {
      responseHeaders.set(key, value);
    },

    setCookie(name, value, opts = {}) {
      const parts = [`${name}=${encodeURIComponent(value)}`];
      if (opts.path) parts.push(`Path=${opts.path}`);
      if (opts.domain) parts.push(`Domain=${opts.domain}`);
      if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
      if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
      if (opts.httpOnly) parts.push('HttpOnly');
      if (opts.secure) parts.push('Secure');
      if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
      responseHeaders.append('Set-Cookie', parts.join('; '));
    },

    getCookie(name) {
      return cookies[name];
    },

    redirect(location, status = 302) {
      throw new RedirectSignal(location, status);
    },

    notFound() {
      throw new NotFoundSignal();
    },
  };
}

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [key, ...vals] = part.trim().split('=');
    if (key) result[key.trim()] = decodeURIComponent(vals.join('=').trim());
  }
  return result;
}

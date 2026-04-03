export interface NexusConfig {
  /** Default island hydration strategy */
  defaultHydration?: 'client:load' | 'client:idle' | 'client:visible';

  /** Image optimization settings */
  images?: {
    formats?: ('avif' | 'webp' | 'png' | 'jpg')[];
    sizes?: number[];
    quality?: number;
  };

  /** Server configuration */
  server?: {
    port?: number;
    host?: string;
    /** Run on edge runtime (Cloudflare Workers / Deno Deploy compatible) */
    edge?: boolean;
  };

  /** Build configuration */
  build?: {
    outDir?: string;
    sourcemap?: boolean;
    minify?: boolean;
    /** Target adapters */
    adapter?: 'node' | 'cloudflare' | 'vercel' | 'fly' | 'deno';
  };

  /** Internationalization */
  i18n?: {
    defaultLocale: string;
    locales: string[];
    /** Path to translation files */
    translationsDir?: string;
  };

  /** Plugins */
  plugins?: NexusPlugin[];
}

export interface NexusPlugin {
  name: string;
  transform?: (source: string, filepath: string) => string | Promise<string>;
  buildStart?: () => void | Promise<void>;
  buildEnd?: () => void | Promise<void>;
}

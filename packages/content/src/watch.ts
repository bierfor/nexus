import { watch as fsWatch } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import type { ContentWatcherOptions } from './types.js';

interface WatcherHandle {
  close(): void | Promise<void>;
}

let watchers = new Map<string, WatcherHandle>();

/** Try to use chokidar if available (better macOS + recursive support), else node:fs */
async function createWatcher(
  dir: string,
  onEvent: (event: 'change' | 'rename', filename: string) => void
): Promise<WatcherHandle> {
  try {
    // @ts-expect-error chokidar is an optional peer dependency
    const chokidar: any = await import('chokidar');
    const w = chokidar.watch(`${dir}/**/*.md`, { ignoreInitial: true });
    w.on('all', (event: string, path: string) => {
      if (event === 'add' || event === 'change' || event === 'unlink') {
        const normalizedEvent = event === 'unlink' ? 'rename' : 'change';
        onEvent(normalizedEvent as 'change' | 'rename', path);
      }
    });
    return { close: () => w.close() };
  } catch {
    // chokidar not installed — fallback to node:fs/watch
    const w = fsWatch(dir, { recursive: true }, (event, filename) => {
      if (!filename) return;
      if (!filename.endsWith('.md')) return;
      onEvent(event as 'change' | 'rename', filename);
    });
    return { close: () => w.close() };
  }
}

/**
 * Watch content directory for changes.
 * Automatically debounces rapid file events.
 *
 * Prefers chokidar when installed (detected dynamically) for reliable
 * cross-platform watching. Falls back to node:fs/watch.
 *
 * In a Nexus app, use inside dev guards:
 *   if (import.meta.env?.DEV) {
 *     watchContent({ contentDir: 'src/content/docs', onChange: (e, f) => reloadPage() });
 *   }
 */
export function watchContent(opts: ContentWatcherOptions): () => void {
  const { contentDir, onChange, debounceMs = 100 } = opts;
  const fullDir = join(cwd(), contentDir);

  // Close existing watcher for this dir
  const existing = watchers.get(fullDir);
  if (existing) {
    existing.close();
    watchers.delete(fullDir);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const wrappedOnChange = (event: 'change' | 'rename', filename: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onChange(event, filename);
    }, debounceMs);
  };

  // Start watcher (async internally, but we store the promise to allow cleanup)
  const watcherPromise = createWatcher(fullDir, wrappedOnChange).then((watcher) => {
    watchers.set(fullDir, watcher);
    return watcher;
  });

  return () => {
    watcherPromise.then((w) => {
      w.close();
      watchers.delete(fullDir);
    }).catch(() => {
      watchers.delete(fullDir);
    });
  };
}

/**
 * Stop all active content watchers.
 */
export function stopAllWatchers(): void {
  const keys = Array.from(watchers.keys());
  for (const dir of keys) {
    const w = watchers.get(dir);
    if (w) w.close();
    watchers.delete(dir);
  }
}

/**
 * Nexus Vault-lite — in-memory secret store with hot-reload (no external vault service).
 * Seed once from `process.env`, then merge patches from Studio / `POST /_nexus/dev/vault`.
 */

export type VaultListener = () => void;

const vaultListeners = new Set<VaultListener>();

export class NexusVault {
  private readonly store = new Map<string, string>();

  /**
   * One-time copy of all string values from `process.env`.
   * Call when the HTTP server starts so the baseline matches the container env.
   */
  seedFromProcessEnv(): void {
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') this.store.set(k, v);
    }
  }

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Merge keys. Use empty string to remove a key from the vault (not from `process.env` on disk).
   */
  patch(entries: Record<string, string>): void {
    for (const [k, v] of Object.entries(entries)) {
      if (v === '') this.store.delete(k);
      else this.store.set(k, v);
    }
    this.notify();
  }

  /**
   * Reset to current `process.env`, then apply `entries` (empty string removes a key).
   * Use from Studio “Replace all” to snap back to the process baseline and apply a full `.env`-style paste.
   */
  replaceAll(entries: Record<string, string>): void {
    this.store.clear();
    this.seedFromProcessEnv();
    for (const [k, v] of Object.entries(entries)) {
      if (v === '') this.store.delete(k);
      else this.store.set(k, v);
    }
    this.notify();
  }

  /** Snapshot for `NexusContext.secrets` (immutable view per request). */
  snapshot(): ReadonlyMap<string, string> {
    return new Map(this.store);
  }

  subscribe(fn: VaultListener): () => void {
    vaultListeners.add(fn);
    return () => {
      vaultListeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of vaultListeners) {
      try {
        fn();
      } catch {
        /* ignore listener errors */
      }
    }
  }
}

/** Process-wide vault instance — use this from server code. */
export const nexusVault = new NexusVault();

export function getVaultSecretsMap(): ReadonlyMap<string, string> {
  return nexusVault.snapshot();
}

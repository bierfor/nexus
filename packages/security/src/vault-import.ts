/**
 * @nexus_js/security - Vault Import Utility
 * 
 * Import secrets from .env files, JSON config, or external vaults (AWS Secrets Manager, etc.)
 * into the Nexus Vault for unified secret management.
 */

import { nexusVault } from './vault.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface VaultImportOptions {
  /**
   * Source type: .env file, JSON config, or raw key-value object.
   */
  source: 'env-file' | 'json-file' | 'object' | 'aws-secrets' | 'gcp-secrets';

  /**
   * Path to the source file (for env-file or json-file).
   */
  filePath?: string;

  /**
   * Raw key-value object to import (for 'object' source).
   */
  secrets?: Record<string, string>;

  /**
   * Filter: only import keys matching this regex.
   * @example /^DB_|^API_KEY/ imports DB_* and API_KEY*
   */
  filter?: RegExp;

  /**
   * Prefix to add to all imported keys.
   * @example prefix: 'LEGACY_' imports DATABASE_URL as LEGACY_DATABASE_URL
   */
  prefix?: string;

  /**
   * Whether to overwrite existing keys in the Vault.
   * @default false
   */
  overwrite?: boolean;

  /**
   * AWS Secrets Manager config (for aws-secrets source).
   */
  aws?: {
    region: string;
    secretName: string;
  };

  /**
   * GCP Secret Manager config (for gcp-secrets source).
   */
  gcp?: {
    projectId: string;
    secretName: string;
  };
}

/**
 * Parse .env file content into key-value pairs.
 * Supports basic syntax: KEY=value, ignores comments (#), handles quotes.
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue; // Skip empty or comment lines

    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (!match) continue;

    let [, key, value] = match;
    if (!key || value === undefined) continue;

    // Remove quotes if present
    value = value.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Import secrets from various sources into the Nexus Vault.
 * 
 * This is critical for legacy migration:
 * - Read the old .env file
 * - Import all secrets into the Vault
 * - Enable hot-reload rotation for sensitive keys
 * - The old backend can now be decommissioned
 * 
 * @example
 * ```ts
 * // Import from .env file
 * await importToVault({
 *   source: 'env-file',
 *   filePath: '.env.production',
 *   filter: /^DB_|^API_KEY/,
 *   prefix: 'LEGACY_',
 * });
 * 
 * // Now accessible via:
 * nexusVault.get('LEGACY_DB_HOST');
 * nexusVault.get('LEGACY_API_KEY_STRIPE');
 * 
 * // Import from AWS Secrets Manager
 * await importToVault({
 *   source: 'aws-secrets',
 *   aws: { region: 'us-east-1', secretName: 'prod/api' },
 * });
 * ```
 */
export async function importToVault(opts: VaultImportOptions): Promise<{
  imported: number;
  skipped: number;
  errors: Array<{ key: string; error: string }>;
}> {
  const { source, filePath, secrets: rawSecrets, filter, prefix, overwrite = false } = opts;

  let secretsToImport: Record<string, string> = {};

  // ── Step 1: Load secrets from source ──────────────────────────────────────
  switch (source) {
    case 'env-file': {
      if (!filePath) throw new Error('filePath required for env-file source');
      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const content = await readFile(filePath, 'utf-8');
      secretsToImport = parseEnvFile(content);
      break;
    }

    case 'json-file': {
      if (!filePath) throw new Error('filePath required for json-file source');
      if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const content = await readFile(filePath, 'utf-8');
      try {
        secretsToImport = JSON.parse(content) as Record<string, string>;
      } catch (err) {
        throw new Error(`Invalid JSON in ${filePath}: ${err}`);
      }
      break;
    }

    case 'object': {
      if (!rawSecrets) throw new Error('secrets object required for object source');
      secretsToImport = rawSecrets;
      break;
    }

    case 'aws-secrets': {
      if (!opts.aws) throw new Error('aws config required for aws-secrets source');
      // Placeholder: requires AWS SDK
      throw new Error(
        'aws-secrets source requires @aws-sdk/client-secrets-manager (not included in @nexus_js/security)',
      );
    }

    case 'gcp-secrets': {
      if (!opts.gcp) throw new Error('gcp config required for gcp-secrets source');
      // Placeholder: requires GCP SDK
      throw new Error(
        'gcp-secrets source requires @google-cloud/secret-manager (not included in @nexus_js/security)',
      );
    }

    default:
      throw new Error(`Unknown source type: ${source}`);
  }

  // ── Step 2: Filter and prefix keys ────────────────────────────────────────
  const filteredSecrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(secretsToImport)) {
    if (filter && !filter.test(key)) continue;
    const finalKey = prefix ? `${prefix}${key}` : key;
    filteredSecrets[finalKey] = value;
  }

  // ── Step 3: Import into Vault ─────────────────────────────────────────────
  let imported = 0;
  let skipped = 0;
  const errors: Array<{ key: string; error: string }> = [];

  for (const [key, value] of Object.entries(filteredSecrets)) {
    try {
      const existing = nexusVault.get(key);
      if (existing && !overwrite) {
        skipped++;
        continue;
      }

      nexusVault.set(key, value);
      imported++;
    } catch (err) {
      errors.push({
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { imported, skipped, errors };
}

/**
 * Auto-import from .env file if it exists in the project root.
 * Call this in your server startup to seamlessly migrate legacy secrets.
 * 
 * @example
 * ```ts
 * // server.ts
 * import { autoImportEnv } from '@nexus_js/security';
 * 
 * await autoImportEnv({ root: process.cwd(), prefix: 'LEGACY_' });
 * 
 * // Now all .env keys are available with LEGACY_ prefix
 * ```
 */
export async function autoImportEnv(opts?: {
  root?: string;
  prefix?: string;
  filter?: RegExp;
  overwrite?: boolean;
}): Promise<{ imported: number; skipped: number }> {
  const root = opts?.root ?? process.cwd();
  const envPath = join(root, '.env');

  if (!existsSync(envPath)) {
    return { imported: 0, skipped: 0 };
  }

  const importOpts: VaultImportOptions = {
    source: 'env-file',
    filePath: envPath,
  };
  if (opts?.prefix !== undefined) importOpts.prefix = opts.prefix;
  if (opts?.filter !== undefined) importOpts.filter = opts.filter;
  if (opts?.overwrite !== undefined) importOpts.overwrite = opts.overwrite;

  const result = await importToVault(importOpts);

  return { imported: result.imported, skipped: result.skipped };
}

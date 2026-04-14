import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type BridgeSourceKind = 'postgres';

export interface BridgeSourceConfig {
  kind: BridgeSourceKind;
  name: string;
  dsnEnv: string;
  schemas?: string[];
  tenantKey?: string;
  tenancyMode?: 'single' | 'subdomain' | 'custom-domain' | 'path' | 'header' | 'jwt';
}

export interface BridgeSourcesFile {
  version: 1;
  sources: BridgeSourceConfig[];
}

export async function readBridgeSources(filePath: string): Promise<BridgeSourcesFile | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    if (r['version'] !== 1) return null;
    if (!Array.isArray(r['sources'])) return null;
    const sources = (r['sources'] as unknown[]).filter(Boolean).map((s) => s as BridgeSourceConfig);
    return { version: 1, sources };
  } catch {
    return null;
  }
}

export async function writeBridgeSources(filePath: string, sources: BridgeSourcesFile): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(sources, null, 2) + '\n', 'utf8');
}

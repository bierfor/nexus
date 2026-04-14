import { join } from 'node:path';

export function bridgeDir(root: string): string {
  return join(root, 'nexus', 'bridge');
}

export function bridgeSourcesPath(root: string): string {
  return join(bridgeDir(root), 'sources.json');
}

export function canonicalModelPath(root: string): string {
  return join(bridgeDir(root), 'canonical-model.json');
}

export function securityReportPath(root: string): string {
  return join(bridgeDir(root), 'security-report.json');
}

export function overridesPath(root: string): string {
  return join(bridgeDir(root), 'overrides.json');
}

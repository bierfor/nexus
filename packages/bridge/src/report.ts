import type { CanonicalModel, CanonicalSecurityFinding } from './types.js';

export interface SecurityReport {
  schemaVersion: '1.0';
  ts: number;
  source: CanonicalModel['source'];
  findings: CanonicalSecurityFinding[];
}

export function buildSecurityReport(model: CanonicalModel): SecurityReport {
  return {
    schemaVersion: '1.0',
    ts: Date.now(),
    source: model.source,
    findings: model.security.findings,
  };
}

export function hasBlockingFindings(findings: CanonicalSecurityFinding[]): boolean {
  return findings.some(f => f.severity === 'block');
}

/**
 * @nexus/audit — Dependency Auditing & Supply Chain Security
 *
 * Provides:
 *  - CVE scanning via Google OSV (open, no API key)
 *  - Supply chain risk analysis via npm registry
 *  - Offline-first local cache (~/.nexus/cache/)
 *  - Override policy with automatic expiry
 *  - Build-time blocking for critical vulnerabilities
 *  - `nexus fix` auto-remediation data
 */

export {
  auditPackage,
  auditDependencies,
  filterVulnerable,
  invalidateCache,
  clearCache,
} from './engine.js';
export type { AuditResult, Vulnerability, VulnSeverity } from './engine.js';

export {
  checkSupplyChain,
  auditSupplyChain,
  MFA_NOTE,
} from './supply-chain.js';
export type { SupplyChainResult, SupplyChainFlag, SupplyChainRiskLevel } from './supply-chain.js';

export {
  validateOverride,
  findOverride,
  formatOverrides,
  maxOverrideDate,
} from './override.js';
export type { VulnerabilityOverride, AllowVulnerableConfig } from './override.js';

export {
  scanProject,
  NexusSecurityError,
  auditPackage as auditSinglePackage,
} from './scanner.js';
export type { ScanOptions, ScanResult } from './scanner.js';

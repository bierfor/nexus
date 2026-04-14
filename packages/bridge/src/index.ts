export type {
  CanonicalModel,
  CanonicalEntity,
  CanonicalField,
  CanonicalRelation,
  CanonicalSecurity,
  CanonicalTenancy,
  CanonicalSecurityFinding,
  FieldSensitivity,
} from './types.js';

export { parseCanonicalModel } from './validate.js';
export { applyInferredSecurity, classifyFieldSensitivity, detectTenancyFromEntities } from './infer.js';
export { bridgeDir, bridgeSourcesPath, canonicalModelPath, overridesPath, securityReportPath } from './paths.js';
export { readBridgeSources, writeBridgeSources, type BridgeSourcesFile, type BridgeSourceConfig, type BridgeSourceKind } from './sources.js';
export { buildSecurityReport, hasBlockingFindings, type SecurityReport } from './report.js';
export { generateGraphqlSdl, generateAppFiles, type GeneratedFile } from './generator.js';

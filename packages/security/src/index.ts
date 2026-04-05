export {
  NexusVault,
  nexusVault,
  getVaultSecretsMap,
  type VaultListener,
} from './vault.js';
export {
  SHIELD_MANIFEST_FILENAME,
  type ShieldManifestV1,
  parseShieldManifest,
  loadShieldManifestFromRoot,
  extractActionNamesFromActionsSource,
  collectActionNamesFromOutputDir,
} from './shield.js';

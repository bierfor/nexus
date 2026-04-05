/**
 * Shield-lite runtime allowlist — refreshed after server action preload.
 */

import { loadShieldManifestFromRoot } from '@nexus_js/security';
import { getRegisteredActionNames } from './actions.js';

let shieldLiteEnabled = false;
let actionAllow: Set<string> | null = null;

export function setShieldLite(enabled: boolean): void {
  shieldLiteEnabled = enabled;
}

export function refreshShieldAllowlist(root: string, dev: boolean): void {
  if (!shieldLiteEnabled) {
    actionAllow = null;
    return;
  }
  const reg = getRegisteredActionNames();
  if (dev) {
    actionAllow = reg.size > 0 ? new Set(reg) : null;
    return;
  }
  const file = loadShieldManifestFromRoot(root);
  if (file && file.actions.length > 0) {
    actionAllow = new Set(file.actions);
  } else {
    actionAllow = reg.size > 0 ? new Set(reg) : null;
  }
}

export function isActionBlockedByShield(actionName: string): boolean {
  if (!shieldLiteEnabled || !actionAllow || actionAllow.size === 0) return false;
  return !actionAllow.has(actionName);
}

import { describe, it, expect } from 'vitest';
import { buildRouteManifest, extractTenant } from './index.js';

describe('@nexus_js/router basic functionality', () => {
  it('should export buildRouteManifest function', () => {
    expect(typeof buildRouteManifest).toBe('function');
  });

  it('should export tenant utilities', () => {
    expect(typeof extractTenant).toBe('function');
  });

  it('buildRouteManifest should throw on non-existent directory (graceful)', async () => {
    await expect(buildRouteManifest('/tmp/non-existent-routes-xyz')).rejects.toThrow();
  });
});

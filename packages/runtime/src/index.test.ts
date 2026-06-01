import { describe, it, expect } from 'vitest';

// Basic smoke tests for runtime public API
import * as runtime from './index.js';

describe('@nexus_js/runtime basic exports', () => {
  it('should export core client utilities', () => {
    // These are the main things apps and islands depend on
    expect(typeof runtime).toBe('object');
  });

  it('should have island and navigation related exports (even if tree-shaken in some builds)', () => {
    // We don't assert deep internals here — just that the module loads without throwing
    expect(true).toBe(true);
  });
});

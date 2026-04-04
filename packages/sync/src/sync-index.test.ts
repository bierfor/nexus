import { describe, it, expect } from 'vitest';
import { isOnline } from './index.js';

describe('@nexus_js/sync entry', () => {
  it('isOnline is true when navigator is undefined (Node)', () => {
    expect(isOnline()).toBe(true);
  });
});

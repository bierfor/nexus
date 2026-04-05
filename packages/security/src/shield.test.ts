import { describe, expect, it } from 'vitest';
import {
  collectActionNamesFromOutputDir,
  extractActionNamesFromActionsSource,
  parseShieldManifest,
} from './shield.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseShieldManifest', () => {
  it('accepts v1', () => {
    const m = parseShieldManifest(
      JSON.stringify({ version: 1, routes: ['/'], actions: ['a'] }),
    );
    expect(m).toEqual({ version: 1, routes: ['/'], actions: ['a'] });
  });

  it('rejects bad version', () => {
    expect(parseShieldManifest(JSON.stringify({ version: 2, routes: [], actions: [] }))).toBeNull();
  });
});

describe('extractActionNamesFromActionsSource', () => {
  it('finds registerAction names', () => {
    const src = `
      import { registerAction } from '@nexus_js/server/actions';
      registerAction("foo", fn);
      registerAction("bar-baz", other);
    `;
    expect(extractActionNamesFromActionsSource(src)).toEqual(['foo', 'bar-baz']);
  });
});

describe('collectActionNamesFromOutputDir', () => {
  it('walks nested dirs', () => {
    const root = mkdtempSync(join(tmpdir(), 'nexus-shield-'));
    try {
      const nested = join(root, 'blog');
      mkdirSync(nested, { recursive: true });
      writeFileSync(
        join(nested, 'post.actions.js'),
        'registerAction("savePost", x); registerAction("deletePost", y);',
        'utf-8',
      );
      expect(collectActionNamesFromOutputDir(root)).toEqual(['deletePost', 'savePost']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

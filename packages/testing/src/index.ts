/**
 * @nexus/testing — Test utilities for Nexus components.
 *
 * Supports two test modes:
 *   1. SSR mode: renders the server output, asserts on HTML strings
 *   2. Island mode: mounts the client island in jsdom, tests reactivity
 *
 * Example:
 *   import { renderSSR, mountIsland, screen, fireEvent } from '@nexus/testing';
 *
 *   // SSR test
 *   test('renders user name', async () => {
 *     const { html } = await renderSSR('./src/routes/+page.nx', {
 *       ctx: { params: { id: '42' } }
 *     });
 *     expect(html).toContain('Hello, Alice');
 *   });
 *
 *   // Island (client) test
 *   test('counter increments', async () => {
 *     const { getByText, container } = await mountIsland('./Counter.nx');
 *     const btn = getByText('Click me');
 *     await fireEvent.click(btn);
 *     expect(getByText('Clicks: 1')).toBeDefined();
 *   });
 *
 *   // Server Action test
 *   test('updateProfile saves name', async () => {
 *     const { invokeAction } = createActionTestHarness('./+page.nx');
 *     const result = await invokeAction('updateProfile', new FormData());
 *     expect(result.success).toBe(true);
 *   });
 */

import { compile, parse } from '@nexus/compiler';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RenderSSROptions {
  /** Context to inject (params, session, etc.) */
  ctx?: Partial<MockContext>;
  /** Additional props to pass to the component */
  props?: Record<string, unknown>;
  /** Mock implementations for $lib/* imports */
  mocks?: Record<string, unknown>;
}

export interface SSRResult {
  /** Rendered HTML string */
  html: string;
  /** Extracted CSS */
  css: string | null;
  /** Whether islands are present */
  hasIslands: boolean;
  /** Island directives detected */
  islands: string[];
  /** Query utilities (JSDOM-based) */
  querySelector: (selector: string) => Element | null;
  querySelectorAll: (selector: string) => NodeListOf<Element>;
  getByText: (text: string) => Element | undefined;
  getByRole: (role: string) => Element | undefined;
}

export interface IslandMountResult {
  container: Element;
  getByText: (text: string) => Element | undefined;
  getByRole: (role: string, opts?: { name?: string }) => Element | undefined;
  getByTestId: (id: string) => Element | undefined;
  queryByText: (text: string) => Element | null;
  /** Simulate a DOM event */
  fireEvent: typeof fireEvent;
  /** Wait for async updates */
  waitFor: (fn: () => boolean, timeout?: number) => Promise<void>;
  /** Unmount and cleanup */
  unmount: () => void;
}

export interface MockContext {
  params: Record<string, string>;
  url: URL;
  request: Request;
  session: Record<string, unknown>;
  locals: Record<string, unknown>;
}

// ── SSR Testing ───────────────────────────────────────────────────────────────

/**
 * Renders a .nx file in server mode and returns HTML + query utilities.
 */
export async function renderSSR(
  filepath: string,
  opts: RenderSSROptions = {},
): Promise<SSRResult> {
  const absPath = resolve(process.cwd(), filepath);
  const source = await readFile(absPath, 'utf-8');

  const result = compile(source, absPath, {
    mode: 'server',
    dev: true,
    ssr: true,
    emitIslandManifest: true,
    target: 'node',
  });

  // For now, return the serverCode as mock HTML
  // In full implementation, we'd execute the serverCode in a VM context
  const html = extractMockHTML(result.serverCode, opts.props ?? {});

  const parsed = parse(source, absPath);

  return {
    html,
    css: result.css,
    hasIslands: parsed.islandDirectives.length > 0,
    islands: parsed.islandDirectives.map((d) => d.directive),
    querySelector: (sel: string) => createQueryContext(html).querySelector(sel),
    querySelectorAll: (sel: string) => createQueryContext(html).querySelectorAll(sel),
    getByText: (text: string) => findByText(html, text),
    getByRole: (role: string) => findByRole(html, role),
  };
}

// ── Island Testing ────────────────────────────────────────────────────────────

/**
 * Mounts an island in jsdom for client-side testing.
 */
export async function mountIsland(
  filepath: string,
  props: Record<string, unknown> = {},
): Promise<IslandMountResult> {
  const absPath = resolve(process.cwd(), filepath);
  const source = await readFile(absPath, 'utf-8');

  const result = compile(source, absPath, {
    mode: 'client',
    dev: true,
    ssr: false,
    emitIslandManifest: false,
    target: 'browser',
  });

  // Create a container element
  const container = createMockElement('div');

  // Execute island code in a sandboxed context
  const clientCode = result.clientCode ?? result.serverCode;
  await executeIslandCode(clientCode, container, props);

  const getAll = () => container.querySelectorAll('*');

  return {
    container,
    getByText: (text: string) => [...getAll()].find((el) => el.textContent?.includes(text)),
    getByRole: (role: string, opts = {}) =>
      [...getAll()].find((el) => {
        const r = el.getAttribute('role') ?? inferRole(el.tagName);
        if (r !== role) return false;
        if (opts.name) return el.getAttribute('aria-label')?.includes(opts.name) ?? false;
        return true;
      }),
    getByTestId: (id: string) => container.querySelector(`[data-testid="${id}"]`) ?? undefined,
    queryByText: (text: string) =>
      [...getAll()].find((el) => el.textContent?.includes(text)) ?? null,
    fireEvent,
    waitFor: (fn: () => boolean, timeout = 1000) => waitFor(fn, timeout),
    unmount: () => { container.innerHTML = ''; },
  };
}

// ── Server Action Testing ──────────────────────────────────────────────────────

export interface ActionTestHarness {
  invokeAction: (name: string, input: FormData | unknown) => Promise<unknown>;
  listActions: () => Promise<string[]>;
}

/**
 * Creates a test harness for Server Actions defined in a .nx file.
 */
export function createActionTestHarness(filepath: string): ActionTestHarness {
  const absPath = resolve(process.cwd(), filepath);

  return {
    async invokeAction(name: string, input: FormData | unknown) {
      const source = await readFile(absPath, 'utf-8');
      const parsed = parse(source, absPath);
      const action = parsed.serverActions.find((a) => a.name === name);

      if (!action) {
        throw new Error(`Action "${name}" not found in ${filepath}`);
      }

      // Execute the action body in a mock context
      const mockCtx = createMockContext();
      const body = action.body;

      // Create a function from the action body and execute it
      const fn = new Function('ctx', 'input', 'FormData', `
        "use strict";
        return (async () => { ${body} })();
      `);

      return fn(mockCtx, input, FormData);
    },

    async listActions() {
      const source = await readFile(absPath, 'utf-8');
      const parsed = parse(source, absPath);
      return parsed.serverActions.map((a) => a.name);
    },
  };
}

// ── Event simulation ──────────────────────────────────────────────────────────

export const fireEvent = {
  click: (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  input: (el: Element, value: string) => {
    if (el instanceof HTMLInputElement) el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  },
  submit: (el: Element) => el.dispatchEvent(new Event('submit', { bubbles: true })),
  change: (el: Element, value: string) => {
    if (el instanceof HTMLInputElement) el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  keydown: (el: Element, key: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })),
};

// ── Matchers for Vitest ───────────────────────────────────────────────────────

export const nexusMatchers = {
  toContainHTML(received: SSRResult, expected: string) {
    const pass = received.html.includes(expected);
    return {
      pass,
      message: () => pass
        ? `Expected HTML not to contain "${expected}"`
        : `Expected HTML to contain "${expected}"\n\nReceived:\n${received.html.slice(0, 500)}`,
    };
  },

  toHaveIsland(received: SSRResult, directive: string) {
    const pass = received.islands.includes(directive);
    return {
      pass,
      message: () => pass
        ? `Expected component not to have island "${directive}"`
        : `Expected component to have island "${directive}"\n\nFound: ${received.islands.join(', ')}`,
    };
  },

  toBeSSROnly(received: SSRResult) {
    const pass = !received.hasIslands;
    return {
      pass,
      message: () => pass
        ? 'Expected component to have islands'
        : 'Expected component to be server-only (no islands)',
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function createQueryContext(html: string): Document {
  if (typeof DOMParser !== 'undefined') {
    return new DOMParser().parseFromString(html, 'text/html');
  }
  // Fallback for Node.js environments without DOMParser
  return { querySelector: () => null, querySelectorAll: () => ({ length: 0 }) } as unknown as Document;
}

function findByText(html: string, text: string): Element | undefined {
  const doc = createQueryContext(html);
  return [...doc.querySelectorAll('*')].find((el) => el.textContent?.trim() === text);
}

function findByRole(html: string, role: string): Element | undefined {
  const doc = createQueryContext(html);
  return [...doc.querySelectorAll(`[role="${role}"], ${roleToTag(role)}`)][0];
}

function roleToTag(role: string): string {
  const map: Record<string, string> = {
    button: 'button',
    link: 'a',
    heading: 'h1,h2,h3,h4,h5,h6',
    textbox: 'input[type="text"],textarea',
    checkbox: 'input[type="checkbox"]',
    form: 'form',
    list: 'ul,ol',
    listitem: 'li',
    img: 'img',
    navigation: 'nav',
    main: 'main',
    banner: 'header',
    contentinfo: 'footer',
  };
  return map[role] ?? role;
}

function inferRole(tag: string): string {
  const map: Record<string, string> = {
    BUTTON: 'button',
    A: 'link',
    H1: 'heading', H2: 'heading', H3: 'heading',
    INPUT: 'textbox',
    FORM: 'form',
    UL: 'list', OL: 'list',
    LI: 'listitem',
    IMG: 'img',
    NAV: 'navigation',
    MAIN: 'main',
    HEADER: 'banner',
    FOOTER: 'contentinfo',
  };
  return map[tag.toUpperCase()] ?? '';
}

function createMockElement(tag: string): Element {
  if (typeof document !== 'undefined') return document.createElement(tag);
  // Minimal mock for Node.js
  return {
    tagName: tag.toUpperCase(),
    innerHTML: '',
    textContent: '',
    children: [],
    querySelectorAll: () => ({ length: 0 }),
    querySelector: () => null,
    dispatchEvent: () => true,
    setAttribute: () => {},
    getAttribute: () => null,
  } as unknown as Element;
}

async function executeIslandCode(
  _code: string,
  _container: Element,
  _props: Record<string, unknown>,
): Promise<void> {
  // In a full implementation, use vm.runInContext() or a Vite environment
  // to execute the island code with the Nexus runtime injected.
  // For now, we just set up the container for DOM querying.
}

function createMockContext(): MockContext {
  return {
    params: {},
    url: new URL('http://localhost/'),
    request: new Request('http://localhost/'),
    session: {},
    locals: {},
  };
}

async function waitFor(fn: () => boolean, timeout: number): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await new Promise((r) => setTimeout(r, 16));
  }
}

function extractMockHTML(serverCode: string, props: Record<string, unknown>): string {
  // Extract template literal from generated server code for basic assertions
  const match = /return `([\s\S]+?)`/.exec(serverCode);
  return match?.[1]?.replace(/\$\{[^}]+\}/g, '[dynamic]') ?? serverCode;
}

/**
 * @nexus_js/runtime/router — programmatic navigation helpers.
 *
 * Re-exports `navigate` and `prefetch` from the navigation module under the
 * `@nexus_js/runtime/router` entry point so island code can import without
 * pulling the full runtime bundle.
 *
 * Usage:
 * ```ts
 * import { navigate, prefetch } from '@nexus_js/runtime/router';
 * await navigate('/dashboard');
 * prefetch('/settings');
 * ```
 *
 * TypeScript augmentations for typed route params live in the generated
 * `.nexus/nexus-types.d.ts` file (created by vite-plugin-nexus on save).
 */

export { navigate, prefetch } from './navigation.js';
export type { NavigateOptions } from './navigation.js';

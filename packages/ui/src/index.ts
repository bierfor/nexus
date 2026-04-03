/**
 * @nexus/ui — Zero-Bundle Component Library
 *
 * Every component in this library generates pure HTML+CSS output.
 * No JavaScript is shipped to the browser. The Nexus compiler detects
 * the @zero-bundle annotation and replaces the component with its
 * static HTML+CSS equivalent at build time.
 *
 * Components:
 *  - Accordion  → <details>/<summary> with animation
 *  - Tabs       → CSS :target pseudo-class trick
 *  - Toggle     → <details> + CSS ::marker trick
 *  - Tooltip    → CSS :hover + aria-label
 *  - Disclosure → <details> semantic variant
 *  - Modal      → <dialog> native + :target fallback
 *  - ProgressRing → SVG-only animated ring
 *
 * Usage in .nx files:
 *
 * ```nx
 * ---
 * import { Accordion } from '@nexus/ui';
 * ---
 *
 * <Accordion title="How does Nexus work?">
 *   It uses islands architecture...
 * </Accordion>
 * ```
 *
 * The compiler replaces this with the CSS-only HTML at build time.
 * Zero JS. Zero hydration. Works even with JavaScript disabled.
 */

export { renderAccordion, type AccordionProps }   from './components/accordion.js';
export { renderTabs, type TabsProps }              from './components/tabs.js';
export { renderTooltip, type TooltipProps }        from './components/tooltip.js';
export { renderModal, type ModalProps }            from './components/modal.js';
export { renderProgressRing, type ProgressRingProps } from './components/progress-ring.js';

/** @zero-bundle annotation marker — used by the Nexus compiler. */
export const ZERO_BUNDLE_MARKER = '__nexus_zero_bundle__';

/**
 * Injects the Zero-Bundle stylesheet into a page's <head>.
 * Called automatically by the renderer when @nexus/ui components are detected.
 */
export function getZeroBundleCSS(): string {
  return `
/* @nexus/ui — Zero-Bundle Component Styles */
@layer nexus.ui {

/* ── Accordion ── */
.nx-accordion { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.nx-accordion + .nx-accordion { margin-top: -1px; border-radius: 0; }
.nx-accordion:first-child { border-radius: 8px 8px 0 0; }
.nx-accordion:last-child  { border-radius: 0 0 8px 8px; }
.nx-accordion details { width: 100%; }
.nx-accordion summary  {
  list-style: none; display: flex; align-items: center; justify-content: space-between;
  padding: .875rem 1rem; font-weight: 500; cursor: pointer; user-select: none;
  background: #fafafa; transition: background .15s;
}
.nx-accordion summary:hover { background: #f1f5f9; }
.nx-accordion summary::after {
  content: '+'; font-size: 1.25rem; font-weight: 300; color: #94a3b8;
  transition: transform .2s; will-change: transform;
}
.nx-accordion details[open] summary::after { transform: rotate(45deg); }
.nx-accordion details[open] summary { background: #f8fafc; }
.nx-accordion__body {
  padding: 1rem; border-top: 1px solid #e2e8f0;
  animation: nx-slide-down .2s ease;
}
@keyframes nx-slide-down {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Tabs ── */
.nx-tabs { }
.nx-tabs__nav  { display: flex; border-bottom: 2px solid #e2e8f0; gap: .5rem; }
.nx-tabs__tab  {
  padding: .625rem 1rem; text-decoration: none; color: #64748b; border-radius: 6px 6px 0 0;
  border: 2px solid transparent; border-bottom: none; font-weight: 500; font-size: .9rem;
  transition: color .15s, background .15s;
}
.nx-tabs__tab:hover { color: #1e293b; background: #f8fafc; }
.nx-tabs__panel { display: none; padding: 1.25rem 0; animation: nx-fade-in .2s; }
.nx-tabs__panel:target { display: block; }
.nx-tabs__panel--default { display: block; }
.nx-tabs__panel:target ~ .nx-tabs__panel--default { display: none; }
.nx-tabs__tab--active,
.nx-tabs__nav a[href]:target-within { color: #6366f1; border-color: #6366f1; background: white; }
@keyframes nx-fade-in { from { opacity: 0; } to { opacity: 1; } }

/* ── Tooltip ── */
.nx-tooltip { position: relative; display: inline-block; }
.nx-tooltip__content {
  position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  background: #1e293b; color: #f8fafc; padding: .4rem .75rem; border-radius: 6px;
  font-size: .8rem; white-space: nowrap; pointer-events: none;
  opacity: 0; visibility: hidden; transition: opacity .15s, visibility .15s;
}
.nx-tooltip__content::after {
  content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: #1e293b;
}
.nx-tooltip:hover .nx-tooltip__content,
.nx-tooltip:focus-within .nx-tooltip__content { opacity: 1; visibility: visible; }

/* ── Modal ── */
.nx-modal-overlay { display: none; }
.nx-modal-overlay:target { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,.5); align-items: center; justify-content: center; z-index: 1000; animation: nx-fade-in .2s; }
.nx-modal {
  background: white; border-radius: 12px; padding: 1.5rem 2rem; min-width: 320px;
  max-width: min(90vw, 560px); box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
  animation: nx-modal-up .25s ease;
}
.nx-modal__close { float: right; text-decoration: none; font-size: 1.25rem; color: #94a3b8; line-height: 1; margin: -.25rem -.5rem 0 0; }
.nx-modal__close:hover { color: #1e293b; }
.nx-modal__title { font-size: 1.125rem; font-weight: 600; margin-bottom: 1rem; }
@keyframes nx-modal-up { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* ── Progress Ring ── */
.nx-ring { display: inline-flex; align-items: center; justify-content: center; position: relative; }
.nx-ring__svg { transform: rotate(-90deg); }
.nx-ring__track { fill: none; stroke: #e2e8f0; }
.nx-ring__fill  { fill: none; stroke: #6366f1; stroke-linecap: round; transition: stroke-dashoffset .6s ease; }
.nx-ring__label { position: absolute; font-weight: 700; font-size: .8rem; color: #1e293b; }

}`;
}

/** @zero-bundle — Pure CSS :hover tooltip. Zero JS. */
export interface TooltipProps {
  text:     string;    // tooltip label
  children: string;    // trigger element (raw HTML)
  position?: 'top' | 'bottom';
}

export function renderTooltip(props: TooltipProps): string {
  const { text, children } = props;
  return `<span class="nx-tooltip" role="tooltip" aria-label="${text}">
  ${children}
  <span class="nx-tooltip__content" aria-hidden="true">${text}</span>
</span>`;
}

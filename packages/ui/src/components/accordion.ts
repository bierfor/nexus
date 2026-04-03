/** @zero-bundle */
export interface AccordionProps {
  title:    string;
  children: string;   // raw HTML content
  open?:    boolean;
  id?:      string;
}

export function renderAccordion(props: AccordionProps): string {
  const { title, children, open = false, id } = props;
  const detailsAttrs = [
    open ? 'open' : '',
    id ? `id="${id}"` : '',
  ].filter(Boolean).join(' ');

  return `<div class="nx-accordion">
  <details ${detailsAttrs}>
    <summary>${title}</summary>
    <div class="nx-accordion__body">${children}</div>
  </details>
</div>`;
}

/** @zero-bundle — Uses CSS :target for tab switching. Zero JS. */
export interface TabItem {
  id:       string;
  label:    string;
  content:  string;  // raw HTML
  default?: boolean;
}

export interface TabsProps {
  tabs:   TabItem[];
  prefix: string;    // unique prefix to avoid ID collisions on the page
}

export function renderTabs(props: TabsProps): string {
  const { tabs, prefix } = props;
  const nav = tabs
    .map((t) => `<a href="#${prefix}-${t.id}" class="nx-tabs__tab">${t.label}</a>`)
    .join('\n    ');

  const panels = tabs
    .map((t) => `<div id="${prefix}-${t.id}" class="nx-tabs__panel${t.default ? ' nx-tabs__panel--default' : ''}">${t.content}</div>`)
    .join('\n  ');

  return `<div class="nx-tabs">
  <nav class="nx-tabs__nav">
    ${nav}
  </nav>
  ${panels}
</div>`;
}

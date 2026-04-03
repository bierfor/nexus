/**
 * @zero-bundle — CSS :target modal. Zero JS.
 * 
 * Usage:
 *   Trigger: <a href="#my-modal">Open</a>
 *   Close:   <a href="#">Close</a>
 */
export interface ModalProps {
  id:       string;
  title:    string;
  children: string;   // raw HTML body
  trigger?: string;   // optional trigger button HTML to prepend
}

export function renderModal(props: ModalProps): string {
  const { id, title, children, trigger } = props;
  const triggerHtml = trigger ? `${trigger}\n` : '';

  return `${triggerHtml}<div id="${id}" class="nx-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
  <div class="nx-modal">
    <a href="#" class="nx-modal__close" aria-label="Close">×</a>
    <h2 class="nx-modal__title" id="${id}-title">${title}</h2>
    ${children}
  </div>
</div>`;
}

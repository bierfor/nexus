import { adminCopy } from './admin-copy.ts';
import type { Locale } from './i18n.ts';
import type { AdminFlashFull } from './admin-gql.ts';
import { escapeHtml, jsonScriptPayload } from './admin-article-ssr.ts';

export type FlashFormLabels = {
  flashNew: string;
  flashEdit: string;
  flashBackList: string;
  flashFormTitleLabel: string;
  flashFormSlugLabel: string;
  flashFormSummaryLabel: string;
  flashFormSourceLabel: string;
  flashFormSourceUrlLabel: string;
  flashFormHackLabel: string;
  flashFormPublishedLabel: string;
  flashFormSave: string;
  flashFormDelete: string;
  flashErrSave: string;
  flashFormDeleteConfirm: string;
};

export function flashFormLabels(locale: Locale): FlashFormLabels {
  const t = adminCopy(locale);
  return {
    flashNew: t.flashNew,
    flashEdit: t.flashEdit,
    flashBackList: t.flashBackList,
    flashFormTitleLabel: t.flashFormTitleLabel,
    flashFormSlugLabel: t.flashFormSlugLabel,
    flashFormSummaryLabel: t.flashFormSummaryLabel,
    flashFormSourceLabel: t.flashFormSourceLabel,
    flashFormSourceUrlLabel: t.flashFormSourceUrlLabel,
    flashFormHackLabel: t.flashFormHackLabel,
    flashFormPublishedLabel: t.flashFormPublishedLabel,
    flashFormSave: t.flashFormSave,
    flashFormDelete: t.flashFormDelete,
    flashErrSave: t.flashErrSave,
    flashFormDeleteConfirm: t.flashFormDeleteConfirm,
  };
}

const ISLAND = `<nexus-island
  data-nexus-island="pf_admin_flash_form"
  data-nexus-island-index="0"
  data-nexus-component="/_nexus/islands/client.mjs?path=src%2Fcomponents%2FAdminFlashForm.nx"
  data-nexus-strategy="client:load"
><span aria-hidden="true"></span></nexus-island>`;

export function buildAdminFlashFormHtml(opts: {
  mode: 'new' | 'edit';
  flash: AdminFlashFull | null;
  t: FlashFormLabels;
  listPath: string;
}): string {
  const { mode, flash, t, listPath } = opts;
  const f = flash;
  const title = mode === 'new' ? t.flashNew : t.flashEdit;

  const bootstrap = jsonScriptPayload({
    mode,
    listPath,
    errSave: t.flashErrSave,
    confirmDelete: mode === 'edit' ? t.flashFormDeleteConfirm : '',
  });

  const idField = mode === 'edit' && f ? `<input type="hidden" name="id" value="${escapeHtml(f.id)}" />` : '';

  const deleteBtn =
    mode === 'edit' && f
      ? `<button type="button" class="pf-admin-btn pf-admin-btn--danger" id="pf-admin-flash-delete" data-id="${escapeHtml(f.id)}">${escapeHtml(t.flashFormDelete)}</button>`
      : '';

  return `
  <section class="pf-admin-page pf-admin-flash-form">
    <header class="pf-admin-head pf-admin-head--row">
      <h1 class="pf-admin-h1">${escapeHtml(title)}</h1>
      <a class="pf-admin-link-back" href="${escapeHtml(listPath)}">${escapeHtml(t.flashBackList)}</a>
    </header>
    <script type="application/json" id="pf-admin-flash-bootstrap">${bootstrap}</script>
    <form id="pf-admin-flash-form" class="pf-admin-form">
      ${idField}
      <label class="pf-admin-field">
        <span>${escapeHtml(t.flashFormTitleLabel)}</span>
        <input type="text" name="title" required value="${escapeHtml(f?.title ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.flashFormSlugLabel)}</span>
        <input type="text" name="slug" value="${escapeHtml(f?.slug ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.flashFormSummaryLabel)}</span>
        <textarea name="summary" required rows="5">${escapeHtml(f?.summary ?? '')}</textarea>
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.flashFormSourceLabel)}</span>
        <input type="text" name="sourceLabel" value="${escapeHtml(f?.sourceLabel ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.flashFormSourceUrlLabel)}</span>
        <input type="url" name="sourceUrl" value="${escapeHtml(f?.sourceUrl ?? '')}" placeholder="https://…" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.flashFormHackLabel)}</span>
        <input type="text" name="hack" value="${escapeHtml(f?.hack ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field pf-admin-check">
        <input type="checkbox" name="published"${f?.published ? ' checked' : ''} />
        <span>${escapeHtml(t.flashFormPublishedLabel)}</span>
      </label>
      <div class="pf-admin-form-actions">
        <button type="submit" class="pf-admin-btn">${escapeHtml(t.flashFormSave)}</button>
        ${deleteBtn}
      </div>
    </form>
    ${ISLAND}
  </section>
  <style>
    .pf-admin-flash-form .pf-admin-head--row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
    .pf-admin-link-back { font-size: 0.9rem; color: var(--nx-muted, #64748b); text-decoration: none; }
    .pf-admin-link-back:hover { color: var(--nx-text, #0f172a); }
    .pf-admin-form { max-width: 42rem; display: flex; flex-direction: column; gap: 1rem; }
    .pf-admin-field span { display: block; font-size: 0.8rem; font-weight: 600; color: var(--nx-muted, #64748b); margin-bottom: 0.35rem; }
    .pf-admin-field input[type="text"],
    .pf-admin-field input[type="url"],
    .pf-admin-field textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border: 1px solid var(--nx-border, #e8ecf0);
      border-radius: 8px;
      font: inherit;
    }
    .pf-admin-check { display: flex; align-items: center; gap: 0.5rem; flex-direction: row; }
    .pf-admin-check span { margin: 0; }
    .pf-admin-form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-top: 0.5rem; }
    .pf-admin-btn { display: inline-flex; align-items: center; padding: 0.45rem 0.9rem; border-radius: 8px; border: none; cursor: pointer; background: var(--nx-accent, #0f172a); color: #fff; font-size: 0.875rem; font-weight: 600; }
    .pf-admin-btn:hover { opacity: 0.92; }
    .pf-admin-btn--danger { background: #b91c1c; }
    .pf-admin-btn--danger:hover { opacity: 0.9; }
  </style>`;
}

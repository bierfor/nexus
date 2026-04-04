import { adminCopy } from './admin-copy.ts';
import type { Locale } from './i18n.ts';
import type { AdminArticleFull, AdminAuthorOption, AdminTagOption } from './admin-gql.ts';
import { mediaUploadUrlFromEnv } from './admin-gql.ts';

/** Safe JSON for embedding in <script type="application/json"> (no </script> break-out). */
export function jsonScriptPayload(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Labels used by the article form (from adminCopy). */
export type ArticleFormLabels = {
  articleNew: string;
  articleEdit: string;
  articleBackList: string;
  articleFormTitleLabel: string;
  articleFormSlugLabel: string;
  articleFormExcerptLabel: string;
  articleFormContentLabel: string;
  articleFormCoverLabel: string;
  articleFormCoverAltLabel: string;
  articleFormReadTimeLabel: string;
  articleFormAuthorLabel: string;
  articleFormAuthorNone: string;
  articleFormTagsLabel: string;
  articleFormPublishedLabel: string;
  articleFormSave: string;
  articleFormDelete: string;
  articleErrSave: string;
  articleFormDeleteConfirm: string;
  adminMediaUploadLabel: string;
  adminMediaUploadHint: string;
  adminMediaUploadErr: string;
};

/** Typed slice of `adminCopy` for the article form (avoids unsafe casts in routes). */
export function articleFormLabels(locale: Locale): ArticleFormLabels {
  const t = adminCopy(locale);
  return {
    articleNew: t.articleNew,
    articleEdit: t.articleEdit,
    articleBackList: t.articleBackList,
    articleFormTitleLabel: t.articleFormTitleLabel,
    articleFormSlugLabel: t.articleFormSlugLabel,
    articleFormExcerptLabel: t.articleFormExcerptLabel,
    articleFormContentLabel: t.articleFormContentLabel,
    articleFormCoverLabel: t.articleFormCoverLabel,
    articleFormCoverAltLabel: t.articleFormCoverAltLabel,
    articleFormReadTimeLabel: t.articleFormReadTimeLabel,
    articleFormAuthorLabel: t.articleFormAuthorLabel,
    articleFormAuthorNone: t.articleFormAuthorNone,
    articleFormTagsLabel: t.articleFormTagsLabel,
    articleFormPublishedLabel: t.articleFormPublishedLabel,
    articleFormSave: t.articleFormSave,
    articleFormDelete: t.articleFormDelete,
    articleErrSave: t.articleErrSave,
    articleFormDeleteConfirm: t.articleFormDeleteConfirm,
    adminMediaUploadLabel: t.adminMediaUploadLabel,
    adminMediaUploadHint: t.adminMediaUploadHint,
    adminMediaUploadErr: t.adminMediaUploadErr,
  };
}

const ISLAND = `<nexus-island
  data-nexus-island="pf_admin_article_form"
  data-nexus-island-index="0"
  data-nexus-component="/_nexus/islands/client.mjs?path=src%2Fcomponents%2FAdminArticleForm.nx"
  data-nexus-strategy="client:load"
><span aria-hidden="true"></span></nexus-island>`;

export function buildAdminArticleFormHtml(opts: {
  mode: 'new' | 'edit';
  article: AdminArticleFull | null;
  authors: AdminAuthorOption[];
  tags: AdminTagOption[];
  t: ArticleFormLabels;
  listPath: string;
}): string {
  const { mode, article, authors, tags, t, listPath } = opts;
  const a = article;
  const title = mode === 'new' ? t.articleNew : t.articleEdit;
  const tagSet = new Set((a?.tags ?? []).map((x) => x.slug));

  const authorOptions = [
    `<option value="">${escapeHtml(t.articleFormAuthorNone)}</option>`,
    ...authors.map(
      (o) =>
        `<option value="${escapeHtml(o.id)}"${a?.author?.id === o.id ? ' selected' : ''}>${escapeHtml(o.name)}</option>`,
    ),
  ].join('');

  const tagBoxes = tags
    .map((tag) => {
      const checked = tagSet.has(tag.slug) ? ' checked' : '';
      return `<label class="pf-admin-tag"><input type="checkbox" name="tagSlugs" value="${escapeHtml(tag.slug)}"${checked} /> ${escapeHtml(tag.name)}</label>`;
    })
    .join(' ');

  const bootstrap = jsonScriptPayload({
    mode,
    listPath,
    errSave: t.articleErrSave,
    confirmDelete: mode === 'edit' ? t.articleFormDeleteConfirm : '',
    uploadUrl: mediaUploadUrlFromEnv(),
    errUpload: t.adminMediaUploadErr,
  });

  const idField =
    mode === 'edit' && a ? `<input type="hidden" name="id" value="${escapeHtml(a.id)}" />` : '';

  const deleteBtn =
    mode === 'edit' && a
      ? `<button type="button" class="pf-admin-btn pf-admin-btn--danger" id="pf-admin-article-delete" data-id="${escapeHtml(a.id)}">${escapeHtml(t.articleFormDelete)}</button>`
      : '';

  return `
  <section class="pf-admin-page pf-admin-article-form">
    <header class="pf-admin-head pf-admin-head--row">
      <h1 class="pf-admin-h1">${escapeHtml(title)}</h1>
      <a class="pf-admin-link-back" href="${escapeHtml(listPath)}">${escapeHtml(t.articleBackList)}</a>
    </header>
    <script type="application/json" id="pf-admin-article-bootstrap">${bootstrap}</script>
    <form id="pf-admin-article-form" class="pf-admin-form">
      ${idField}
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormTitleLabel)}</span>
        <input type="text" name="title" required value="${escapeHtml(a?.title ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormSlugLabel)}</span>
        <input type="text" name="slug" required value="${escapeHtml(a?.slug ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormExcerptLabel)}</span>
        <textarea name="excerpt" rows="3">${escapeHtml(a?.excerpt ?? '')}</textarea>
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormContentLabel)}</span>
        <textarea name="content" required rows="16" class="pf-admin-textarea-code">${escapeHtml(a?.content ?? '')}</textarea>
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormCoverLabel)}</span>
        <input type="url" name="coverImage" id="pf-admin-cover-url" value="${escapeHtml(a?.coverImage ?? '')}" placeholder="https://…" />
      </label>
      <label class="pf-admin-field pf-admin-file-row">
        <span>${escapeHtml(t.adminMediaUploadLabel)}</span>
        <input type="file" accept="image/*" id="pf-admin-cover-file" />
        <p class="pf-admin-upload-hint">${escapeHtml(t.adminMediaUploadHint)}</p>
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormCoverAltLabel)}</span>
        <input type="text" name="coverImageAlt" value="${escapeHtml(a?.coverImageAlt ?? '')}" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormReadTimeLabel)}</span>
        <input type="number" name="readTimeMinutes" min="0" step="1" value="${a?.readTimeMinutes != null ? String(a.readTimeMinutes) : ''}" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.articleFormAuthorLabel)}</span>
        <select name="authorId">${authorOptions}</select>
      </label>
      <fieldset class="pf-admin-field pf-admin-tags">
        <legend>${escapeHtml(t.articleFormTagsLabel)}</legend>
        <div class="pf-admin-tag-grid">${tagBoxes}</div>
      </fieldset>
      <label class="pf-admin-field pf-admin-check">
        <input type="checkbox" name="published"${a?.published ? ' checked' : ''} />
        <span>${escapeHtml(t.articleFormPublishedLabel)}</span>
      </label>
      <div class="pf-admin-form-actions">
        <button type="submit" class="pf-admin-btn">${escapeHtml(t.articleFormSave)}</button>
        ${deleteBtn}
      </div>
    </form>
    ${ISLAND}
  </section>
  <style>
    .pf-admin-article-form .pf-admin-head--row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
    .pf-admin-link-back { font-size: 0.9rem; color: var(--nx-muted, #64748b); text-decoration: none; }
    .pf-admin-link-back:hover { color: var(--nx-text, #0f172a); }
    .pf-admin-form { max-width: 42rem; display: flex; flex-direction: column; gap: 1rem; }
    .pf-admin-field span { display: block; font-size: 0.8rem; font-weight: 600; color: var(--nx-muted, #64748b); margin-bottom: 0.35rem; }
    .pf-admin-field input[type="text"],
    .pf-admin-file-row input[type="file"] { font: inherit; font-size: 0.9rem; }
    .pf-admin-upload-hint { margin: 0.35rem 0 0; font-size: 0.78rem; color: var(--nx-muted, #64748b); line-height: 1.45; }
    .pf-admin-field input[type="url"],
    .pf-admin-field input[type="number"],
    .pf-admin-field select,
    .pf-admin-field textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border: 1px solid var(--nx-border, #e8ecf0);
      border-radius: 8px;
      font: inherit;
    }
    .pf-admin-textarea-code { font-family: ui-monospace, monospace; font-size: 0.85rem; }
    .pf-admin-tags legend { font-size: 0.8rem; font-weight: 600; color: var(--nx-muted, #64748b); padding: 0; margin-bottom: 0.5rem; }
    .pf-admin-tag-grid { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }
    .pf-admin-tag { font-size: 0.85rem; cursor: pointer; }
    .pf-admin-check { display: flex; align-items: center; gap: 0.5rem; flex-direction: row; }
    .pf-admin-check span { margin: 0; }
    .pf-admin-form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-top: 0.5rem; }
    .pf-admin-btn { display: inline-flex; align-items: center; padding: 0.45rem 0.9rem; border-radius: 8px; border: none; cursor: pointer; background: var(--nx-accent, #0f172a); color: #fff; font-size: 0.875rem; font-weight: 600; }
    .pf-admin-btn:hover { opacity: 0.92; }
    .pf-admin-btn--danger { background: #b91c1c; }
    .pf-admin-btn--danger:hover { opacity: 0.9; }
  </style>`;
}

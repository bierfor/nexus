import { adminCopy } from './admin-copy.ts';
import type { Locale } from './i18n.ts';
import type { AdminHeroFull } from './admin-gql.ts';
import { mediaUploadUrlFromEnv } from './admin-gql.ts';
import { escapeHtml, jsonScriptPayload } from './admin-article-ssr.ts';

export type HeroFormLabels = {
  heroNew: string;
  heroEdit: string;
  heroBackList: string;
  heroFormSlugLabel: string;
  heroFormSlugHint: string;
  heroFormKickerLabel: string;
  heroFormHeadlineLabel: string;
  heroFormSubheadlineLabel: string;
  heroFormBodyLabel: string;
  heroFormBodySecondaryLabel: string;
  heroFormImageUrlLabel: string;
  heroFormFooterCtaLabel: string;
  heroFormFooterCtaHrefLabel: string;
  heroFormPublishedLabel: string;
  heroFormSave: string;
  heroFormDelete: string;
  heroErrSave: string;
  heroFormDeleteConfirm: string;
  adminMediaUploadLabel: string;
  adminMediaUploadHint: string;
  adminMediaUploadErr: string;
};

export function heroFormLabels(locale: Locale): HeroFormLabels {
  const t = adminCopy(locale);
  return {
    heroNew: t.heroNew,
    heroEdit: t.heroEdit,
    heroBackList: t.heroBackList,
    heroFormSlugLabel: t.heroFormSlugLabel,
    heroFormSlugHint: t.heroFormSlugHint,
    heroFormKickerLabel: t.heroFormKickerLabel,
    heroFormHeadlineLabel: t.heroFormHeadlineLabel,
    heroFormSubheadlineLabel: t.heroFormSubheadlineLabel,
    heroFormBodyLabel: t.heroFormBodyLabel,
    heroFormBodySecondaryLabel: t.heroFormBodySecondaryLabel,
    heroFormImageUrlLabel: t.heroFormImageUrlLabel,
    heroFormFooterCtaLabel: t.heroFormFooterCtaLabel,
    heroFormFooterCtaHrefLabel: t.heroFormFooterCtaHrefLabel,
    heroFormPublishedLabel: t.heroFormPublishedLabel,
    heroFormSave: t.heroFormSave,
    heroFormDelete: t.heroFormDelete,
    heroErrSave: t.heroErrSave,
    heroFormDeleteConfirm: t.heroFormDeleteConfirm,
    adminMediaUploadLabel: t.adminMediaUploadLabel,
    adminMediaUploadHint: t.adminMediaUploadHint,
    adminMediaUploadErr: t.adminMediaUploadErr,
  };
}

const ISLAND = `<nexus-island
  data-nexus-island="pf_admin_hero_form"
  data-nexus-island-index="0"
  data-nexus-component="/_nexus/islands/client.mjs?path=src%2Fcomponents%2FAdminHeroForm.nx"
  data-nexus-strategy="client:load"
><span aria-hidden="true"></span></nexus-island>`;

export function buildAdminHeroFormHtml(opts: {
  mode: 'new' | 'edit';
  hero: AdminHeroFull | null;
  t: HeroFormLabels;
  listPath: string;
}): string {
  const { mode, hero, t, listPath } = opts;
  const h = hero;
  const title = mode === 'new' ? t.heroNew : t.heroEdit;

  const bootstrap = jsonScriptPayload({
    mode,
    listPath,
    errSave: t.heroErrSave,
    confirmDelete: mode === 'edit' ? t.heroFormDeleteConfirm : '',
    slug: h?.slug ?? '',
    uploadUrl: mediaUploadUrlFromEnv(),
    errUpload: t.adminMediaUploadErr,
  });

  const slugBlock =
    mode === 'edit' && h
      ? `<input type="hidden" name="slug" value="${escapeHtml(h.slug)}" />
      <p class="pf-admin-field pf-admin-slug-readonly"><span>${escapeHtml(t.heroFormSlugLabel)}</span><code>${escapeHtml(h.slug)}</code></p>
      <p class="pf-admin-hint">${escapeHtml(t.heroFormSlugHint)}</p>`
      : `<label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormSlugLabel)}</span>
        <input type="text" name="slug" required value="" autocomplete="off" />
      </label>
      <p class="pf-admin-hint">${escapeHtml(t.heroFormSlugHint)}</p>`;

  const deleteBtn =
    mode === 'edit' && h
      ? `<button type="button" class="pf-admin-btn pf-admin-btn--danger" id="pf-admin-hero-delete" data-slug="${escapeHtml(h.slug)}">${escapeHtml(t.heroFormDelete)}</button>`
      : '';

  return `
  <section class="pf-admin-page pf-admin-hero-form">
    <header class="pf-admin-head pf-admin-head--row">
      <h1 class="pf-admin-h1">${escapeHtml(title)}</h1>
      <a class="pf-admin-link-back" href="${escapeHtml(listPath)}">${escapeHtml(t.heroBackList)}</a>
    </header>
    <script type="application/json" id="pf-admin-hero-bootstrap">${bootstrap}</script>
    <form id="pf-admin-hero-form" class="pf-admin-form">
      ${slugBlock}
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormKickerLabel)}</span>
        <input type="text" name="kicker" value="${escapeHtml(h?.kicker ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormHeadlineLabel)}</span>
        <input type="text" name="headline" required value="${escapeHtml(h?.headline ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormSubheadlineLabel)}</span>
        <input type="text" name="subheadline" value="${escapeHtml(h?.subheadline ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormBodyLabel)}</span>
        <textarea name="body" required rows="8" class="pf-admin-textarea-code">${escapeHtml(h?.body ?? '')}</textarea>
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormBodySecondaryLabel)}</span>
        <textarea name="bodySecondary" rows="4">${escapeHtml(h?.bodySecondary ?? '')}</textarea>
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormImageUrlLabel)}</span>
        <input type="url" name="imageUrl" id="pf-admin-hero-image-url" value="${escapeHtml(h?.imageUrl ?? '')}" placeholder="https://…" />
      </label>
      <label class="pf-admin-field pf-admin-file-row">
        <span>${escapeHtml(t.adminMediaUploadLabel)}</span>
        <input type="file" accept="image/*" id="pf-admin-hero-image-file" />
        <p class="pf-admin-upload-hint">${escapeHtml(t.adminMediaUploadHint)}</p>
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormFooterCtaLabel)}</span>
        <input type="text" name="footerCtaLabel" value="${escapeHtml(h?.footerCtaLabel ?? '')}" autocomplete="off" />
      </label>
      <label class="pf-admin-field">
        <span>${escapeHtml(t.heroFormFooterCtaHrefLabel)}</span>
        <input type="url" name="footerCtaHref" value="${escapeHtml(h?.footerCtaHref ?? '')}" placeholder="https://…" />
      </label>
      <label class="pf-admin-field pf-admin-check">
        <input type="checkbox" name="published"${h?.published !== false ? ' checked' : ''} />
        <span>${escapeHtml(t.heroFormPublishedLabel)}</span>
      </label>
      <div class="pf-admin-form-actions">
        <button type="submit" class="pf-admin-btn">${escapeHtml(t.heroFormSave)}</button>
        ${deleteBtn}
      </div>
    </form>
    ${ISLAND}
  </section>
  <style>
    .pf-admin-hero-form .pf-admin-head--row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
    .pf-admin-link-back { font-size: 0.9rem; color: var(--nx-muted, #64748b); text-decoration: none; }
    .pf-admin-link-back:hover { color: var(--nx-text, #0f172a); }
    .pf-admin-form { max-width: 42rem; display: flex; flex-direction: column; gap: 1rem; }
    .pf-admin-field span { display: block; font-size: 0.8rem; font-weight: 600; color: var(--nx-muted, #64748b); margin-bottom: 0.35rem; }
    .pf-admin-slug-readonly code { display: block; margin-top: 0.35rem; font-size: 0.95rem; }
    .pf-admin-hint { margin: -0.5rem 0 0; font-size: 0.8rem; color: var(--nx-muted, #64748b); }
    .pf-admin-file-row input[type="file"] { font: inherit; font-size: 0.9rem; }
    .pf-admin-upload-hint { margin: 0.35rem 0 0; font-size: 0.78rem; color: var(--nx-muted, #64748b); line-height: 1.45; }
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
    .pf-admin-textarea-code { font-family: ui-monospace, monospace; font-size: 0.85rem; }
    .pf-admin-check { display: flex; align-items: center; gap: 0.5rem; flex-direction: row; }
    .pf-admin-check span { margin: 0; }
    .pf-admin-form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-top: 0.5rem; }
    .pf-admin-btn { display: inline-flex; align-items: center; padding: 0.45rem 0.9rem; border-radius: 8px; border: none; cursor: pointer; background: var(--nx-accent, #0f172a); color: #fff; font-size: 0.875rem; font-weight: 600; }
    .pf-admin-btn:hover { opacity: 0.92; }
    .pf-admin-btn--danger { background: #b91c1c; }
    .pf-admin-btn--danger:hover { opacity: 0.9; }
  </style>`;
}

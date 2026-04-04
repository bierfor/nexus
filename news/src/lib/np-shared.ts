/** Shared editorial surface styles (light, abstract) for list/detail pages. */

export const NP_FONT_FACE = `@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Newsreader:ital,opsz,wght@0,6..72,400..800;1,6..72,400..600&display=swap');`;

export const NP_PAGE_CSS = `
${NP_FONT_FACE}
.np-surface {
  --np-paper: #ffffff;
  --np-ink: #0f172a;
  --np-muted: #64748b;
  --np-rule: #e2e8f0;
  --np-accent: #2563eb;
  --np-headline: "Newsreader", "Libre Baskerville", Georgia, serif;
  --np-body: "Libre Baskerville", Georgia, "Times New Roman", serif;
  font-family: var(--np-body);
  color: var(--np-ink);
  background: var(--np-paper);
  border: 1px solid var(--np-rule);
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 40px rgba(15, 23, 42, 0.04);
  max-width: 56rem;
  margin: 0 auto;
  padding: 1.75rem 1.25rem 2.25rem;
}
@media (min-width: 640px) {
  .np-surface { padding: 2rem 2rem 2.5rem; }
}
.np-page__eyebrow {
  margin: 0 0 0.5rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--np-muted);
}
.np-page__title {
  margin: 0 0 0.75rem;
  font-family: var(--np-headline);
  font-weight: 700;
  font-size: clamp(1.5rem, 3vw, 2rem);
  letter-spacing: -0.03em;
  line-height: 1.12;
}
.np-page__lead {
  margin: 0 0 1.5rem;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--np-muted);
  max-width: 40rem;
}
.np-abstract-grid {
  display: grid;
  gap: 1rem;
}
@media (min-width: 640px) {
  .np-abstract-grid--2 { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 900px) {
  .np-abstract-grid--3 { grid-template-columns: repeat(3, 1fr); }
}
.np-card {
  display: block;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--np-rule);
  border-radius: 2px;
  padding: 1rem 1.1rem;
  background: #fff;
  transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}
a.np-card:hover {
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  border-color: #cbd5e1;
  transform: translateY(-1px);
}
.np-card__title {
  margin: 0 0 0.4rem;
  font-family: var(--np-headline);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.np-card__meta {
  margin: 0;
  font-size: 0.75rem;
  color: var(--np-muted);
}
.np-card__excerpt {
  margin: 0.5rem 0 0;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--np-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.np-pill {
  display: inline-block;
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--np-rule);
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--np-muted);
  text-decoration: none;
  background: #f8fafc;
  transition: border-color 0.15s ease, color 0.15s ease;
}
a.np-pill:hover {
  color: var(--np-accent);
  border-color: #bfdbfe;
}
.np-empty {
  text-align: center;
  padding: 2rem 0.5rem;
  color: var(--np-muted);
  font-size: 0.92rem;
}
`;

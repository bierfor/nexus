/**
 * i18n — aligned with nexus.config.ts `i18n.locales`.
 * Resolve locale per request: ?lang= → cookie nx-lang → Accept-Language → default.
 */

export type Locale = 'en' | 'es' | 'pt';

export const LOCALES: Locale[] = ['en', 'es', 'pt'];
export const DEFAULT_LOCALE: Locale = 'en';

type CtxLike = {
  url: URL;
  getCookie: (name: string) => string | undefined;
  request: Request;
};

/** Prefer `ctx.pretext.locale` from root layout pretext when present (same as `getLocale`, one source of truth). */
export type CtxWithPretext = CtxLike & { pretext?: Record<string, unknown> };

export function getLocaleFromCtx(ctx: CtxWithPretext): Locale {
  const p = ctx.pretext?.locale;
  if (p === 'en' || p === 'es' || p === 'pt') return p;
  return getLocale(ctx);
}

function isLocale(s: string | undefined | null): s is Locale {
  return s === 'en' || s === 'es' || s === 'pt';
}

/** Active locale for this request (use in templates: getLocale(ctx)). */
export function getLocale(ctx: CtxLike): Locale {
  const q = ctx.url.searchParams.get('lang') ?? ctx.url.searchParams.get('locale');
  if (q) {
    const norm = q.trim().split('-')[0]?.toLowerCase();
    if (isLocale(norm)) return norm;
  }
  const ck = ctx.getCookie('nx-lang');
  if (isLocale(ck)) return ck;
  const al = ctx.request.headers.get('accept-language');
  if (al) {
    const first = al.split(',')[0]?.trim().split('-')[0]?.toLowerCase();
    if (first === 'es' || first === 'pt') return first;
  }
  return DEFAULT_LOCALE;
}

/** Same path + query, with `lang` set (preserves other search params). */
export function langHref(ctx: CtxLike, locale: Locale): string {
  const u = new URL(ctx.url.href);
  u.searchParams.set('lang', locale);
  return u.pathname + u.search;
}

/** Internal link with current locale in `lang` (e.g. `/?lang=es`). */
export function pathWithLang(ctx: CtxLike, pathname: string): string {
  const u = new URL(ctx.url.href);
  u.pathname = pathname;
  u.searchParams.set('lang', getLocale(ctx));
  return u.pathname + u.search;
}

/** Fallback so layout nav labels never render as the string "undefined" (stale cache / bad locale). */
const LAYOUT_DEFAULTS_EN = {
  appName: 'Puro Flusso',
  metaDescription:
    'Editorial stories and live wire — science, systems, and culture. Puro Flusso: clarity without noise.',
  /** Home page document title — primary keyword + brand (keep concise for SERP). */
  homeTitle: 'Puro Flusso — Editorial news & live wire | Less noise, more signal',
  /** Meta description home — compelling, honest (≈150–160 chars). */
  homeMetaDescription:
    'Independent editorial: sharp analysis, live wire updates, and long-form stories. No clickbait — depth you can use. Read Puro Flusso today.',
  /** Open Graph title (can match or shorten homeTitle). */
  homeOgTitle: 'Puro Flusso — Editorial news & live wire',
  ogSiteName: 'Puro Flusso',
  langAria: 'Language',
  footerTagline: 'Editorial · Puro Flusso',
  footerMade: 'Built with',
  /** Document title + OG for `/flash` index (execution-intel positioning). */
  flashIndexTitle: 'Wire — execution intel',
  flashIndexMeta:
    'Flash wire: models, APIs, prompts, and fixes — fast. High-intent, zero fluff. Puro Flusso.',
  navHome: 'Home',
  navFlash: 'Wire',
  navTags: 'Topics',
  navAuthors: 'Authors',
  navLogin: 'Sign in',
  navRegister: 'Register',
  navAdmin: 'Admin',
  navLogout: 'Sign out',
  navAria: 'Main',
} as const;

/** Keys allowed in root +layout — use with `layoutStr(ctx, 'navHome')` (no `a.b` in `{…}` templates). */
export type LayoutCopyKey =
  | 'navHome'
  | 'navFlash'
  | 'navTags'
  | 'navAuthors'
  | 'navLogin'
  | 'navRegister'
  | 'navAdmin'
  | 'navLogout'
  | 'navAria'
  | 'appName'
  | 'metaDescription'
  | 'langAria'
  | 'footerMade'
  | 'footerTagline';

/** Safe for +layout.nx: one `{layoutStr(ctx, 'navHome')}` instead of `{layoutCopy(getLocale(ctx)).navHome}`. */
export function layoutStr(ctx: CtxLike, key: LayoutCopyKey): string {
  const c = layoutCopy(getLocale(ctx));
  const v = c[key];
  return v == null ? '' : String(v);
}

export function layoutCopy(locale: Locale) {
  const t = {
    en: { ...LAYOUT_DEFAULTS_EN },
    es: {
      appName: 'Puro Flusso',
      metaDescription:
        'Historias editoriales y cable en vivo — ciencia, sistemas y cultura. Puro Flusso: claridad sin ruido.',
      homeTitle: 'Puro Flusso — Noticias editoriales y cable | Menos ruido, más señal',
      homeMetaDescription:
        'Editorial independiente: análisis, cable en vivo y reportajes largos. Sin clickbait — profundidad útil. Lee Puro Flusso.',
      homeOgTitle: 'Puro Flusso — Noticias editoriales y cable',
      ogSiteName: 'Puro Flusso',
      langAria: 'Idioma',
      footerTagline: 'Editorial · Puro Flusso',
      footerMade: 'Hecho con',
      flashIndexTitle: 'Cable — intel de ejecución',
      flashIndexMeta:
        'Cable relámpago: modelos, APIs, prompts y arreglos — al grano. Alta intención, sin relleno. Puro Flusso.',
      navHome: 'Inicio',
      navFlash: 'Cable',
      navTags: 'Temas',
      navAuthors: 'Autores',
      navLogin: 'Entrar',
      navRegister: 'Registro',
      navAdmin: 'Admin',
      navLogout: 'Salir',
      navAria: 'Principal',
    },
    pt: {
      appName: 'Puro Flusso',
      metaDescription:
        'Histórias editoriais e fio ao vivo — ciência, sistemas e cultura. Puro Flusso: clareza sem ruído.',
      homeTitle: 'Puro Flusso — Notícias editoriais e fio | Menos ruído, mais sinal',
      homeMetaDescription:
        'Editorial independente: análises, fio ao vivo e reportagens. Sem clickbait — profundidade que você usa. Leia Puro Flusso.',
      homeOgTitle: 'Puro Flusso — Notícias editoriais e fio',
      ogSiteName: 'Puro Flusso',
      langAria: 'Idioma',
      footerTagline: 'Editorial · Puro Flusso',
      footerMade: 'Feito com',
      flashIndexTitle: 'Fio — intel de execução',
      flashIndexMeta:
        'Fio relâmpago: modelos, APIs, prompts e correções — direto. Alta intenção, sem enrolação. Puro Flusso.',
      navHome: 'Início',
      navFlash: 'Fio',
      navTags: 'Temas',
      navAuthors: 'Autores',
      navLogin: 'Entrar',
      navRegister: 'Registo',
      navAdmin: 'Admin',
      navLogout: 'Sair',
      navAria: 'Principal',
    },
  };
  const key: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const row = t[key] ?? t.en;
  return { ...LAYOUT_DEFAULTS_EN, ...row };
}

/** Localize internal paths for `lang=` while preserving hash (e.g. `/#section`). */
export function localizeAppHref(ctx: CtxLike, href: string): string {
  const h = href.trim();
  if (!h || /^https?:\/\//i.test(h)) return h;
  const hashIdx = h.indexOf('#');
  const hash = hashIdx >= 0 ? h.slice(hashIdx) : '';
  const pathOnly = hashIdx >= 0 ? h.slice(0, hashIdx) : h;
  let pathname = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  if (pathname === '' || pathname === '/') pathname = '/';
  return pathWithLang(ctx, pathname) + hash;
}

export function langActiveClass(ctx: CtxLike, locale: Locale): string {
  return getLocale(ctx) === locale ? 'nx-lang-btn--on' : '';
}

/** Newspaper-style home + article (routes `/`, `/news/*`). */
export function newsPageCopy(locale: Locale) {
  const t = {
    en: {
      masthead: 'Puro Flusso',
      /** Landmark label for the /news/* layout region (screen readers). */
      sectionAria: 'News story',
      indexKicker: 'Latest from the wire',
      moreHeadlines: 'More headlines',
      minRead: 'min read',
      backToNews: 'All stories',
      coverPhoto: 'Cover',
      emptyTitle: 'No edition today',
      emptyLead:
        'There are no published stories, or the GraphQL API is unreachable. Start mongo/backend and set NEXUS_GRAPHQL_URL in .env if needed.',
      wireFrom: 'Feed',
      /** Ethical curiosity / clarity (no manipulation — honest editorial hook). */
      homePsychLine: 'What you read next shapes how you think — start with the story that matters.',
      homeTrustLine: 'Editorial · Fresh editions · Straight to the point',
      mastSubTagline: 'Independent editorial · Live wire',
      heroCtaFallback: 'View stories',
      flashStripTitle: 'Wire',
      flashStripMore: 'All wire',
      explorerFlashTitle: 'Wire',
      explorerFlashLead:
        'Execution intel, not hype: models, APIs, and workflows you can ship today — fast, blunt, useful.',
      flashRelatedHead: 'More on the wire',
      flashCtaNext: 'Next productivity hack →',
      explorerTagsTitle: 'Topics',
      explorerTagsLead: 'Browse the tag index from your GraphQL API.',
      explorerAuthorsTitle: 'Authors',
      explorerAuthorsLead: 'People behind the bylines.',
      explorerStories: 'Stories',
      explorerHack: 'Hack',
      explorerSource: 'Source',
      explorerEmpty: 'Nothing here yet.',
      explorerNotFound: 'Not found.',
      explorerBackStories: 'All stories',
    },
    es: {
      masthead: 'Puro Flusso',
      sectionAria: 'Noticia',
      indexKicker: 'Últimas del cable',
      moreHeadlines: 'Más titulares',
      minRead: 'min lectura',
      backToNews: 'Todas las noticias',
      coverPhoto: 'Portada',
      emptyTitle: 'Sin edición hoy',
      emptyLead:
        'No hay artículos publicados o el API GraphQL no responde. Arranca mongo/backend y revisa NEXUS_GRAPHQL_URL en .env.',
      wireFrom: 'Cable',
      homePsychLine:
        'Lo que lees después moldea cómo piensas — empieza por la historia que importa.',
      homeTrustLine: 'Editorial · Ediciones al día · Sin rodeos',
      mastSubTagline: 'Editorial independiente · Cable en vivo',
      heroCtaFallback: 'Ver historias',
      flashStripTitle: 'Cable',
      flashStripMore: 'Todo el cable',
      explorerFlashTitle: 'Cable',
      explorerFlashLead:
        'Intel de ejecución, no ruido: modelos, APIs y flujos que puedes desplegar hoy — rápido, directo, útil.',
      flashRelatedHead: 'Más en el cable',
      flashCtaNext: 'Dame otro hack de productividad →',
      explorerTagsTitle: 'Temas',
      explorerTagsLead: 'Índice de etiquetas vía GraphQL.',
      explorerAuthorsTitle: 'Autores',
      explorerAuthorsLead: 'Quienes firman las piezas.',
      explorerStories: 'Historias',
      explorerHack: 'Hack',
      explorerSource: 'Fuente',
      explorerEmpty: 'Aún no hay contenido.',
      explorerNotFound: 'No encontrado.',
      explorerBackStories: 'Todas las noticias',
    },
    pt: {
      masthead: 'Puro Flusso',
      sectionAria: 'Notícia',
      indexKicker: 'Últimas do fio',
      moreHeadlines: 'Mais manchetes',
      minRead: 'min de leitura',
      backToNews: 'Todas as notícias',
      coverPhoto: 'Capa',
      emptyTitle: 'Sem edição hoje',
      emptyLead:
        'Não há artigos publicados ou o GraphQL não responde. Inicie mongo/backend e confira NEXUS_GRAPHQL_URL no .env.',
      wireFrom: 'Fio',
      homePsychLine:
        'O que você lê em seguida molda como pensa — comece pela história que importa.',
      homeTrustLine: 'Editorial · Edições frescas · Direto ao ponto',
      mastSubTagline: 'Editorial independente · Fio ao vivo',
      heroCtaFallback: 'Ver histórias',
      flashStripTitle: 'Fio',
      flashStripMore: 'Todo o fio',
      explorerFlashTitle: 'Fio',
      explorerFlashLead:
        'Intel de execução, não hype: modelos, APIs e fluxos para colocar no ar hoje — rápido, direto, útil.',
      flashRelatedHead: 'Mais no fio',
      flashCtaNext: 'Próximo hack de produtividade →',
      explorerTagsTitle: 'Temas',
      explorerTagsLead: 'Índice de etiquetas via GraphQL.',
      explorerAuthorsTitle: 'Autores',
      explorerAuthorsLead: 'Quem assina as matérias.',
      explorerStories: 'Histórias',
      explorerHack: 'Hack',
      explorerSource: 'Fonte',
      explorerEmpty: 'Ainda sem conteúdo.',
      explorerNotFound: 'Não encontrado.',
      explorerBackStories: 'Todas as notícias',
    },
  };
  const key: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return t[key] ?? t.en;
}

/** Copy for `/login` and `/register` (admin login + newsletter via `POST /leads`). */
export function authCopy(locale: Locale) {
  const t = {
    en: {
      loginTitle: 'Sign in',
      loginLead: 'Editorial access — use the same email and password as the CMS admin.',
      loginEmail: 'Email',
      loginPassword: 'Password',
      loginSubmit: 'Sign in',
      loginSuccess: 'Signed in. Your session token is stored in this browser.',
      loginError: 'Could not sign in. Check your credentials.',
      loginLinkRegister: 'Join the newsletter',
      registerTitle: 'Newsletter',
      registerLead:
        'Subscribe with your email. We only send updates when there is something worth reading — no noise.',
      registerEmail: 'Email address',
      registerSubmit: 'Subscribe',
      registerSuccess: "You're on the list.",
      registerError: 'Could not subscribe. Check your email and try again.',
      registerLinkLogin: 'Editorial sign in',
      privacyHint: 'We use your email only for this list. You can leave anytime.',
    },
    es: {
      loginTitle: 'Entrar',
      loginLead: 'Acceso editorial — mismo email y contraseña que el admin del CMS.',
      loginEmail: 'Correo',
      loginPassword: 'Contraseña',
      loginSubmit: 'Entrar',
      loginSuccess: 'Sesión iniciada. El token se guarda en este navegador.',
      loginError: 'No se pudo entrar. Revisa credenciales.',
      loginLinkRegister: 'Suscribirse al boletín',
      registerTitle: 'Boletín',
      registerLead:
        'Déjanos tu correo. Solo escribimos cuando haya algo que merezca leerse — sin ruido.',
      registerEmail: 'Correo electrónico',
      registerSubmit: 'Suscribirme',
      registerSuccess: 'Estás en la lista.',
      registerError: 'No se pudo guardar. Revisa el correo e inténtalo de nuevo.',
      registerLinkLogin: 'Acceso editorial',
      privacyHint: 'Usamos tu correo solo para este boletín. Puedes darte de baja cuando quieras.',
    },
    pt: {
      loginTitle: 'Entrar',
      loginLead: 'Acesso editorial — mesmo e-mail e palavra-passe do admin do CMS.',
      loginEmail: 'E-mail',
      loginPassword: 'Palavra-passe',
      loginSubmit: 'Entrar',
      loginSuccess: 'Sessão iniciada. O token fica guardado neste navegador.',
      loginError: 'Não foi possível entrar. Verifique as credenciais.',
      loginLinkRegister: 'Assinar a newsletter',
      registerTitle: 'Newsletter',
      registerLead:
        'Deixe seu e-mail. Só enviamos quando houver algo que valha a pena — sem ruído.',
      registerEmail: 'E-mail',
      registerSubmit: 'Assinar',
      registerSuccess: 'Você está na lista.',
      registerError: 'Não foi possível guardar. Verifique o e-mail e tente de novo.',
      registerLinkLogin: 'Acesso editorial',
      privacyHint: 'Usamos seu e-mail só para esta lista. Pode sair quando quiser.',
    },
  };
  const key: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return t[key] ?? t.en;
}

/** Use inside `+page.nx` templates only (`renderTemplate(ctx)` has `ctx`). Not in frontmatter. */
export function authPageCopy(ctx: CtxLike) {
  return authCopy(getLocale(ctx));
}

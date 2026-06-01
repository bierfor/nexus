// PayLinks i18n — Simple locale resolver + translations
// Nexus i18n is opt-in; the framework provides config types but the app
// implements its own resolution logic.

export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['en', 'es', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];

export interface I18nContext {
  locale: Locale;
  t: (key: string) => string;
}

function parseAcceptLanguage(header: string | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const langs = header
    .split(',')
    .map((s) => s.split(';')[0]?.trim().slice(0, 2))
    .filter(Boolean) as string[];
  for (const l of langs) {
    if ((LOCALES as readonly string[]).includes(l)) return l as Locale;
  }
  return DEFAULT_LOCALE;
}

export function resolveLocale(ctx: { url: URL; getCookie: (name: string) => string | undefined; headers?: { get: (name: string) => string | null } }): Locale {
  const urlLang = ctx.url.searchParams.get('lang') ?? ctx.url.searchParams.get('locale');
  if (urlLang && (LOCALES as readonly string[]).includes(urlLang)) return urlLang as Locale;

  const cookieLang = ctx.getCookie('pl_lang');
  if (cookieLang && (LOCALES as readonly string[]).includes(cookieLang)) return cookieLang as Locale;

  const acceptLang = ctx.headers?.get('accept-language');
  return parseAcceptLanguage(acceptLang ?? undefined);
}

export function langHref(url: URL, locale: Locale): string {
  const u = new URL(url);
  u.searchParams.set('lang', locale);
  return u.pathname + u.search;
}

// ── Translations ────────────────────────────────────────────────────────────

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Nav / Layout
    'nav.dashboard': 'Dashboard',
    'nav.links': 'Links',
    'nav.transactions': 'Transactions',
    'nav.vault': 'Vault',
    'nav.logout': 'Logout',
    'nav.login': 'Sign In',

    // Landing
    'landing.badge': 'Now on Nexus.js',
    'landing.title': 'Generate payment links',
    'landing.titleAccent': 'in seconds',
    'landing.subtitle': 'PayLinks lets you create, manage and share custom payment links without a full online store. Receive payments simply and securely.',
    'landing.ctaPrimary': 'Get started free',
    'landing.ctaSecondary': 'View demo',
    'landing.stat.processed': 'Processed',
    'landing.stat.links': 'Links created',
    'landing.stat.uptime': 'Uptime',

    // Features
    'features.title': 'Everything you need to get paid',
    'features.subtitle': 'Tools designed for freelancers, content creators and small businesses.',
    'features.speed.title': 'Create in seconds',
    'features.speed.desc': 'Generate a payment link with title, amount and currency in under a minute. No complex setup.',
    'features.share.title': 'Share anywhere',
    'features.share.desc': 'Send your link via WhatsApp, email, social media or embed it on your website. Customers pay with one click.',
    'features.dashboard.title': 'Real-time dashboard',
    'features.dashboard.desc': 'View transactions, revenue and key metrics from an intuitive, always-updated panel.',
    'features.security.title': 'Built-in security',
    'features.security.desc': 'Fraud protection, rate limiting and secure cookies. Your money and data always protected.',
    'features.currency.title': 'Multi-currency',
    'features.currency.desc': 'Supports USD, EUR and GBP. Receive payments from customers worldwide without hassle.',
    'features.responsive.title': '100% Responsive',
    'features.responsive.desc': 'Your payment links look perfect on any device: mobile, tablet or desktop.',

    // CTA
    'cta.title': 'Ready to start getting paid?',
    'cta.subtitle': 'Create your free account in seconds and issue your first payment link today. No hidden fees, no contracts.',
    'cta.button': 'Create free account →',

    // Login
    'login.title': 'Welcome to PayLinks',
    'login.subtitle': 'Sign in to manage your payment links',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.signIn': 'Sign In',
    'login.demo': 'Demo credentials: any email + password',

    // Dashboard
    'dashboard.title': 'Dashboard',
    'dashboard.totalLinks': 'Total Links',
    'dashboard.activeLinks': 'Active',
    'dashboard.totalRevenue': 'Total Revenue',
    'dashboard.transactions': 'Transactions',
    'dashboard.recentLinks': 'Recent Links',
    'dashboard.recentTransactions': 'Recent Transactions',
    'dashboard.status.succeeded': 'Succeeded',
    'dashboard.status.pending': 'Pending',

    // Footer
    'footer.copy': 'Powered by Nexus.js',
  },
  es: {
    'nav.dashboard': 'Panel',
    'nav.links': 'Enlaces',
    'nav.transactions': 'Transacciones',
    'nav.vault': 'Vault',
    'nav.logout': 'Cerrar sesión',
    'nav.login': 'Iniciar sesión',

    'landing.badge': 'Ahora en Nexus.js',
    'landing.title': 'Genera enlaces de pago',
    'landing.titleAccent': 'en segundos',
    'landing.subtitle': 'PayLinks te permite crear, gestionar y compartir enlaces de pago personalizados sin una tienda online completa. Recibe pagos de forma simple y segura.',
    'landing.ctaPrimary': 'Comenzar gratis',
    'landing.ctaSecondary': 'Ver demo',
    'landing.stat.processed': 'Procesados',
    'landing.stat.links': 'Enlaces creados',
    'landing.stat.uptime': 'Uptime',

    'features.title': 'Todo lo que necesitas para cobrar',
    'features.subtitle': 'Herramientas pensadas para freelancers, creadores de contenido y pequeños negocios.',
    'features.speed.title': 'Crea en segundos',
    'features.speed.desc': 'Genera un enlace de pago con título, monto y moneda en menos de un minuto. Sin configuraciones complejas.',
    'features.share.title': 'Comparte donde quieras',
    'features.share.desc': 'Envía tu enlace por WhatsApp, email, redes sociales o incrustarlo en tu web. Tus clientes pagan con un click.',
    'features.dashboard.title': 'Panel en tiempo real',
    'features.dashboard.desc': 'Visualiza transacciones, ingresos y métricas clave desde un panel intuitivo y siempre actualizado.',
    'features.security.title': 'Seguridad integrada',
    'features.security.desc': 'Protección contra fraudes, rate limiting y cookies seguras. Tu dinero y tus datos siempre protegidos.',
    'features.currency.title': 'Multimoneda',
    'features.currency.desc': 'Soporta USD, EUR y GBP. Recibe pagos de clientes de todo el mundo sin complicaciones.',
    'features.responsive.title': '100% Responsive',
    'features.responsive.desc': 'Tus enlaces de pago se ven perfectos en cualquier dispositivo: móvil, tablet o escritorio.',

    'cta.title': '¿Listo para empezar a cobrar?',
    'cta.subtitle': 'Crea tu cuenta gratuita en segundos y emite tu primer enlace de pago hoy mismo. Sin tarifas ocultas, sin contratos.',
    'cta.button': 'Crear cuenta gratis →',

    'login.title': 'Bienvenido a PayLinks',
    'login.subtitle': 'Inicia sesión para gestionar tus enlaces de pago',
    'login.email': 'Correo electrónico',
    'login.password': 'Contraseña',
    'login.signIn': 'Iniciar sesión',
    'login.demo': 'Credenciales de demo: cualquier email + contraseña',

    'dashboard.title': 'Panel',
    'dashboard.totalLinks': 'Enlaces totales',
    'dashboard.activeLinks': 'Activos',
    'dashboard.totalRevenue': 'Ingresos totales',
    'dashboard.transactions': 'Transacciones',
    'dashboard.recentLinks': 'Enlaces recientes',
    'dashboard.recentTransactions': 'Transacciones recientes',
    'dashboard.status.succeeded': 'Completado',
    'dashboard.status.pending': 'Pendiente',

    'footer.copy': 'Desarrollado con Nexus.js',
  },
  pt: {
    'nav.dashboard': 'Painel',
    'nav.links': 'Links',
    'nav.transactions': 'Transações',
    'nav.vault': 'Vault',
    'nav.logout': 'Sair',
    'nav.login': 'Entrar',

    'landing.badge': 'Agora em Nexus.js',
    'landing.title': 'Gere links de pagamento',
    'landing.titleAccent': 'em segundos',
    'landing.subtitle': 'O PayLinks permite criar, gerenciar e compartilhar links de pagamento personalizados sem uma loja online completa. Receba pagamentos de forma simples e segura.',
    'landing.ctaPrimary': 'Começar grátis',
    'landing.ctaSecondary': 'Ver demo',
    'landing.stat.processed': 'Processados',
    'landing.stat.links': 'Links criados',
    'landing.stat.uptime': 'Uptime',

    'features.title': 'Tudo que você precisa para receber',
    'features.subtitle': 'Ferramentas pensadas para freelancers, criadores de conteúdo e pequenos negócios.',
    'features.speed.title': 'Crie em segundos',
    'features.speed.desc': 'Gere um link de pagamento com título, valor e moeda em menos de um minuto. Sem configurações complexas.',
    'features.share.title': 'Compartilhe onde quiser',
    'features.share.desc': 'Envie seu link por WhatsApp, email, redes sociais ou incorpore no seu site. Seus clientes pagam com um clique.',
    'features.dashboard.title': 'Painel em tempo real',
    'features.dashboard.desc': 'Visualize transações, receitas e métricas-chave em um painel intuitivo e sempre atualizado.',
    'features.security.title': 'Segurança integrada',
    'features.security.desc': 'Proteção contra fraudes, rate limiting e cookies seguros. Seu dinheiro e seus dados sempre protegidos.',
    'features.currency.title': 'Multimoeda',
    'features.currency.desc': 'Suporta USD, EUR e GBP. Receba pagamentos de clientes de todo o mundo sem complicações.',
    'features.responsive.title': '100% Responsivo',
    'features.responsive.desc': 'Seus links de pagamento ficam perfeitos em qualquer dispositivo: mobile, tablet ou desktop.',

    'cta.title': 'Pronto para começar a receber?',
    'cta.subtitle': 'Crie sua conta gratuita em segundos e emitir seu primeiro link de pagamento hoje mesmo. Sem taxas ocultas, sem contratos.',
    'cta.button': 'Criar conta grátis →',

    'login.title': 'Bem-vindo ao PayLinks',
    'login.subtitle': 'Entre para gerenciar seus links de pagamento',
    'login.email': 'E-mail',
    'login.password': 'Senha',
    'login.signIn': 'Entrar',
    'login.demo': 'Credenciais de demo: qualquer email + senha',

    'dashboard.title': 'Painel',
    'dashboard.totalLinks': 'Links totais',
    'dashboard.activeLinks': 'Ativos',
    'dashboard.totalRevenue': 'Receita total',
    'dashboard.transactions': 'Transações',
    'dashboard.recentLinks': 'Links recentes',
    'dashboard.recentTransactions': 'Transações recentes',
    'dashboard.status.succeeded': 'Concluído',
    'dashboard.status.pending': 'Pendente',

    'footer.copy': 'Desenvolvido com Nexus.js',
  },
};

export function createT(locale: Locale) {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE];
  return (key: string): string => dict[key] ?? key;
}

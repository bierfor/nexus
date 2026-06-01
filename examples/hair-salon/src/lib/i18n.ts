// Hair Salon i18n
export const DEFAULT_LOCALE = 'en';
export const LOCALES = ['en', 'es', 'pt'];

export function resolveLocale(ctx: { url: URL; getCookie: (name: string) => string | undefined }) {
  const urlLang = ctx.url.searchParams.get('lang');
  if (urlLang && LOCALES.includes(urlLang)) return urlLang;

  const cookieLang = ctx.getCookie('salon_lang');
  if (cookieLang && LOCALES.includes(cookieLang)) return cookieLang;

  return DEFAULT_LOCALE;
}

export function langHref(url: URL, locale: string) {
  const u = new URL(url);
  u.searchParams.set('lang', locale);
  return u.pathname + u.search;
}

export function createT(locale: string) {
  const dict = translations[locale] ?? translations[DEFAULT_LOCALE];
  return (key: string) => dict[key] ?? key;
}

const translations: Record<string, Record<string, string>> = {
  en: {
    'nav.book': 'Book Now',
    'hero.title': 'Where Style Meets Precision',
    'hero.subtitle': 'Premium cuts, colors & styling for the modern you. Walk in looking good, walk out looking great.',
    'hero.cta': 'Book Appointment',
    'hero.cta2': 'Our Services',
    'services.title': 'Our Services',
    'services.subtitle': 'Expert care tailored to your unique style',
    'services.cut.title': 'Haircuts',
    'services.cut.desc': 'Classic cuts, fades, undercuts and modern styles tailored to your face shape.',
    'services.color.title': 'Coloring',
    'services.color.desc': 'Full color, balayage, highlights and creative coloring by expert colorists.',
    'services.beard.title': 'Beard Trim',
    'services.beard.desc': 'Precision beard shaping, hot towel treatment and grooming for the perfect look.',
    'services.styling.title': 'Styling',
    'services.styling.desc': 'Blowouts, updos, event styling and professional finishes for any occasion.',
    'gallery.title': 'Our Work',
    'gallery.subtitle': 'Real results, real confidence',
    'hours.title': 'Opening Hours',
    'hours.monfri': 'Mon - Fri',
    'hours.sat': 'Saturday',
    'hours.sun': 'Sunday',
    'hours.closed': 'Closed',
    'contact.address': '123 Style Street, Fashion District',
    'contact.phone': '+1 (555) 123-4567',
    'cta.title': 'Ready for a fresh look?',
    'cta.subtitle': 'Book your appointment today and experience the difference. Walk-ins welcome.',
    'cta.button': 'Book Now →',
    'footer.copy': 'Hair Salon. All rights reserved.',
  },
  es: {
    'nav.book': 'Reservar',
    'hero.title': 'Donde el Estilo se Encuentra con la Precisión',
    'hero.subtitle': 'Cortes premium, color y estilismo para el tú moderno. Entra luciendo bien, sal luciendo espectacular.',
    'hero.cta': 'Reservar Cita',
    'hero.cta2': 'Nuestros Servicios',
    'services.title': 'Nuestros Servicios',
    'services.subtitle': 'Cuidado experto adaptado a tu estilo único',
    'services.cut.title': 'Cortes',
    'services.cut.desc': 'Cortes clásicos, degradados, undercuts y estilos modernos adaptados a tu rostro.',
    'services.color.title': 'Coloración',
    'services.color.desc': 'Coloración completa, balayage, mechas y color creativo por expertos coloristas.',
    'services.beard.title': 'Arreglo de Barba',
    'services.beard.desc': 'Diseño preciso de barba, tratamiento con toalla caliente y cuidado masculino.',
    'services.styling.title': 'Estilismo',
    'services.styling.desc': 'Blowouts, recogidos, estilismo para eventos y acabados profesionales.',
    'gallery.title': 'Nuestro Trabajo',
    'gallery.subtitle': 'Resultados reales, confianza real',
    'hours.title': 'Horario',
    'hours.monfri': 'Lun - Vie',
    'hours.sat': 'Sábado',
    'hours.sun': 'Domingo',
    'hours.closed': 'Cerrado',
    'contact.address': 'Calle Estilo 123, Distrito Moda',
    'contact.phone': '+34 612 345 678',
    'cta.title': '¿Listo para un cambio de look?',
    'cta.subtitle': 'Reserva tu cita hoy y experimenta la diferencia. Aceptamos visitas sin cita.',
    'cta.button': 'Reservar →',
    'footer.copy': 'Peluquería. Todos los derechos reservados.',
  },
  pt: {
    'nav.book': 'Agendar',
    'hero.title': 'Onde o Estilo Encontra a Precisão',
    'hero.subtitle': 'Cortes premium, coloração e estilismo para o você moderno. Entre bem, saia impressionante.',
    'hero.cta': 'Agendar Horário',
    'hero.cta2': 'Nossos Serviços',
    'services.title': 'Nossos Serviços',
    'services.subtitle': 'Cuidado especializado adaptado ao seu estilo único',
    'services.cut.title': 'Cortes',
    'services.cut.desc': 'Cortes clássicos, degradês, undercuts e estilos modernos adaptados ao seu rosto.',
    'services.color.title': 'Coloração',
    'services.color.desc': 'Coloração completa, balayage, mechas e coloração criativa por especialistas.',
    'services.beard.title': 'Barba',
    'services.beard.desc': 'Modelagem precisa de barba, toalha quente e cuidados masculinos.',
    'services.styling.title': 'Estilismo',
    'services.styling.desc': 'Escovas, penteados, estilismo para eventos e acabamentos profissionais.',
    'gallery.title': 'Nosso Trabalho',
    'gallery.subtitle': 'Resultados reais, confiança real',
    'hours.title': 'Horário de Funcionamento',
    'hours.monfri': 'Seg - Sex',
    'hours.sat': 'Sábado',
    'hours.sun': 'Domingo',
    'hours.closed': 'Fechado',
    'contact.address': 'Rua Estilo 123, Distrito Moda',
    'contact.phone': '+55 11 91234-5678',
    'cta.title': 'Pronto para um novo visual?',
    'cta.subtitle': 'Agende seu horário hoje e experimente a diferença. Aceitamos clientes sem agendamento.',
    'cta.button': 'Agendar →',
    'footer.copy': 'Salão de Beleza. Todos os direitos reservados.',
  },
};

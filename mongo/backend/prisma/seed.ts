import "./load-env.js";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { EXTRA_EDITORIAL_TAGS } from "./extra-tags.js";

const prisma = new PrismaClient();

async function main() {
  await prisma.flashNews.deleteMany();
  await prisma.tagsOnArticles.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.author.deleteMany();

  const author = await prisma.author.create({
    data: {
      name: "Puro Flusso",
      bio: "Menos ruido. Más flujo. Para quien quiere pensar con claridad.",
    },
  });

  const tagDefs = [
    { name: "Productividad", slug: "productividad" },
    { name: "Herramientas", slug: "herramientas" },
    { name: "Minimalismo digital", slug: "minimalismo" },
    { name: "IA Essenziale", slug: "ia-essenziale" },
    ...EXTRA_EDITORIAL_TAGS,
  ];
  const tags = await Promise.all(tagDefs.map((t) => prisma.tag.create({ data: t })));

  const baseTime = Date.now();

  const articles = [
    {
      title: "Menos apps en la primera pantalla: captura y ejecución",
      slug: "menos-apps-captura-ejecucion",
      excerpt:
        "Un experimento de productividad: una app para capturar y otra para ejecutar. Todo lo demás, negociable.",
      content: `## La regla que cambia el viernes

Solo **dos aplicaciones** con icono en la primera pantalla dedicadas a productividad real: una para **capturar** y una para **ejecutar**. No es estética: es un contrato contigo.

## App A — Captura

Todo lo que no tiene sitio aún entra aquí. Nota de voz de diez segundos, lista de tres bullets, idea suelta. **Una revisión al día**, diez minutos: lo que sigue vivo pasa a App B; lo demás se borra sin drama.

## App B — Ejecución

Solo **siguientes acciones**: verbo + resultado en una sesión. Si no cabe en una frase, no es tarea: es proyecto y se descompone.

## Calendario, email, mensajes

Son **reactividad**, no estrategia. No cuentan en la regla de las dos apps. Si pitan cada hora, mute o fuera del dock.

## Por qué diez horas

Cada app extra es contexto mental, notificación y culpa acumulada. Volver a dos no es romanticismo: es **menos cambio de contexto** y más bloques de flujo intactos.

---

*Puro Flusso.* #PuroFlusso`,
      readTimeMinutes: 7,
      coverImage: null as string | null,
      tagSlugs: ["minimalismo", "productividad"],
      order: 0,
    },
    {
      title: "Por qué tu calendario es una lista de deseos y cómo recuperé mi viernes",
      slug: "calendario-google-minimalismo-digital",
      excerpt:
        "Tu calendario es una lista de deseos. Aprende a convertirlo en un compromiso con tu libertad.",
      content: `## La bofetada de realidad

Tu calendario es una **lista de deseos** disfrazada de compromiso: bloques de color que te hacen sentir ocupado, no alineado. Aprende a convertirlo en un **compromiso con tu libertad**: menos piezas, más espacio para lo que solo tú puedes hacer.

## La mentira piadosa

Google Calendar te muestra **huecos llenos** y te hace creer que el día "está cubierto". Muchas piezas son **reuniones reactivas**, no trabajo que te acerca a lo importante.

## Qué está pasando

- **Ocupación ≠ prioridad.** Llenar no es estrategia.
- **El calendario manda.** Tú reaccionas; no eliges.
- **El viernes llega vacío de energía** porque la semana fue contextos, no resultados.

## Tres movimientos

1. **Un bloque diario sin reuniones** (aunque sea 90 min). Si no está en el calendario, no existe.
2. **Tres outcomes por semana.** El calendario **protege** eso, no lo exhibe.
3. **Elimina antes de optimizar.** La productividad **no es añadir; es quitar**.

## El viernes

Cuando el calendario es un **dique** que protege tu flujo, el viernes vuelve a ser **espacio** — no el cadáver de la semana.

---

*Puro Flusso — flujo sin ruido.* #PuroFlusso`,
      readTimeMinutes: 5,
      coverImage: null,
      tagSlugs: ["productividad", "minimalismo"],
      order: 1,
    },
    {
      title: "IA Essenziale: las 3 herramientas que no son ruido",
      slug: "ia-essenziale-tres-herramientas",
      excerpt:
        "No necesitas veinte suscripciones. Tres capas bastan: investigar, redactar, automatizar lo repetible — sin perder el criterio humano.",
      content: `## El principio Essenziale

La IA no es añadir **más** herramientas: es **tres funciones** claras. Todo lo demás es ruido y factura.

## 1. Investigar (una sola fuente de síntesis)

Un solo sitio donde **preguntar con contexto** y recibir respuestas con referencias o al menos límites honestos. No abras cinco chats distintos: uno, bien usado, con prompts concretos.

## 2. Redactar (borrador, no autoría)

Una herramienta para **primer borrador** o para **reescribir en tu voz**: emails, esquemos, titulares. La firma final es siempre tuya. Si la IA escribe y tú solo pulsas «enviar», has delegado el criterio.

## 3. Automatizar lo repetible

Solo lo que ya hiciste **diez veces igual**: formatos, extractos, clasificación burda. Si el flujo cambia cada semana, no automatices aún: primero **simplifica**.

## Lo que no entra en el trío

- Otra app «por si acaso».
- Notificaciones de «novedades IA».
- El mito de que más modelos = más claridad.

**Menos capas, más juicio.** Eso es IA Essenziale.

---

*Puro Flusso.* #PuroFlusso`,
      readTimeMinutes: 6,
      coverImage: null,
      tagSlugs: ["ia-essenziale", "herramientas"],
      order: 2,
    },
  ];

  for (const a of articles) {
    const tagIds = tags.filter((t) => a.tagSlugs.includes(t.slug)).map((t) => t.id);
    const publishedAt = new Date(baseTime - a.order * 86400000);
    await prisma.article.create({
      data: {
        title: a.title,
        slug: a.slug,
        excerpt: a.excerpt,
        content: a.content,
        coverImage: a.coverImage,
        readTimeMinutes: a.readTimeMinutes,
        published: true,
        publishedAt,
        authorId: author.id,
        tagLinks: {
          create: tagIds.map((tagId) => ({ tagId })),
        },
      },
    });
  }

  const flashes = [
    {
      title: "Bio-Hack: Microplasticos invaden sangre",
      slug: "bio-hack-microplasticos-sangre",
      summary:
        "Environment International detecta microplasticos en 77-88.9% de muestras de sangre, con 4.2 particulas/ml y senales asociadas a riesgo cardiovascular y coagulación alterada.",
      sourceLabel: "Environment International",
      sourceUrl: "https://www.sciencedirect.com/journal/environment-international",
      hack: "Filtra agua con osmosis inversa y evita calentar comida en plastico.",
      order: 0,
    },
    {
      title: "Cerebro en modo niebla por multitarea digital",
      slug: "niebla-mental-multitarea-digital",
      summary:
        "Bloques fragmentados de notificaciones elevan carga cognitiva y bajan memoria de trabajo; el costo no es tiempo, es calidad de enfoque.",
      sourceLabel: "Cognitive load studies",
      sourceUrl: null,
      hack: "Agrupa mensajes en 2 ventanas al dia y activa modo no molestar por bloques.",
      order: 1,
    },
    {
      title: "Dormir 90 min mas mejora control impulsivo",
      slug: "dormir-90-min-control-impulsivo",
      summary:
        "Metaanalisis recientes sugieren que ampliar descanso semanal mejora toma de decisiones y reduce compras impulsivas por fatiga.",
      sourceLabel: "Sleep research review",
      sourceUrl: null,
      hack: "Fija hora de cierre digital 75 min antes de dormir.",
      order: 2,
    },
  ];

  for (const f of flashes) {
    await prisma.flashNews.create({
      data: {
        title: f.title,
        slug: f.slug,
        summary: f.summary,
        sourceLabel: f.sourceLabel,
        sourceUrl: f.sourceUrl,
        hack: f.hack,
        published: true,
        publishedAt: new Date(baseTime - f.order * 21600000),
      },
    });
  }

  await prisma.hero.upsert({
    where: { slug: "home" },
    create: {
      slug: "home",
      kicker: "El fin de la obesidad digital",
      headline: "Tu tiempo es puro. Tu flujo también debería serlo.",
      subheadline: null,
      body:
        "¿Qué harías con **40 horas extra al mes**? Menos ruido, más espacio para pensar. El boletín llega solo cuando haya algo que merezca leerse.",
      bodySecondary:
        "Sin cadencia forzada ni promesas vacías: artículos largos y notas cuando toque. Baja cuando quieras.",
      imageUrl:
        "https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=1200&q=82",
      footerCtaLabel: "Ver la revista",
      footerCtaHref: "/#revista",
      published: true,
    },
    update: {},
  });
  console.log("Seed: hero «home» asegurado (no se sobrescribe si ya existía).");

  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (
    bootstrapEmail &&
    bootstrapPassword &&
    bootstrapPassword.length >= 10 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapEmail)
  ) {
    const passwordHash = await bcrypt.hash(bootstrapPassword, 12);
    await prisma.adminUser.upsert({
      where: { email: bootstrapEmail },
      update: { passwordHash },
      create: { email: bootstrapEmail, passwordHash },
    });
    console.log("Seed: cuenta de administrador lista (revisa ADMIN_BOOTSTRAP_* en .env).");
  } else {
    console.log(
      "Seed: define ADMIN_BOOTSTRAP_EMAIL y ADMIN_BOOTSTRAP_PASSWORD (mín. 10 caracteres) para crear o actualizar el admin.",
    );
  }

  console.log("Seed: Puro Flusso — 3 piezas editoriales + flash news listas.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });

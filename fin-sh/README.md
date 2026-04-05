# Fin.sh

Link shortener stack: **Nexus** (UI + SSR + islands), **Apollo GraphQL** + **MongoDB** (data), estética tipo Vercel/Geist (Inter + JetBrains Mono, bordes 1px, header con blur).

## Requisitos

- Node 20+
- MongoDB en `localhost:27017` (ej. `docker run -d -p 27017:27017 --name fin-mongo mongo:7`)

## Arranque

Desde la raíz del monorepo:

```bash
pnpm install
cd fin-sh
cp .env.example .env
cp api/.env.example api/.env
pnpm dev
```

Esto levanta:

- **API GraphQL**: `http://127.0.0.1:4000/graphql` (`fin-sh-api`)
- **Nexus**: `http://127.0.0.1:3050` (landing, `/dashboard`, redirects `/s/:slug`)

Para CORS del navegador (isla de anuncios → Apollo), en `api/.env`:

`FIN_SH_CORS_ORIGIN=http://127.0.0.1:3050`

## Patrones Nexus (0.7.x)

- **`// nexus:pretext` + `export async function load`**: el compilador renombra a `nxPretext`; no pongas `const` antes del `export` en ese bloque (mueve queries al **leading** del frontmatter).
- **`// nexus:server`**: `defineHead`, `createAction` de `@nexus_js/server`, igual que en `news/`.
- **Datos en plantilla**: usa `ctx.pretext` vía el binding `pretext` que inyecta el runtime en `renderTemplate`.
- **Redirects / 404**: en rutas solo-redirección, toda la lógica va en **nxPretext** (`ctx.redirect` / `ctx.notFound`).

## Rutas

| Ruta            | Descripción                                      |
|-----------------|--------------------------------------------------|
| `/`             | Landing                                          |
| `/dashboard`    | Crear links, tabla, ⌘K palette, slot de anuncio |
| `/s/{slug}`     | Redirect + `recordClick` (UA reenviado)         |

## Variables

| Variable               | Uso                                      |
|------------------------|------------------------------------------|
| `FIN_SH_GRAPHQL_URL`   | Nexus → Apollo (default `:4000/graphql`) |
| `FIN_SH_PUBLIC_ORIGIN` | Base mostrada para short URLs          |
| `MONGODB_URI`          | API Mongo                                |

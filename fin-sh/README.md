# Fin.sh

Link shortener stack: **Nexus** (UI + SSR + islands), **Apollo GraphQL** + **MongoDB** (data), estética tipo Vercel/Geist (Inter + JetBrains Mono, bordes 1px, header con blur).

## Requisitos

- Node 20+
- **pnpm 9+** o **npm 9+** para instalar dependencias dentro de `fin-sh`
- En la **raíz del monorepo Nexus**, sigue siendo obligatorio **pnpm** (`npm install` en la raíz está bloqueado por diseño).
- **Nexus en npm:** las dependencias `@nexus_js/*` usan **`^0.7.4`** (registro público). Para el CLI global también puedes usar **`npm i -g nexus-js`** o **`nexus_js`**.
- MongoDB en `localhost:27017` (ej. `docker run -d -p 27017:27017 --name fin-mongo mongo:7`)

## Arranque

### Dentro del monorepo (recomendado)

Desde la raíz del repo:

```bash
pnpm install
cd fin-sh
cp .env.example .env
cp api/.env.example api/.env
pnpm dev
```

### Solo carpeta `fin-sh` (dependencias desde npm)

Si trabajas solo con este directorio (o copias el proyecto), instala y arranca:

```bash
cd fin-sh
npm install
# o: pnpm install
cp .env.example .env
cp api/.env.example api/.env
pnpm dev
# o: npx nexus dev --port 3050   (si tienes @nexus_js/cli en node_modules)
```

El script `pnpm dev` del `package.json` sigue usando `pnpm --filter fin-sh-api` para la API; eso requiere estar en el **workspace** del monorepo. Fuera del monorepo, levanta la API en otra terminal: `cd api && npm install && npm run dev`.

**Nota monorepo:** con `pnpm install` en la raíz, pnpm suele **enlazar** los paquetes `@nexus_js/*` locales si coinciden con `^0.7.4` (más rápido para desarrollar el framework). El `package.json` sigue declarando versiones de **npm** para que un clon solo de `fin-sh` resuelva desde **registry.npmjs.org**.

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

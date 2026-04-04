# Vercel y la app `news` (Nexus)

## 404 en la URL de Vercel (`NOT_FOUND`)

Si el deploy **termina bien** pero al abrir la web ves **404**, suele ser porque en `public/` **no había** un `index.html` en la raíz: Vercel solo sirve estáticos; sin `index.html`, **`/`** no tiene recurso.

En este repo, **`news/public/index.html`** es una página estática mínima para que **`/`** deje de responder 404. Sigue sin ser la app Nexus real (eso requiere Node).

## Error: «No Output Directory named "public"»

Vercel exige una carpeta de salida tras el build. Con **Root Directory** = raíz del monorepo, el `vercel.json` de la raíz usa **`outputDirectory`: `news/public`** (ahí están los estáticos de la app, p. ej. `favicon.svg`).

Si en el dashboard el **Root Directory** es solo **`news`**, en **Project Settings → Build & Output** pon **Output Directory** = **`public`** (o añade `news/vercel.json` con `"outputDirectory": "public"`).

Esto solo satisface el chequeo de despliegue estático; **Nexus sigue siendo un servidor Node** — ver la sección «Límite importante» más abajo.

## Error: «No Next.js version detected»

Eso sale cuando el **proyecto en Vercel** (p. ej. `puro-flusso`) está en preset **Next.js**, pero en la raíz del monorepo **no** hay `next` en `package.json`.

**Qué hacer:**

1. En [Vercel](https://vercel.com) → tu proyecto → **Settings** → **General** → **Framework Preset** → elige **Other** (u otro que no sea Next.js).
2. Este repo ya incluye en la raíz un `vercel.json` con **`"framework": null`** para no forzar detección de framework.
3. Si el proyecto se creó para el front **Next** de `mongo/`, conviene **crear otro proyecto** en Vercel solo para Nexus y enlazarlo con `vercel link`, o separar repositorios.

Después de cambiar el preset, vuelve a desplegar: `pnpm dlx vercel@latest` (o desde el dashboard con un nuevo deploy).

## Límite importante de Vercel con Nexus

Según la [documentación de Vercel](https://vercel.com/support/articles/does-vercel-support-docker-deployments), **no se despliegan contenedores Docker como runtime en producción** en el sentido de “subir una imagen y ejecutarla” como harías en Railway/Fly. Nexus usa **`nexus start`** (servidor HTTP Node), no un export estático tipo Next export.

Por tanto, **Vercel no es la opción más adecuada** para servir esta app tal cual, salvo que en el futuro exista un adaptador serverless oficial.

## Dónde desplegar `news` con el Dockerfile

Usa el **`Dockerfile.news`** en la raíz del monorepo en plataformas pensadas para **contenedores** o **Node largo**:

- [Railway](https://railway.app), [Render](https://render.com), [Fly.io](https://fly.io), etc.
- Build desde la raíz del repo: `docker build -f Dockerfile.news -t nexus-news .`
- Variables: las mismas que en `news/.env.example`.

## Prueba local de la imagen

```bash
docker build -f Dockerfile.news -t nexus-news .
docker run --rm -p 3000:3000 -e NEXUS_GRAPHQL_URL=https://tu-api/graphql nexus-news
```

`PORT` lo define el orquestador; el CLI de Nexus ya lo respeta en `nexus start`.

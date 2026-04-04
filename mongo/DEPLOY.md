# Despliegue en producción (Puro Flusso)

Arquitectura típica:

1. **Frontend (Next.js)** — Vercel, Netlify, Railway o contenedor propio.
2. **Backend (API)** — Mismo host con subdominio (`api.tudominio.com`), Railway, Render, Fly.io, VPS + Docker.
3. **MongoDB** — Atlas, o contenedor/volumen en VPS.

### Vercel (Next.js en la raíz del monorepo)

Si el proyecto en Vercel apunta al **repo completo** (Root Directory = `.`):

- En la raíz hay **`vercel.json`**: instala con `npm ci && npm ci --prefix frontend` y construye con **`npm run vercel:build`** (compila en `frontend/` y copia `frontend/.next` a la raíz, porque el builder de Next en Vercel espera `.next` en el directorio raíz del proyecto).
- El **`package.json` de la raíz** incluye `next` (misma versión que `frontend/`) para que Vercel detecte Next.js.

**Recomendado:** en **Vercel → Settings → General → Root Directory** pon **`frontend`**. Así el build y `.next` coinciden con lo que espera Vercel y puedes **eliminar** el `vercel.json` de la raíz y quitar el script `vercel:build` / dependencias `next` en la raíz si quieres simplificar.

### Railway (Railpack) — servicio solo API

Despliega desde la **raíz del repo** (no hace falta cambiar “Root Directory” a `backend`):

- **Build command** (por defecto Railpack usa `npm run build`): compila el backend con `npm ci --prefix backend --include=dev` (necesario cuando `NODE_ENV=production` omite devDependencies).
- **Start command** (o `railpack.json`): `npm start` en la raíz arranca `node backend/dist/index.js`.

Variables: las del backend (`DATABASE_URL`, `PORT`, `ADMIN_*`, `CORS_ORIGINS`, etc.). Añade **MongoDB** como plugin o usa Atlas (`DATABASE_URL`).

#### Ejemplo: API en `*.up.railway.app` y front en otro sitio (p. ej. Vercel)

Esa URL **es solo el backend**, no el sitio Next.

- Abres `https://puro-flusso-production.up.railway.app` → debe responder JSON (servicio API) o al menos `/health` con `ok: true`.
- En **Vercel / Railway (Next)** configura:
  - `BACKEND_URL=https://puro-flusso-production.up.railway.app`
  - `NEXT_PUBLIC_GRAPHQL_URL=https://puro-flusso-production.up.railway.app/graphql`
- En **variables del servicio API en Railway** (`CORS_ORIGINS`) pon la URL **del front donde ves la web**, por ejemplo `https://tu-proyecto.vercel.app` — **no** pongas la URL de Railway del API ahí (CORS es “qué sitios web pueden llamar a esta API desde el navegador”).

---

## 1. Variables de entorno

### Backend (`backend/.env`)

| Variable | Obligatorio | Descripción |
|----------|-------------|-------------|
| `DATABASE_URL` | Sí | URI MongoDB (`mongodb+srv://...` en Atlas o `mongodb://mongo:27017/...` en Docker). |
| `PORT` | No | Por defecto `4000`. |
| `ADMIN_SECRET` | Sí prod | Mismo valor que en el front; cabecera `Authorization: Bearer` al proxy GraphQL admin. |
| `ADMIN_JWT_SECRET` | Sí | ≥ 32 caracteres; firma de la cookie de sesión admin (mismo valor en front). |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | Primera vez | Para `npm run create-admin` o seed. |
| `CORS_ORIGINS` | Sí si front ≠ API | URLs del sitio público, separadas por coma, **sin barra final**: `https://tudominio.com,https://www.tudominio.com`. Necesario porque el navegador llama a GraphQL (p. ej. contador de vistas). |
| `CLOUDINARY_*` | Si subes imágenes | Credenciales Cloudinary. |
| `HERO_PREVIEW_TOKEN` | Opcional | Misma clave que en front para `/preview/hero`. |

### Frontend (panel del host, p. ej. Vercel)

| Variable | Dónde | Descripción |
|----------|--------|-------------|
| `NEXT_PUBLIC_SITE_URL` | Build + runtime | URL canónica **https**, sin barra final (`https://tudominio.com`). Imprescindible para sitemap, RSS y metadatos. |
| `BACKEND_URL` | Solo servidor | URL base de la API **sin** `/graphql` (ej. `https://api.tudominio.com`). Usada por **RSC, sitemap, RSS, feed** (`gql` en servidor) y rutas `/api/*` hacia el backend. |
| `NEXT_PUBLIC_GRAPHQL_URL` | Build | URL completa del GraphQL (`https://api.tudominio.com/graphql`) para **peticiones desde el navegador** (p. ej. contador de vistas). Debe coincidir con el mismo host que `BACKEND_URL`. Alternativa: `NEXT_PUBLIC_BACKEND_URL` sin path (el front añade `/graphql`). |
| `ADMIN_SECRET` | Solo servidor | Igual que backend. |
| `ADMIN_JWT_SECRET` | Solo servidor | Igual que backend (≥ 32 caracteres). |
| `HERO_PREVIEW_TOKEN` | Solo servidor | Opcional, igual que backend. |

En Vercel, `VERCEL_URL` sirve de respaldo para URLs internas, pero **`NEXT_PUBLIC_SITE_URL` debe ser tu dominio definitivo**.

---

## 2. Base de datos y primer arranque (API)

En el entorno donde corre el backend:

```bash
cd backend
npm ci
npx prisma generate
npx prisma db push
npm run create-admin   # o el flujo de seed que uses
npm run tags:ensure    # si aplica
npm run build
NODE_ENV=production npm run start:prod
```

Comprueba `GET https://TU_API/health` → `{"ok":true,...}`.

---

## 3. Frontend

```bash
cd frontend
npm ci
npm run build
npm start
```

En el host serverless (Vercel): conectar repo, definir las variables de entorno y dejar el comando de build por defecto (`next build`).

Imagen Docker mínima del front (opcional):

```bash
NEXT_STANDALONE=1 npm run build
# Servir la carpeta .next/standalone según la guía de Next.js
```

---

## 4. Docker (API + Mongo en un VPS)

1. Copia `backend/.env.example` → `backend/.env` y ajusta `DATABASE_URL=mongodb://mongo:27017/smart_mag` (o el nombre de BD que quieras).
2. Define `CORS_ORIGINS` con la URL **https** del Next desplegado.
3. Expón la API detrás de **HTTPS** (Caddy, Nginx, Traefik) y no abras Mongo al público.

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

---

## 5. Checklist previo a abrir tráfico

- [ ] HTTPS en front y API.
- [ ] `CORS_ORIGINS` coincide **exactamente** con el `Origin` del navegador (incl. `www` si lo usas).
- [ ] `NEXT_PUBLIC_GRAPHQL_URL` apunta al `/graphql` público.
- [ ] `BACKEND_URL` sin path extra; el front añade `/graphql` o `/leads` donde toca.
- [ ] Secretos distintos a los de desarrollo; nunca commitear `.env`.
- [ ] Probar login en `/admin/login`, crear borrador y publicar.
- [ ] Abrir `/sitemap.xml`, `/feed.xml` y validar el RSS (W3C Feed Validator).

---

## 6. Revalidación (ISR)

Tras publicar desde el admin, el cliente llama a `POST /api/admin/revalidate` con la cookie de sesión; invalida tags (`articles`, `heroes`, etc.). No hace falta secreto extra: basta con que el admin esté logueado y `ADMIN_JWT_SECRET` / `ADMIN_SECRET` coincidan con el backend.

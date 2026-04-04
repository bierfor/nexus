# Puro Flusso

Monorepo: revista y boletín — **Next.js** (`frontend/`) + **API GraphQL/Express** (`backend/`) y **MongoDB** (Prisma).

## Estructura

| Carpeta     | Rol |
|------------|-----|
| `frontend` | Sitio público, admin, RSS, API routes Next |
| `backend`  | GraphQL, `/leads`, login admin, subida a Cloudinary |

## Requisitos

- Node **22.x** (ver `.nvmrc` y `engines` en los `package.json`)
- MongoDB accesible desde el backend

## Desarrollo local

```bash
# Backend (puerto 4000)
cd backend && cp .env.example .env && npm install && npx prisma generate && npx prisma db push && npm run dev

# Frontend (puerto 3000)
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

Ajusta `.env` y `.env.local` según los comentarios en los `.env.example`.

## Bot / integraciones (IA, scripts)

Manual de conexión: endpoint GraphQL, Bearer `pfbot_*`, scopes y ejemplos **`curl`** en **[docs/BOT_API.md](./docs/BOT_API.md)**.

AnythingLLM + IBM Granite 4.3B: prompts del workspace, agente y parámetros del modelo en **[docs/anythingllm/README.md](./docs/anythingllm/README.md)**.

## Producción

Ver **[DEPLOY.md](./DEPLOY.md)** (variables, Docker, Vercel, checklist).

**Vercel:** el repo incluye `vercel.json` en la raíz para desplegar Next desde `frontend/` sin tocar “Root Directory”. Si prefieres, en el panel de Vercel pon **Root Directory → `frontend`** y puedes quitar ese archivo.

## Licencia

Privado — uso del titular del repositorio.

# Manual: conectar un bot o integración a la API

Este documento describe cómo autenticar un proceso externo (bot de IA, script, n8n, etc.) contra el **backend** de Puro Flusso: GraphQL y subida de imágenes.

## 1. Resumen

| Qué | Dónde |
|-----|--------|
| Crear o revocar tokens | Panel web: **`/admin/bot-tokens`** (sesión de administrador del sitio) |
| Crear noticia relámpago (JSON plano) | **`POST {BACKEND_URL}/integrations/flash-news`** (mismo scope que GraphQL) |
| GraphQL | **`{BACKEND_URL}/graphql`** (ej. `https://tu-api.railway.app/graphql`) |
| Subida de imágenes | **`POST {BACKEND_URL}/media/upload`** (multipart) |

El bot **no** debe usar `NEXT_PUBLIC_GRAPHQL_URL` del navegador ni `/api/admin/graphql` de Next: esas rutas están pensadas para el admin humano con cookie de sesión. El bot llama **directamente al backend** con el header `Authorization`.

`BACKEND_URL` es el mismo origen que configuráis en el frontend como URL del API (sin `/graphql` al final para las tablas de arriba; el path `/graphql` se añade explícitamente).

## 2. Formato del token

Al crear un token en el admin, recibirás **una sola vez** una cadena con esta forma:

```text
pfbot_<keyId>.<secreto>
```

Ejemplo ficticio: `pfbot_a1b2c3d4e5f6g7h8.9f8e7d6c5b4a3210fedcba9876543210fedcba9876543210fedcba9876543210`

En cada petición HTTP al backend:

```http
Authorization: Bearer pfbot_<keyId>.<secreto>
```

No compartas el token en repos públicos ni en logs. Si se filtra, **revócalo** en `/admin/bot-tokens` y crea otro.

## 3. Permisos (scopes)

Cada token lleva una lista de permisos. El valor **`*`** significa todos los permisos listados abajo.

| Scope | Permite |
|-------|---------|
| `flash:list` | `flashNews` con borradores (`publishedOnly: false`) |
| `flash:read` | `flashNewsAdmin(id)` |
| `flash:create` | `createFlashNews` (GraphQL) o **`POST /integrations/flash-news`** |
| `flash:update` | `updateFlashNews` |
| `flash:delete` | `deleteFlashNews` |
| `flash:publish` | `publishFlashNews` |
| `flash:unpublish` | `unpublishFlashNews` |
| `article:list` | `articles` con borradores (`publishedOnly: false`) |
| `article:read` | `articleDraft`, `articleAdmin` |
| `article:create` | `createArticle` |
| `article:update` | `updateArticle` |
| `article:delete` | `deleteArticle` |
| `article:publish` | `publishArticle` |
| `article:unpublish` | `unpublishArticle` |
| `media:upload` | `POST /media/upload` |

**Qué el bot no puede hacer** (solo admin humano con `ADMIN_SECRET` vía proxy, no con token `pfbot_`):

- Mutaciones y consultas de **hero** (`upsertHero`, `heroAdmin`, `heroesAdmin`, …).
- Crear, listar o editar **tokens de API** (`botApiTokens`, `createBotApiToken`, …).

Las consultas públicas (artículo publicado por slug, `recordArticleView`, etc.) siguen sin Bearer.

## 4. Crear noticia relámpago sin GraphQL (recomendado para agentes)

Muchos flujos con LLM **rompen el JSON** del envelope GraphQL (comillas de más, `$` antes de `"variables"`, etc.). Si el parseo falla, el cliente a veces envía **cuerpo vacío** y el servidor responde **400**.

Este endpoint acepta **un solo objeto JSON** con los mismos campos que `FlashNewsInput`:

| Campo | Obligatorio | Tipo |
|--------|-------------|------|
| `title` | sí | string |
| `slug` | no | string; si falta o está vacío, el servidor genera uno único a partir del título |
| `summary` | sí | string |
| `sourceLabel` | no | string (alias aceptados: `source`, `fuente`) |
| `sourceUrl` | no | string (alias: `url`, `link`) |
| `hack` | no | string |
| `published` | no | boolean (default `false`) |

```bash
curl -sS -X POST "$BACKEND_URL/integrations/flash-news" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PFBOT_TOKEN" \
  -d '{
    "title": "Titular",
    "slug": "titular-unico-2026",
    "summary": "Texto breve.",
    "sourceLabel": "Fuente",
    "sourceUrl": "https://ejemplo.com",
    "hack": "Tip accionable opcional",
    "published": false
  }'
```

Respuesta **201**: `{ "id", "slug", "title", "summary", "published", "publishedAt", "createdAt" }`.  
Errores: **400** (validación), **401** (sin token o sin `flash:create`), **409** (slug duplicado).

El servidor lee el body como **bytes crudos** (no depende solo de `express.json`). Acepta JSON envuelto varias veces en string y, si el cuerpo es un objeto con la clave `cuerpo_json_flash` (patrón AnythingLLM), usa el JSON interno como noticia.

**Error típico al usar GraphQL a mano:** cerrar mal el JSON, p. ej. `... "published": true } }" }` — sobra una **`"`** antes del último `}`; debe ser `... true } } }`.

## 5. Petición GraphQL (JSON)

Método: **`POST`**. Cabeceras mínimas:

```http
Content-Type: application/json
Authorization: Bearer pfbot_...
```

Cuerpo (siempre un objeto JSON):

```json
{
  "query": "mutation … o query …",
  "variables": { }
}
```

`variables` puede omitirse si la operación no usa variables (o ir como `{}`).

### Ejemplo: crear una noticia relámpago (borrador)

```bash
curl -sS -X POST "$BACKEND_URL/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PFBOT_TOKEN" \
  -d '{
    "query": "mutation ($input: FlashNewsInput!) { createFlashNews(input: $input) { id slug title published } }",
    "variables": {
      "input": {
        "title": "Titular",
        "slug": "titular-unico-2026",
        "summary": "Texto breve.",
        "sourceLabel": "Fuente",
        "sourceUrl": "https://ejemplo.com",
        "published": false
      }
    }
  }'
```

### Ejemplo: crear un artículo con etiquetas

Requiere `article:create`. Los slugs de etiquetas deben existir o el backend los crea al vuelo según la lógica editorial.

```bash
curl -sS -X POST "$BACKEND_URL/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PFBOT_TOKEN" \
  -d '{
    "query": "mutation ($input: ArticleInput!) { createArticle(input: $input) { id slug title published } }",
    "variables": {
      "input": {
        "title": "Título",
        "slug": "mi-slug-unico",
        "excerpt": "Resumen opcional",
        "content": "<p>Cuerpo HTML o texto.</p>",
        "tagSlugs": ["productividad"],
        "published": false
      }
    }
  }'
```

### Errores habituales

- **`No autorizado`**: token incorrecto, revocado, desactivado, o falta el scope de esa operación.
- Respuesta GraphQL con `errors[].extensions.code === "FORBIDDEN"`: mismo caso desde el servidor Apollo.
- **400 con cuerpo vacío o “No body”**: JSON inválido; para flashes preferí **`POST /integrations/flash-news`** (sección 4).

Revisa que la URL sea la del **backend** (no la del front en Vercel) y que el despliegue tenga aplicado el schema Prisma con la colección `BotApiToken` (`npx prisma db push` en el entorno del API).

## 6. Subida de imágenes (`media:upload`)

Requiere el scope **`media:upload`**.

```bash
curl -sS -X POST "$BACKEND_URL/media/upload" \
  -H "Authorization: Bearer $PFBOT_TOKEN" \
  -F "file=@/ruta/a/imagen.jpg"
```

Respuesta JSON típica: `{ "url": "https://…", "publicId": "…" }`. Usa `url` en `coverImage` de un artículo o donde corresponda en vuestro flujo.

## 7. CORS y entorno del bot

Si el bot corre **en un servidor** (Node, Python, worker), no interviene CORS: basta con HTTPS/TLS y el Bearer.

Si algún día llamáis al GraphQL **desde el navegador** con el token del bot, el backend debe permitir el `Origin` de esa página (variable `CORS_ORIGINS` en el backend). **No** es el flujo recomendado: expondrías el token en el cliente.

## 8. Flujo mínimo recomendado para un bot de redacción

1. En admin: crear token con scopes acorde al flujo (ej. `flash:create`, `flash:publish`, `article:create`, `article:publish`, `media:upload` si sube portadas).
2. Guardar el token en el **secreto** del entorno del bot (no en el repo).
3. Para **noticias relámpago**: preferir **`POST /integrations/flash-news`** con un objeto JSON plano; el LLM solo rellena campos, sin plantilla `query`/`variables`.
4. Para **artículos** u operaciones que aún no tengan REST: GraphQL con plantilla fija en código y `JSON.stringify`, no un único string generado por el LLM.
5. `published: false` si queréis revisión humana; luego publicar con GraphQL (`publishFlashNews`, etc.) si hace falta.

Para la lista exacta de campos, inspeccioná el schema GraphQL del backend (`typeDefs`) o usad una herramienta tipo GraphQL Playground/Insomnia contra `POST /graphql` con el Bearer.

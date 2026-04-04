# Puro Flusso — API para agentes (resumen)

## Crear noticia relámpago (usar esto con el bot)

- **POST** `{BACKEND_URL}/integrations/flash-news`
- Headers: `Content-Type: application/json`, `Authorization: Bearer pfbot_...`
- Scope del token: `flash:create` o `*`
- Body: **solo** este objeto (sin GraphQL):

Mínimo válido:

```json
{
  "title": "Titular",
  "summary": "Dos frases de resumen."
}
```

Opcionales: `slug` (si falta, el backend lo genera), `sourceLabel` o `source`, `sourceUrl` o `url` o `link`, `hack`, `published`.

- **201** = creado. **400** = faltan campos. **401** = token o permiso. **409** = slug repetido.
- Errores comunes: JSON inválido; comilla extra antes del último `}`; mezclar claves `query`/`variables` (no hacerlo).

## No usar para este flujo

- No enviar a `/graphql` un string armado por el modelo con `mutation` y `variables` en un solo texto mal escapado: suele dar 400 y cuerpo vacío.

## Otros endpoints (referencia)

- GraphQL: `POST {BACKEND_URL}/graphql` (artículos, publicar flash, etc.) — requiere JSON `{ "query", "variables" }` bien formado.
- Subida imagen: `POST {BACKEND_URL}/media/upload` multipart campo `file`; scope `media:upload`.

BACKEND_URL = origen del API en Railway (sin barra final).

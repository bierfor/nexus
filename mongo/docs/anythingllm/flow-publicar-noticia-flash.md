# Flow AnythingLLM: PublicarNoticiaFlash (configuración exacta)

Este documento define cómo debe quedar el flow para que un LLM lo entienda y **no rompa el JSON**. Usa el endpoint **`POST /integrations/flash-news`** (cuerpo plano), no GraphQL en el cuerpo generado por el modelo.

**Seguridad:** no pegues el token `pfbot_…` en el flow ni en este repo. Usa **variables de entorno / secretos** de AnythingLLM para `Authorization`.

---

## Flow Name

```text
PublicarNoticiaFlash
```

Nombre claro en PascalCase; el modelo puede asociarlo a “publicar una noticia relámpago en Puro Flusso”.

---

## Description

Copia y pega (o adapta una línea):

```text
Publica una noticia relámpago en el sitio Puro Flusso. El LLM genera un único objeto JSON (title, summary obligatorios; slug opcional porque el backend puede generarlo desde el título; fuente y hack opcionales). Ese objeto se envía en el cuerpo de POST /integrations/flash-news en Railway. No usar GraphQL en el cuerpo. Requiere Bearer con scope flash:create.
```

---

## Flow Variables

| Variable            | Uso |
|---------------------|-----|
| `entrada_noticia`   | Entrada del usuario o texto/scraping que alimenta al LLM (contexto). |
| `cuerpo_json_flash` | **Salida del bloque LLM:** objeto JSON **plano** listo para el POST (ver instrucción). |
| `respuesta_api`     | **Salida del bloque API:** respuesta del servidor (no reutilices `entrada_noticia` para esto). |

- **Initial value** de `entrada_noticia`: déjala vacía o un ejemplo mínimo; el chat rellenará el contexto.
- **No** uses `{{datos_noticia}}` en el API si tu variable se llama `entrada_noticia`: el nombre debe coincidir en todo el flow.

---

## Bloque 1: LLM Instruction

**Instruction** (copiar tal cual o ajustar tono):

```text
Actúa como redactor de Puro Flusso. Con los datos en la variable de contexto (noticia, titular, enlace, etc.), genera EXCLUSIVAMENTE un único objeto JSON válido, sin markdown, sin bloques ```json, sin texto antes ni después.

Claves (inglés preferido; el backend acepta alias):
- "title": obligatorio, titular corto.
- "summary": obligatorio, máximo 2 frases.
- "slug": opcional. Si lo omites o va vacío, el servidor genera un slug único a partir del title.
- "sourceLabel" o "source": nombre de la fuente (ej. medio).
- "sourceUrl" o "url" o "link": URL https de la noticia.
- "hack": tip corto para el lector.
- "published": boolean; si hay duda, false.

Reglas:
- No incluyas "query", "mutation", "variables" ni GraphQL.
- No pongas comillas sueltas entre llaves al cerrar el JSON.
- Salida: solo el objeto, una línea o varias, pero parseable por JSON.parse.
```

**Result variable:** `cuerpo_json_flash` (o el nombre que luego uses en el API Call).

---

## Bloque 2: API Call

| Campo | Valor |
|--------|--------|
| **URL** | `https://puro-flusso-production.up.railway.app/integrations/flash-news` |
| **Method** | `POST` |

**Headers**

| Name | Value |
|------|--------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <TU_TOKEN_PFBOT>` |

Sustituye `<TU_TOKEN_PFBOT>` por una **variable/secreto** de AnythingLLM (no el literal en el flow si es compartido o versionado).

**Request Body**

Si AnythingLLM permite poner el cuerpo entero sustituido por variable, usa **solo** la variable que guardó el LLM:

```text
{{cuerpo_json_flash}}
```

Si la UI obliga a un objeto JSON y no acepta “raw”, prueba:

```json
{{cuerpo_json_flash}}
```

según la documentación de tu versión (algunas esperan el JSON ya string-escaped; otras inyectan el bloque).

**Importante:** no uses esta forma antigua (provoca errores y cuerpo vacío):

```json
{
  "query": "mutation …",
  "variables": {
    "input": {{algo}}
  }
}
```

El backend **`/integrations/flash-news`** espera **directamente** el mismo objeto que iría dentro de `input` en GraphQL, por ejemplo:

```json
{
  "title": "…",
  "summary": "…",
  "sourceLabel": "…",
  "sourceUrl": "https://…",
  "hack": "…",
  "published": true
}
```

(`slug` opcional.)

**Store Response In:** `respuesta_api` (u otro nombre que no pise `entrada_noticia`).

### CORS (local vs Railway)

**CORS no borra el cuerpo del POST.** Si el log dice **“No body”**, el fallo está en el **flow** (plantilla del HTTP sin enlazar), no en CORS.

- Petición **desde el servidor** de AnythingLLM (típico en Docker): no hay `Origin` → CORS no aplica.
- Petición **desde el navegador** (Electron o pestaña): si en Railway tienes `CORS_ORIGINS` restrictivo, añade el origen exacto de AnythingLLM (ej. `http://localhost:3001` sin barra final). Si falta, el navegador puede bloquear la **lectura** de la respuesta; no suele enviar un POST con cuerpo vacío por eso.

Tras desplegar el backend reciente, `/integrations/flash-news` acepta el body **crudo** y, si el JSON es el objeto del tool con `cuerpo_json_flash` como string, **desempaqueta** el objeto interno.

### Si ves **404** en Railway

Ese path no existe en el despliegue actual: hay que **volver a desplegar el backend** con el código que incluye `POST /integrations/flash-news`. Mientras tanto solo existirá `/graphql`.

### Si ves **No body** / **400** con cuerpo vacío

El bloque HTTP **no está usando** la salida del LLM como cuerpo. Comprueba:

1. El **Request Body** del API Call debe ser **solo** `{{cuerpo_json_flash}}` (o el nombre exacto de la variable donde guardaste la salida del bloque LLM), no un objeto que mezcle `entrada_noticia` + `respuesta_api` del tool.
2. Si el agente invoca el tool con argumentos tipo `{ "cuerpo_json_flash": "{...string escapado...}", ... }`, el flow debe **parsear** `cuerpo_json_flash` y usar **ese string** como body, no el JSON completo del tool.
3. Tipo de body: si la UI ofrece “Raw” / “Text”, úsalo para inyectar el JSON; si solo “JSON”, a veces hay que usar un paso intermedio que asigne el string al body.

---

## Direct Output

- Si quieres que el usuario vea **solo** la respuesta del servidor: activa **Direct Output** en el bloque API y apunta al mensaje final con `respuesta_api`.
- Si necesitas otro paso después, no marques Direct Output en el API hasta el último bloque.

---

## Checklist rápido

| Comprueba | |
|-----------|---|
| URL termina en `/integrations/flash-news` | Sí |
| Cuerpo = JSON plano del LLM, sin envelope GraphQL | Sí |
| Variable del LLM = variable del body del API (mismo nombre) | Sí |
| Token en secreto, no en texto fijo público | Sí |
| Respuesta guardada en variable distinta a la entrada | Sí |

---

## Respuestas HTTP esperadas

| Código | Significado |
|--------|-------------|
| **201** | Creado; cuerpo con `id`, `slug`, `title`, etc. |
| **400** | Validación (faltan `title` / `summary` o JSON inválido / cuerpo vacío). |
| **401** | Sin Bearer o sin scope `flash:create`. |
| **404** | Ruta no desplegada o URL incorrecta. |
| **409** | Colisión de slug muy rara (condición de carrera); el backend suele añadir sufijo automático. |

Si obtienes **400** y el log dice cuerpo vacío, el sustituto `{{variable}}` no está inyectando el JSON: revisa el nombre de la variable y que el LLM no haya envuelto la salida en markdown.

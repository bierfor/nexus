# AnythingLLM + IBM Granite 4.3B (Puro Flusso)

Guía para configurar un workspace que publique **noticias relámpago** vía `POST /integrations/flash-news` sin romper JSON.

## 1. Proveedor y modelo

1. Abre **AnythingLLM** → **Settings** (rueda) → **LLM Preference**.
2. Elige tu backend (p. ej. **Ollama**, **LM Studio**, **LocalAI**, **vLLM**).
3. Modelo recomendado: **`granite4:3b`** (Ollama: `ollama pull granite4:3b` o imagen IBM según tu instalación).
4. Guarda y, si hace falta, **reinicia** el contenedor o la app.

Parámetros numéricos: copia la tabla de **`granite-4-3b-settings.md`** en el mismo proveedor (si la UI los expone) o déjalos por defecto y baja **temperature** si el agente alucina o malforma JSON.

## 2. System prompt del workspace

1. Entra al **workspace** deseado → **Settings del workspace** (icono de engranaje en el chat).
2. Busca **System Prompt** (o “Prompt del sistema”).
3. Pega el contenido completo de **`workspace-system-prompt.txt`**.
4. AnythingLLM admite variables como `{datetime}`; el archivo ya las usa donde aplica.

## 3. Documentos (RAG)

1. En el mismo workspace: **Upload** / **Documents**.
2. Sube **`api-cheatsheet-for-rag.md`** (resumen de API y reglas JSON).
3. Opcional: sube también **`../BOT_API.md`** del repo para el manual largo.

Así Granite 3B puede citar reglas sin que el system prompt ocupe todo el contexto.

## 4. Agente y herramienta HTTP

Si usas **@agent** con un flujo que llama a tu API:

1. Configura la URL base de producción, p. ej. `https://puro-flusso-production.up.railway.app/integrations/flash-news`.
2. Método **POST**, cabeceras:
   - `Content-Type: application/json`
   - `Authorization: Bearer <token>` (mejor variable de entorno / secreto en AnythingLLM, **no** en el prompt).
3. **Cuerpo:** debe ser **solo** el JSON plano del artículo (ver cheatsheet). El flujo no debe pedir al modelo un string que contenga `query` ni `variables` de GraphQL.

Pega en la descripción del agente o en “Instructions” del skill el contenido de **`agent-flash-http-instructions.txt`**.

## 5. Archivos de esta carpeta

| Archivo | Uso |
|---------|-----|
| **`flow-publicar-noticia-flash.md`** | **Flow AnythingLLM paso a paso:** nombre, descripción, variables, LLM, API (sin GraphQL en el body). |
| `workspace-system-prompt.txt` | Prompt del sistema del workspace |
| `agent-flash-http-instructions.txt` | Instrucciones del agente / skill HTTP |
| `granite-4-3b-settings.md` | Temperature, max tokens, etc. |
| `api-cheatsheet-for-rag.md` | Subir como documento al workspace |

## 6. Comprobación

Desde el chat (sin agente): pedir un resumen de cómo publicar una flash. Debe mencionar JSON plano y `/integrations/flash-news`.

Con agente: una prueba con `published: false` y un `slug` único; respuesta **201** del backend.

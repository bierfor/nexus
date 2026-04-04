# Parámetros sugeridos: Granite 4.3B en AnythingLLM

Modelo pequeño: prioriza **JSON estable** y **menos alucinación** sobre creatividad.

## Chat normal (preguntas / RAG)

| Parámetro | Valor sugerido | Nota |
|-----------|----------------|------|
| Temperature | **0.2 – 0.35** | Subir solo si las respuestas son demasiado rígidas. |
| Top P | **0.85 – 0.9** | Compatible con docs IBM Granite. |
| Top K | **40 – 50** | Si tu backend lo expone. |
| Max tokens (respuesta) | **512 – 900** | 3B se satura pronto; evita respuestas enormes. |
| Repetition penalty | **1.05 – 1.1** | Si el modelo repite frases. |

## Modo agente / herramienta (generar JSON para HTTP)

| Parámetro | Valor sugerido |
|-----------|----------------|
| Temperature | **0.1 – 0.25** |
| Max tokens | **256 – 512** (solo basta un objeto JSON) |

## Ollama (referencia)

Si configuras por CLI o `Modelfile`:

```text
parameter temperature 0.2
parameter top_p 0.9
parameter num_predict 512
```

Ajusta el nombre del modelo (`granite4:3b`, `ibm/granite4:3b`, etc.) según tu `ollama list`.

## Contexto

AnythingLLM: deja margen a **documentos embebidos** y a la definición de herramientas. Si el contexto se llena, reduce historial del chat o fragmenta documentos largos.

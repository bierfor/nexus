# @nexus_js/brain

**Optional** server-side LLM helper (OpenAI-compatible providers). Skip this package entirely if you do not want any AI dependency — the rest of Nexus does not require it.

OpenAI-compatible providers (**OpenAI**, **Groq**), in-memory **hash cache**, and **DevRadar** events for **Nexus Studio** (latency, tokens, model, cache hit). Unit tests here only cover config and cache (**no** live API calls).

## Setup

```bash
pnpm add @nexus_js/brain
```

Environment (pick one key strategy):

| Variable | Purpose |
|----------|---------|
| `NEXUS_BRAIN_API_KEY` | Preferred single key |
| `OPENAI_API_KEY` | Used when `NEXUS_BRAIN_PROVIDER=openai` (default) |
| `GROQ_API_KEY` | Used when provider is Groq |
| `NEXUS_BRAIN_PROVIDER` | `openai` or `groq` |
| `NEXUS_BRAIN_BASE_URL` | Override API base (defaults: api.openai.com / api.groq.com openai-compatible path) |
| `NEXUS_BRAIN_MODEL` | e.g. `gpt-4o-mini`, `llama-3.1-8b-instant` |

## Usage (Server Action)

```ts
import { $brain } from '@nexus_js/brain';

export const suggestNextNode = async (currentFlow: unknown) => {
  return $brain.complete({
    prompt: 'Based on this flow JSON, suggest the next node type in one line.',
    context: currentFlow,
    cache: true,
  });
};
```

With `nexus dev` and Studio open, each completion appears in the **DevRadar** panel (Nexus Brain section).

## Security

- Call only from **server** code (actions, `nxPretext`, etc.).
- Telemetry uses **truncated** prompt previews and `sanitizeTelemetryValue` for DevRadar; do not put secrets in `prompt` / `context`.

## License

MIT

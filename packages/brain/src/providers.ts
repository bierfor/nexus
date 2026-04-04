/**
 * OpenAI-compatible chat completions (OpenAI + Groq).
 */

export interface ChatCompleteParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Full user message (prompt + serialized context). */
  userContent: string;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface ChatCompleteResult {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export async function chatCompleteOpenAICompatible(
  params: ChatCompleteParams,
): Promise<ChatCompleteResult> {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'content-type':  'application/json',
      authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model:       params.model,
      messages:    [{ role: 'user', content: params.userContent }],
      max_tokens:  params.maxTokens ?? 1024,
    }),
  };
  if (params.signal !== undefined) init.signal = params.signal;
  const res = await fetch(url, init);

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw.slice(0, 400);
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* use raw */
    }
    throw new Error(`[Nexus Brain] ${res.status}: ${detail}`);
  }

  const json = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const text = json.choices?.[0]?.message?.content?.trim() ?? '';
  const u = json.usage;
  if (u === undefined) {
    return { text };
  }
  const usage: ChatCompleteResult['usage'] = {};
  if (u.prompt_tokens !== undefined) usage.promptTokens = u.prompt_tokens;
  if (u.completion_tokens !== undefined) usage.completionTokens = u.completion_tokens;
  if (u.total_tokens !== undefined) usage.totalTokens = u.total_tokens;
  return Object.keys(usage).length > 0 ? { text, usage } : { text };
}

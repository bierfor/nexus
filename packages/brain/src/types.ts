export type BrainProvider = 'openai' | 'groq';

export interface BrainCompleteOptions {
  prompt: string;
  /** Arbitrary JSON-serializable context (flow JSON, etc.). */
  context?: unknown;
  /** Default true — skip network when an identical request was made in-process. */
  cache?: boolean;
  model?: string;
  provider?: BrainProvider;
  signal?: AbortSignal;
  maxTokens?: number;
}

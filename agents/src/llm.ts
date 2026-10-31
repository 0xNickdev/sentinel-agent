// One narrow door to the model: a structured, streamed completion. Swarm code
// depends on the LLM interface, so tests run with a fake and production runs
// on the Anthropic SDK (adaptive thinking, structured outputs, prompt caching,
// server-side refusal fallback for the judge).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import type { Effort, Usage } from './schema.js';

export interface StructuredRequest<T> {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** opt into Anthropic's server-side refusal fallback (not supported on Haiku) */
  fallbacks?: boolean;
  /** who is asking and why; fakes branch on it, production ignores it */
  meta: { agent: string; phase: 'finding' | 'debate' | 'council' | 'advocate' | 'judge' };
  onThinking?: (delta: string) => void;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  value: T;
  model: string;
  usage: Usage;
  ms: number;
}

export interface LLM {
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export class LLMError extends Error {
  constructor(message: string, readonly kind: 'refusal' | 'truncated' | 'schema' | 'api') {
    super(message);
    this.name = 'LLMError';
  }
}

export class AnthropicLLM implements LLM {
  constructor(private readonly client: Anthropic = new Anthropic()) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const t0 = Date.now();
    let lastSchemaError: unknown;
    // One retry on a schema miss; API errors surface immediately (the SDK already retries 429/5xx).
    for (let attempt = 0; attempt < 2; attempt++) {
      const stream = this.client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.user }],
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort },
          ...(req.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        req.signal ? { signal: req.signal } : {},
      );
      if (req.onThinking) stream.on('thinking', d => req.onThinking!(d));
      if (req.onText) stream.on('text', d => req.onText!(d));
      let msg;
      try {
        msg = await stream.finalMessage();
      } catch (e) {
        if (e instanceof Anthropic.APIError) throw new LLMError(`${req.model}: API ${e.status ?? ''} ${e.message}`.trim(), 'api');
        throw e;
      }
      if (msg.stop_reason === 'refusal') throw new LLMError(`${req.model} declined (${msg.stop_details?.category ?? 'unknown'})`, 'refusal');
      if (msg.stop_reason === 'max_tokens') throw new LLMError(`${req.model} hit max_tokens=${req.maxTokens}`, 'truncated');
      const usage: Usage = { input: msg.usage.input_tokens, output: msg.usage.output_tokens, cacheRead: msg.usage.cache_read_input_tokens ?? 0 };
      let value = msg.parsed_output as T | null | undefined;
      if (value == null) {
        const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('');
        try {
          value = req.schema.parse(JSON.parse(text));
        } catch (e) {
          lastSchemaError = e;
          continue;
        }
      }
      return { value, model: msg.model, usage, ms: Date.now() - t0 };
    }
    throw new LLMError(`${req.model} returned output that does not match the schema: ${String(lastSchemaError)}`, 'schema');
  }
}

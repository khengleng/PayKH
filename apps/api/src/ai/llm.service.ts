import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin Anthropic Messages API client. When ANTHROPIC_API_KEY is unset, returns
 * `{ text: null }` so callers can fall back to a deterministic computed response
 * (mirrors the log-transport pattern used by email/telegram). Best-effort — a
 * failed call returns null rather than throwing into the request.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger('LLM');
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('anthropicApiKey');
    this.model = config.get<string>('aiModel') ?? 'claude-haiku-4-5-20251001';
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  get modelName(): string {
    return this.model;
  }

  async complete(system: string, user: string, maxTokens = 500): Promise<LlmResult> {
    if (!this.apiKey) return { text: null, inputTokens: 0, outputTokens: 0, model: this.model };
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      if (!res.ok) {
        this.logger.error(`Anthropic API ${res.status}: ${await res.text()}`);
        return { text: null, inputTokens: 0, outputTokens: 0, model: this.model };
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
      const text = data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ?? null;
      return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, model: this.model };
    } catch (err) {
      this.logger.error(`Anthropic call failed: ${err}`);
      return { text: null, inputTokens: 0, outputTokens: 0, model: this.model };
    }
  }
}

export interface LlmResult {
  text: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

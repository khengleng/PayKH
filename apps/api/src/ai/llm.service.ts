import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.module';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Thin Anthropic Messages API client. The key + model are resolved at call time
 * from system settings (encrypted DB value → env fallback), so an admin can set
 * them in-app without a redeploy. When no key is configured it returns
 * `{ text: null }` so callers fall back to a deterministic computed response.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger('LLM');

  constructor(private readonly config: ConfigService, private readonly settings: SettingsService) {}

  get modelName(): string {
    return this.config.get<string>('aiModel') ?? DEFAULT_MODEL;
  }

  async complete(system: string, user: string, maxTokens = 500): Promise<LlmResult> {
    const apiKey = await this.settings.resolve('anthropic_api_key');
    const model = (await this.settings.resolve('ai_model')) ?? DEFAULT_MODEL;
    if (!apiKey) return { text: null, inputTokens: 0, outputTokens: 0, model };
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      if (!res.ok) {
        this.logger.error(`Anthropic API ${res.status}: ${await res.text()}`);
        return { text: null, inputTokens: 0, outputTokens: 0, model };
      }
      const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
      const text = data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ?? null;
      return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0, model };
    } catch (err) {
      this.logger.error(`Anthropic call failed: ${err}`);
      return { text: null, inputTokens: 0, outputTokens: 0, model };
    }
  }
}

export interface LlmResult {
  text: string | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

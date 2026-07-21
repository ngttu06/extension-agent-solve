import type { ChatMessage, ProviderConfig, ToolCall } from '@/shared/types';
import type { ToolSchema } from '@/shared/tools';
import { ProviderError, parseRetryAfter, type AIProvider, type ProviderResponse } from './types';

/**
 * Adapter for Anthropic-compatible Messages API endpoints (Claude and clones).
 * Converts our normalised chat format to Anthropic's content-block model.
 */
export class AnthropicCompatibleProvider implements AIProvider {
  constructor(private config: ProviderConfig) {}

  async chat(
    messages: ChatMessage[],
    tools: ToolSchema[],
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/messages`;

    // Anthropic takes a top-level system prompt separate from the turns.
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const turns = messages.filter((m) => m.role !== 'system');

    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 1024,
      temperature: this.config.temperature ?? 0.2,
      system: system || undefined,
      messages: turns.map((m) => this.toApiMessage(m)),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new ProviderError(
        `Anthropic-compatible API error ${res.status}: ${errText.slice(0, 500)}`,
        res.status,
        parseRetryAfter(res.headers),
      );
    }

    const json = await res.json();
    const blocks: Array<Record<string, unknown>> = json.content ?? [];
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of blocks) {
      if (block.type === 'text') {
        text += String(block.text ?? '');
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: String(block.id ?? crypto.randomUUID()),
          name: block.name as ToolCall['name'],
          args: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    return { text, toolCalls };
  }

  private toApiMessage(m: ChatMessage): unknown {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content },
        ],
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
      }
      return { role: 'assistant', content };
    }
    if (m.role === 'user' && m.imageDataUrl && this.config.supportsVision) {
      const [meta, data] = m.imageDataUrl.split(',');
      const mediaType = meta.match(/data:(.*?);/)?.[1] ?? 'image/png';
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data },
          },
        ],
      };
    }
    return { role: m.role, content: m.content };
  }
}

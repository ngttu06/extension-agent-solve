import type { ChatMessage, ProviderConfig, ToolCall } from '@/shared/types';
import type { ToolSchema } from '@/shared/tools';
import { ProviderError, parseRetryAfter, type AIProvider, type ProviderResponse } from './types';

/**
 * Adapter for any OpenAI-compatible Chat Completions endpoint.
 * Works with OpenAI, Groq, OpenRouter, LM Studio, Ollama (/v1), vLLM, etc.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(private config: ProviderConfig) {}

  async chat(
    messages: ChatMessage[],
    tools: ToolSchema[],
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = {
      model: this.config.model,
      temperature: this.config.temperature ?? 0.2,
      max_tokens: this.config.maxTokens ?? 1024,
      messages: messages.map((m) => this.toApiMessage(m)),
      tools: tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: 'auto',
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new ProviderError(
        `OpenAI-compatible API error ${res.status}: ${errText.slice(0, 500)}`,
        res.status,
        parseRetryAfter(res.headers),
      );
    }

    const json = await res.json();
    const choice = json.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (choice.tool_calls ?? []).map(
      (tc: { id?: string; function: { name: string; arguments: string } }) => ({
        id: tc.id ?? crypto.randomUUID(),
        name: tc.function.name,
        args: safeParse(tc.function.arguments),
      }),
    );

    return { text: choice.content ?? '', toolCalls };
  }

  private toApiMessage(m: ChatMessage): unknown {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    // Multimodal user message with an image (vision fallback).
    if (m.role === 'user' && m.imageDataUrl && this.config.supportsVision) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          { type: 'image_url', image_url: { url: m.imageDataUrl } },
        ],
      };
    }
    return { role: m.role, content: m.content };
  }
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

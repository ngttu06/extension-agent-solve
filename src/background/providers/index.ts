import type { ProviderConfig } from '@/shared/types';
import { AnthropicCompatibleProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openai';
import type { AIProvider } from './types';

/** Instantiate the correct adapter for the configured provider kind. */
export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.kind) {
    case 'anthropic-compatible':
      return new AnthropicCompatibleProvider(config);
    case 'openai-compatible':
    default:
      return new OpenAICompatibleProvider(config);
  }
}

export type { AIProvider, ProviderResponse } from './types';
export { ProviderError, isRetryableProviderError } from './types';

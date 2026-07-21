import type { ChatMessage, ProviderConfig, ToolCall } from '@/shared/types';
import type { ToolSchema } from '@/shared/tools';

/** Normalised response from any provider after one chat turn. */
export interface ProviderResponse {
  /** Assistant free-text (may be empty when only tools were requested). */
  text: string;
  /** Structured tool calls the model wants executed. */
  toolCalls: ToolCall[];
}

/** Common interface every provider adapter implements. */
export interface AIProvider {
  chat(
    messages: ChatMessage[],
    tools: ToolSchema[],
    signal?: AbortSignal,
  ): Promise<ProviderResponse>;
}

export interface ProviderContext {
  config: ProviderConfig;
}

/**
 * Error thrown by provider adapters carrying the HTTP status (when the failure
 * was an HTTP error response) so callers can decide whether it's retryable.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    /** HTTP status if the failure was a non-2xx response; undefined for network errors. */
    readonly status?: number,
    /** Parsed `Retry-After` hint in ms, when the server supplied one (429/503). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * A provider failure is worth retrying when it's a transient network error
 * (fetch rejected, no HTTP status), a 429 rate-limit, or a 5xx. Fixed errors
 * like 401/403 (bad key) or 4xx bad requests are not retried.
 */
export function isRetryableProviderError(err: unknown): boolean {
  // AbortError means the user cancelled — never retry.
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  if (err instanceof ProviderError) {
    if (err.status === undefined) return true; // network-level failure
    return err.status === 429 || err.status >= 500;
  }
  // Any other thrown value (e.g. raw fetch TypeError) is treated as transient.
  return true;
}

/** Parse an HTTP `Retry-After` header (delta-seconds or HTTP-date) into ms. */
export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('Retry-After');
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

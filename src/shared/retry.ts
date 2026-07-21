// ---------------------------------------------------------------------------
// Generic retry helper with exponential backoff + jitter, abort-aware so a
// user pressing Stop cancels an in-flight wait immediately.
// ---------------------------------------------------------------------------

/** Default number of retry attempts after the initial try. */
export const DEFAULT_RETRIES = 3;

export interface RetryOptions {
  /** Retry attempts after the first try. Defaults to DEFAULT_RETRIES. */
  retries?: number;
  /** Base backoff in ms; grows exponentially per attempt. Defaults to 500. */
  baseDelayMs?: number;
  /** Cancels pending waits and short-circuits retries when aborted. */
  signal?: AbortSignal;
  /** Return true if the error is transient and worth retrying. */
  shouldRetry: (err: unknown) => boolean;
  /** Called before each retry wait so callers can surface progress. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

/** True if an error is (or wraps) a fetch abort — never worth retrying. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** Sleep that resolves early (rejects) if the signal aborts mid-wait. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `fn`, retrying transient failures up to `retries` times. Aborts and
 * fixed errors (per `shouldRetry`) throw immediately without further attempts.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // User pressed Stop, or the request was aborted — give up now.
      if (opts.signal?.aborted || isAbortError(err)) throw err;
      // Out of attempts, or the error is fixed (bad key, 4xx) — surface it.
      if (attempt >= retries || !opts.shouldRetry(err)) throw err;

      const backoff = baseDelayMs * 2 ** attempt;
      const retryAfterMs = getRetryAfterMs(err);
      const delayMs = retryAfterMs ?? backoff + Math.floor(Math.random() * baseDelayMs);
      opts.onRetry?.(attempt + 1, err, delayMs);
      await abortableDelay(delayMs, opts.signal);
    }
  }
  throw lastErr;
}

/** Pull a `retryAfterMs` hint off an error if it carries one (e.g. 429). */
function getRetryAfterMs(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'retryAfterMs' in err) {
    const v = (err as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof v === 'number' && v > 0) return v;
  }
  return undefined;
}

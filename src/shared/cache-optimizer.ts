/**
 * Cache optimizer - memoization và debouncing cho action cache operations.
 * Giảm số lần query vào IndexedDB và tối ưu performance khi lookup recipes.
 */

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export class CacheOptimizer<K, V> {
  private memoryCache = new Map<string, CacheEntry<V>>();
  private pendingRequests = new Map<string, Promise<V | null>>();
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(options: { ttl?: number; maxSize?: number } = {}) {
    this.ttl = options.ttl ?? 30000; // 30 giây mặc định
    this.maxSize = options.maxSize ?? 100; // Tối đa 100 entries
  }

  /**
   * Serialize key object thành string để dùng làm map key
   */
  private serializeKey(key: K): string {
    return JSON.stringify(key);
  }

  /**
   * Kiểm tra entry có còn valid không
   */
  private isValid(entry: CacheEntry<V>): boolean {
    return Date.now() - entry.timestamp < this.ttl;
  }

  /**
   * Dọn dẹp cache khi quá kích thước
   */
  private evict(): void {
    if (this.memoryCache.size <= this.maxSize) return;

    // Xóa entries cũ nhất cho đến khi size <= maxSize
    const entries = Array.from(this.memoryCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );

    const toRemove = entries.slice(0, entries.length - this.maxSize);
    for (const [key] of toRemove) {
      this.memoryCache.delete(key);
    }
  }

  /**
   * Get value từ cache hoặc fetch mới.
   * Deduplicate concurrent requests cho cùng key.
   */
  async get(key: K, fetcher: () => Promise<V | null>): Promise<V | null> {
    const serialized = this.serializeKey(key);

    // Check memory cache
    const cached = this.memoryCache.get(serialized);
    if (cached && this.isValid(cached)) {
      return cached.value;
    }

    // Deduplicate concurrent requests
    const pending = this.pendingRequests.get(serialized);
    if (pending) {
      return pending;
    }

    // Fetch mới
    const request = fetcher();
    this.pendingRequests.set(serialized, request);

    try {
      const value = await request;
      if (value !== null) {
        this.set(key, value);
      }
      return value;
    } finally {
      this.pendingRequests.delete(serialized);
    }
  }

  /**
   * Set value vào cache
   */
  set(key: K, value: V): void {
    const serialized = this.serializeKey(key);
    this.memoryCache.set(serialized, {
      value,
      timestamp: Date.now(),
    });
    this.evict();
  }

  /**
   * Invalidate một key cụ thể
   */
  invalidate(key: K): void {
    const serialized = this.serializeKey(key);
    this.memoryCache.delete(serialized);
  }

  /**
   * Clear toàn bộ cache
   */
  clear(): void {
    this.memoryCache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Lấy stats về cache
   */
  getStats(): { size: number; ttl: number; maxSize: number } {
    return {
      size: this.memoryCache.size,
      ttl: this.ttl,
      maxSize: this.maxSize,
    };
  }
}

/**
 * Debouncer cho write operations - gộp nhiều writes gần nhau thành 1 batch
 */
export class WriteDebouncer<T> {
  private pending: T[] = [];
  private timeoutId: number | null = null;
  private readonly delay: number;

  constructor(delay = 500) {
    this.delay = delay;
  }

  /**
   * Schedule một item để write. Sẽ được gộp với các items khác trong cùng window.
   */
  schedule(item: T, executor: (batch: T[]) => Promise<void>): void {
    this.pending.push(item);

    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
    }

    this.timeoutId = window.setTimeout(async () => {
      const batch = [...this.pending];
      this.pending = [];
      this.timeoutId = null;

      if (batch.length > 0) {
        try {
          await executor(batch);
        } catch (err) {
          console.error('Write debouncer batch failed:', err);
        }
      }
    }, this.delay);
  }

  /**
   * Flush ngay lập tức mà không đợi delay
   */
  async flush(executor: (batch: T[]) => Promise<void>): Promise<void> {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.pending.length === 0) return;

    const batch = [...this.pending];
    this.pending = [];

    try {
      await executor(batch);
    } catch (err) {
      console.error('Write debouncer flush failed:', err);
    }
  }
}

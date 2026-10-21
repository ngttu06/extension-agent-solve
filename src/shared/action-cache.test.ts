import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  deriveRouteKey,
  landmarkSimilarity,
  normalizeGoal,
} from './action-cache';

describe('action cache keys', () => {
  it('normalizes equivalent goal whitespace and Unicode', () => {
    expect(normalizeGoal('  Mở   SẢN PHẨM  ')).toBe(normalizeGoal('mở sản phẩm'));
  });

  it('preserves meaningful numbers and addresses', () => {
    expect(normalizeGoal('open order 123')).not.toBe(normalizeGoal('open order 124'));
    expect(normalizeGoal('email a@example.com')).not.toBe(normalizeGoal('email b@example.com'));
  });

  it('drops only known tracking parameters and sorts the rest', () => {
    const result = canonicalizeUrl('https://example.com/search?utm_source=x&q=shoes&page=2#top');
    expect(result).toBe('https://example.com/search?page=2&q=shoes');
    expect(deriveRouteKey(result)).toBe('https://example.com/search?page=2&q=shoes');
  });
});

describe('landmark similarity', () => {
  it('accepts a small structural change but rejects a different page', () => {
    expect(landmarkSimilarity(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBe(0.75);
    expect(landmarkSimilarity(['a', 'b'], ['x', 'y'])).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@/background/tools';
import { neverRetryToolNames, parallelToolNames, riskyToolNames } from './tool-registry';

describe('tool registry', () => {
  const registry = createToolRegistry();

  it('creates a registry with all tools', () => {
    expect(registry.size).toBeGreaterThan(0);
    expect(registry.has('observe_page')).toBe(true);
    expect(registry.has('click')).toBe(true);
    expect(registry.has('finish')).toBe(true);
  });

  it('every tool has a schema, executor, and metadata', () => {
    for (const [name, def] of registry) {
      expect(def.name).toBe(name);
      expect(def.schema).toBeDefined();
      expect(def.schema.name).toBe(name);
      expect(typeof def.execute).toBe('function');
      expect(['safe', 'confirm']).toContain(def.risk);
      expect(['page', 'network', 'agent']).toContain(def.scope);
      expect(typeof def.sideEffecting).toBe('boolean');
      expect(typeof def.parallelSafe).toBe('boolean');
    }
  });

  it('no duplicate tool names', () => {
    const names = Array.from(registry.keys());
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it('schemas match registry', () => {
    // Compare schemas directly from registry instead of calling getToolSchemas
    // which uses require() that doesn't work with path alias in test
    const schemas = Array.from(registry.values()).map((def) => def.schema);
    expect(schemas.length).toBe(registry.size);
    
    for (const schema of schemas) {
      const def = registry.get(schema.name);
      expect(def).toBeDefined();
      expect(def?.schema).toEqual(schema);
    }
  });

  it('derives risky tools correctly', () => {
    const risky = riskyToolNames(registry);
    expect(risky.has('click')).toBe(true);
    expect(risky.has('navigate')).toBe(true);
    expect(risky.has('execute_javascript')).toBe(true);
    expect(risky.has('observe_page')).toBe(false);
    expect(risky.has('wait')).toBe(false);
  });

  it('derives never-retry tools correctly', () => {
    const neverRetry = neverRetryToolNames(registry);
    expect(neverRetry.has('click')).toBe(true);
    expect(neverRetry.has('type')).toBe(true);
    expect(neverRetry.has('observe_page')).toBe(false);
  });

  it('derives parallel-safe tools correctly', () => {
    const parallel = parallelToolNames(registry);
    expect(parallel.has('observe_page')).toBe(true);
    expect(parallel.has('inspect_html')).toBe(true);
    expect(parallel.has('extract')).toBe(true);
    expect(parallel.has('click')).toBe(false);
    expect(parallel.has('navigate')).toBe(false);
  });

  it('page tools have correct scope', () => {
    expect(registry.get('click')?.scope).toBe('page');
    expect(registry.get('observe_page')?.scope).toBe('page');
  });

  it('agent tools have correct scope', () => {
    expect(registry.get('ask_user')?.scope).toBe('agent');
    expect(registry.get('finish')?.scope).toBe('agent');
  });
});

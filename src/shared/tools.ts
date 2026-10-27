import type { ToolName } from './types';

/** JSON-schema style parameter definition for a tool. */
export interface ToolSchema {
  name: ToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * The fixed catalogue of tools the agent may invoke.
 * 
 * NOTE: This is now derived from the tool registry at runtime to keep a single
 * source of truth. Import createToolRegistry from @/background/tools if you
 * need access to the full registry with executors and metadata.
 * 
 * This export exists for back-compat with providers that only need schemas.
 */
let _cachedSchemas: ToolSchema[] | null = null;

export function getToolSchemas(): ToolSchema[] {
  if (_cachedSchemas) return _cachedSchemas;
  
  // Lazy import to avoid circular dependency (background imports shared)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createToolRegistry } = require('@/background/tools');
  const registry = createToolRegistry();
  
  _cachedSchemas = Array.from(registry.values()).map((def: any) => def.schema);
  return _cachedSchemas;
}

/**
 * Legacy export for back-compat. Providers use this directly.
 * Now returns schemas from registry on first access.
 */
export const TOOL_SCHEMAS: ToolSchema[] = new Proxy([], {
  get(_target, prop) {
    const schemas = getToolSchemas();
    // @ts-expect-error Proxy typing
    return schemas[prop];
  },
  has(_target, prop) {
    return prop in getToolSchemas();
  },
  ownKeys() {
    return Reflect.ownKeys(getToolSchemas());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getToolSchemas(), prop);
  },
});

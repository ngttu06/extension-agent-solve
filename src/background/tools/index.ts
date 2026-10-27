import type { ToolRegistry } from '@/shared/tool-registry';
import { agentTools } from './agent-tools';
import { browserTools } from './browser-tools';
import { webTools } from './web-tools';

/**
 * Create the global tool registry from all tool modules.
 * This is the single source of truth for what tools exist and how they behave.
 */
export function createToolRegistry(): ToolRegistry {
  const registry: ToolRegistry = new Map();
  const allTools = [...browserTools, ...webTools, ...agentTools];

  for (const tool of allTools) {
    if (registry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }

  return registry;
}

export { agentTools, browserTools, webTools };

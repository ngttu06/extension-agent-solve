import type { ToolSchema } from './tools';
import type { ToolCall, ToolName, ToolResult } from './types';

/**
 * Risk level determines whether the tool requires user confirmation in
 * 'confirm' execution mode.
 */
export type ToolRisk = 'safe' | 'confirm';

/**
 * Scope determines how the orchestrator handles the tool:
 * - 'page': DOM/browser actions — snapshot before/after, glow, recipe trace
 * - 'network': web search/fetch — no DOM interaction, parallel-safe
 * - 'agent': meta-actions (ask_user, finish, update_plan) — no DOM, no glow
 */
export type ToolScope = 'page' | 'network' | 'agent';

/**
 * Context passed to every tool executor so they can delegate to orchestrator
 * services without circular dependencies.
 */
export interface ToolContext {
  tabId: number;
  settings: any; // Settings — imported from types causes circular dep, so using any
  hooks: any; // OrchestratorHooks
  /** Capture a fresh page snapshot. */
  observe: (force?: boolean) => Promise<any>; // PageSnapshot | null
  /** Navigate and wait for load. */
  navigateAndWait: (url: string) => Promise<void>;
  /** Go back and wait for load. */
  goBackAndWait: () => Promise<void>;
  /** Capture visible tab screenshot. */
  captureScreenshot: () => Promise<string>;
  /** Execute JavaScript in page MAIN world via CDP. */
  executeJavaScript: (call: ToolCall) => Promise<ToolResult>;
  /** Send a message to content script and await response. */
  sendToContent: <T = unknown>(message: any) => Promise<T>;
}

/**
 * Complete definition of a tool: schema, metadata, validation, and executor.
 * This is the single source of truth for how a tool behaves.
 */
export interface ToolDefinition {
  name: ToolName;
  /** JSON schema for providers and UI. */
  schema: ToolSchema;
  /** Whether this tool requires confirmation in 'confirm' mode. */
  risk: ToolRisk;
  /** How the orchestrator should handle this tool. */
  scope: ToolScope;
  /** True if the tool has side effects (never retry on transient failure). */
  sideEffecting: boolean;
  /** True if multiple calls can run in parallel without coordination. */
  parallelSafe: boolean;
  /** Validate args before execution; return error string or null if valid. */
  validate?: (args: Record<string, unknown>) => string | null;
  /** Redact sensitive args (e.g. passwords) for logging. */
  redactArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Execute the tool with the given context. */
  execute: (call: ToolCall, ctx: ToolContext) => Promise<ToolResult>;
}

/**
 * The tool registry is the single authoritative source for all tools.
 * Add a tool here and it becomes available everywhere: orchestrator, providers, UI.
 */
export type ToolRegistry = Map<ToolName, ToolDefinition>;

/**
 * Derive the set of tool names that require user confirmation from the registry.
 */
export function riskyToolNames(registry: ToolRegistry): Set<ToolName> {
  const names = new Set<ToolName>();
  for (const [name, def] of registry) {
    if (def.risk === 'confirm') names.add(name);
  }
  return names;
}

/**
 * Derive the set of tool names that should never be retried (side-effecting).
 */
export function neverRetryToolNames(registry: ToolRegistry): Set<ToolName> {
  const names = new Set<ToolName>();
  for (const [name, def] of registry) {
    if (def.sideEffecting) names.add(name);
  }
  return names;
}

/**
 * Derive the set of tool names that are safe to run in parallel.
 */
export function parallelToolNames(registry: ToolRegistry): Set<ToolName> {
  const names = new Set<ToolName>();
  for (const [name, def] of registry) {
    if (def.parallelSafe) names.add(name);
  }
  return names;
}

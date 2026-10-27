# Tool Registry Architecture

## Overview

The agent's tools are organized in a **centralized registry** that eliminates duplication and enables declarative control.

## Structure

```typescript
type ToolDefinition = {
  name: string;
  schema: ToolSchema;           // JSON schema for AI provider
  execute: ToolExecutor;         // (call, ctx) => Promise<ToolResult>
  risk: 'safe' | 'confirm';      // Whether confirmation is needed
  scope: 'page' | 'network' | 'agent';  // Tool category
  sideEffecting: boolean;        // Does it mutate state?
  parallelSafe: boolean;         // Can run concurrently?
  validate?: (args) => string | null;   // Pre-execution validation
  redactArgs?: (args) => Record<string, unknown>;  // Hide sensitive data
};
```

## Tool Categories

- **Page tools** (`scope: 'page'`) — DOM interaction: observe, click, type, navigate, edit_html, execute_javascript
- **Network tools** (`scope: 'network'`) — Web search, fetch (Phase C)
- **Agent tools** (`scope: 'agent'`) — ask_user, finish, update_plan (Phase D)

## Risk Levels

- **`risk: 'safe'`** — Read-only or reversible: observe_page, inspect_html, scroll, wait
- **`risk: 'confirm'`** — Mutates state: click, type, navigate, edit_html, execute_javascript

In **Confirm** mode, risky tools require user approval. In **Auto** mode, they execute immediately.

## Adding a Tool

1. Create `ToolDefinition` in `src/background/tools/[category]-tools.ts`
2. Add to the array export (`browserTools`, `webTools`, or `agentTools`)
3. Run `npm test tool-registry` to verify

Example:
```typescript
export const myTool: ToolDefinition = {
  name: 'my_tool',
  schema: { name: 'my_tool', description: '...', parameters: {...} },
  risk: 'safe',
  scope: 'page',
  sideEffecting: false,
  parallelSafe: true,
  async execute(call, ctx) {
    // Implementation
    return { id: call.id, name: 'my_tool', ok: true, content: 'Done' };
  },
};
```

## Testing

```bash
npm test tool-registry
```

Verifies: no duplicates, every tool has schema + executor, derived sets match expectations.

## Migration from Old Pattern

**Old** (5 places to edit):
- `TOOL_SCHEMAS` array
- `RISKY_TOOLS` array  
- `NEVER_RETRY_TOOLS` array
- `PARALLEL_READ_ONLY_TOOLS` set
- `executeTool()` switch case

**New** (1 place):
- Add `ToolDefinition` to registry

Back-compat exports (`TOOL_SCHEMAS`, `RISKY_TOOLS`) are preserved as getters deriving from registry.

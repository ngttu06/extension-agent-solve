import type { ToolContext, ToolDefinition } from '@/shared/tool-registry';
import type { ToolCall, ToolResult } from '@/shared/types';

/**
 * Agent meta-tools: ask_user, finish.
 * These have scope: 'agent' and don't interact with the page.
 */

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  schema: {
    name: 'ask_user',
    description:
      'Ask the human user a question when you are blocked, need credentials, need a decision, or require confirmation you cannot infer.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user.' },
      },
      required: ['question'],
    },
  },
  risk: 'safe',
  scope: 'agent',
  sideEffecting: false,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const question = String(call.args.question ?? 'Could you clarify?');
    const answer = await ctx.hooks.askUser(question);
    return {
      id: call.id,
      name: 'ask_user',
      ok: true,
      content: `User answered: ${answer}`,
    };
  },
};

export const finishTool: ToolDefinition = {
  name: 'finish',
  schema: {
    name: 'finish',
    description:
      'Signal that the task is complete. Provide a concise summary of what was accomplished.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Summary of the outcome.' },
      },
      required: ['summary'],
    },
  },
  risk: 'safe',
  scope: 'agent',
  sideEffecting: false,
  parallelSafe: false,
  async execute(call: ToolCall): Promise<ToolResult> {
    const summary = String(call.args.summary ?? 'Task complete.');
    return { id: call.id, name: 'finish', ok: true, content: summary };
  },
};

export const agentTools: ToolDefinition[] = [askUserTool, finishTool];

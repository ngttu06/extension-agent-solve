import type { ToolContext, ToolDefinition } from '@/shared/tool-registry';
import type { ToolCall, ToolResult } from '@/shared/types';
import { renderSnapshot } from '../prompt';

/**
 * Browser/DOM tools that interact with the page.
 * These have scope: 'page' and trigger snapshots, glow, and recipe tracing.
 */

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const observePageTool: ToolDefinition = {
  name: 'observe_page',
  schema: {
    name: 'observe_page',
    description:
      'Capture a fresh snapshot of the current page: its URL, title, condensed text and the list of interactive elements with their indices. Call this whenever you need up-to-date knowledge of the page before acting.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  scope: 'page',
  sideEffecting: false,
  parallelSafe: true,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const snapshot = await ctx.observe();
    if (!snapshot) {
      return { id: call.id, name: call.name, ok: false, content: 'Could not read page.' };
    }
    return {
      id: call.id,
      name: call.name,
      ok: true,
      content: renderSnapshot(snapshot),
      data: snapshot,
    };
  },
};

export const inspectHtmlTool: ToolDefinition = {
  name: 'inspect_html',
  schema: {
    name: 'inspect_html',
    description:
      'Read the runtime HTML of elements matching a CSS selector. Use this before edit_html when page structure is unclear. Output is truncated to a safe size.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'A valid CSS selector.' },
        outer: {
          type: 'boolean',
          description: 'Return outerHTML instead of innerHTML. Defaults to true.',
        },
        max_length: {
          type: 'number',
          description: 'Maximum output characters (100-20000). Defaults to 8000.',
        },
      },
      required: ['selector'],
    },
  },
  risk: 'safe',
  scope: 'page',
  sideEffecting: false,
  parallelSafe: true,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = await ctx.sendToContent({
        type: 'INSPECT_HTML',
        selector: String(call.args.selector ?? ''),
        outer: call.args.outer !== false,
        maxLength: Number(call.args.max_length) || 8000,
      });
      if ((response as any)?.type === 'ACTION_RESULT') return (response as any).result;
      return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${errMessage(err)}` };
    }
  },
};

export const editHtmlTool: ToolDefinition = {
  name: 'edit_html',
  schema: {
    name: 'edit_html',
    description:
      'Modify runtime page DOM for elements matching a CSS selector. Changes are temporary and normally disappear on reload. Inspect first and re-observe after editing.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'A valid CSS selector.' },
        mode: {
          type: 'string',
          enum: ['inner', 'outer', 'append', 'prepend', 'before', 'after', 'remove'],
          description: 'How to apply the HTML. remove does not require html.',
        },
        html: { type: 'string', description: 'HTML markup to apply.' },
        all: {
          type: 'boolean',
          description: 'Edit every match (up to 50) instead of only the first. Defaults to false.',
        },
      },
      required: ['selector', 'mode'],
    },
  },
  risk: 'confirm',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = (await ctx.sendToContent({
        type: 'EDIT_HTML',
        selector: String(call.args.selector ?? ''),
        mode: String(call.args.mode ?? 'inner') as any,
        html: String(call.args.html ?? ''),
        all: Boolean(call.args.all),
      }));
      if ((response as any)?.type === 'ACTION_RESULT') return (response as any).result;
      return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${errMessage(err)}` };
    }
  },
};

export const executeJavaScriptTool: ToolDefinition = {
  name: 'execute_javascript',
  schema: {
    name: 'execute_javascript',
    description:
      'Execute JavaScript in the page MAIN world through Chrome DevTools Protocol. The code runs inside an async function, so await is supported. Explicitly return a serializable value when a result is needed. Use only when structured tools are insufficient.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript function body to execute. May use await and explicit return.',
        },
      },
      required: ['code'],
    },
  },
  risk: 'confirm',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    return await ctx.executeJavaScript(call);
  },
};

export const clickTool: ToolDefinition = {
  name: 'click',
  schema: {
    name: 'click',
    description: 'Click an interactive element referenced by its index from the latest snapshot.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Index of the element to click.' },
      },
      required: ['index'],
    },
  },
  risk: 'confirm',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = (await ctx.sendToContent({
        type: 'CLICK',
        index: Number(call.args.index),
      }));
      if ((response as any)?.type === 'ACTION_RESULT') return (response as any).result;
      return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${errMessage(err)}` };
    }
  },
};

export const typeTool: ToolDefinition = {
  name: 'type',
  schema: {
    name: 'type',
    description:
      'Replace the current value of a supported text-like input, textarea or editable element referenced by index. Optionally submit once afterwards. Do not use for checkbox, radio, file or buttons.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Index of the input element.' },
        text: { type: 'string', description: 'Text to type.' },
        submit: {
          type: 'boolean',
          description: 'Press Enter to submit after typing. Defaults to false.',
        },
      },
      required: ['index', 'text'],
    },
  },
  risk: 'confirm',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = (await ctx.sendToContent({
        type: 'TYPE',
        index: Number(call.args.index),
        text: String(call.args.text ?? ''),
        submit: Boolean(call.args.submit),
      }));
      if ((response as any)?.type === 'ACTION_RESULT') return (response as any).result;
      return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${errMessage(err)}` };
    }
  },
};

export const selectTool: ToolDefinition = {
  name: 'select',
  schema: {
    name: 'select',
    description: 'Choose an option in a <select> element referenced by index.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Index of the select element.' },
        value: { type: 'string', description: 'Value or visible label of the option to choose.' },
      },
      required: ['index', 'value'],
    },
  },
  risk: 'confirm',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = (await ctx.sendToContent({
        type: 'SELECT',
        index: Number(call.args.index),
        value: String(call.args.value ?? ''),
      }));
      if ((response as any)?.type === 'ACTION_RESULT') return (response as any).result;
      return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${errMessage(err)}` };
    }
  },
};

export const scrollTool: ToolDefinition = {
  name: 'scroll',
  schema: {
    name: 'scroll',
    description: 'Scroll the page in a direction to reveal more content.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'top', 'bottom'],
          description: 'Direction to scroll.',
        },
      },
      required: ['direction'],
    },
  },
  risk: 'safe',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = (await ctx.sendToContent({
        type: 'SCROLL',
        direction: String(call.args.direction ?? 'down') as any,
      }));
      if ((response as any)?.type === 'ACTION_RESULT') return (response as any).result;
      return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${errMessage(err)}` };
    }
  },
};

export const navigateTool: ToolDefinition = {
  name: 'navigate',
  schema: {
    name: 'navigate',
    description: 'Navigate the active tab to a new absolute URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL to navigate to.' },
      },
      required: ['url'],
    },
  },
  risk: 'confirm',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const url = String(call.args.url ?? '');
    if (!url.trim()) {
      return { id: call.id, name: call.name, ok: false, content: 'URL is empty.' };
    }
    try {
      await ctx.navigateAndWait(url);
      const snapshot = await ctx.observe(true);
      return {
        id: call.id,
        name: call.name,
        ok: Boolean(snapshot),
        content: snapshot
          ? `Navigated to ${url}.`
          : 'Navigation completed but the page could not be observed.',
      };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Navigation failed: ${errMessage(err)}` };
    }
  },
};

export const goBackTool: ToolDefinition = {
  name: 'go_back',
  schema: {
    name: 'go_back',
    description: 'Navigate back to the previous page in history.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  scope: 'page',
  sideEffecting: true,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      await ctx.goBackAndWait();
      const snapshot = await ctx.observe(true);
      return {
        id: call.id,
        name: call.name,
        ok: Boolean(snapshot),
        content: snapshot
          ? 'Navigated back to previous page.'
          : 'Navigation completed but the page could not be observed.',
      };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Go back failed: ${errMessage(err)}` };
    }
  },
};

export const extractTool: ToolDefinition = {
  name: 'extract',
  schema: {
    name: 'extract',
    description:
      'Extract specific information from the current page text according to a natural-language query. Use when you need to read content rather than act on it.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to extract from the page.' },
      },
      required: ['query'],
    },
  },
  risk: 'safe',
  scope: 'page',
  sideEffecting: false,
  parallelSafe: true,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = (await ctx.sendToContent({
        type: 'EXTRACT',
        query: String(call.args.query ?? ''),
      }));
      if ((response as any)?.type === 'ACTION_RESULT') return (response as any).result;
      return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
    } catch (err) {
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${errMessage(err)}` };
    }
  },
};

export const screenshotTool: ToolDefinition = {
  name: 'screenshot',
  schema: {
    name: 'screenshot',
    description:
      'Capture a screenshot of the visible tab. Use this when the DOM text is insufficient (e.g. canvas, images, complex visual layout) and you need to see the page.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  scope: 'page',
  sideEffecting: false,
  parallelSafe: false,
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    try {
      const dataUrl = await ctx.captureScreenshot();
      return {
        id: call.id,
        name: call.name,
        ok: true,
        content: 'Screenshot captured.',
        imageDataUrl: dataUrl,
      };
    } catch (err) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        content: `Screenshot failed: ${errMessage(err)}`,
      };
    }
  },
};

export const waitTool: ToolDefinition = {
  name: 'wait',
  schema: {
    name: 'wait',
    description: 'Pause for a number of milliseconds to let the page settle or load.',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (max 10000).' },
      },
      required: ['ms'],
    },
  },
  risk: 'safe',
  scope: 'page',
  sideEffecting: false,
  parallelSafe: false,
  async execute(call: ToolCall): Promise<ToolResult> {
    const ms = Math.max(0, Math.min(Number(call.args.ms) || 0, 10000));
    await new Promise((r) => setTimeout(r, ms));
    return { id: call.id, name: call.name, ok: true, content: `Waited ${ms}ms.` };
  },
};

export const browserTools: ToolDefinition[] = [
  observePageTool,
  inspectHtmlTool,
  editHtmlTool,
  executeJavaScriptTool,
  clickTool,
  typeTool,
  selectTool,
  scrollTool,
  navigateTool,
  goBackTool,
  extractTool,
  screenshotTool,
  waitTool,
];

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
 * The fixed catalogue of tools the agent may invoke. Every capability is
 * exposed as a structured call and risky calls are gated by confirmation.
 */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'observe_page',
    description:
      'Capture a fresh snapshot of the current page: its URL, title, condensed text and the list of interactive elements with their indices. Call this whenever you need up-to-date knowledge of the page before acting.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
    name: 'go_back',
    description: 'Navigate back to the previous page in history.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
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
  {
    name: 'screenshot',
    description:
      'Capture a screenshot of the visible tab. Use this when the DOM text is insufficient (e.g. canvas, images, complex visual layout) and you need to see the page.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
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
  {
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
  {
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
];

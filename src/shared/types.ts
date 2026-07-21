// ---------------------------------------------------------------------------
// Shared domain types used across background, content script and side panel.
// ---------------------------------------------------------------------------

/** A single interactive element discovered on the page, referenced by index. */
export interface PageElement {
  /** Stable index the agent uses to reference this element in tool calls. */
  index: number;
  /** Tag name, lowercased (e.g. "button", "a", "input"). */
  tag: string;
  /** Accessible role if resolvable. */
  role?: string;
  /** Visible text / accessible name, trimmed. */
  text?: string;
  /** Common attributes useful for reasoning. */
  attributes: Record<string, string>;
  /** Bounding box in viewport coordinates. */
  rect: { x: number; y: number; width: number; height: number };
  /** Whether the element is currently visible in the viewport. */
  inViewport: boolean;
}

/** A snapshot of the page produced by the perception layer. */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Condensed textual content of the page (truncated). */
  text: string;
  /** Interactive elements the agent may act on. */
  elements: PageElement[];
  /** Set when DOM perception was insufficient and vision is advised. */
  needsVision?: boolean;
  capturedAt: number;
}

// ---------------------------------------------------------------------------
// Tool / action definitions. The AI chooses from this fixed, auditable set.
// ---------------------------------------------------------------------------

export type ToolName =
  | 'observe_page'
  | 'inspect_html'
  | 'edit_html'
  | 'execute_javascript'
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'navigate'
  | 'go_back'
  | 'extract'
  | 'screenshot'
  | 'wait'
  | 'ask_user'
  | 'finish';

export interface ToolCall {
  /** Provider-assigned id, used to correlate results back to the model. */
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: ToolName;
  ok: boolean;
  /** Human/AI-readable result payload. */
  content: string;
  /** Optional structured data (e.g. a fresh snapshot). */
  data?: unknown;
  /** Present for screenshot results: base64 data URL. */
  imageDataUrl?: string;
}

/** Actions considered risky and gated behind user confirmation. */
export const RISKY_TOOLS: ToolName[] = [
  'navigate',
  'click',
  'type',
  'select',
  'edit_html',
  'execute_javascript',
];

// ---------------------------------------------------------------------------
// Provider configuration.
// ---------------------------------------------------------------------------

export type ProviderKind = 'openai-compatible' | 'anthropic-compatible';

export interface ProviderConfig {
  kind: ProviderKind;
  /** Base URL, e.g. https://api.openai.com/v1 or https://api.anthropic.com. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Whether the chosen model supports image input for vision fallback. */
  supportsVision: boolean;
  temperature?: number;
  maxTokens?: number;
}

export type ExecutionMode = 'auto' | 'confirm';

export interface Settings {
  provider: ProviderConfig;
  mode: ExecutionMode;
  /** Max agent loop iterations before forcing a stop. */
  maxSteps: number;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: {
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    supportsVision: true,
    temperature: 0.2,
    maxTokens: 1024,
  },
  mode: 'confirm',
  maxSteps: 25,
};

// ---------------------------------------------------------------------------
// Conversation / chat model.
// ---------------------------------------------------------------------------

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** For assistant turns that requested tools. */
  toolCalls?: ToolCall[];
  /** For tool turns, the id of the call being answered. */
  toolCallId?: string;
  /** Optional image attached to a user/tool turn (base64 data URL). */
  imageDataUrl?: string;
  /** Wall-clock time the message was created; used to order the UI timeline. */
  timestamp?: number;
}

/** A step shown in the side panel timeline. */
export interface AgentStep {
  id: string;
  kind: 'thought' | 'action' | 'observation' | 'error' | 'final';
  title: string;
  detail?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Session model — a chat session accumulates many task turns so the agent can
// reason with prior context. Persisted to chrome.storage.local.
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  /** Derived from the first goal in the session. */
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Full transcript, accumulated across turns. */
  messages: ChatMessage[];
  /** Timeline steps shown in the panel. */
  steps: AgentStep[];
}

/** Lightweight session descriptor for the history list. */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

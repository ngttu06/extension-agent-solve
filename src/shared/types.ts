// ---------------------------------------------------------------------------
// Shared domain types used across background, content script and side panel.
// ---------------------------------------------------------------------------

export interface SemanticLocator {
  version: 1;
  tag: string;
  role?: string;
  accessibleName?: string;
  attributes: {
    id?: string;
    name?: string;
    type?: string;
    autocomplete?: string;
    placeholder?: string;
    href?: string;
    testId?: string;
  };
  ancestors?: Array<{
    tag: string;
    role?: string;
    accessibleName?: string;
    id?: string;
  }>;
  ordinalHint?: number;
}

export interface PageIdentity {
  /** New for every document load; stable for the lifetime of one content script. */
  documentId: string;
  /** Increments whenever page content, form state, route, or viewport changes. */
  revision: number;
  canonicalUrl: string;
  routeKey: string;
  structureHash: string;
  landmarkHashes: string[];
}

/** A single interactive element discovered on the page, referenced by index. */
export interface PageElement {
  /** Index valid only for the snapshot that produced it. */
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
  /** Durable semantic description used to re-resolve this target later. */
  locator: SemanticLocator;
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
  identity: PageIdentity;
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
  | 'finish'
  | 'web_search'
  | 'fetch_url';

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

/**
 * Derive risky tool names from the registry at runtime.
 * This is the new source of truth; RISKY_TOOLS above is kept for back-compat.
 */
export function getRiskyTools(): Set<ToolName> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createToolRegistry } = require('@/background/tools');
  const { riskyToolNames } = require('@/shared/tool-registry');
  return riskyToolNames(createToolRegistry());
}

// ---------------------------------------------------------------------------
// Agent status tracking.
// ---------------------------------------------------------------------------

/**
 * Agent execution phase — what is the agent doing right now.
 */
export type AgentPhase =
  | 'idle'
  | 'preparing'
  | 'thinking'
  | 'calling-model'
  | 'running-tool'
  | 'awaiting-confirm'
  | 'awaiting-user'
  | 'replaying-recipe'
  | 'finishing'
  | 'done'
  | 'error';

/**
 * Live status of an agent run — published at phase boundaries.
 */
export interface RunStatus {
  phase: AgentPhase;
  /** Human-readable detail (e.g. "web_search: giá vàng hôm nay"). */
  detail?: string;
  /** Current iteration in the agent loop. */
  iteration?: number;
  /** Max iterations before stopping. */
  maxIterations?: number;
  /** The tool currently being executed (if phase === 'running-tool'). */
  activeTool?: ToolName;
  /** Timestamp when this run started (epoch ms). */
  startedAt: number;
  /** Elapsed time since start (ms). */
  elapsedMs: number;
  /** Duration of the last step (ms). */
  lastDurationMs?: number;
  /** Token and turn accounting. */
  usage?: {
    modelTurns: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Current plan items (if using update_plan tool). */
  plan?: PlanItem[];
}

/**
 * A single item in an agent plan.
 */
export interface PlanItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
}


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

export interface ActionCacheSettings {
  enabled: boolean;
  ttlDays: number;
  maxRecipes: number;
  maxBytes: number;
}

export interface Settings {
  provider: ProviderConfig;
  mode: ExecutionMode;
  /** Max agent loop iterations before forcing a stop. */
  maxSteps: number;
  showVirtualCursor: boolean;
  showProcessingEffects: boolean;
  actionCache: ActionCacheSettings;
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
  showVirtualCursor: true,
  showProcessingEffects: true,
  actionCache: {
    enabled: true,
    ttlDays: 14,
    maxRecipes: 50,
    maxBytes: 512_000,
  },
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
  metadata?: {
    source?: 'model' | 'recipe' | 'system';
    durationMs?: number;
    cacheStatus?: 'lookup' | 'hit' | 'miss' | 'replaying' | 'diverged' | 'verified';
  };
}

export type RecipeToolName = 'click' | 'type' | 'select' | 'navigate';

export interface TargetState {
  visible: boolean;
  enabled: boolean;
  editable?: boolean;
  valueHash?: string;
  selectedValue?: string;
  checked?: boolean;
  pressed?: boolean;
  expanded?: boolean;
}

export interface RecipePrecondition {
  canonicalUrl: string;
  routeKey: string;
  minimumLandmarkSimilarity: number;
  expectedLandmarkHashes: string[];
  requiredLandmarkHashes?: string[];
  expectedTargetState?: TargetState;
}

export type RecipePostcondition =
  | { kind: 'url'; canonicalUrl: string }
  | { kind: 'document-changed' }
  | { kind: 'target-state'; state: TargetState }
  | { kind: 'landmarks-added'; hashes: string[] }
  | { kind: 'landmarks-removed'; hashes: string[] };

export interface RecipeStep {
  id: string;
  tool: RecipeToolName;
  locator?: SemanticLocator;
  args: Record<string, unknown>;
  precondition: RecipePrecondition;
  postconditions: RecipePostcondition[];
}

export interface ActionRecipe {
  schemaVersion: 1;
  id: string;
  key: string;
  goalHash: string;
  entryIdentity: Omit<PageIdentity, 'documentId' | 'revision'>;
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  expiresAt: number;
  useCount: number;
  successCount: number;
  divergenceCount: number;
  quarantined: boolean;
  byteSize: number;
}

export interface ActionExecutionEvidence {
  documentIdBefore: string;
  documentIdAfter: string;
  revisionBefore: number;
  revisionAfter: number;
  urlBefore: string;
  urlAfter: string;
  resolvedLocator?: SemanticLocator;
  locatorScore?: number;
  targetStateBefore?: TargetState;
  targetStateAfter?: TargetState;
  identityAfter: PageIdentity;
  settled: boolean;
  sensitive: boolean;
  durationMs: number;
}

export interface ActionCacheStats {
  recipeCount: number;
  byteSize: number;
  hits: number;
  misses: number;
  successfulReplays: number;
  divergences: number;
  replayedSteps: number;
  avoidedModelTurns: number;
  totalReplayMs: number;
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

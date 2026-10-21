import type {
  ActionCacheStats,
  ActionExecutionEvidence,
  AgentStep,
  ChatMessage,
  PageIdentity,
  PageSnapshot,
  RecipeStep,
  Session,
  SessionSummary,
  Settings,
  ToolCall,
  ToolResult,
} from './types';

// ---------------------------------------------------------------------------
// Messages sent FROM the side panel TO the background service worker.
// ---------------------------------------------------------------------------

export type PanelToBackground =
  | { type: 'RUN_TASK'; goal: string; tabId: number }
  | { type: 'STOP_TASK' }
  | { type: 'CONFIRM_ACTION'; approved: boolean; toolCallId: string }
  | { type: 'ANSWER_USER'; text: string }
  | { type: 'GET_STATE' }
  | { type: 'SAVE_SETTINGS'; settings: Settings }
  | { type: 'GET_SETTINGS' }
  | { type: 'NEW_SESSION' }
  | { type: 'LIST_SESSIONS' }
  | { type: 'LOAD_SESSION'; id: string }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'GET_ACTION_CACHE_STATS' }
  | { type: 'CLEAR_ACTION_CACHE' };

// ---------------------------------------------------------------------------
// Messages sent FROM the background TO the side panel (events / responses).
// ---------------------------------------------------------------------------

export type BackgroundToPanel =
  | { type: 'STEP'; step: AgentStep }
  | { type: 'MESSAGE'; message: ChatMessage }
  | { type: 'STATE'; running: boolean; steps: AgentStep[]; messages: ChatMessage[] }
  | { type: 'CONFIRM_REQUEST'; toolCall: ToolCall; description: string }
  | { type: 'ASK_USER'; question: string }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'DONE'; summary: string }
  | { type: 'ERROR'; message: string }
  | { type: 'SESSION_LIST'; sessions: SessionSummary[] }
  | { type: 'SESSION_LOADED'; session: Session }
  | { type: 'ACTION_CACHE_STATS'; stats: ActionCacheStats };

// ---------------------------------------------------------------------------
// Messages sent FROM the background TO the content script (commands).
// ---------------------------------------------------------------------------

export type BackgroundToContent =
  | { type: 'PING' }
  | { type: 'OBSERVE'; includeOffscreen?: boolean }
  | { type: 'INSPECT_HTML'; selector: string; outer?: boolean; maxLength?: number }
  | {
      type: 'EDIT_HTML';
      selector: string;
      mode: 'inner' | 'outer' | 'append' | 'prepend' | 'before' | 'after' | 'remove';
      html?: string;
      all?: boolean;
    }
  | { type: 'CLICK'; index: number }
  | { type: 'TYPE'; index: number; text: string; submit?: boolean }
  | { type: 'SELECT'; index: number; value: string }
  | { type: 'SCROLL'; direction: 'up' | 'down' | 'top' | 'bottom' }
  | { type: 'EXTRACT'; query: string }
  | { type: 'HIGHLIGHT'; index: number }
  | { type: 'SET_CONTROL_GLOW'; on: boolean; activeAction?: boolean; showCursor: boolean }
  | { type: 'GET_PAGE_STATE' }
  | { type: 'WAIT_FOR_PAGE_QUIET'; quietMs?: number; timeoutMs?: number }
  | { type: 'EXECUTE_RECIPE_ACTION'; step: RecipeStep };

// ---------------------------------------------------------------------------
// Messages sent FROM the content script back TO the background (responses).
// ---------------------------------------------------------------------------

export type ContentToBackground =
  | { type: 'PONG' }
  | { type: 'SNAPSHOT'; snapshot: PageSnapshot }
  | { type: 'PAGE_STATE'; identity: PageIdentity }
  | { type: 'PAGE_QUIET'; settled: boolean; identity: PageIdentity }
  | {
      type: 'RECIPE_ACTION_RESULT';
      ok: boolean;
      content: string;
      evidence?: ActionExecutionEvidence;
    }
  | { type: 'ACTION_RESULT'; result: ToolResult; evidence?: ActionExecutionEvidence };

export type RuntimeMessage =
  | PanelToBackground
  | BackgroundToPanel
  | BackgroundToContent
  | ContentToBackground;

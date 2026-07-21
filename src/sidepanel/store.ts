import { create } from 'zustand';
import type { BackgroundToPanel, PanelToBackground } from '@/shared/messages';
import {
  DEFAULT_SETTINGS,
  type AgentStep,
  type ChatMessage,
  type SessionSummary,
  type Settings,
  type ToolCall,
} from '@/shared/types';

interface ConfirmRequest {
  toolCall: ToolCall;
  description: string;
}

type View = 'chat' | 'settings' | 'history';

interface PanelState {
  running: boolean;
  steps: AgentStep[];
  messages: ChatMessage[];
  settings: Settings;
  sessions: SessionSummary[];
  confirmRequest: ConfirmRequest | null;
  askQuestion: string | null;
  view: View;
  error: string | null;

  /** Tab this panel is locked to (set on open / new session). */
  lockedTabId: number | null;
  lockedTabTitle: string | null;
  /** Tab currently active in the window (tracked live). */
  activeTabId: number | null;
  /** True once the locked tab has been closed. */
  lockedTabClosed: boolean;

  init: () => void;
  setView: (view: View) => void;
  runTask: (goal: string) => Promise<void>;
  stopTask: () => void;
  answerConfirm: (approved: boolean) => void;
  answerQuestion: (text: string) => void;
  saveSettings: (settings: Settings) => void;
  newSession: () => void;
  listSessions: () => void;
  loadSession: (id: string) => void;
  deleteSession: (id: string) => void;
}

function post(msg: PanelToBackground): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

async function lockToActiveTab(set: (partial: Partial<PanelState>) => void): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  set({
    lockedTabId: tab?.id ?? null,
    lockedTabTitle: tab?.title ?? null,
    activeTabId: tab?.id ?? null,
    lockedTabClosed: false,
    error: null,
  });
}

export const usePanelStore = create<PanelState>((set, get) => ({
  running: false,
  steps: [],
  messages: [],
  settings: DEFAULT_SETTINGS,
  sessions: [],
  confirmRequest: null,
  askQuestion: null,
  view: 'chat',
  error: null,
  lockedTabId: null,
  lockedTabTitle: null,
  activeTabId: null,
  lockedTabClosed: false,

  init: () => {
    chrome.runtime.onMessage.addListener((msg: BackgroundToPanel) => {
      switch (msg.type) {
        case 'STATE':
          set({ running: msg.running, steps: msg.steps, messages: msg.messages });
          break;
        case 'SESSION_LIST':
          set({ sessions: msg.sessions });
          break;
        case 'SESSION_LOADED':
          set({
            steps: msg.session.steps,
            messages: msg.session.messages,
            view: 'chat',
            error: null,
          });
          break;
        case 'STEP':
          set((s) => ({ steps: [...s.steps, msg.step] }));
          break;
        case 'MESSAGE':
          set((s) => ({ messages: [...s.messages, msg.message] }));
          break;
        case 'CONFIRM_REQUEST':
          set({ confirmRequest: { toolCall: msg.toolCall, description: msg.description } });
          break;
        case 'ASK_USER':
          set({ askQuestion: msg.question });
          break;
        case 'SETTINGS':
          set({ settings: msg.settings });
          break;
        case 'DONE':
          set({ running: false });
          break;
        case 'ERROR':
          set({ running: false, error: msg.message });
          break;
      }
    });
    // Track the active tab live so we can enforce the tab lock.
    chrome.tabs.onActivated.addListener((info) => {
      set({ activeTabId: info.tabId });
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (tabId === get().lockedTabId) set({ lockedTabClosed: true });
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (tabId === get().lockedTabId && changeInfo.title != null) {
        set({ lockedTabTitle: changeInfo.title });
      }
    });

    // Lock to whichever tab is active when the panel opens.
    void lockToActiveTab(set);

    post({ type: 'GET_SETTINGS' });
    post({ type: 'GET_STATE' });
  },

  setView: (view) => set({ view }),

  runTask: async (goal) => {
    const { lockedTabId, lockedTabTitle, activeTabId, lockedTabClosed } = get();
    if (lockedTabClosed) {
      set({
        error: 'Tab đã liên kết đã bị đóng. Mở lại extension hoặc tạo session mới để liên kết tab khác.',
      });
      return;
    }
    if (lockedTabId == null) {
      set({ error: 'Không tìm thấy tab để liên kết.' });
      return;
    }
    if (activeTabId !== lockedTabId) {
      set({
        error: `Bạn đang ở tab khác. Quay lại tab đã liên kết ("${lockedTabTitle ?? 'tab đã liên kết'}") hoặc tạo session mới.`,
      });
      return;
    }
    set({ error: null, running: true });
    await post({ type: 'RUN_TASK', goal, tabId: lockedTabId });
  },

  stopTask: () => {
    post({ type: 'STOP_TASK' });
    set({ running: false });
  },

  answerConfirm: (approved) => {
    const req = get().confirmRequest;
    if (!req) return;
    post({ type: 'CONFIRM_ACTION', approved, toolCallId: req.toolCall.id });
    set({ confirmRequest: null });
  },

  answerQuestion: (text) => {
    post({ type: 'ANSWER_USER', text });
    set({
      askQuestion: null,
      messages: [...get().messages, { role: 'user', content: text, timestamp: Date.now() }],
    });
  },

  saveSettings: (settings) => {
    post({ type: 'SAVE_SETTINGS', settings });
    set({ settings, view: 'chat' });
  },

  newSession: () => {
    post({ type: 'NEW_SESSION' });
    set({ steps: [], messages: [], error: null, view: 'chat' });
    // Re-lock to whichever tab is active now.
    void lockToActiveTab(set);
  },

  listSessions: () => {
    post({ type: 'LIST_SESSIONS' });
  },

  loadSession: (id) => {
    post({ type: 'LOAD_SESSION', id });
  },

  deleteSession: (id) => {
    post({ type: 'DELETE_SESSION', id });
  },
}));

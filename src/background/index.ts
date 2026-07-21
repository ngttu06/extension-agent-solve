import type { BackgroundToPanel, PanelToBackground } from '@/shared/messages';
import {
  deleteSession,
  listSessions,
  loadSession,
  loadSettings,
  saveSession,
  saveSettings,
} from '@/shared/storage';
import type { Session, ToolCall } from '@/shared/types';
import { Orchestrator } from './orchestrator';

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Session state. A single session accumulates many task turns so the agent can
// reason with prior context; it is persisted to chrome.storage.local.
// ---------------------------------------------------------------------------

let orchestrator: Orchestrator | null = null;
let running = false;
let currentSession: Session | null = null;

/** Pending human-in-the-loop promises keyed by their resolver. */
let pendingConfirm: { toolCallId: string; resolve: (v: boolean) => void } | null = null;
let pendingAsk: { resolve: (v: string) => void } | null = null;

/** Debounce persistence so we don't hammer storage on every stream event. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function send(msg: BackgroundToPanel): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Panel may be closed; events are also replayed via GET_STATE on reopen.
  });
}

function uid(): string {
  return crypto.randomUUID();
}

function titleFromGoal(goal: string): string {
  const t = goal.trim().replace(/\s+/g, ' ');
  return t.length > 60 ? `${t.slice(0, 60)}…` : t || 'Untitled session';
}

function ensureSession(goal: string): Session {
  if (!currentSession) {
    const now = Date.now();
    currentSession = {
      id: uid(),
      title: titleFromGoal(goal),
      createdAt: now,
      updatedAt: now,
      messages: [],
      steps: [],
    };
  }
  return currentSession;
}

function persistSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 600);
}

function persistNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!currentSession || currentSession.messages.length === 0) return;
  currentSession.updatedAt = Date.now();
  void saveSession(currentSession);
}

function newSession(): void {
  persistNow();
  orchestrator?.stop();
  orchestrator = null;
  running = false;
  currentSession = null;
  pendingConfirm = null;
  pendingAsk = null;
  send({ type: 'STATE', running: false, steps: [], messages: [] });
}

async function startTask(goal: string, tabId: number): Promise<void> {
  if (running) {
    send({ type: 'ERROR', message: 'A task is already running.' });
    return;
  }
  const settings = await loadSettings();
  const session = ensureSession(goal);
  // Carry prior transcript so this turn continues the conversation.
  const priorMessages = [...session.messages];

  running = true;
  // Sync prior state first, THEN append the new goal via a single MESSAGE event.
  // (Sending STATE after the push would replay the goal, duplicating it.)
  send({ type: 'STATE', running, steps: session.steps, messages: session.messages });
  const userMsg = { role: 'user' as const, content: goal, timestamp: Date.now() };
  session.messages.push(userMsg);
  send({ type: 'MESSAGE', message: userMsg });
  persistSoon();

  orchestrator = new Orchestrator(settings, tabId, priorMessages, {
    onStep: (step) => {
      session.steps.push(step);
      send({ type: 'STEP', step });
      persistSoon();
    },
    onMessage: (message) => {
      session.messages.push(message);
      send({ type: 'MESSAGE', message });
      persistSoon();
    },
    requestConfirm: (toolCall: ToolCall, description: string) =>
      new Promise<boolean>((resolve) => {
        pendingConfirm = { toolCallId: toolCall.id, resolve };
        send({ type: 'CONFIRM_REQUEST', toolCall, description });
      }),
    askUser: (question: string) =>
      new Promise<string>((resolve) => {
        pendingAsk = { resolve };
        send({ type: 'ASK_USER', question });
      }),
    onDone: (summary) => {
      running = false;
      persistNow();
      send({ type: 'DONE', summary });
    },
    onError: (message) => {
      running = false;
      persistNow();
      send({ type: 'ERROR', message });
    },
  });

  orchestrator.run(goal).finally(() => {
    running = false;
    persistNow();
  });
}

function stopTask(): void {
  orchestrator?.stop();
  orchestrator = null;
  running = false;
  // Resolve any pending gates so the loop can unwind.
  pendingConfirm?.resolve(false);
  pendingAsk?.resolve('(stopped)');
  pendingConfirm = null;
  pendingAsk = null;
  persistNow();
}

chrome.runtime.onMessage.addListener((msg: PanelToBackground, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'RUN_TASK':
        await startTask(msg.goal, msg.tabId);
        sendResponse({ ok: true });
        break;
      case 'STOP_TASK':
        stopTask();
        sendResponse({ ok: true });
        break;
      case 'CONFIRM_ACTION':
        if (pendingConfirm && pendingConfirm.toolCallId === msg.toolCallId) {
          pendingConfirm.resolve(msg.approved);
          pendingConfirm = null;
        }
        sendResponse({ ok: true });
        break;
      case 'ANSWER_USER':
        if (pendingAsk) {
          pendingAsk.resolve(msg.text);
          pendingAsk = null;
        }
        sendResponse({ ok: true });
        break;
      case 'GET_STATE':
        send({
          type: 'STATE',
          running,
          steps: currentSession?.steps ?? [],
          messages: currentSession?.messages ?? [],
        });
        sendResponse({ ok: true });
        break;
      case 'GET_SETTINGS': {
        const settings = await loadSettings();
        send({ type: 'SETTINGS', settings });
        sendResponse({ ok: true });
        break;
      }
      case 'SAVE_SETTINGS':
        await saveSettings(msg.settings);
        send({ type: 'SETTINGS', settings: msg.settings });
        sendResponse({ ok: true });
        break;
      case 'NEW_SESSION':
        newSession();
        sendResponse({ ok: true });
        break;
      case 'LIST_SESSIONS': {
        const sessions = await listSessions();
        send({ type: 'SESSION_LIST', sessions });
        sendResponse({ ok: true });
        break;
      }
      case 'LOAD_SESSION': {
        if (running) {
          send({ type: 'ERROR', message: 'Stop the running task before loading a session.' });
          sendResponse({ ok: false });
          break;
        }
        const session = await loadSession(msg.id);
        if (session) {
          currentSession = session;
          send({ type: 'SESSION_LOADED', session });
          send({
            type: 'STATE',
            running: false,
            steps: session.steps,
            messages: session.messages,
          });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'DELETE_SESSION': {
        await deleteSession(msg.id);
        if (currentSession?.id === msg.id) {
          currentSession = null;
          send({ type: 'STATE', running: false, steps: [], messages: [] });
        }
        const sessions = await listSessions();
        send({ type: 'SESSION_LIST', sessions });
        sendResponse({ ok: true });
        break;
      }
    }
  })();
  return true; // keep the message channel open for async sendResponse
});

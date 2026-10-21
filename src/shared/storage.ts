import {
  DEFAULT_SETTINGS,
  type ChatMessage,
  type Session,
  type SessionSummary,
  type Settings,
} from './types';

const SETTINGS_KEY = 'agent_settings';
const SESSIONS_INDEX_KEY = 'agent_sessions_index';
const sessionKey = (id: string) => `agent_session_${id}`;

/** Load settings from chrome.storage.local, merged over defaults. */
export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = raw[SETTINGS_KEY] as Partial<Settings> | undefined;
  if (!stored) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    provider: { ...DEFAULT_SETTINGS.provider, ...stored.provider },
    actionCache: { ...DEFAULT_SETTINGS.actionCache, ...stored.actionCache },
  };
}

/** Persist settings to chrome.storage.local. */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

// ---------------------------------------------------------------------------
// Chat session persistence. Each session is stored under its own key so we
// never read/write the whole store on every update; a lightweight index keeps
// the history list cheap to load.
// ---------------------------------------------------------------------------

function summarize(session: Session): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

/** Screenshots (base64) can be megabytes — drop them before persisting. */
function stripImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ imageDataUrl: _drop, ...rest }) => rest);
}

/** List session summaries, most recently updated first. */
export async function listSessions(): Promise<SessionSummary[]> {
  const raw = await chrome.storage.local.get(SESSIONS_INDEX_KEY);
  const index = (raw[SESSIONS_INDEX_KEY] as SessionSummary[] | undefined) ?? [];
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Load a full session transcript by id. */
export async function loadSession(id: string): Promise<Session | null> {
  const key = sessionKey(id);
  const raw = await chrome.storage.local.get(key);
  return (raw[key] as Session | undefined) ?? null;
}

/** Persist a session and refresh its entry in the index. */
export async function saveSession(session: Session): Promise<void> {
  const stored: Session = { ...session, messages: stripImages(session.messages) };
  const index = await listSessions();
  const next = index.filter((s) => s.id !== session.id);
  next.push(summarize(stored));
  await chrome.storage.local.set({
    [sessionKey(session.id)]: stored,
    [SESSIONS_INDEX_KEY]: next,
  });
}

/** Remove a session and its index entry. */
export async function deleteSession(id: string): Promise<void> {
  const index = await listSessions();
  await chrome.storage.local.remove(sessionKey(id));
  await chrome.storage.local.set({
    [SESSIONS_INDEX_KEY]: index.filter((s) => s.id !== id),
  });
}

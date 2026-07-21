import { useEffect } from 'react';
import { usePanelStore } from '../store';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function HistoryView() {
  const sessions = usePanelStore((s) => s.sessions);
  const listSessions = usePanelStore((s) => s.listSessions);
  const loadSession = usePanelStore((s) => s.loadSession);
  const deleteSession = usePanelStore((s) => s.deleteSession);

  useEffect(() => {
    listSessions();
  }, [listSessions]);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
      {sessions.length === 0 ? (
        <div className="mx-auto mt-10 max-w-[260px] text-center text-xs leading-relaxed text-muted">
          <div className="mb-3 text-3xl">🕘</div>
          No saved chats yet. Run a task and it will show up here.
        </div>
      ) : (
        <div className="space-y-2.5">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="glass animate-fade-slide flex items-center gap-2 rounded-xl2 px-3.5 py-2.5 shadow-glassSm"
            >
              <button
                onClick={() => loadSession(s.id)}
                className="min-w-0 flex-1 text-left"
                title="Open this chat"
              >
                <div className="truncate text-sm font-medium text-content">{s.title}</div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {s.messageCount} messages · {relativeTime(s.updatedAt)}
                </div>
              </button>
              <button
                onClick={() => deleteSession(s.id)}
                className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-95"
                style={{ color: 'var(--kind-error)', background: 'var(--amber-soft)' }}
                title="Delete this chat"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

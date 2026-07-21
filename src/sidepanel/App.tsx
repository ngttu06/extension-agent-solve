import { useEffect } from 'react';
import { usePanelStore } from './store';
import { ChatView } from './components/ChatView';
import { SettingsView } from './components/SettingsView';
import { HistoryView } from './components/HistoryView';

export function App() {
  const init = usePanelStore((s) => s.init);
  const view = usePanelStore((s) => s.view);
  const setView = usePanelStore((s) => s.setView);
  const newSession = usePanelStore((s) => s.newSession);
  const hasKey = usePanelStore((s) => Boolean(s.settings.provider.apiKey));

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="flex h-full flex-col">
      <header className="glass sticky top-0 z-20 flex items-center justify-between rounded-b-xl2 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accentSoft text-lg shadow-glassSm">
            🤖
          </span>
          <h1 className="text-[15px] font-semibold tracking-tight text-content">Agent Solve</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={newSession}
            className="rounded-full bg-accentSoft px-3 py-1.5 text-xs font-medium text-accent transition hover:opacity-80 active:scale-95"
            title="New chat"
          >
            ＋ New
          </button>
          <button
            onClick={() => setView(view === 'history' ? 'chat' : 'history')}
            className="rounded-full bg-accentSoft px-3 py-1.5 text-xs font-medium text-accent transition hover:opacity-80 active:scale-95"
            title="Chat history"
          >
            {view === 'history' ? 'Done' : '🕘 History'}
          </button>
          <button
            onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
            className="rounded-full bg-accentSoft px-3 py-1.5 text-xs font-medium text-accent transition hover:opacity-80 active:scale-95"
            title="Settings"
          >
            {view === 'settings' ? 'Done' : '⚙'}
          </button>
        </div>
      </header>

      {!hasKey && view === 'chat' && (
        <div className="glass mx-3 mt-3 rounded-xl2 px-4 py-2.5 text-xs text-content shadow-glassSm">
          <span className="font-medium" style={{ color: 'var(--amber)' }}>
            No API key set.
          </span>{' '}
          <button
            className="font-medium text-accent underline-offset-2 hover:underline"
            onClick={() => setView('settings')}
          >
            Open settings
          </button>{' '}
          to configure a provider.
        </div>
      )}

      <main className="min-h-0 flex-1">
        {view === 'settings' ? (
          <SettingsView />
        ) : view === 'history' ? (
          <HistoryView />
        ) : (
          <ChatView />
        )}
      </main>
    </div>
  );
}

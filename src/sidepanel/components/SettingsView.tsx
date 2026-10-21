import { useState } from 'react';
import type { ExecutionMode, ProviderKind, Settings } from '@/shared/types';
import { usePanelStore } from '../store';

const fieldClass =
  'w-full rounded-xl2 bg-elevated px-3.5 py-2.5 text-content outline-none ring-1 ring-hairline transition focus:ring-2 focus:ring-accent';

export function SettingsView() {
  const settings = usePanelStore((s) => s.settings);
  const saveSettings = usePanelStore((s) => s.saveSettings);
  const actionCacheStats = usePanelStore((s) => s.actionCacheStats);
  const clearActionCache = usePanelStore((s) => s.clearActionCache);
  const setView = usePanelStore((s) => s.setView);

  const [draft, setDraft] = useState<Settings>(settings);

  const update = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const updateProvider = (patch: Partial<Settings['provider']>) =>
    setDraft((d) => ({ ...d, provider: { ...d.provider, ...patch } }));

  const presetBaseUrl = (kind: ProviderKind) =>
    kind === 'anthropic-compatible' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';

  return (
    <div className="flex h-full flex-col">
      <div className="glass sticky top-0 z-10 flex items-center justify-between rounded-b-xl2 px-4 py-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-content">Settings</h2>
        <button
          onClick={() => setView('chat')}
          className="rounded-full bg-accentSoft px-3 py-1.5 text-xs font-medium text-accent transition hover:opacity-80 active:scale-95"
        >
          ← Back
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <label className="block">
          <span className="mb-1.5 block font-medium text-content">Provider type</span>
          <select
            value={draft.provider.kind}
            onChange={(e) => {
              const kind = e.target.value as ProviderKind;
              updateProvider({ kind, baseUrl: presetBaseUrl(kind) });
            }}
            className={fieldClass}
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic-compatible">Anthropic-compatible</option>
          </select>
          <span className="mt-1.5 block text-xs text-muted">
            OpenAI-compatible covers OpenAI, Groq, OpenRouter, LM Studio, Ollama, vLLM, and more.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-medium text-content">Base URL</span>
          <input
            value={draft.provider.baseUrl}
            onChange={(e) => updateProvider({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block font-medium text-content">API key</span>
          <input
            type="password"
            value={draft.provider.apiKey}
            onChange={(e) => updateProvider({ apiKey: e.target.value })}
            placeholder="sk-..."
            className={fieldClass}
          />
          <span className="mt-1.5 block text-xs text-muted">
            Stored locally in this browser only. Never sent anywhere except your configured Base URL.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-medium text-content">Model</span>
          <input
            value={draft.provider.model}
            onChange={(e) => updateProvider({ model: e.target.value })}
            placeholder="gpt-4o-mini / claude-3-5-sonnet-latest / llama3.1"
            className={fieldClass}
          />
        </label>

        <label className="glass flex items-center gap-3 rounded-xl2 px-3.5 py-3">
          <input
            type="checkbox"
            checked={draft.provider.supportsVision}
            onChange={(e) => updateProvider({ supportsVision: e.target.checked })}
            className="h-4 w-4 accent-[color:var(--accent)]"
          />
          <span className="text-content">Model supports vision (image input)</span>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-medium text-content">Execution mode</span>
          <select
            value={draft.mode}
            onChange={(e) => update({ mode: e.target.value as ExecutionMode })}
            className={fieldClass}
          >
            <option value="confirm">Confirm each risky action</option>
            <option value="auto">Auto (no confirmation)</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-medium text-content">Max steps</span>
          <input
            type="number"
            min={1}
            max={100}
            value={draft.maxSteps}
            onChange={(e) => update({ maxSteps: Number(e.target.value) })}
            className={fieldClass}
          />
        </label>

        <div className="glass space-y-3 rounded-xl2 px-3.5 py-3">
          <span className="block font-medium text-content">Visual effects</span>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={draft.showVirtualCursor}
              onChange={(e) => update({ showVirtualCursor: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[color:var(--accent)]"
            />
            <span>
              <span className="block text-content">Show virtual mouse cursor</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">
                Shows cursor movement, press animation and click ripple on the controlled page.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={draft.showProcessingEffects}
              onChange={(e) => update({ showProcessingEffects: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[color:var(--accent)]"
            />
            <span>
              <span className="block text-content">Show AI processing effects</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">
                Shows the page control glow and animated processing indicators in the side panel.
              </span>
            </span>
          </label>
        </div>

        <div className="glass space-y-3 rounded-xl2 px-3.5 py-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={draft.actionCache.enabled}
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  actionCache: { ...current.actionCache, enabled: e.target.checked },
                }))
              }
              className="mt-0.5 h-4 w-4 accent-[color:var(--accent)]"
            />
            <span>
              <span className="block font-medium text-content">Reuse validated action recipes</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">
                Replays only the same goal on a tightly matching page. Actions run again on the current DOM,
                confirmation still applies, and any mismatch returns control to the agent.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted">
            <span>{actionCacheStats.recipeCount} recipes</span>
            <span>{Math.round(actionCacheStats.byteSize / 1024)} KB</span>
            <span>{actionCacheStats.successfulReplays} successful replays</span>
            <span>{actionCacheStats.divergences} divergences</span>
          </div>
          <button
            type="button"
            onClick={clearActionCache}
            disabled={actionCacheStats.recipeCount === 0}
            className="w-full rounded-full bg-elevated px-3 py-2 text-xs font-medium text-content ring-1 ring-hairline transition disabled:opacity-40 active:scale-[0.98]"
          >
            Clear action cache
          </button>
        </div>
      </div>

      <div className="glass rounded-t-xl2 p-4">
        <button
          onClick={() => saveSettings(draft)}
          className="w-full rounded-full bg-accent px-3 py-2.5 text-sm font-semibold text-white shadow-glassSm transition active:scale-[0.98]"
        >
          Save settings
        </button>
      </div>
    </div>
  );
}

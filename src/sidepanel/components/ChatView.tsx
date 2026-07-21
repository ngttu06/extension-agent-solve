import { useEffect, useRef, useState } from 'react';
import type { AgentStep, ChatMessage } from '@/shared/types';
import { usePanelStore } from '../store';
import { Markdown } from './Markdown';

const KIND_ACCENT: Record<AgentStep['kind'], string> = {
  thought: 'var(--kind-thought)',
  action: 'var(--kind-action)',
  observation: 'var(--kind-observation)',
  error: 'var(--kind-error)',
  final: 'var(--kind-final)',
};

const KIND_LABEL: Record<AgentStep['kind'], string> = {
  thought: '💭 Thought',
  action: '⚡ Action',
  observation: '👁 Observation',
  error: '⚠ Error',
  final: '✅ Done',
};

const STATUS_LABEL: Record<AgentStep['kind'], string> = {
  thought: 'Thinking',
  action: 'Acting',
  observation: 'Observing',
  error: 'Recovering',
  final: 'Finishing',
};

/** Animated "· · ·" that moves while the agent works. */
function ThinkingDots() {
  return (
    <span className="thinking-dots" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/** A single process step rendered inside the collapsible thinking panel. */
function StepRow({ step, active }: { step: AgentStep; active: boolean }) {
  const [open, setOpen] = useState(step.kind === 'error');
  const hasDetail = Boolean(step.detail);
  const accent = KIND_ACCENT[step.kind];
  return (
    <div
      className="animate-fade-slide rounded-lg px-2.5 py-2 text-xs transition"
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <button
        className="flex w-full items-center justify-between text-left font-medium text-content"
        onClick={() => hasDetail && setOpen((o) => !o)}
      >
        <span className="flex items-center gap-1.5">
          <span style={{ color: accent }}>{KIND_LABEL[step.kind]}</span>
          <span className="text-muted">· {step.title}</span>
          {active && (
            <span className="text-faint">
              <ThinkingDots />
            </span>
          )}
        </span>
        {hasDetail && (
          <span
            className="text-faint transition-transform duration-300"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ›
          </span>
        )}
      </button>
      <div
        className="grid transition-all duration-300 ease-out"
        style={{
          gridTemplateRows: open && hasDetail ? '1fr' : '0fr',
          opacity: open && hasDetail ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          {step.kind === 'thought' ? (
            <div className="mt-1.5">
              <Markdown text={step.detail ?? ''} />
            </div>
          ) : (
            <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted">
              {step.detail}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Groups the agent's intermediate process steps (thoughts / actions /
 * observations) into one collapsible panel. While the group is live it stays
 * expanded with an animated "Thinking …" header; once the turn finishes it
 * auto-collapses to a compact pill the user can re-open.
 */
function ProcessGroup({ steps, active }: { steps: AgentStep[]; active: boolean }) {
  // Expanded while running; collapses automatically once the turn is done.
  const [open, setOpen] = useState(active);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) setOpen(false); // just finished → collapse
    wasActive.current = active;
  }, [active]);

  const last = steps[steps.length - 1];
  const label = active && last ? STATUS_LABEL[last.kind] : 'Thought';

  return (
    <div
      className={`glass animate-fade-slide overflow-hidden rounded-xl2 text-xs shadow-glassSm transition ${
        active ? 'animate-breath' : ''
      }`}
      style={{ borderLeft: '3px solid var(--kind-thought)' }}
    >
      <button
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <span className={active ? 'shimmer-text' : 'text-content'}>
            {label}
          </span>
          {active ? (
            <span className="text-accent">
              <ThinkingDots />
            </span>
          ) : (
            <span className="text-faint">· {steps.length} bước</span>
          )}
        </span>
        <span
          className="text-faint transition-transform duration-300"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ›
        </span>
      </button>
      <div
        className="grid transition-all duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 border-t border-hairline px-2 py-2">
            {steps.map((step, i) => (
              <StepRow key={step.id} step={step} active={active && i === steps.length - 1} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The agent's final answer — always visible, rendered prominently. */
function FinalAnswer({ step }: { step: AgentStep }) {
  return (
    <div
      className="glass-strong animate-fade-slide rounded-xl2 px-3.5 py-3 text-sm shadow-glass"
      style={{ borderLeft: '3px solid var(--kind-final)' }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        <span style={{ color: 'var(--kind-final)' }}>{KIND_LABEL.final}</span>
      </div>
      <Markdown text={step.detail ?? ''} />
    </div>
  );
}

/**
 * Floating status pill shown only in the gap between starting a task and the
 * first step arriving. Once steps exist, the live ProcessGroup header carries
 * the animated "Thinking …" state, so we hide this to avoid duplication.
 */
function StatusIndicator() {
  const running = usePanelStore((s) => s.running);
  const steps = usePanelStore((s) => s.steps);
  if (!running) return null;
  const last = steps[steps.length - 1];
  // A live group is already showing the animation for any non-final tail step.
  if (last && last.kind !== 'final') return null;
  const label = 'Thinking';
  return (
    <div className="glass flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-glassSm animate-fade-slide">
      <span className="shimmer-text">{label}</span>
      <span className="text-accent">
        <ThinkingDots />
      </span>
    </div>
  );
}

function ConfirmBar() {
  const confirmRequest = usePanelStore((s) => s.confirmRequest);
  const answerConfirm = usePanelStore((s) => s.answerConfirm);
  if (!confirmRequest) return null;
  return (
    <div className="glass-strong mx-3 mb-2 rounded-xl2 p-3 text-sm animate-fade-slide">
      <p className="mb-2.5 text-content">
        Confirm action:{' '}
        <span className="font-semibold" style={{ color: 'var(--amber)' }}>
          {confirmRequest.description}
        </span>
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => answerConfirm(true)}
          className="flex-1 rounded-full py-2 font-medium text-white shadow-glassSm transition active:scale-95"
          style={{ background: 'var(--kind-observation)' }}
        >
          Approve
        </button>
        <button
          onClick={() => answerConfirm(false)}
          className="flex-1 rounded-full py-2 font-medium text-white shadow-glassSm transition active:scale-95"
          style={{ background: 'var(--kind-error)' }}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function AskBar() {
  const askQuestion = usePanelStore((s) => s.askQuestion);
  const answerQuestion = usePanelStore((s) => s.answerQuestion);
  const [text, setText] = useState('');
  if (!askQuestion) return null;
  const send = () => {
    if (text.trim()) {
      answerQuestion(text.trim());
      setText('');
    }
  };
  return (
    <div className="glass-strong mx-3 mb-2 rounded-xl2 p-3 text-sm animate-fade-slide">
      <p className="mb-2.5 text-content">{askQuestion}</p>
      <div className="flex gap-2">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          className="flex-1 rounded-full bg-elevated px-3.5 py-2 text-content outline-none ring-1 ring-hairline transition focus:ring-2 focus:ring-accent"
          placeholder="Your answer..."
        />
        <button
          onClick={send}
          className="rounded-full bg-accent px-4 py-2 font-medium text-white shadow-glassSm transition active:scale-95"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function LinkedTabBar() {
  const lockedTabId = usePanelStore((s) => s.lockedTabId);
  const lockedTabTitle = usePanelStore((s) => s.lockedTabTitle);
  const activeTabId = usePanelStore((s) => s.activeTabId);
  const lockedTabClosed = usePanelStore((s) => s.lockedTabClosed);

  if (lockedTabId == null && !lockedTabClosed) return null;

  const title = lockedTabTitle ?? 'tab đã liên kết';

  if (lockedTabClosed) {
    return (
      <div
        className="glass mx-3 mt-2 rounded-xl2 px-3 py-2 text-[11px] text-content shadow-glassSm animate-fade-slide"
        style={{ borderLeft: '3px solid var(--kind-error)' }}
      >
        Tab đã liên kết đã bị đóng. Mở lại extension hoặc tạo session mới để liên kết tab khác.
      </div>
    );
  }

  const matches = activeTabId === lockedTabId;

  if (matches) {
    return (
      <div className="mx-3 mt-2 flex items-center gap-1.5 truncate px-1 text-[11px] text-muted animate-fade-slide">
        <span>🔗</span>
        <span className="truncate">Liên kết: {title}</span>
      </div>
    );
  }

  return (
    <div
      className="glass mx-3 mt-2 rounded-xl2 px-3 py-2 text-[11px] text-content shadow-glassSm animate-fade-slide"
      style={{ borderLeft: '3px solid var(--amber)' }}
    >
      Bạn đang ở tab khác. Quay lại tab đã liên kết ("{title}") hoặc tạo session mới để điều khiển tab này.
    </div>
  );
}

export function ChatView() {
  const steps = usePanelStore((s) => s.steps);
  const messages = usePanelStore((s) => s.messages);
  const running = usePanelStore((s) => s.running);
  const error = usePanelStore((s) => s.error);
  const runTask = usePanelStore((s) => s.runTask);
  const stopTask = usePanelStore((s) => s.stopTask);
  const lockedTabId = usePanelStore((s) => s.lockedTabId);
  const activeTabId = usePanelStore((s) => s.activeTabId);
  const lockedTabClosed = usePanelStore((s) => s.lockedTabClosed);

  const tabMatches = lockedTabId != null && activeTabId === lockedTabId && !lockedTabClosed;

  const [goal, setGoal] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build a time-ordered timeline of three item kinds:
  //  - user message bubbles
  //  - "process" groups: runs of consecutive intermediate steps (thought /
  //    action / observation / error) folded into one collapsible panel
  //  - final answers: rendered on their own as persistent, prominent bubbles
  // Assistant plain-text replies already surface as "thought" steps, so we
  // don't render assistant message bubbles here (would duplicate the text).
  const lastStepId = steps.length ? steps[steps.length - 1].id : null;

  type TimelineItem =
    | { kind: 'message'; key: string; ts: number; message: ChatMessage }
    | { kind: 'process'; key: string; ts: number; steps: AgentStep[] }
    | { kind: 'final'; key: string; ts: number; step: AgentStep };

  const stepItems: TimelineItem[] = [];
  let group: AgentStep[] = [];
  const flush = () => {
    if (group.length) {
      stepItems.push({ kind: 'process', key: `g-${group[0].id}`, ts: group[0].timestamp, steps: group });
      group = [];
    }
  };
  for (const s of steps) {
    if (s.kind === 'final') {
      flush();
      stepItems.push({ kind: 'final', key: `f-${s.id}`, ts: s.timestamp, step: s });
    } else {
      group.push(s);
    }
  }
  flush();

  const timeline: TimelineItem[] = [
    ...messages
      .filter((m) => m.role === 'user')
      .map((m, i): TimelineItem => ({
        kind: 'message',
        key: `m-${i}-${m.timestamp ?? ''}`,
        message: m,
        ts: m.timestamp ?? 0,
      })),
    ...stepItems,
  ].sort((a, b) => a.ts - b.ts);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [steps.length, messages.length, running]);

  const submit = () => {
    if (!goal.trim() || running || !tabMatches) return;
    runTask(goal.trim());
    setGoal('');
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-4">
        {messages.length === 0 && steps.length === 0 && (
          <div className="mx-auto mt-10 max-w-[260px] text-center text-xs leading-relaxed text-muted">
            <div className="mb-3 text-3xl">✨</div>
            Describe what you want the agent to do on the current page.
            <br />
            <span className="text-faint">
              e.g. "Search for wireless headphones and open the top result."
            </span>
          </div>
        )}

        {timeline.map((item) => {
          if (item.kind === 'message') {
            return (
              <div
                key={item.key}
                className="ml-auto max-w-[85%] animate-fade-slide rounded-xl2 bg-accent px-3.5 py-2.5 text-sm text-white shadow-glassSm"
              >
                {item.message.content}
              </div>
            );
          }
          if (item.kind === 'final') {
            return <FinalAnswer key={item.key} step={item.step} />;
          }
          const groupActive =
            running && lastStepId != null && item.steps.some((s) => s.id === lastStepId);
          return <ProcessGroup key={item.key} steps={item.steps} active={groupActive} />;
        })}

        <StatusIndicator />

        {error && (
          <div
            className="glass animate-fade-slide rounded-xl2 px-3.5 py-2.5 text-xs text-content shadow-glassSm"
            style={{ borderLeft: '3px solid var(--kind-error)' }}
          >
            {error}
          </div>
        )}
      </div>

      <ConfirmBar />
      <AskBar />
      <LinkedTabBar />

      <div className="glass rounded-t-xl2 p-3">
        <div
          className={`flex items-end gap-2 rounded-xl2 bg-elevated p-1.5 ring-1 ring-hairline transition ${
            running ? 'animate-breath' : ''
          }`}
        >
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="What should the agent do?"
            className="flex-1 resize-none bg-transparent px-2.5 py-1.5 text-sm text-content outline-none placeholder:text-faint"
          />
          {running ? (
            <button
              onClick={stopTask}
              className="mb-0.5 rounded-full px-4 py-2 text-sm font-medium text-white shadow-glassSm transition active:scale-95"
              style={{ background: 'var(--kind-error)' }}
            >
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!goal.trim() || !tabMatches}
              className="mb-0.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-glassSm transition active:scale-95 disabled:opacity-40"
            >
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

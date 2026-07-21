import type { BackgroundToContent, ContentToBackground } from '@/shared/messages';
import { TOOL_SCHEMAS } from '@/shared/tools';
import {
  RISKY_TOOLS,
  type AgentStep,
  type ChatMessage,
  type PageSnapshot,
  type Settings,
  type ToolCall,
  type ToolResult,
} from '@/shared/types';
import { createProvider, isRetryableProviderError } from './providers';
import { renderSnapshot, SYSTEM_PROMPT } from './prompt';
import { DEFAULT_RETRIES, withRetry } from '@/shared/retry';

/** Extract a readable message from an unknown thrown value. */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Whether a failed ToolResult looks like a transport error (the action likely
 * never ran) vs. a semantic one the model should handle. Only transport errors
 * are safe to retry automatically. Markers correspond to the failure strings
 * produced in executeTool / sendToContent / observe.
 */
function isTransientToolFailure(content: string): boolean {
  const c = content.toLowerCase();
  return (
    c.includes('could not read page') ||
    c.includes('no response from content script') ||
    c.startsWith('tool error:')
  );
}

/** These tools may have completed before their response was lost. Never replay them. */
const NEVER_RETRY_TOOLS: ToolCall['name'][] = ['edit_html', 'execute_javascript'];

function preview(value: unknown, maxLength = 180): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export interface OrchestratorHooks {
  onStep: (step: AgentStep) => void;
  onMessage: (message: ChatMessage) => void;
  /** Request user confirmation for a risky tool. Resolves to approved/denied. */
  requestConfirm: (toolCall: ToolCall, description: string) => Promise<boolean>;
  /** Ask the user a question and await their typed answer. */
  askUser: (question: string) => Promise<string>;
  onDone: (summary: string) => void;
  onError: (message: string) => void;
}

function uid(): string {
  return crypto.randomUUID();
}

function step(partial: Omit<AgentStep, 'id' | 'timestamp'>): AgentStep {
  return { id: uid(), timestamp: Date.now(), ...partial };
}

/**
 * Condense a prior-turn transcript for replay. Tool observations and page
 * snapshots from finished turns are huge and stale, so we keep only the
 * user goals and the assistant's plain-text replies (its summaries), which
 * is what gives continuity without blowing the token budget.
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.imageDataUrl)
    .map((m) => ({ role: m.role, content: m.content }))
    .filter((m) => m.content.trim().length > 0);
}

/**
 * Drives the perceive → reason → act loop for a single task against one tab.
 */
export class Orchestrator {
  private messages: ChatMessage[] = [];
  private abort = new AbortController();
  private stopped = false;

  constructor(
    private settings: Settings,
    private tabId: number,
    /** Transcript from earlier turns in this session, replayed for continuity. */
    private priorMessages: ChatMessage[],
    private hooks: OrchestratorHooks,
  ) {}

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    void this.setGlow(false);
  }

  /** Toggle the on-page control glow; tolerant of missing content script. */
  private async setGlow(on: boolean): Promise<void> {
    try {
      await this.ensureContentScript();
      await chrome.tabs.sendMessage(this.tabId, {
        type: 'SET_CONTROL_GLOW',
        on,
      } satisfies BackgroundToContent);
    } catch {
      // Tab closed, navigating, or content script not injected yet.
    }
  }

  async run(goal: string): Promise<void> {
    if (!this.settings.provider.apiKey) {
      this.hooks.onError('No API key configured. Open settings and add your provider key.');
      return;
    }

    const provider = createProvider(this.settings.provider);

    this.messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...trimHistory(this.priorMessages),
      { role: 'user', content: `Goal: ${goal}` },
    ];

    // Light up the tab so the user can see which page the agent controls.
    await this.setGlow(true);
    try {
      await this.loop(provider);
    } finally {
      await this.setGlow(false);
    }
  }

  private async loop(provider: ReturnType<typeof createProvider>): Promise<void> {
    // Seed with an initial observation so the model starts grounded.
    const initial = await this.observe();
    if (initial) {
      this.messages.push({
        role: 'user',
        content: `Current page snapshot:\n${renderSnapshot(initial)}`,
      });
    }

    for (let iter = 0; iter < this.settings.maxSteps; iter += 1) {
      if (this.stopped) return;

      let response;
      try {
        response = await withRetry(
          () => provider.chat(this.messages, TOOL_SCHEMAS, this.abort.signal),
          {
            signal: this.abort.signal,
            shouldRetry: isRetryableProviderError,
            onRetry: (attempt, err, delayMs) =>
              this.hooks.onStep(
                step({
                  kind: 'error',
                  title: `Đang thử lại (${attempt}/${DEFAULT_RETRIES})`,
                  detail: `Lỗi gọi AI: ${errMessage(err)}. Thử lại sau ${delayMs}ms…`,
                }),
              ),
          },
        );
      } catch (err) {
        if (this.stopped) return;
        this.hooks.onError(`Model call failed: ${errMessage(err)}`);
        return;
      }

      // No tool calls → the model is done and this text is its final answer.
      if (response.toolCalls.length === 0) {
        this.messages.push({ role: 'assistant', content: response.text });
        if (response.text) {
          this.hooks.onStep(step({ kind: 'final', title: 'Answer', detail: response.text }));
          this.hooks.onMessage({ role: 'assistant', content: response.text });
          this.hooks.onDone(response.text);
        } else {
          this.hooks.onError('Model returned no action and no message.');
        }
        return;
      }

      // Otherwise this text is intermediate reasoning ahead of tool calls.
      if (response.text) {
        this.hooks.onStep(step({ kind: 'thought', title: 'Thinking', detail: response.text }));
        this.hooks.onMessage({ role: 'assistant', content: response.text });
      }

      this.messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      // Execute each requested tool sequentially.
      for (const call of response.toolCalls) {
        if (this.stopped) return;

        if (call.name === 'finish') {
          const summary = String(call.args.summary ?? 'Task complete.');
          this.hooks.onStep(step({ kind: 'final', title: 'Finished', detail: summary }));
          this.hooks.onDone(summary);
          return;
        }

        if (call.name === 'ask_user') {
          const question = String(call.args.question ?? 'Could you clarify?');
          this.hooks.onStep(step({ kind: 'action', title: 'Asking user', detail: question }));
          const answer = await this.hooks.askUser(question);
          this.pushToolResult(call, {
            id: call.id,
            name: 'ask_user',
            ok: true,
            content: `User answered: ${answer}`,
          });
          continue;
        }

        // Confirmation gate for risky tools in confirm mode.
        if (this.settings.mode === 'confirm' && RISKY_TOOLS.includes(call.name)) {
          const description = this.describeCall(call);
          const approved = await this.hooks.requestConfirm(call, description);
          if (!approved) {
            this.pushToolResult(call, {
              id: call.id,
              name: call.name,
              ok: false,
              content: 'User denied this action. Consider an alternative or ask the user.',
            });
            continue;
          }
        }

        const result = await this.withToolRetry(call);
        this.pushToolResult(call, result);
      }
    }

    this.hooks.onError(`Reached max steps (${this.settings.maxSteps}) without finishing.`);
  }

  private describeCall(call: ToolCall): string {
    switch (call.name) {
      case 'click':
        return `Click element #${call.args.index}`;
      case 'type':
        return `Fill ${String(call.args.text ?? '').length} character(s) into element #${call.args.index}${
          call.args.submit ? ' and submit' : ''
        }`;
      case 'select':
        return `Select "${call.args.value}" in element #${call.args.index}`;
      case 'navigate':
        return `Navigate to ${call.args.url}`;
      case 'edit_html':
        return `Edit HTML (${call.args.mode}) at selector "${call.args.selector}"${
          call.args.mode === 'remove'
            ? ''
            : ` with: ${preview(call.args.html) || '(empty HTML)'}`
        }`;
      case 'execute_javascript':
        return `Execute JavaScript in the page: ${preview(call.args.code)}`;
      default:
        return `${call.name}(${JSON.stringify(call.args)})`;
    }
  }

  private pushToolResult(call: ToolCall, result: ToolResult): void {
    this.hooks.onStep(
      step({
        kind: result.ok ? 'observation' : 'error',
        title: result.ok ? `${call.name} ✓` : `${call.name} ✗`,
        detail: result.content,
        toolCall: call,
        toolResult: result,
      }),
    );
    this.messages.push({
      role: 'tool',
      toolCallId: call.id,
      content: result.content,
      imageDataUrl: result.imageDataUrl,
    });
    // For screenshots, also attach the image as a user turn so vision models see it.
    if (result.imageDataUrl) {
      this.messages.push({
        role: 'user',
        content: 'Screenshot of the current visible tab:',
        imageDataUrl: result.imageDataUrl,
      });
    }
  }

  /**
   * Run a tool with retry, but ONLY for transient transport failures where the
   * action almost certainly never ran (content script unreachable, page
   * unreadable, navigation timed out). Semantic failures returned by a content
   * script that already executed — "element not found", denied actions — are
   * NOT retried, so we never risk clicking or typing twice.
   */
  private async withToolRetry(call: ToolCall): Promise<ToolResult> {
    let result = await this.executeTool(call);
    if (NEVER_RETRY_TOOLS.includes(call.name)) return result;
    for (let attempt = 1; attempt <= DEFAULT_RETRIES; attempt += 1) {
      if (result.ok || this.stopped || !isTransientToolFailure(result.content)) return result;

      const delayMs = 500 * 2 ** (attempt - 1);
      this.hooks.onStep(
        step({
          kind: 'error',
          title: `Đang thử lại (${attempt}/${DEFAULT_RETRIES})`,
          detail: `Lỗi ${call.name}: ${result.content}. Thử lại sau ${delayMs}ms…`,
        }),
      );
      await new Promise((r) => setTimeout(r, delayMs));
      if (this.stopped) return result;
      result = await this.executeTool(call);
    }
    return result;
  }

  private async executeTool(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'observe_page': {
          const snapshot = await this.observe();
          if (!snapshot) {
            return { id: call.id, name: call.name, ok: false, content: 'Could not read page.' };
          }
          return {
            id: call.id,
            name: call.name,
            ok: true,
            content: renderSnapshot(snapshot),
            data: snapshot,
          };
        }
        case 'navigate': {
          const url = String(call.args.url);
          await chrome.tabs.update(this.tabId, { url });
          await this.waitForLoad();
          // Fresh page dropped the overlay — re-apply it.
          await this.setGlow(true);
          const snap = await this.observe();
          return {
            id: call.id,
            name: call.name,
            ok: true,
            content: `Navigated to ${url}.\n${snap ? renderSnapshot(snap) : ''}`,
          };
        }
        case 'go_back': {
          await chrome.tabs.goBack(this.tabId);
          await this.waitForLoad();
          await this.setGlow(true);
          return { id: call.id, name: call.name, ok: true, content: 'Navigated back.' };
        }
        case 'screenshot': {
          const dataUrl = await this.captureScreenshot();
          return {
            id: call.id,
            name: call.name,
            ok: true,
            content: 'Captured screenshot of the visible tab.',
            imageDataUrl: dataUrl,
          };
        }
        case 'execute_javascript':
          return this.executeJavaScript(call);
        case 'wait': {
          const ms = Math.min(Number(call.args.ms) || 500, 10000);
          await new Promise((r) => setTimeout(r, ms));
          return { id: call.id, name: call.name, ok: true, content: `Waited ${ms}ms.` };
        }
        case 'click':
        case 'type':
        case 'select':
        case 'scroll':
        case 'extract':
        case 'inspect_html':
        case 'edit_html': {
          const result = await this.sendToContent(call);
          return { ...result, id: call.id };
        }
        default:
          return {
            id: call.id,
            name: call.name,
            ok: false,
            content: `Unknown tool: ${call.name}`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${message}` };
    }
  }

  private async sendToContent(call: ToolCall): Promise<ToolResult> {
    await this.ensureContentScript();
    let cmd: BackgroundToContent;
    switch (call.name) {
      case 'click':
        cmd = { type: 'CLICK', index: Number(call.args.index) };
        break;
      case 'inspect_html':
        cmd = {
          type: 'INSPECT_HTML',
          selector: String(call.args.selector ?? ''),
          outer: call.args.outer === undefined ? true : Boolean(call.args.outer),
          maxLength: Number(call.args.max_length) || 8000,
        };
        break;
      case 'edit_html':
        cmd = {
          type: 'EDIT_HTML',
          selector: String(call.args.selector ?? ''),
          mode: call.args.mode as
            | 'inner'
            | 'outer'
            | 'append'
            | 'prepend'
            | 'before'
            | 'after'
            | 'remove',
          html: String(call.args.html ?? ''),
          all: Boolean(call.args.all),
        };
        break;
      case 'type':
        cmd = {
          type: 'TYPE',
          index: Number(call.args.index),
          text: String(call.args.text ?? ''),
          submit: Boolean(call.args.submit),
        };
        break;
      case 'select':
        cmd = {
          type: 'SELECT',
          index: Number(call.args.index),
          value: String(call.args.value ?? ''),
        };
        break;
      case 'scroll':
        cmd = { type: 'SCROLL', direction: (call.args.direction as 'down') ?? 'down' };
        break;
      case 'extract':
        cmd = { type: 'EXTRACT', query: String(call.args.query ?? '') };
        break;
      default:
        return { id: call.id, name: call.name, ok: false, content: 'Unsupported content command.' };
    }

    const res = (await chrome.tabs.sendMessage(this.tabId, cmd)) as ContentToBackground;
    if (res?.type === 'ACTION_RESULT') {
      // Give the page a beat to react, then let the model re-observe next turn.
      await new Promise((r) => setTimeout(r, 400));
      return res.result;
    }
    return { id: call.id, name: call.name, ok: false, content: 'No response from content script.' };
  }

  /**
   * Guarantee the content script is live in the target tab before we message
   * it. Declarative content_scripts only inject into tabs loaded AFTER the
   * extension started, so tabs open beforehand have no listener. We PING to
   * detect it and programmatically inject only when absent — re-injecting a
   * live script would register a duplicate onMessage listener.
   */
  private async ensureContentScript(): Promise<void> {
    try {
      const res = (await chrome.tabs.sendMessage(this.tabId, {
        type: 'PING',
      } satisfies BackgroundToContent)) as ContentToBackground;
      if (res?.type === 'PONG') return;
    } catch {
      // No listener → fall through to injection.
    }

    // Reuse the exact built file paths from the manifest so this works in both
    // dev and production bundles.
    const files = (chrome.runtime.getManifest().content_scripts ?? [])
      .flatMap((cs) => cs.js ?? [])
      .filter(Boolean);
    if (files.length === 0) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.tabId },
        files,
      });
    } catch {
      // Restricted pages (chrome://, Web Store, PDF viewer) reject injection.
      // Leave it; the caller's sendMessage will fail gracefully as before.
    }
  }

  private async observe(): Promise<PageSnapshot | null> {
    await this.ensureContentScript();
    try {
      const res = (await chrome.tabs.sendMessage(this.tabId, {
        type: 'OBSERVE',
      } satisfies BackgroundToContent)) as ContentToBackground;
      if (res?.type === 'SNAPSHOT') return res.snapshot;
      return null;
    } catch {
      // Content script may not be injected yet (e.g. after navigation).
      return null;
    }
  }

  private async captureScreenshot(): Promise<string> {
    const tab = await chrome.tabs.get(this.tabId);
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  }

  /** Execute model-provided code in the page's MAIN world through CDP. */
  private async executeJavaScript(call: ToolCall): Promise<ToolResult> {
    const code = String(call.args.code ?? '');
    if (!code.trim()) {
      return { id: call.id, name: call.name, ok: false, content: 'JavaScript code is empty.' };
    }
    if (code.length > 50000) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        content: 'JavaScript code exceeds the 50,000 character limit.',
      };
    }

    const target: chrome.debugger.Debuggee = { tabId: this.tabId };
    let attached = false;
    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
      const response = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: `(async () => {\n${code}\n})()`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      })) as {
        result?: {
          type?: string;
          value?: unknown;
          unserializableValue?: string;
          description?: string;
        };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };

      if (response.exceptionDetails) {
        const detail =
          response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          'Unknown JavaScript exception';
        return {
          id: call.id,
          name: call.name,
          ok: false,
          content: `JavaScript exception: ${detail.slice(0, 8000)}`,
        };
      }

      const remote = response.result;
      let rendered: string;
      if (remote?.value !== undefined) {
        try {
          rendered = JSON.stringify(remote.value, null, 2);
        } catch {
          rendered = String(remote.value);
        }
      } else {
        rendered = remote?.unserializableValue ?? remote?.description ?? remote?.type ?? 'undefined';
      }
      if (rendered === undefined) rendered = 'undefined';
      if (rendered.length > 20000) {
        rendered = `${rendered.slice(0, 20000)}\n… [result truncated]`;
      }
      return {
        id: call.id,
        name: call.name,
        ok: true,
        content: `JavaScript executed successfully. Result:\n${rendered}`,
      };
    } catch (err) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        content: `JavaScript execution failed: ${errMessage(err)}`,
      };
    } finally {
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
          // Tab may have navigated or closed while evaluating.
        }
      }
    }
  }

  private async waitForLoad(timeout = 8000): Promise<void> {
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const check = async () => {
        try {
          const tab = await chrome.tabs.get(this.tabId);
          if (tab.status === 'complete' || Date.now() - start > timeout) {
            resolve();
            return;
          }
        } catch {
          resolve();
          return;
        }
        setTimeout(check, 300);
      };
      check();
    });
    // Small settle delay for SPA rendering.
    await new Promise((r) => setTimeout(r, 500));
  }
}

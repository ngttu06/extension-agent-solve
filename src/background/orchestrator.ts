import type { BackgroundToContent, ContentToBackground } from '@/shared/messages';
import { TOOL_SCHEMAS } from '@/shared/tools';
import { createToolRegistry } from '@/background/tools';
import { createToolContext } from '@/background/tools/context';
import { neverRetryToolNames, parallelToolNames, riskyToolNames } from '@/shared/tool-registry';
import {
  type ActionExecutionEvidence,
  type ActionRecipe,
  type AgentStep,
  type ChatMessage,
  type PageSnapshot,
  type RecipeStep,
  type RunStatus,
  type Settings,
  type ToolCall,
  type ToolResult,
} from '@/shared/types';
import { createProvider, isRetryableProviderError } from './providers';
import { renderSnapshot, SYSTEM_PROMPT } from './prompt';
import { DEFAULT_RETRIES, withRetry } from '@/shared/retry';
import { StatusPublisher } from './status';
import {
  RecipeEngine,
  summarizeExecutedRecipe,
  validateRecipePostconditions,
  validateRecipePrecondition,
} from './recipe-engine';

/** Extract a readable message from an unknown thrown value. */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Create registry once at module level
const TOOL_REGISTRY = createToolRegistry();
const RISKY_TOOL_NAMES = riskyToolNames(TOOL_REGISTRY);
const NEVER_RETRY_TOOL_NAMES = neverRetryToolNames(TOOL_REGISTRY);
const PARALLEL_TOOL_NAMES = parallelToolNames(TOOL_REGISTRY);

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

function preview(value: unknown, maxLength = 180): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export interface OrchestratorHooks {
  onStep: (step: AgentStep) => void;
  onMessage: (message: ChatMessage) => void;
  onStatus: (status: RunStatus) => void;
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
  private observationInFlight: Promise<PageSnapshot | null> | null = null;
  private lastSnapshot: PageSnapshot | null = null;
  private lastExecutionEvidence: ActionExecutionEvidence | undefined;
  private recipeEngine: RecipeEngine;
  private goal = '';
  private pendingReplayVerification: { recipeId: string; steps: number; durationMs: number } | null = null;
  private statusPublisher: StatusPublisher;

  constructor(
    private settings: Settings,
    private tabId: number,
    /** Transcript from earlier turns in this session, replayed for continuity. */
    private priorMessages: ChatMessage[],
    private hooks: OrchestratorHooks,
  ) {
    this.recipeEngine = new RecipeEngine(settings);
    this.statusPublisher = new StatusPublisher((status) => hooks.onStatus(status));
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    this.statusPublisher.reset();
    void this.setGlow(false);
  }

  /** Toggle the on-page control glow; tolerant of missing content script. */
  private async setGlow(on: boolean, activeAction = false): Promise<void> {
    try {
      await this.ensureContentScript();
      await chrome.tabs.sendMessage(this.tabId, {
        type: 'SET_CONTROL_GLOW',
        on: on && this.settings.showProcessingEffects,
        activeAction,
        showCursor: this.settings.showVirtualCursor,
      } satisfies BackgroundToContent);
    } catch {
      // Tab closed, navigating, or content script not injected yet.
    }
  }

  async run(goal: string): Promise<void> {
    if (!this.settings.provider.apiKey) {
      this.hooks.onError('No API key configured. Open settings and add your provider key.');
      this.statusPublisher.updatePhase('error', { detail: 'No API key' });
      return;
    }

    this.goal = goal;
    this.statusPublisher.setMaxIterations(this.settings.maxSteps);
    this.statusPublisher.updatePhase('preparing', { detail: goal });

    const provider = createProvider(this.settings.provider);
    this.messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...trimHistory(this.priorMessages),
      { role: 'user', content: `Goal: ${goal}` },
    ];

    await this.setGlow(true);
    try {
      const initial = await this.observe(true);
      this.recipeEngine.begin(initial);
      if (initial && this.settings.actionCache.enabled) {
        this.hooks.onStep(step({
          kind: 'thought',
          title: 'Checking action cache',
          detail: 'Looking for a validated recipe for the same goal and page.',
          metadata: { source: 'system', cacheStatus: 'lookup' },
        }));
        const recipe = await this.recipeEngine.lookup(goal, initial);
        if (recipe) {
          const replay = await this.replayRecipe(recipe, initial);
          if (replay.snapshot) {
            this.messages.push({ role: 'user', content: replay.report });
            this.messages.push({
              role: 'user',
              content: `Fresh page snapshot after recipe replay:\n${renderSnapshot(replay.snapshot)}`,
            });
          }
        } else {
          this.hooks.onStep(step({
            kind: 'observation',
            title: 'Action cache miss',
            detail: 'No safe matching recipe; continuing with the agent.',
            metadata: { source: 'system', cacheStatus: 'miss' },
          }));
          this.messages.push({ role: 'user', content: `Current page snapshot:\n${renderSnapshot(initial)}` });
        }
      } else if (initial) {
        this.messages.push({ role: 'user', content: `Current page snapshot:\n${renderSnapshot(initial)}` });
      }
      await this.loop(provider);
    } catch (err) {
      this.statusPublisher.updatePhase('error', { detail: errMessage(err) });
      throw err;
    } finally {
      await this.setGlow(false);
    }
  }

  private async loop(provider: ReturnType<typeof createProvider>): Promise<void> {

    for (let iter = 0; iter < this.settings.maxSteps; iter += 1) {
      if (this.stopped) return;

      this.statusPublisher.updatePhase('calling-model', { iteration: iter + 1 });
      let response;
      const callStart = Date.now();
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
        this.statusPublisher.updatePhase('error', { detail: errMessage(err) });
        this.hooks.onError(`Model call failed: ${errMessage(err)}`);
        return;
      }
      this.statusPublisher.setLastDuration(Date.now() - callStart);

      // No tool calls → the model is done and this text is its final answer.
      if (response.toolCalls.length === 0) {
        this.statusPublisher.updatePhase('finishing', { detail: 'Model completed task' });
        this.messages.push({ role: 'assistant', content: response.text });
        if (response.text) {
          this.hooks.onStep(step({ kind: 'final', title: 'Answer', detail: response.text }));
          this.hooks.onMessage({ role: 'assistant', content: response.text });
          this.hooks.onDone(response.text);
        } else {
          this.hooks.onError('Model returned no action and no message.');
        }
        this.statusPublisher.updatePhase('done');
        return;
      }

      // Otherwise this text is intermediate reasoning ahead of tool calls.
      if (response.text) {
        this.statusPublisher.updatePhase('thinking', { detail: response.text.slice(0, 100) });
        this.hooks.onStep(step({ kind: 'thought', title: 'Thinking', detail: response.text }));
        this.hooks.onMessage({ role: 'assistant', content: response.text });
      }

      this.messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
      });

      for (let index = 0; index < response.toolCalls.length;) {
        if (this.stopped) return;
        const call = response.toolCalls[index];
        if (PARALLEL_TOOL_NAMES.has(call.name)) {
          const batch: ToolCall[] = [];
          while (
            index < response.toolCalls.length &&
            PARALLEL_TOOL_NAMES.has(response.toolCalls[index].name)
          ) {
            batch.push(response.toolCalls[index]);
            index += 1;
          }
          const results = await Promise.all(batch.map((entry) => this.withToolRetry(entry)));
          for (let resultIndex = 0; resultIndex < batch.length; resultIndex += 1) {
            this.pushToolResult(batch[resultIndex], results[resultIndex]);
          }
          continue;
        }
        index += 1;

        if (call.name === 'finish') {
          this.statusPublisher.updatePhase('finishing', { detail: String(call.args.summary ?? 'Task complete.') });
          const summary = String(call.args.summary ?? 'Task complete.');
          if (this.pendingReplayVerification) {
            const verification = this.pendingReplayVerification;
            await this.recipeEngine.store.recordSuccess(
              verification.recipeId,
              verification.steps,
              verification.durationMs,
            );
            this.pendingReplayVerification = null;
          } else {
            await this.recipeEngine.maybeLearn(this.goal);
          }
          this.hooks.onStep(step({ kind: 'final', title: 'Finished', detail: summary }));
          this.hooks.onDone(summary);
          this.statusPublisher.updatePhase('done');
          return;
        }

        if (call.name === 'ask_user') {
          this.statusPublisher.updatePhase('awaiting-user', { detail: String(call.args.question ?? 'Waiting for user input') });
          this.pendingReplayVerification = null;
          this.recipeEngine.disqualify();
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

        if (this.settings.mode === 'confirm' && RISKY_TOOL_NAMES.has(call.name)) {
          this.statusPublisher.updatePhase('awaiting-confirm', { activeTool: call.name, detail: this.describeCall(call) });
          const description = this.describeCall(call);
          const approved = await this.hooks.requestConfirm(call, description);
          if (!approved) {
            this.recipeEngine.disqualify();
            this.pushToolResult(call, {
              id: call.id,
              name: call.name,
              ok: false,
              content: 'User denied this action. Consider an alternative or ask the user.',
            });
            continue;
          }
        }

        this.statusPublisher.updatePhase('running-tool', { activeTool: call.name, detail: this.describeCall(call) });

        if (this.pendingReplayVerification) this.pendingReplayVerification = null;
        const before = this.lastSnapshot ?? await this.observe(true);
        await this.setGlow(true, true); // Báo hiệu action đang thực thi
        const result = await this.withToolRetry(call);
        const after = await this.observe(true);
        this.recipeEngine.recordExecution(call, result, before, after, this.lastExecutionEvidence);
        this.pushToolResult(call, result);
        // Tối ưu: giảm animation khi không có action đang xảy ra
        await this.setGlow(true, false);
      }
    }

    this.hooks.onError(`Reached max steps (${this.settings.maxSteps}) without finishing.`);
  }

  private async replayRecipe(
    recipe: ActionRecipe,
    initial: PageSnapshot,
  ): Promise<{ snapshot: PageSnapshot | null; report: string }> {
    this.statusPublisher.updatePhase('replaying-recipe', { detail: `Replaying ${recipe.steps.length} cached steps` });
    const started = performance.now();
    const executed: RecipeStep[] = [];
    let current = initial;
    this.hooks.onStep(step({
      kind: 'action',
      title: `Action cache hit (${recipe.steps.length} steps)`,
      detail: 'Re-validating every target and postcondition before continuing.',
      metadata: { source: 'recipe', cacheStatus: 'hit' },
    }));
    for (let index = 0; index < recipe.steps.length; index += 1) {
      const recipeStep = recipe.steps[index];
      if (this.stopped) break;
      if (!validateRecipePrecondition(recipeStep, current)) {
        await this.recipeEngine.store.recordDivergence(recipe.id);
        return this.recipeFallbackReport(executed, `Precondition failed at step ${index + 1}.`);
      }
      const syntheticCall: ToolCall = {
        id: uid(),
        name: recipeStep.tool,
        args: {
          ...recipeStep.args,
          target: recipeStep.locator?.accessibleName ?? recipeStep.locator?.tag,
        },
      };
      if (this.settings.mode === 'confirm' && RISKY_TOOL_NAMES.has(syntheticCall.name)) {
        const approved = await this.hooks.requestConfirm(
          syntheticCall,
          `Replay cached step ${index + 1}/${recipe.steps.length}: ${this.describeRecipeStep(recipeStep)}`,
        );
        if (!approved) {
          const snapshot = await this.observe(true);
          return {
            snapshot,
            report: `Cached replay stopped because the user denied step ${index + 1}. No cached result was assumed. ${executed.length} step(s) had already executed.`,
          };
        }
      }
      this.hooks.onStep(step({
        kind: 'action',
        title: `Replaying step ${index + 1}/${recipe.steps.length}`,
        detail: this.describeRecipeStep(recipeStep),
        metadata: { source: 'recipe', cacheStatus: 'replaying' },
      }));
      const before = current;
      const outcome = await this.executeRecipeStep(recipeStep);
      current = (await this.observe(true)) ?? current;
      if (!outcome.ok || !validateRecipePostconditions(recipeStep, before, current, outcome.evidence)) {
        await this.recipeEngine.store.recordDivergence(recipe.id);
        return this.recipeFallbackReport(
          executed,
          `Step ${index + 1} diverged: ${outcome.content}`,
        );
      }
      executed.push(recipeStep);
    }
    if (executed.length === recipe.steps.length) {
      const durationMs = Math.round(performance.now() - started);
      this.pendingReplayVerification = { recipeId: recipe.id, steps: executed.length, durationMs };
      this.hooks.onStep(step({
        kind: 'observation',
        title: 'Cached actions re-executed',
        detail: `${executed.length} action(s) ran on the current DOM and passed local postconditions. The agent will verify the goal now.`,
        metadata: { source: 'recipe', cacheStatus: 'replaying', durationMs },
      }));
      return {
        snapshot: current,
        report: `A cached action recipe was re-executed against the current DOM. Every listed action was performed now and passed its local postconditions:\n${summarizeExecutedRecipe(executed)}\nVerify the user's goal from the fresh snapshot. Finish only if it is actually complete.`,
      };
    }
    return this.recipeFallbackReport(executed, 'Replay stopped.');
  }

  private async recipeFallbackReport(
    executed: RecipeStep[],
    reason: string,
  ): Promise<{ snapshot: PageSnapshot | null; report: string }> {
    this.pendingReplayVerification = null;
    this.hooks.onStep(step({
      kind: 'error',
      title: 'Cached recipe diverged',
      detail: `${reason} The agent is resuming from the current page state.`,
      metadata: { source: 'recipe', cacheStatus: 'diverged' },
    }));
    const snapshot = await this.observe(true);
    return {
      snapshot,
      report: `Cached recipe replay diverged and stopped. ${reason}\nActions that actually ran before stopping:\n${executed.length ? summarizeExecutedRecipe(executed) : '(none)'}\nContinue from the fresh current state. Do not assume unexecuted cached steps occurred.`,
    };
  }

  private describeRecipeStep(recipeStep: RecipeStep): string {
    switch (recipeStep.tool) {
      case 'click':
        return `Click ${recipeStep.locator?.accessibleName ?? recipeStep.locator?.tag ?? 'target'}`;
      case 'type':
        return `Fill ${String(recipeStep.args.text ?? '').length} character(s) into ${recipeStep.locator?.accessibleName ?? 'target'}`;
      case 'select':
        return `Select "${String(recipeStep.args.value ?? '')}" in ${recipeStep.locator?.accessibleName ?? 'target'}`;
      case 'navigate':
        return `Navigate to ${String(recipeStep.args.url ?? '')}`;
    }
  }

  private async executeRecipeStep(recipeStep: RecipeStep): Promise<{
    ok: boolean;
    content: string;
    evidence?: ActionExecutionEvidence;
  }> {
    if (recipeStep.tool === 'navigate') {
      try {
        const url = String(recipeStep.args.url ?? '');
        await this.navigateAndWait(url);
        const snapshot = await this.observe(true);
        return {
          ok: Boolean(snapshot),
          content: snapshot ? `Navigated to ${url}.` : 'Navigation completed but the page could not be observed.',
        };
      } catch (err) {
        return { ok: false, content: `Navigation failed: ${errMessage(err)}` };
      }
    }
    await this.ensureContentScript();
    try {
      const response = (await chrome.tabs.sendMessage(this.tabId, {
        type: 'EXECUTE_RECIPE_ACTION',
        step: recipeStep,
      } satisfies BackgroundToContent)) as ContentToBackground;
      if (response?.type === 'RECIPE_ACTION_RESULT') return response;
      return { ok: false, content: 'No recipe result from content script.' };
    } catch (err) {
      return { ok: false, content: `Recipe transport failed: ${errMessage(err)}` };
    }
  }

  private describeCall(call: ToolCall): string {
    switch (call.name) {
      case 'click':
        return call.args.target
          ? `Click ${String(call.args.target)}`
          : `Click element #${call.args.index}`;
      case 'type':
        return `Fill ${String(call.args.text ?? '').length} character(s) into ${
          call.args.target ? String(call.args.target) : `element #${call.args.index}`
        }${call.args.submit ? ' and submit' : ''}`;
      case 'select':
        return `Select "${call.args.value}" in ${
          call.args.target ? String(call.args.target) : `element #${call.args.index}`
        }`;
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
    if (NEVER_RETRY_TOOL_NAMES.has(call.name)) return result;
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
    this.lastExecutionEvidence = undefined;
    
    try {
      const toolDef = TOOL_REGISTRY.get(call.name);
      if (!toolDef) {
        return {
          id: call.id,
          name: call.name,
          ok: false,
          content: `Unknown tool: ${call.name}`,
        };
      }

      // Create context for this execution
      const context = createToolContext(
        this.tabId,
        this.settings,
        this.hooks,
        {
          observe: (force) => this.observe(force),
          navigateAndWait: (url) => this.navigateAndWait(url),
          goBackAndWait: () => this.goBackAndWait(),
          captureScreenshot: () => this.captureScreenshot(),
          executeJavaScript: (call) => this.executeJavaScript(call),
        },
      );

      // Special handling for tools that need orchestrator state
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
          await this.navigateAndWait(url);
          const snap = await this.observe(true);
          return {
            id: call.id,
            name: call.name,
            ok: true,
            content: `Navigated to ${url}.\n${snap ? renderSnapshot(snap) : ''}`,
          };
        }
        case 'go_back': {
          await this.goBackAndWait();
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
        default:
          // Use registry executor for all other tools
          return await toolDef.execute(call, context);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { id: call.id, name: call.name, ok: false, content: `Tool error: ${message}` };
    }
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

  private async observe(force = false): Promise<PageSnapshot | null> {
    if (!force && this.lastSnapshot) return this.lastSnapshot;
    if (this.observationInFlight) return this.observationInFlight;
    this.observationInFlight = (async () => {
      await this.ensureContentScript();
      try {
        const res = (await chrome.tabs.sendMessage(this.tabId, {
          type: 'OBSERVE',
        } satisfies BackgroundToContent)) as ContentToBackground;
        if (res?.type === 'SNAPSHOT') {
          this.lastSnapshot = res.snapshot;
          return res.snapshot;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.observationInFlight = null;
      }
    })();
    return this.observationInFlight;
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

  private async navigateAndWait(url: string): Promise<void> {
    const ready = this.waitForTabReady(url);
    await chrome.tabs.update(this.tabId, { url });
    this.lastSnapshot = null;
    await ready;
    await this.setGlow(true);
    await this.waitForContentQuiet();
  }

  private async goBackAndWait(): Promise<void> {
    const ready = this.waitForTabReady();
    await chrome.tabs.goBack(this.tabId);
    this.lastSnapshot = null;
    await ready;
    await this.setGlow(true);
    await this.waitForContentQuiet();
  }

  private waitForTabReady(expectedUrl?: string, timeout = 8000): Promise<void> {
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      };
      const listener = (
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab,
      ) => {
        if (tabId !== this.tabId) return;
        if (changeInfo.status === 'complete' && (!expectedUrl || tab.url?.startsWith(expectedUrl))) finish();
      };
      const timer = setTimeout(finish, timeout);
      chrome.tabs.onUpdated.addListener(listener);
      void chrome.tabs.get(this.tabId).then((tab) => {
        if (tab.status === 'complete' && (!expectedUrl || tab.url?.startsWith(expectedUrl))) finish();
      }).catch(finish);
    });
  }

  private async waitForContentQuiet(): Promise<void> {
    try {
      await this.ensureContentScript();
      await chrome.tabs.sendMessage(this.tabId, {
        type: 'WAIT_FOR_PAGE_QUIET',
        quietMs: 100,
        timeoutMs: 1400,
      } satisfies BackgroundToContent);
    } catch {
      // Restricted or still-loading pages fall back to the next observation.
    }
  }
}

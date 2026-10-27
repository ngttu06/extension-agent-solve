import type { AgentPhase, RunStatus, ToolName } from '@/shared/types';

/**
 * StatusPublisher manages the current run status and publishes changes.
 * It throttles updates to avoid spamming the message channel (~5 msg/s max).
 */
export class StatusPublisher {
  private status: RunStatus;
  private lastPublishTime = 0;
  private readonly minPublishInterval = 200; // ms between publishes
  private pendingPublish: NodeJS.Timeout | null = null;
  private readonly onPublish: (status: RunStatus) => void;

  constructor(onPublish: (status: RunStatus) => void) {
    this.onPublish = onPublish;
    this.status = {
      phase: 'idle',
      startedAt: Date.now(),
      elapsedMs: 0,
    };
  }

  /**
   * Update phase and optionally detail/activeTool.
   * Publishes immediately if phase changed significantly.
   */
  updatePhase(
    phase: AgentPhase,
    opts?: { detail?: string; activeTool?: ToolName; iteration?: number }
  ): void {
    const now = Date.now();
    this.status.phase = phase;
    this.status.elapsedMs = now - this.status.startedAt;
    if (opts?.detail !== undefined) this.status.detail = opts.detail;
    if (opts?.activeTool !== undefined) this.status.activeTool = opts.activeTool;
    if (opts?.iteration !== undefined) this.status.iteration = opts.iteration;

    // Publish immediately for important phase changes
    const importantPhases: AgentPhase[] = [
      'awaiting-confirm',
      'awaiting-user',
      'done',
      'error',
    ];
    if (importantPhases.includes(phase)) {
      this.publishNow();
    } else {
      this.schedulePublish();
    }
  }

  /**
   * Update token usage statistics.
   */
  updateUsage(usage: RunStatus['usage']): void {
    this.status.usage = usage;
    this.schedulePublish();
  }

  /**
   * Update plan items.
   */
  updatePlan(plan: RunStatus['plan']): void {
    this.status.plan = plan;
    this.publishNow(); // Plan updates are user-visible, publish immediately
  }

  /**
   * Set max iterations for progress tracking.
   */
  setMaxIterations(max: number): void {
    this.status.maxIterations = max;
  }

  /**
   * Record the duration of the last step.
   */
  setLastDuration(durationMs: number): void {
    this.status.lastDurationMs = durationMs;
    this.schedulePublish();
  }

  /**
   * Reset to idle state.
   */
  reset(): void {
    if (this.pendingPublish) {
      clearTimeout(this.pendingPublish);
      this.pendingPublish = null;
    }
    this.status = {
      phase: 'idle',
      startedAt: Date.now(),
      elapsedMs: 0,
    };
    this.publishNow();
  }

  /**
   * Get current status (for serialization).
   */
  getStatus(): RunStatus {
    return { ...this.status };
  }

  private schedulePublish(): void {
    if (this.pendingPublish) return; // Already scheduled

    const now = Date.now();
    const timeSinceLastPublish = now - this.lastPublishTime;
    const delay = Math.max(0, this.minPublishInterval - timeSinceLastPublish);

    this.pendingPublish = setTimeout(() => {
      this.publishNow();
    }, delay);
  }

  private publishNow(): void {
    if (this.pendingPublish) {
      clearTimeout(this.pendingPublish);
      this.pendingPublish = null;
    }
    this.lastPublishTime = Date.now();
    this.status.elapsedMs = this.lastPublishTime - this.status.startedAt;
    this.onPublish({ ...this.status });
  }
}

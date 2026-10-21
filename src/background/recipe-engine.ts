import {
  buildRecipeKey,
  canonicalizeUrl,
  hashString,
  landmarkSimilarity,
  pageIdentityMatches,
} from '@/shared/action-cache';
import { RecipeStore } from '@/shared/recipe-storage';
import type {
  ActionExecutionEvidence,
  ActionRecipe,
  PageSnapshot,
  RecipePostcondition,
  RecipeStep,
  Settings,
  ToolCall,
  ToolResult,
} from '@/shared/types';

interface TraceEntry {
  call: ToolCall;
  result: ToolResult;
  before: PageSnapshot | null;
  after: PageSnapshot | null;
  evidence?: ActionExecutionEvidence;
  locator?: RecipeStep['locator'];
}

const DISQUALIFYING_TOOLS = new Set<ToolCall['name']>([
  'ask_user',
  'extract',
  'inspect_html',
  'screenshot',
  'edit_html',
  'execute_javascript',
  'go_back',
]);

export class RecipeEngine {
  private trace: TraceEntry[] = [];
  private disqualified = false;
  private entrySnapshot: PageSnapshot | null = null;

  readonly store: RecipeStore;

  constructor(private settings: Settings) {
    this.store = new RecipeStore(settings.actionCache);
  }

  begin(snapshot: PageSnapshot | null): void {
    this.trace = [];
    this.disqualified = false;
    this.entrySnapshot = snapshot;
  }

  async lookup(goal: string, snapshot: PageSnapshot): Promise<ActionRecipe | null> {
    if (!this.settings.actionCache.enabled) return null;
    const { goalHash } = await buildRecipeKey(goal, snapshot.identity.routeKey);
    const candidates = await this.store.findCandidates(goalHash, snapshot.identity.routeKey);
    const recipe = candidates.find((candidate) => pageIdentityMatches(candidate.entryIdentity, snapshot.identity));
    if (!recipe) {
      await this.store.recordMiss();
      return null;
    }
    await this.store.recordHit();
    return recipe;
  }

  recordExecution(
    call: ToolCall,
    result: ToolResult,
    before: PageSnapshot | null,
    after: PageSnapshot | null,
    evidence?: ActionExecutionEvidence,
  ): void {
    if (DISQUALIFYING_TOOLS.has(call.name) || !result.ok) this.disqualified = true;
    if (call.name === 'type' && Boolean(call.args.submit)) this.disqualified = true;
    const isRecipeAction = ['click', 'type', 'select', 'navigate'].includes(call.name);
    if (!isRecipeAction) return;
    const locator =
      before && typeof call.args.index === 'number'
        ? before.elements.find((element) => element.index === Number(call.args.index))?.locator
        : undefined;
    this.trace.push({ call, result, before, after, evidence, locator });
  }

  disqualify(): void {
    this.disqualified = true;
  }

  async maybeLearn(goal: string): Promise<ActionRecipe | null> {
    if (!this.settings.actionCache.enabled || this.disqualified || !this.entrySnapshot) return null;
    const steps: RecipeStep[] = [];
    for (const entry of this.trace) {
      const step = this.toRecipeStep(entry);
      if (step) steps.push(step);
      else if (['click', 'type', 'select', 'navigate'].includes(entry.call.name)) return null;
    }
    if (steps.length < 2) return null;
    const { goalHash, key } = await buildRecipeKey(goal, this.entrySnapshot.identity.routeKey);
    const now = Date.now();
    const recipe: ActionRecipe = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      key,
      goalHash,
      entryIdentity: {
        canonicalUrl: this.entrySnapshot.identity.canonicalUrl,
        routeKey: this.entrySnapshot.identity.routeKey,
        structureHash: this.entrySnapshot.identity.structureHash,
        landmarkHashes: this.entrySnapshot.identity.landmarkHashes,
      },
      steps,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      expiresAt: now + this.settings.actionCache.ttlDays * 86_400_000,
      useCount: 0,
      successCount: 0,
      divergenceCount: 0,
      quarantined: false,
      byteSize: 0,
    };
    await this.store.upsert(recipe);
    return recipe;
  }

  private toRecipeStep(entry: TraceEntry): RecipeStep | null {
    const { call, before, after, evidence, locator } = entry;
    if (!before || !after || !entry.result.ok) return null;
    if (!['click', 'type', 'select', 'navigate'].includes(call.name)) return null;
    if (call.name === 'type' && (Boolean(call.args.submit) || evidence?.sensitive)) return null;
    if (call.name !== 'navigate' && !locator) return null;

    const postconditions: RecipePostcondition[] = [];
    if (before.identity.canonicalUrl !== after.identity.canonicalUrl) {
      postconditions.push({ kind: 'url', canonicalUrl: after.identity.canonicalUrl });
    }
    if (evidence?.documentIdBefore !== evidence?.documentIdAfter) {
      postconditions.push({ kind: 'document-changed' });
    }
    if (call.name === 'type' || call.name === 'select') {
      if (!evidence?.targetStateAfter) return null;
      postconditions.push({ kind: 'target-state', state: evidence.targetStateAfter });
    }
    if (call.name === 'click' && postconditions.length === 0) {
      const beforeSet = new Set(before.identity.landmarkHashes);
      const added = after.identity.landmarkHashes.filter((hash) => !beforeSet.has(hash)).slice(0, 6);
      const afterSet = new Set(after.identity.landmarkHashes);
      const removed = before.identity.landmarkHashes.filter((hash) => !afterSet.has(hash)).slice(0, 6);
      if (added.length) postconditions.push({ kind: 'landmarks-added', hashes: added });
      if (removed.length) postconditions.push({ kind: 'landmarks-removed', hashes: removed });
    }
    if (postconditions.length === 0) return null;

    const args = { ...call.args };
    delete args.index;
    return {
      id: crypto.randomUUID(),
      tool: call.name as RecipeStep['tool'],
      locator,
      args,
      precondition: {
        canonicalUrl: before.identity.canonicalUrl,
        routeKey: before.identity.routeKey,
        minimumLandmarkSimilarity: 0.8,
        expectedLandmarkHashes: before.identity.landmarkHashes,
        expectedTargetState: evidence?.targetStateBefore,
      },
      postconditions,
    };
  }
}

export function validateRecipePrecondition(step: RecipeStep, snapshot: PageSnapshot): boolean {
  if (
    step.precondition.canonicalUrl !== snapshot.identity.canonicalUrl ||
    step.precondition.routeKey !== snapshot.identity.routeKey
  ) return false;
  if (
    step.precondition.requiredLandmarkHashes?.some(
      (hash) => !snapshot.identity.landmarkHashes.includes(hash),
    )
  ) return false;
  return landmarkSimilarity(
    step.precondition.expectedLandmarkHashes,
    snapshot.identity.landmarkHashes,
  ) >= step.precondition.minimumLandmarkSimilarity;
}

export function validateRecipePostconditions(
  step: RecipeStep,
  before: PageSnapshot,
  after: PageSnapshot,
  evidence?: ActionExecutionEvidence,
): boolean {
  const actual = new Set(after.identity.landmarkHashes);
  const beforeSet = new Set(before.identity.landmarkHashes);
  return step.postconditions.every((condition) => {
    switch (condition.kind) {
      case 'url':
        return canonicalizeUrl(after.url) === condition.canonicalUrl;
      case 'document-changed':
        return Boolean(evidence && evidence.documentIdBefore !== evidence.documentIdAfter);
      case 'target-state':
        return Object.entries(condition.state).every(
          ([key, value]) => value === undefined || evidence?.targetStateAfter?.[key as keyof typeof condition.state] === value,
        );
      case 'landmarks-added':
        return condition.hashes.every((hash) => actual.has(hash) && !beforeSet.has(hash));
      case 'landmarks-removed':
        return condition.hashes.every((hash) => beforeSet.has(hash) && !actual.has(hash));
    }
  });
}

export function recipeContextSimilarity(recipe: ActionRecipe, snapshot: PageSnapshot): number {
  return landmarkSimilarity(recipe.entryIdentity.landmarkHashes, snapshot.identity.landmarkHashes);
}

export function summarizeExecutedRecipe(steps: RecipeStep[]): string {
  return steps.map((step, index) => `${index + 1}. ${step.tool} (${hashString(step.id)})`).join('\n');
}

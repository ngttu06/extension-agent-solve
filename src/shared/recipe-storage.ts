import { DEFAULT_SETTINGS, type ActionCacheSettings, type ActionCacheStats, type ActionRecipe } from './types';
import { CacheOptimizer } from './cache-optimizer';

const INDEX_KEY = 'agent_recipe_index_v1';
const STATS_KEY = 'agent_recipe_stats_v1';
const recipeKey = (id: string) => `agent_recipe_v1_${id}`;

interface RecipeIndexEntry {
  id: string;
  key: string;
  goalHash: string;
  routeKey: string;
  lastUsedAt: number;
  expiresAt: number;
  quarantined: boolean;
  byteSize: number;
}

const EMPTY_STATS: ActionCacheStats = {
  recipeCount: 0,
  byteSize: 0,
  hits: 0,
  misses: 0,
  successfulReplays: 0,
  divergences: 0,
  replayedSteps: 0,
  avoidedModelTurns: 0,
  totalReplayMs: 0,
};

let writeChain: Promise<void> = Promise.resolve();

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function byteSize(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeChain.then(operation, operation);
  writeChain = result.then(() => undefined, () => undefined);
  return result;
}

async function readIndex(): Promise<RecipeIndexEntry[]> {
  const raw = await chrome.storage.local.get(INDEX_KEY);
  return (raw[INDEX_KEY] as RecipeIndexEntry[] | undefined) ?? [];
}

async function readStats(): Promise<ActionCacheStats> {
  const raw = await chrome.storage.local.get(STATS_KEY);
  return { ...EMPTY_STATS, ...(raw[STATS_KEY] as Partial<ActionCacheStats> | undefined) };
}

function validRecipe(value: unknown): value is ActionRecipe {
  if (!value || typeof value !== 'object') return false;
  const recipe = value as Partial<ActionRecipe>;
  return (
    recipe.schemaVersion === 1 &&
    typeof recipe.id === 'string' &&
    typeof recipe.key === 'string' &&
    typeof recipe.goalHash === 'string' &&
    Array.isArray(recipe.steps) &&
    recipe.steps.every((entry) =>
      ['click', 'type', 'select', 'navigate'].includes(String(entry?.tool)),
    )
  );
}

export class RecipeStore {
  // Tối ưu: memory cache để tránh redundant storage queries
  private recipeCache = new CacheOptimizer<string, ActionRecipe>({
    ttl: 60000, // 1 phút
    maxSize: 30,
  });

  private indexCache: RecipeIndexEntry[] | null = null;
  private indexCacheTimestamp = 0;
  private readonly INDEX_CACHE_TTL = 5000; // 5 giây

  constructor(private settings: ActionCacheSettings = DEFAULT_SETTINGS.actionCache) {}

  async findCandidates(goalHash: string, routeKey: string): Promise<ActionRecipe[]> {
    await this.compact();
    const now = Date.now();
    const index = await this.getCachedIndex();
    const matching = index.filter(
      (entry) =>
        entry.goalHash === goalHash &&
        entry.routeKey === routeKey &&
        !entry.quarantined &&
        entry.expiresAt > now,
    );
    if (matching.length === 0) return [];

    // Tối ưu: fetch từ cache trước, rồi mới query storage cho những cái chưa có
    const results: ActionRecipe[] = [];
    const toFetch: string[] = [];

    for (const entry of matching) {
      const cached = await this.recipeCache.get(entry.id, async () => null);
      if (cached) {
        results.push(cached);
      } else {
        toFetch.push(entry.id);
      }
    }

    if (toFetch.length > 0) {
      const raw = await chrome.storage.local.get(toFetch.map((id) => recipeKey(id)));
      for (const id of toFetch) {
        const recipe = raw[recipeKey(id)];
        if (validRecipe(recipe)) {
          this.recipeCache.set(id, recipe);
          results.push(recipe);
        }
      }
    }

    return results.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  async upsert(input: ActionRecipe): Promise<void> {
    await withWriteLock(async () => {
      const recipe = serialize(input);
      recipe.byteSize = byteSize(recipe);
      if (recipe.byteSize > this.settings.maxBytes) return;
      const index = await readIndex();
      const next = index.filter((entry) => entry.id !== recipe.id);
      next.push({
        id: recipe.id,
        key: recipe.key,
        goalHash: recipe.goalHash,
        routeKey: recipe.entryIdentity.routeKey,
        lastUsedAt: recipe.lastUsedAt,
        expiresAt: recipe.expiresAt,
        quarantined: recipe.quarantined,
        byteSize: recipe.byteSize,
      });
      await chrome.storage.local.set({
        [recipeKey(recipe.id)]: recipe,
        [INDEX_KEY]: next,
      });
      await this.compactUnlocked();
    });
  }

  async recordSuccess(recipeId: string, replayedSteps: number, durationMs: number): Promise<void> {
    await withWriteLock(async () => {
      const raw = await chrome.storage.local.get(recipeKey(recipeId));
      const recipe = raw[recipeKey(recipeId)];
      if (!validRecipe(recipe)) return;
      const now = Date.now();
      recipe.lastUsedAt = now;
      recipe.updatedAt = now;
      recipe.useCount += 1;
      recipe.successCount += 1;
      await this.writeRecipeUnlocked(recipe);
      const stats = await readStats();
      stats.successfulReplays += 1;
      stats.replayedSteps += replayedSteps;
      stats.avoidedModelTurns += Math.max(1, replayedSteps);
      stats.totalReplayMs += durationMs;
      await chrome.storage.local.set({ [STATS_KEY]: stats });
    });
  }

  async recordHit(): Promise<void> {
    await this.updateStats((stats) => { stats.hits += 1; });
  }

  async recordMiss(): Promise<void> {
    await this.updateStats((stats) => { stats.misses += 1; });
  }

  async recordDivergence(recipeId: string): Promise<void> {
    await withWriteLock(async () => {
      const raw = await chrome.storage.local.get(recipeKey(recipeId));
      const recipe = raw[recipeKey(recipeId)];
      if (validRecipe(recipe)) {
        recipe.quarantined = true;
        recipe.divergenceCount += 1;
        recipe.updatedAt = Date.now();
        await this.writeRecipeUnlocked(recipe);
      }
      const stats = await readStats();
      stats.divergences += 1;
      await chrome.storage.local.set({ [STATS_KEY]: stats });
    });
  }

  async getStats(): Promise<ActionCacheStats> {
    await this.compact();
    const [stats, index] = await Promise.all([readStats(), readIndex()]);
    return {
      ...stats,
      recipeCount: index.length,
      byteSize: index.reduce((sum, entry) => sum + entry.byteSize, 0),
    };
  }

  async clear(): Promise<void> {
    await withWriteLock(async () => {
      const index = await readIndex();
      await chrome.storage.local.remove([
        INDEX_KEY,
        STATS_KEY,
        ...index.map((entry) => recipeKey(entry.id)),
      ]);
      // Tối ưu: clear memory caches
      this.recipeCache.clear();
      this.invalidateIndexCache();
    });
  }

  async compact(): Promise<void> {
    await withWriteLock(() => this.compactUnlocked());
  }

  private async writeRecipeUnlocked(recipe: ActionRecipe): Promise<void> {
    recipe.byteSize = byteSize(recipe);
    const index = await readIndex();
    const next = index.filter((entry) => entry.id !== recipe.id);
    next.push({
      id: recipe.id,
      key: recipe.key,
      goalHash: recipe.goalHash,
      routeKey: recipe.entryIdentity.routeKey,
      lastUsedAt: recipe.lastUsedAt,
      expiresAt: recipe.expiresAt,
      quarantined: recipe.quarantined,
      byteSize: recipe.byteSize,
    });
    await chrome.storage.local.set({ [recipeKey(recipe.id)]: recipe, [INDEX_KEY]: next });

    // Tối ưu: update caches
    this.recipeCache.set(recipe.id, recipe);
    this.invalidateIndexCache();
  }

  // Tối ưu: helper methods for index caching
  private async getCachedIndex(): Promise<RecipeIndexEntry[]> {
    const now = Date.now();
    if (this.indexCache && now - this.indexCacheTimestamp < this.INDEX_CACHE_TTL) {
      return this.indexCache;
    }
    const index = await readIndex();
    this.indexCache = index;
    this.indexCacheTimestamp = now;
    return index;
  }

  private invalidateIndexCache(): void {
    this.indexCache = null;
    this.indexCacheTimestamp = 0;
  }

  private async updateStats(update: (stats: ActionCacheStats) => void): Promise<void> {
    await withWriteLock(async () => {
      const stats = await readStats();
      update(stats);
      await chrome.storage.local.set({ [STATS_KEY]: stats });
    });
  }

  private async compactUnlocked(): Promise<void> {
    const now = Date.now();
    const index = await readIndex();
    const expired = index.filter((entry) => entry.expiresAt <= now);
    let keep = index
      .filter((entry) => entry.expiresAt > now)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    let total = keep.reduce((sum, entry) => sum + entry.byteSize, 0);
    const evicted: RecipeIndexEntry[] = [...expired];
    while (keep.length > this.settings.maxRecipes || total > this.settings.maxBytes) {
      const entry = keep.pop();
      if (!entry) break;
      total -= entry.byteSize;
      evicted.push(entry);
    }
    if (evicted.length > 0 || keep.length !== index.length) {
      await chrome.storage.local.remove(evicted.map((entry) => recipeKey(entry.id)));
      await chrome.storage.local.set({ [INDEX_KEY]: keep });
    }
  }
}

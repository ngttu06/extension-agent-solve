import type { PageIdentity } from '@/shared/types';

const OVERLAY_SELECTOR = '[data-agent-overlay="true"]';
const documentId = crypto.randomUUID();
let revision = 0;
let lastChangedAt = performance.now();
let started = false;

function belongsToOverlay(node: Node | null): boolean {
  if (!node) return false;
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(OVERLAY_SELECTOR));
}

export function markPageStateChanged(): void {
  revision += 1;
  lastChangedAt = performance.now();
}

export function getPageState(): { documentId: string; revision: number } {
  return { documentId, revision };
}

export function startPageStateTracker(): void {
  if (started) return;
  started = true;
  const observer = new MutationObserver((records) => {
    if (
      records.every(
        (record) =>
          belongsToOverlay(record.target) &&
          Array.from(record.addedNodes).every(belongsToOverlay) &&
          Array.from(record.removedNodes).every(belongsToOverlay),
      )
    ) return;
    markPageStateChanged();
  });
  const root = document.documentElement;
  if (root) {
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'aria-checked',
        'aria-disabled',
        'aria-expanded',
        'aria-pressed',
        'checked',
        'class',
        'disabled',
        'hidden',
        'href',
        'selected',
        'style',
        'value',
      ],
    });
  }
  for (const event of ['input', 'change', 'scroll', 'resize', 'popstate', 'hashchange']) {
    window.addEventListener(event, markPageStateChanged, { capture: true, passive: true });
  }
}

export async function waitForPageQuiet(
  quietMs = 100,
  timeoutMs = 1400,
): Promise<{ settled: boolean }> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const elapsedSinceChange = performance.now() - lastChangedAt;
    if (elapsedSinceChange >= quietMs) return { settled: true };
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(quietMs, 25)));
  }
  return { settled: false };
}

export function withPageState(identity: Omit<PageIdentity, 'documentId' | 'revision'>): PageIdentity {
  return { documentId, revision, ...identity };
}

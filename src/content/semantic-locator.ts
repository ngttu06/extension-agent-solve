import type { RecipeToolName, SemanticLocator } from '@/shared/types';

export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa'];
const MAX_NAME = 200;

export interface LocatorResolution {
  status: 'resolved' | 'not-found' | 'ambiguous' | 'incompatible';
  element?: HTMLElement;
  score?: number;
  runnerUpScore?: number;
  reason?: string;
}

export function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function accessibleName(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim().slice(0, MAX_NAME);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return text.replace(/\s+/g, ' ').slice(0, MAX_NAME);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const text = Array.from(el.labels ?? [])
      .map((label) => label.innerText || label.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.slice(0, MAX_NAME);
  }
  return (
    el.getAttribute('title') ||
    el.getAttribute('placeholder') ||
    el.innerText ||
    el.textContent ||
    ''
  ).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

export function normalizeAccessibleName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isStableAttribute(_name: string, value: string): boolean {
  if (!value || value.length > 120) return false;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) return false;
  if (/^[a-z0-9_-]*\d{8,}[a-z0-9_-]*$/i.test(value)) return false;
  if (/^[a-f0-9]{16,}$/i.test(value)) return false;
  return true;
}

function firstStableAttribute(el: HTMLElement, names: string[]): string | undefined {
  for (const name of names) {
    const value = el.getAttribute(name);
    if (value && isStableAttribute(name, value)) return value.slice(0, 120);
  }
  return undefined;
}

export function buildSemanticLocator(el: HTMLElement, ordinalHint?: number): SemanticLocator {
  const ancestors: NonNullable<SemanticLocator['ancestors']> = [];
  let ancestor = el.parentElement;
  while (ancestor && ancestors.length < 3) {
    const name = accessibleName(ancestor);
    const id = firstStableAttribute(ancestor, ['id']);
    const role = ancestor.getAttribute('role') ?? undefined;
    if (id || role || name) {
      ancestors.push({
        tag: ancestor.tagName.toLowerCase(),
        role,
        accessibleName: name || undefined,
        id,
      });
    }
    ancestor = ancestor.parentElement;
  }
  return {
    version: 1,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? undefined,
    accessibleName: accessibleName(el) || undefined,
    attributes: {
      id: firstStableAttribute(el, ['id']),
      name: firstStableAttribute(el, ['name']),
      type: el.getAttribute('type') ?? undefined,
      autocomplete: el.getAttribute('autocomplete') ?? undefined,
      placeholder: el.getAttribute('placeholder') ?? undefined,
      href: el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href') ?? undefined,
      testId: firstStableAttribute(el, TEST_ID_ATTRIBUTES),
    },
    ancestors: ancestors.length ? ancestors : undefined,
    ordinalHint,
  };
}

function compatible(tool: RecipeToolName, el: HTMLElement): boolean {
  if (tool === 'click') return true;
  if (tool === 'select') return el instanceof HTMLSelectElement;
  if (tool === 'type') {
    if (el instanceof HTMLInputElement) {
      return !['button', 'checkbox', 'file', 'hidden', 'radio', 'reset', 'submit'].includes(el.type);
    }
    return el instanceof HTMLTextAreaElement || el.isContentEditable;
  }
  return false;
}

function scoreCandidate(locator: SemanticLocator, el: HTMLElement, index: number): number {
  const attrs = locator.attributes;
  let score = 0;
  const testId = firstStableAttribute(el, TEST_ID_ATTRIBUTES);
  if (attrs.testId && testId === attrs.testId) score += 120;
  const id = firstStableAttribute(el, ['id']);
  if (attrs.id && id === attrs.id) score += 100;
  if (locator.tag === el.tagName.toLowerCase()) score += 15;
  if (locator.role && locator.role === el.getAttribute('role')) score += 25;
  if (attrs.type && attrs.type === el.getAttribute('type')) score += 25;
  if (attrs.name && attrs.name === el.getAttribute('name')) score += 45;
  if (attrs.autocomplete && attrs.autocomplete === el.getAttribute('autocomplete')) score += 20;
  if (attrs.placeholder && normalizeAccessibleName(attrs.placeholder) === normalizeAccessibleName(el.getAttribute('placeholder') ?? '')) score += 20;
  if (attrs.href) {
    const href = el instanceof HTMLAnchorElement ? el.href : el.getAttribute('href') ?? '';
    if (href === attrs.href) score += 35;
  }
  if (
    locator.accessibleName &&
    normalizeAccessibleName(locator.accessibleName) === normalizeAccessibleName(accessibleName(el))
  ) score += 55;
  let current = el.parentElement;
  for (const expected of locator.ancestors ?? []) {
    if (!current) break;
    if (expected.tag === current.tagName.toLowerCase()) score += 4;
    if (expected.id && expected.id === firstStableAttribute(current, ['id'])) score += 16;
    if (expected.role && expected.role === current.getAttribute('role')) score += 8;
    if (
      expected.accessibleName &&
      normalizeAccessibleName(expected.accessibleName) === normalizeAccessibleName(accessibleName(current))
    ) score += 6;
    current = current.parentElement;
  }
  if (locator.ordinalHint === index) score += 2;
  return score;
}

export function resolveSemanticLocator(
  locator: SemanticLocator,
  tool: Exclude<RecipeToolName, 'navigate'>,
): LocatorResolution {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR))
    .filter((element) =>
      element.isConnected &&
      isVisible(element) &&
      !element.closest('[data-agent-overlay="true"]') &&
      element.getAttribute('aria-disabled') !== 'true' &&
      (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) || !element.disabled),
    )
    .map((element, index) => ({ element, score: scoreCandidate(locator, element, index) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return { status: 'not-found', reason: 'No visible matching element.' };
  const [best, runnerUp] = candidates;
  if (!compatible(tool, best.element)) {
    return { status: 'incompatible', score: best.score, reason: `Target is incompatible with ${tool}.` };
  }
  const minimum = locator.attributes.id || locator.attributes.testId ? 100 : 70;
  const margin = runnerUp ? best.score - runnerUp.score : best.score;
  if (best.score < minimum || (runnerUp && margin < 12)) {
    return {
      status: 'ambiguous',
      score: best.score,
      runnerUpScore: runnerUp?.score,
      reason: 'Semantic locator is not unique enough.',
    };
  }
  return {
    status: 'resolved',
    element: best.element,
    score: best.score,
    runnerUpScore: runnerUp?.score,
  };
}

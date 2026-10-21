import { buildPageIdentity } from '@/shared/action-cache';
import type { PageElement, PageSnapshot } from '@/shared/types';
import { getPageState } from './page-state';
import {
  accessibleName,
  buildSemanticLocator,
  INTERACTIVE_SELECTOR,
  isVisible,
} from './semantic-locator';

const MAX_ELEMENTS = 150;
const MAX_TEXT_LENGTH = 8000;

/** The element a user actually sees/clicks for a registered index. */
export function getVisualElement(el: HTMLElement): HTMLElement {
  if (isFormChoice(el) && !isVisible(el)) return visibleLabelFor(el) ?? el;
  return el;
}

let elementRegistry: HTMLElement[] = [];
let cachedSnapshot: PageSnapshot | null = null;

export function getElementByIndex(index: number): HTMLElement | undefined {
  return elementRegistry[index];
}

export function getIndexForElement(element: HTMLElement): number {
  return elementRegistry.indexOf(element);
}

function isFormChoice(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
}

function visibleLabelFor(el: HTMLInputElement): HTMLElement | null {
  for (const label of Array.from(el.labels ?? [])) if (isVisible(label)) return label;
  const wrapping = el.closest('label');
  return wrapping instanceof HTMLElement && isVisible(wrapping) ? wrapping : null;
}

function isInViewport(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function collectAttributes(el: HTMLElement): Record<string, string> {
  const keys = [
    'id',
    'name',
    'type',
    'href',
    'placeholder',
    'aria-label',
    'role',
    'autocomplete',
    'inputmode',
  ];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = el.getAttribute(key);
    if (value) out[key] = value.slice(0, 120);
  }
  if (isFormChoice(el)) out.checked = el.checked ? 'true' : 'false';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.disabled) out.disabled = 'true';
    if (el.required) out.required = 'true';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.readOnly) out.readonly = 'true';
    if (el.maxLength >= 0) out.maxlength = String(el.maxLength);
    if (el.value && !(el instanceof HTMLInputElement && el.type === 'password')) {
      out.value = el.value.slice(0, 120);
    }
  }
  if (el.isContentEditable) out.contenteditable = el.getAttribute('contenteditable') || 'true';
  return out;
}

export function observe(): PageSnapshot {
  const pageState = getPageState();
  if (
    cachedSnapshot?.identity.documentId === pageState.documentId &&
    cachedSnapshot.identity.revision === pageState.revision
  ) return cachedSnapshot;

  elementRegistry = [];
  const elements: PageElement[] = [];
  const seen = new Set<HTMLElement>();
  const nodeList = document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
  let index = 0;
  for (const el of Array.from(nodeList)) {
    if (index >= MAX_ELEMENTS) break;
    if (seen.has(el) || el.closest('[data-agent-overlay="true"]')) continue;

    let visual: HTMLElement = el;
    if (isFormChoice(el) && !isVisible(el)) {
      const label = visibleLabelFor(el);
      if (!label) continue;
      visual = label;
      seen.add(label);
    } else if (!isVisible(el)) {
      continue;
    }

    seen.add(el);
    const rect = visual.getBoundingClientRect();
    elementRegistry[index] = el;
    elements.push({
      index,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? undefined,
      text: accessibleName(visual),
      attributes: collectAttributes(el),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      inViewport: isInViewport(rect),
      locator: buildSemanticLocator(el, index),
    });
    index += 1;
  }

  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const base = {
    url: location.href,
    title: document.title,
    text: bodyText.slice(0, MAX_TEXT_LENGTH),
    elements,
    needsVision:
      bodyText.length < 200 &&
      (document.querySelectorAll('canvas').length > 0 || elements.length === 0),
  };
  cachedSnapshot = {
    ...base,
    identity: buildPageIdentity(base, pageState.documentId, pageState.revision),
    capturedAt: Date.now(),
  };
  return cachedSnapshot;
}

import type { PageElement, PageSnapshot } from '@/shared/types';

/** The element a user actually sees/clicks for a registered index (the visible
 * label for a hidden radio/checkbox, otherwise the element itself). */
export function getVisualElement(el: HTMLElement): HTMLElement {
  if (isFormChoice(el) && !isVisible(el)) {
    return visibleLabelFor(el) ?? el;
  }
  return el;
}

const INTERACTIVE_SELECTOR = [
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

const MAX_ELEMENTS = 150;
const MAX_TEXT_LENGTH = 8000;
const MAX_ELEMENT_TEXT = 200;

/**
 * Registry mapping the index assigned in a snapshot to the live DOM element.
 * Rebuilt on each observe() so indices always reference the current DOM.
 */
let elementRegistry: HTMLElement[] = [];

export function getElementByIndex(index: number): HTMLElement | undefined {
  return elementRegistry[index];
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isFormChoice(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
}

/**
 * Radio/checkbox inputs are usually visually hidden (0×0, opacity:0) with a
 * styled <label> doing the visible rendering. Find that label so we can index
 * and highlight the thing the user actually sees. Clicking the hidden input
 * itself still toggles it natively, so the registry keeps pointing at the input.
 */
function visibleLabelFor(el: HTMLInputElement): HTMLElement | null {
  const labels = el.labels ? Array.from(el.labels) : [];
  for (const label of labels) {
    if (isVisible(label)) return label;
  }
  const wrapping = el.closest('label');
  if (wrapping instanceof HTMLElement && isVisible(wrapping)) return wrapping;
  return null;
}

function isInViewport(rect: DOMRect): boolean {
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function accessibleName(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelledText = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (labelledText) return labelledText.slice(0, MAX_ELEMENT_TEXT);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labelText = Array.from(el.labels ?? [])
      .map((label) => label.innerText || label.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (labelText) return labelText.slice(0, MAX_ELEMENT_TEXT);
  }
  const title = el.getAttribute('title');
  const placeholder = el.getAttribute('placeholder');
  const value =
    el instanceof HTMLInputElement && el.type !== 'password'
      ? el.value
      : el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
        ? el.value
        : '';
  const text = (el.innerText || el.textContent || '').trim();
  return (text || title || placeholder || value || '').slice(0, MAX_ELEMENT_TEXT).trim();
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
    const v = el.getAttribute(key);
    if (v) out[key] = v.slice(0, 120);
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

/** Build a snapshot of the current page: text + indexed interactive elements. */
export function observe(): PageSnapshot {
  elementRegistry = [];
  const elements: PageElement[] = [];

  const nodeList = document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
  const seen = new Set<HTMLElement>();
  let index = 0;
  for (const el of Array.from(nodeList)) {
    if (index >= MAX_ELEMENTS) break;
    if (seen.has(el)) continue;

    // A visually-hidden radio/checkbox: index it via its visible label so the
    // agent can see and target it, but keep the input in the registry so that
    // clicking it toggles the choice natively.
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
    });
    index += 1;
  }

  const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const text = bodyText.slice(0, MAX_TEXT_LENGTH);

  // Heuristic: if there is very little readable text but the page has canvas or
  // many images, DOM perception is likely insufficient — advise vision.
  const canvasCount = document.querySelectorAll('canvas').length;
  const needsVision = bodyText.length < 200 && (canvasCount > 0 || elements.length === 0);

  return {
    url: location.href,
    title: document.title,
    text,
    elements,
    needsVision,
    capturedAt: Date.now(),
  };
}

import type {
  ActionExecutionEvidence,
  RecipeStep,
  TargetState,
  ToolResult,
} from '@/shared/types';
import { getElementByIndex, getIndexForElement, getVisualElement, observe } from './perception';
import { getPageState, markPageStateChanged, waitForPageQuiet } from './page-state';
import { pointAt } from './overlay';
import { buildSemanticLocator, isVisible, resolveSemanticLocator } from './semantic-locator';

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

const UNSUPPORTED_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

type HtmlEditMode = 'inner' | 'outer' | 'append' | 'prepend' | 'before' | 'after' | 'remove';

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}\n… [truncated ${value.length - maxLength} characters]`
    : value;
}

/** Read runtime DOM markup without exposing an unbounded page to the model. */
export function inspectHtml(
  selector: string,
  outer = true,
  requestedMaxLength = 8000,
): { ok: boolean; content: string } {
  const maxLength = Math.max(100, Math.min(Number(requestedMaxLength) || 8000, 20000));
  let matches: Element[];
  try {
    matches = Array.from(document.querySelectorAll(selector));
  } catch (err) {
    return { ok: false, content: `Invalid CSS selector "${selector}": ${String(err)}` };
  }
  if (matches.length === 0) return { ok: false, content: `No elements match "${selector}".` };

  const markup = matches
    .slice(0, 20)
    .map((el, index) => `--- match ${index + 1} ---\n${outer ? el.outerHTML : el.innerHTML}`)
    .join('\n');
  return {
    ok: true,
    content: `${matches.length} element(s) matched "${selector}".\n${truncate(markup, maxLength)}`,
  };
}

/** Apply an explicit runtime DOM edit. Reloading the page normally reverts it. */
export function editHtml(
  selector: string,
  mode: HtmlEditMode,
  html = '',
  all = false,
): { ok: boolean; content: string } {
  let matches: Element[];
  try {
    matches = Array.from(document.querySelectorAll(selector));
  } catch (err) {
    return { ok: false, content: `Invalid CSS selector "${selector}": ${String(err)}` };
  }
  if (matches.length === 0) return { ok: false, content: `No elements match "${selector}".` };
  if (!['inner', 'outer', 'append', 'prepend', 'before', 'after', 'remove'].includes(mode)) {
    return { ok: false, content: `Unsupported HTML edit mode "${mode}".` };
  }
  if (mode !== 'remove' && typeof html !== 'string') {
    return { ok: false, content: `Mode "${mode}" requires an html string.` };
  }

  const targets = matches.slice(0, all ? 50 : 1);
  try {
    for (const el of targets) {
      switch (mode) {
        case 'inner':
          el.innerHTML = html;
          break;
        case 'outer':
          el.outerHTML = html;
          break;
        case 'append':
          el.insertAdjacentHTML('beforeend', html);
          break;
        case 'prepend':
          el.insertAdjacentHTML('afterbegin', html);
          break;
        case 'before':
          el.insertAdjacentHTML('beforebegin', html);
          break;
        case 'after':
          el.insertAdjacentHTML('afterend', html);
          break;
        case 'remove':
          el.remove();
          break;
      }
    }
  } catch (err) {
    return { ok: false, content: `Could not edit HTML: ${String(err)}` };
  }
  return {
    ok: true,
    content: `Applied "${mode}" to ${targets.length} element(s) matching "${selector}". Re-observe the page to verify the result.`,
  };
}

/** Briefly highlight an element so the user can see what the agent touches. */
export function highlight(index: number): void {
  const registered = getElementByIndex(index);
  if (!registered) return;
  const el = getVisualElement(registered);
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = '3px solid #6366f1';
  el.style.outlineOffset = '2px';
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  }, 1200);
}

function elementLabel(el: HTMLElement): string {
  const visual = getVisualElement(el);
  const name = (el.getAttribute('aria-label') || visual.innerText || visual.textContent || '')
    .trim()
    .slice(0, 60);
  return `<${el.tagName.toLowerCase()}${name ? ` "${name}"` : ''}>`;
}

export async function clickElement(index: number): Promise<{ ok: boolean; content: string }> {
  const el = getElementByIndex(index);
  if (!el) return { ok: false, content: `No element at index ${index}.` };
  highlight(index);
  pointAt(getVisualElement(el));
  el.focus?.();
  el.click();
  return { ok: true, content: `Clicked ${elementLabel(el)} at index ${index}.` };
}

export async function typeIntoElement(
  index: number,
  text: string,
  submit?: boolean,
): Promise<{ ok: boolean; content: string }> {
  const el = getElementByIndex(index);
  if (!el) return { ok: false, content: `No element at index ${index}.` };
  if (!el.isConnected) {
    return { ok: false, content: `Element at index ${index} is stale. Observe the page again.` };
  }
  if (el instanceof HTMLInputElement && UNSUPPORTED_INPUT_TYPES.has(el.type)) {
    return { ok: false, content: `Input type "${el.type}" cannot be filled with text.` };
  }
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    (el.disabled || el.readOnly)
  ) {
    return {
      ok: false,
      content: `Element at index ${index} is ${el.disabled ? 'disabled' : 'read-only'}.`,
    };
  }
  if (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true') {
    return { ok: false, content: `Element at index ${index} is not editable.` };
  }
  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    el.maxLength >= 0 &&
    text.length > el.maxLength
  ) {
    return {
      ok: false,
      content: `Text has ${text.length} characters but element #${index} allows at most ${el.maxLength}.`,
    };
  }
  highlight(index);
  pointAt(getVisualElement(el));
  el.focus?.();

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    if (!setter) {
      return { ok: false, content: `Could not resolve the native value setter for element #${index}.` };
    }
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: 'insertReplacementText',
    });
    if (!el.dispatchEvent(beforeInput)) {
      return { ok: false, content: `The page prevented input into element #${index}.` };
    }
    setter.call(el, text);
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: text,
        inputType: 'insertReplacementText',
      }),
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(50);
    if (el.value !== text) {
      return {
        ok: false,
        content: `The page did not retain the requested value in element #${index}. Current value length: ${el.value.length}.`,
      };
    }
  } else if (el.isContentEditable) {
    // Select existing content so the first insert replaces it, then insert the
    // full string in one go. execCommand('insertText') fires native beforeinput/
    // input events that rich editors (Lexical, Draft.js, ...) rely on, keeping all
    // Unicode characters intact. Setting textContent per keystroke corrupts the
    // editor's managed DOM and drops everything after the first character.
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: 'insertText',
    });
    if (!el.dispatchEvent(beforeInput)) {
      return { ok: false, content: `The page prevented input into element #${index}.` };
    }
    const before = el.innerHTML;
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted || el.innerHTML === before) {
      el.textContent = text;
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: text,
          inputType: 'insertText',
        }),
      );
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(50);
    if ((el.innerText || el.textContent || '') !== text) {
      return {
        ok: false,
        content: `The editable element #${index} did not retain the requested text.`,
      };
    }
  } else {
    return { ok: false, content: `Element at index ${index} is not editable.` };
  }

  if (submit) {
    const form = el.closest('form');
    if (form instanceof HTMLFormElement) {
      if (!form.checkValidity()) {
        return {
          ok: false,
          content: `Filled element #${index}, but the form is invalid and was not submitted.`,
        };
      }
      form.requestSubmit();
    } else {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
  }

  const sensitive = el instanceof HTMLInputElement && el.type === 'password';
  return {
    ok: true,
    content: `Filled ${text.length} character(s) into ${elementLabel(el)}${
      sensitive ? ' (value hidden)' : ''
    }${submit ? ' and submitted' : ''}.`,
  };
}

export async function selectOption(
  index: number,
  value: string,
): Promise<{ ok: boolean; content: string }> {
  const el = getElementByIndex(index);
  if (!(el instanceof HTMLSelectElement)) {
    return { ok: false, content: `Element at index ${index} is not a <select>.` };
  }
  highlight(index);
  pointAt(el);
  const options = Array.from(el.options);
  const match =
    options.find((o) => o.value === value) ||
    options.find((o) => o.text.trim().toLowerCase() === value.trim().toLowerCase());
  if (!match) {
    return { ok: false, content: `No option matching "${value}" in select at index ${index}.` };
  }
  el.value = match.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, content: `Selected "${match.text}" in select at index ${index}.` };
}

export function scrollPage(direction: 'up' | 'down' | 'top' | 'bottom'): {
  ok: boolean;
  content: string;
} {
  const amount = window.innerHeight * 0.85;
  switch (direction) {
    case 'up':
      window.scrollBy({ top: -amount, behavior: 'smooth' });
      break;
    case 'down':
      window.scrollBy({ top: amount, behavior: 'smooth' });
      break;
    case 'top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'bottom':
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      break;
  }
  return { ok: true, content: `Scrolled ${direction}.` };
}

/** Extract page text relevant to a query (naive keyword windowing). */
export function extract(query: string): { ok: boolean; content: string } {
  const snapshot = observe();
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const sentences = snapshot.text.split(/(?<=[.!?])\s+/);
  const scored = sentences
    .map((s) => ({
      s,
      score: words.reduce((acc, w) => acc + (s.toLowerCase().includes(w) ? 1 : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((x) => x.s);

  const content = scored.length
    ? scored.join('\n')
    : `No direct matches. Page excerpt:\n${snapshot.text.slice(0, 1500)}`;
  return { ok: true, content };
}

function hashValue(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function captureTargetState(el: HTMLElement): TargetState {
  const editable =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable;
  const rawValue =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.value
      : el.isContentEditable
        ? el.innerText || el.textContent || ''
        : '';
  return {
    visible: isVisible(el),
    enabled:
      el.getAttribute('aria-disabled') !== 'true' &&
      (!(el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.disabled),
    editable,
    valueHash: editable && !(el instanceof HTMLInputElement && el.type === 'password')
      ? hashValue(rawValue)
      : undefined,
    selectedValue: el instanceof HTMLSelectElement ? el.value : undefined,
    checked: el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type) ? el.checked : undefined,
    pressed: el.hasAttribute('aria-pressed') ? el.getAttribute('aria-pressed') === 'true' : undefined,
    expanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') === 'true' : undefined,
  };
}

export function isSensitiveElement(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
  const signals = [
    el instanceof HTMLInputElement ? el.type : '',
    el.name,
    el.id,
    el.autocomplete,
    el.placeholder,
    el.getAttribute('aria-label') ?? '',
  ].join(' ').toLowerCase();
  return /password|passcode|otp|one.?time|credit|card|cvv|cvc|security.?code|token|secret/.test(signals);
}

function sameTargetState(expected: TargetState, actual: TargetState): boolean {
  for (const key of Object.keys(expected) as Array<keyof TargetState>) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) return false;
  }
  return true;
}

export async function executeIndexedAction(
  tool: 'click' | 'type' | 'select',
  index: number,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; content: string; evidence?: ActionExecutionEvidence }> {
  const snapshot = observe();
  const element = getElementByIndex(index);
  const locator = snapshot.elements.find((candidate) => candidate.index === index)?.locator;
  if (!element || !locator) return { ok: false, content: `No element at index ${index}.` };
  const beforePage = getPageState();
  const before = captureTargetState(element);
  const sensitive = isSensitiveElement(element);
  const started = performance.now();
  let outcome: { ok: boolean; content: string };
  if (tool === 'click') outcome = await clickElement(index);
  else if (tool === 'type') outcome = await typeIntoElement(index, String(args.text ?? ''), Boolean(args.submit));
  else outcome = await selectOption(index, String(args.value ?? ''));
  if (!outcome.ok) return outcome;
  markPageStateChanged();
  const quiet = await waitForPageQuiet();
  const afterSnapshot = observe();
  const afterPage = getPageState();
  return {
    ...outcome,
    evidence: {
      documentIdBefore: beforePage.documentId,
      documentIdAfter: afterPage.documentId,
      revisionBefore: beforePage.revision,
      revisionAfter: afterPage.revision,
      urlBefore: snapshot.url,
      urlAfter: afterSnapshot.url,
      resolvedLocator: locator,
      targetStateBefore: before,
      targetStateAfter: element.isConnected ? captureTargetState(element) : undefined,
      identityAfter: afterSnapshot.identity,
      settled: quiet.settled,
      sensitive,
      durationMs: Math.round(performance.now() - started),
    },
  };
}

export async function executeRecipeAction(step: RecipeStep): Promise<{
  ok: boolean;
  content: string;
  evidence?: ActionExecutionEvidence;
}> {
  if (step.tool === 'navigate') {
    return { ok: false, content: 'Navigation recipe actions execute in the background context.' };
  }
  if (!step.locator) return { ok: false, content: 'Recipe target has no semantic locator.' };
  observe();
  const resolution = resolveSemanticLocator(step.locator, step.tool);
  if (resolution.status !== 'resolved' || !resolution.element) {
    return { ok: false, content: resolution.reason ?? `Could not resolve recipe target (${resolution.status}).` };
  }
  const element = resolution.element;
  const index = getIndexForElement(element);
  if (index < 0) return { ok: false, content: 'Resolved target is not bound to the current snapshot.' };
  const beforePage = getPageState();
  const beforeSnapshot = observe();
  const before = captureTargetState(element);
  if (step.precondition.expectedTargetState && !sameTargetState(step.precondition.expectedTargetState, before)) {
    return { ok: false, content: 'Target precondition no longer matches the current page.' };
  }
  const started = performance.now();
  let outcome: { ok: boolean; content: string };
  switch (step.tool) {
    case 'click':
      outcome = await clickElement(index);
      break;
    case 'type':
      outcome = await typeIntoElement(index, String(step.args.text ?? ''), false);
      break;
    case 'select':
      outcome = await selectOption(index, String(step.args.value ?? ''));
      break;
  }
  if (!outcome.ok) return outcome;
  markPageStateChanged();
  const quiet = await waitForPageQuiet();
  const afterSnapshot = observe();
  const afterPage = getPageState();
  const after = element.isConnected ? captureTargetState(element) : undefined;
  return {
    ok: true,
    content: outcome.content,
    evidence: {
      documentIdBefore: beforePage.documentId,
      documentIdAfter: afterPage.documentId,
      revisionBefore: beforePage.revision,
      revisionAfter: afterPage.revision,
      urlBefore: beforeSnapshot.url,
      urlAfter: afterSnapshot.url,
      resolvedLocator: buildSemanticLocator(element, index),
      locatorScore: resolution.score,
      targetStateBefore: before,
      targetStateAfter: after,
      identityAfter: afterSnapshot.identity,
      settled: quiet.settled,
      sensitive: isSensitiveElement(element),
      durationMs: Math.round(performance.now() - started),
    },
  };
}

/** Build a ToolResult wrapper for an action outcome. */
export function toResult(
  id: string,
  name: ToolResult['name'],
  outcome: { ok: boolean; content: string },
): ToolResult {
  return { id, name, ok: outcome.ok, content: outcome.content };
}

import { beforeEach, describe, expect, it } from 'vitest';
import { buildSemanticLocator, resolveSemanticLocator } from './semantic-locator';

describe('semantic locator', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves a stable target after DOM reorder', () => {
    document.body.innerHTML = `
      <button data-testid="secondary">Other</button>
      <button data-testid="save-button">Save</button>
    `;
    const save = document.querySelector('[data-testid="save-button"]') as HTMLElement;
    const locator = buildSemanticLocator(save, 1);
    document.body.prepend(save);
    const result = resolveSemanticLocator(locator, 'click');
    expect(result.status).toBe('resolved');
    expect(result.element).toBe(save);
  });

  it('fails closed for duplicate semantic targets', () => {
    document.body.innerHTML = '<button>Delete</button><button>Delete</button>';
    const locator = buildSemanticLocator(document.querySelector('button') as HTMLElement, 0);
    const result = resolveSemanticLocator(locator, 'click');
    expect(result.status).toBe('ambiguous');
  });

  it('does not resolve disabled targets', () => {
    document.body.innerHTML = '<button id="save" disabled>Save</button>';
    const locator = buildSemanticLocator(document.querySelector('button') as HTMLElement);
    expect(resolveSemanticLocator(locator, 'click').status).toBe('not-found');
  });
});

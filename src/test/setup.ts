import { vi } from 'vitest';

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
  },
});

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    return { x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 32, width: 120, height: 32 };
  },
});

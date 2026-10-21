import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pointAt, setVirtualCursorEnabled } from './overlay';

describe('virtual cursor preference', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body><button>Save</button></body>';
    setVirtualCursorEnabled(true);
    vi.useFakeTimers();
  });

  it('does not create the cursor or ripple while disabled', () => {
    const button = document.querySelector('button') as HTMLElement;
    setVirtualCursorEnabled(false);
    pointAt(button);
    vi.runAllTimers();
    expect(document.getElementById('agent-virtual-cursor')).toBeNull();
    expect(document.querySelector('[data-agent-cursor-ripple="true"]')).toBeNull();
  });

  it('shows the cursor when enabled again', () => {
    const button = document.querySelector('button') as HTMLElement;
    setVirtualCursorEnabled(false);
    setVirtualCursorEnabled(true);
    pointAt(button);
    expect(document.getElementById('agent-virtual-cursor')).not.toBeNull();
  });
});

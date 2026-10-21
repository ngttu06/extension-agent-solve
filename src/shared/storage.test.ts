import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from './storage';

const getMock = chrome.storage.local.get as ReturnType<typeof vi.fn>;

describe('visual settings migration', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('enables visual effects for settings saved before the fields existed', async () => {
    getMock.mockResolvedValue({
      agent_settings: { mode: 'auto', maxSteps: 10 },
    });
    const settings = await loadSettings();
    expect(settings.showVirtualCursor).toBe(true);
    expect(settings.showProcessingEffects).toBe(true);
  });

  it('preserves explicitly disabled visual effects', async () => {
    getMock.mockResolvedValue({
      agent_settings: {
        showVirtualCursor: false,
        showProcessingEffects: false,
      },
    });
    const settings = await loadSettings();
    expect(settings.showVirtualCursor).toBe(false);
    expect(settings.showProcessingEffects).toBe(false);
  });
});

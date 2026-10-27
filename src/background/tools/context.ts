import type { BackgroundToContent } from '@/shared/messages';
import type { ToolContext } from '@/shared/tool-registry';
import type { Settings } from '@/shared/types';
import type { OrchestratorHooks } from '../orchestrator';

/**
 * Create a ToolContext bound to an orchestrator instance.
 * This breaks circular dependencies by letting tools call back to orchestrator
 * services without importing Orchestrator directly.
 */
export function createToolContext(
  tabId: number,
  settings: Settings,
  hooks: OrchestratorHooks,
  services: {
    observe: (force?: boolean) => Promise<any>;
    navigateAndWait: (url: string) => Promise<void>;
    goBackAndWait: () => Promise<void>;
    captureScreenshot: () => Promise<string>;
    executeJavaScript: (call: any) => Promise<any>;
  },
): ToolContext {
  return {
    tabId,
    settings,
    hooks,
    observe: services.observe,
    navigateAndWait: services.navigateAndWait,
    goBackAndWait: services.goBackAndWait,
    captureScreenshot: services.captureScreenshot,
    executeJavaScript: services.executeJavaScript,
    sendToContent: async <T = unknown>(message: BackgroundToContent): Promise<T> => {
      try {
        const response = (await chrome.tabs.sendMessage(tabId, message)) as T;
        return response;
      } catch (err) {
        throw new Error(`No response from content script: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

import type { BackgroundToContent, ContentToBackground } from '@/shared/messages';
import {
  editHtml,
  executeIndexedAction,
  executeRecipeAction,
  extract,
  highlight,
  inspectHtml,
  scrollPage,
  toResult,
} from './actions';
import { observe } from './perception';
import { startPageStateTracker, waitForPageQuiet } from './page-state';
import { hideControlGlow, setVirtualCursorEnabled, showControlGlow } from './overlay';

startPageStateTracker();

// The content script executes only the structured DOM commands below. MAIN-world
// JavaScript execution is isolated in the background's confirmed CDP handler.
chrome.runtime.onMessage.addListener(
  (msg: BackgroundToContent, _sender, sendResponse) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'PING': {
            sendResponse({ type: 'PONG' } satisfies ContentToBackground);
            return;
          }
          case 'OBSERVE': {
            const res: ContentToBackground = { type: 'SNAPSHOT', snapshot: observe() };
            sendResponse(res);
            return;
          }
          case 'INSPECT_HTML': {
            sendResponse({
              type: 'ACTION_RESULT',
              result: toResult(
                '',
                'inspect_html',
                inspectHtml(msg.selector, msg.outer ?? true, msg.maxLength),
              ),
            } satisfies ContentToBackground);
            return;
          }
          case 'EDIT_HTML': {
            sendResponse({
              type: 'ACTION_RESULT',
              result: toResult(
                '',
                'edit_html',
                editHtml(msg.selector, msg.mode, msg.html, msg.all),
              ),
            } satisfies ContentToBackground);
            return;
          }
          case 'CLICK': {
            const outcome = await executeIndexedAction('click', msg.index, {});
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'click', outcome),
              evidence: outcome.evidence,
            };
            sendResponse(res);
            return;
          }
          case 'TYPE': {
            const outcome = await executeIndexedAction('type', msg.index, {
              text: msg.text,
              submit: msg.submit,
            });
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'type', outcome),
              evidence: outcome.evidence,
            };
            sendResponse(res);
            return;
          }
          case 'SELECT': {
            const outcome = await executeIndexedAction('select', msg.index, { value: msg.value });
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'select', outcome),
              evidence: outcome.evidence,
            };
            sendResponse(res);
            return;
          }
          case 'SCROLL': {
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'scroll', scrollPage(msg.direction)),
            };
            sendResponse(res);
            return;
          }
          case 'EXTRACT': {
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'extract', extract(msg.query)),
            };
            sendResponse(res);
            return;
          }
          case 'HIGHLIGHT': {
            highlight(msg.index);
            sendResponse({
              type: 'ACTION_RESULT',
              result: toResult('', 'click', { ok: true, content: 'highlighted' }),
            });
            return;
          }
          case 'SET_CONTROL_GLOW': {
            setVirtualCursorEnabled(msg.showCursor);
            if (msg.on) showControlGlow(msg.activeAction ?? false);
            else hideControlGlow();
            sendResponse({
              type: 'ACTION_RESULT',
              result: toResult('', 'observe_page', { ok: true, content: 'glow updated' }),
            });
            return;
          }
          case 'GET_PAGE_STATE': {
            sendResponse({ type: 'PAGE_STATE', identity: observe().identity } satisfies ContentToBackground);
            return;
          }
          case 'WAIT_FOR_PAGE_QUIET': {
            const quiet = await waitForPageQuiet(msg.quietMs, msg.timeoutMs);
            sendResponse({
              type: 'PAGE_QUIET',
              settled: quiet.settled,
              identity: observe().identity,
            } satisfies ContentToBackground);
            return;
          }
          case 'EXECUTE_RECIPE_ACTION': {
            const result = await executeRecipeAction(msg.step);
            sendResponse({
              type: 'RECIPE_ACTION_RESULT',
              ...result,
            } satisfies ContentToBackground);
            return;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendResponse({
          type: 'ACTION_RESULT',
          result: { id: '', name: 'observe_page', ok: false, content: `Content error: ${message}` },
        });
      }
    })();
    return true; // keep the message channel open for async sendResponse
  },
);

import type { BackgroundToContent, ContentToBackground } from '@/shared/messages';
import {
  clickElement,
  editHtml,
  extract,
  highlight,
  inspectHtml,
  scrollPage,
  selectOption,
  toResult,
  typeIntoElement,
} from './actions';
import { observe } from './perception';
import { hideControlGlow, showControlGlow } from './overlay';

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
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'click', await clickElement(msg.index)),
            };
            sendResponse(res);
            return;
          }
          case 'TYPE': {
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'type', await typeIntoElement(msg.index, msg.text, msg.submit)),
            };
            sendResponse(res);
            return;
          }
          case 'SELECT': {
            const res: ContentToBackground = {
              type: 'ACTION_RESULT',
              result: toResult('', 'select', await selectOption(msg.index, msg.value)),
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
            if (msg.on) showControlGlow();
            else hideControlGlow();
            sendResponse({
              type: 'ACTION_RESULT',
              result: toResult('', 'observe_page', { ok: true, content: 'glow updated' }),
            });
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

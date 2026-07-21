# Agent Solve — Browser AI Agent Extension

A Chrome/Edge (Manifest V3) extension that acts as an AI agent inside the browser. It perceives the current page, reasons with a configurable AI model, and acts through a fixed set of structured tools. Risky tools, including DOM editing and JavaScript execution, are confirmation-gated by default.

## How it works

The agent runs a **perceive → reason → act → observe** loop:

1. **Perceive** — a content script reads the DOM, indexes interactive elements, and condenses page text. When the DOM is insufficient (canvas, images), it falls back to a **screenshot** for vision-capable models.
2. **Reason** — the background service worker sends the page context plus your goal to the AI model.
3. **Act** — the model responds with structured **tool calls** (click, fill, scroll, navigate, inspect/edit HTML, execute JavaScript, ...). The extension validates and executes each call.
4. **Observe** — results feed back into the loop until the task is done or the agent needs you.

## Architecture

```
Side Panel (React + Tailwind)   ← chat, step timeline, provider settings
Background Service Worker        ← agent loop, AI providers, tool registry
Content Script                   ← DOM perception + action executor + highlight
```

- `src/shared` — types, message contracts, tool schemas, storage.
- `src/background` — orchestrator (agent loop) and provider adapters.
- `src/content` — perception and action execution in the page.
- `src/sidepanel` — React UI and state store.

## Providers

Configure any provider in Settings:

- **OpenAI-compatible** — OpenAI, Groq, OpenRouter, LM Studio, Ollama (`/v1`), vLLM, etc. Set Base URL, API key, and model name.
- **Anthropic-compatible** — Claude and clones. Set Base URL, API key, and model name.

Enable the "supports vision" toggle for multimodal models so screenshots are sent for visual pages.

Your API key is stored in `chrome.storage.local` and is only sent to the Base URL you configure.

## Safety

- Risky actions (click, type, select, navigate, edit HTML, execute JavaScript) are gated behind confirmation in **Confirm** mode. Switch to **Auto** only when you trust the model and current page.
- A max-steps limit prevents runaway loops.
- The agent can `ask_user` when it is blocked or needs a decision.
- JavaScript runs in the page's MAIN world through the Chrome DevTools Protocol. Chrome therefore shows the extension's `debugger` permission warning. The debugger is attached only for one evaluation and detached immediately afterwards.

## Browser control tools

- **Reliable form filling** — replaces values using native input/textarea setters, emits framework-compatible input events, supports contenteditable editors, checks readonly/disabled/max-length constraints, verifies the retained value, and avoids logging password contents.
- **`inspect_html`** — reads runtime `innerHTML` or `outerHTML` using a CSS selector with bounded output.
- **`edit_html`** — replaces, inserts, appends, prepends or removes runtime DOM markup. These edits are temporary and normally disappear after reload.
- **`execute_javascript`** — evaluates async JavaScript in the page MAIN world and returns a bounded serialized result. Restricted Chrome pages and tabs already attached to another debugger may reject it.

Example goals:

- `Điền họ tên và email vào form, kiểm tra validation nhưng chưa gửi.`
- `Inspect phần .hero rồi đổi tiêu đề thành "Hello".`
- `Chạy JavaScript để trả về document.querySelectorAll('article').length.`

## Development

```bash
npm install
npm run dev      # start Vite; load the generated dist/ as an unpacked extension
npm run build    # type-check + production build into dist/
```

Then in Chrome/Edge: go to `chrome://extensions`, enable Developer mode, and **Load unpacked** pointing at the `dist` folder. Click the toolbar icon to open the side panel.

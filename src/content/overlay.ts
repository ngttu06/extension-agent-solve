// Injected page overlays: a breathing glow border around the viewport of the
// tab the agent controls, plus a virtual mouse cursor that mimics the agent's
// clicks and typing. The content script has no Tailwind pipeline, so styles are
// inlined and a single <style> tag carries the keyframes.

const STYLE_ID = 'agent-overlay-style';
const GLOW_ID = 'agent-control-glow';
const CURSOR_ID = 'agent-virtual-cursor';
const ACCENT = '#0a84ff';
const CURSOR_FILL = '#a9c1f5';
const MAX_Z = '2147483647';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes agent-breath {
      0%, 100% { box-shadow: inset 0 0 0 2px rgba(10,132,255,0.5), inset 0 0 22px rgba(10,132,255,0.25); }
      50% { box-shadow: inset 0 0 0 3px rgba(10,132,255,0.9), inset 0 0 60px rgba(10,132,255,0.5); }
    }
    @keyframes agent-cursor-press {
      0% { transform: translate(-50%, -50%) scale(1); }
      45% { transform: translate(-50%, -50%) scale(0.78); }
      100% { transform: translate(-50%, -50%) scale(1); }
    }
    @keyframes agent-ripple {
      0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0.55; }
      100% { transform: translate(-50%, -50%) scale(2.4); opacity: 0; }
    }
  `;
  document.documentElement.appendChild(style);
}

// ---------------------------------------------------------------------------
// Control glow
// ---------------------------------------------------------------------------

export function showControlGlow(): void {
  ensureStyle();
  let glow = document.getElementById(GLOW_ID);
  if (!glow) {
    glow = document.createElement('div');
    glow.id = GLOW_ID;
    Object.assign(glow.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: MAX_Z,
      borderRadius: '4px',
      animation: 'agent-breath 2.4s ease-in-out infinite',
      transition: 'opacity 0.3s ease',
      opacity: '0',
    } as CSSStyleDeclaration);
    document.documentElement.appendChild(glow);
    // Next frame so the opacity transition runs.
    requestAnimationFrame(() => {
      glow!.style.opacity = '1';
    });
  } else {
    glow.style.opacity = '1';
  }
}

export function hideControlGlow(): void {
  const glow = document.getElementById(GLOW_ID);
  if (glow) {
    glow.style.opacity = '0';
    window.setTimeout(() => glow.remove(), 320);
  }
  hideCursor();
}

// ---------------------------------------------------------------------------
// Virtual cursor
// ---------------------------------------------------------------------------

function cursorEl(): HTMLElement {
  ensureStyle();
  let cursor = document.getElementById(CURSOR_ID);
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = CURSOR_ID;
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '24px',
      height: '24px',
      pointerEvents: 'none',
      zIndex: MAX_Z,
      transform: 'translate(-50%, -50%)',
      transition: 'left 0.35s cubic-bezier(0.22,1,0.36,1), top 0.35s cubic-bezier(0.22,1,0.36,1)',
      opacity: '0',
      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
    } as CSSStyleDeclaration);
    cursor.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.5 4.2a1.7 1.7 0 0 1 2.6-1.4l11.4 8.4a1.7 1.7 0 0 1-.5 3l-4.9 1.3-2.6 4.7a1.7 1.7 0 0 1-3.2-.6z"
          fill="${CURSOR_FILL}"/>
      </svg>`;
    document.documentElement.appendChild(cursor);
  }
  return cursor;
}

function hideCursor(): void {
  const cursor = document.getElementById(CURSOR_ID);
  if (cursor) cursor.style.opacity = '0';
}

/** Glide the virtual cursor to viewport coordinates and settle briefly. */
export function moveCursorTo(x: number, y: number): Promise<void> {
  const cursor = cursorEl();
  cursor.style.opacity = '1';
  cursor.style.left = `${x}px`;
  cursor.style.top = `${y}px`;
  return new Promise((resolve) => window.setTimeout(resolve, 380));
}

/** Play a press animation plus a ripple at the cursor's current position. */
export function cursorPress(): void {
  const cursor = document.getElementById(CURSOR_ID);
  if (!cursor) return;
  const inner = cursor.firstElementChild as HTMLElement | null;
  if (inner) {
    inner.style.animation = 'agent-cursor-press 0.32s ease-out';
    window.setTimeout(() => {
      inner.style.animation = '';
    }, 340);
  }

  const ripple = document.createElement('div');
  Object.assign(ripple.style, {
    position: 'fixed',
    left: cursor.style.left,
    top: cursor.style.top,
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    border: `2px solid ${ACCENT}`,
    pointerEvents: 'none',
    zIndex: MAX_Z,
    transform: 'translate(-50%, -50%)',
    animation: 'agent-ripple 0.5s ease-out forwards',
  } as CSSStyleDeclaration);
  document.documentElement.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 520);
}

/** Move the cursor to an element's center and press. */
export async function pointAt(el: HTMLElement): Promise<void> {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  await moveCursorTo(cx, cy);
  cursorPress();
}

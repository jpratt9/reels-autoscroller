// Shared helpers: platform detection, keyboard-shortcut parsing/formatting, and
// the page-interaction primitives the content script uses to advance the feed.
// Pure functions here are exercised directly by the test suite; the DOM helpers
// below them only run inside a content script.

function detectPlatform(url) {
  if (!url) return null;

  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();
    const path = pathname.toLowerCase();

    if (host.includes('instagram.com') && (path.startsWith('/reels') || path.startsWith('/reel'))) {
      return PLATFORMS.INSTAGRAM;
    }
    if (host.includes('youtube.com') && path.includes('/shorts')) {
      return PLATFORMS.YOUTUBE;
    }
    if (host.includes('tiktok.com')) {
      const unsupported = ['/login', '/signup', '/upload', '/creator', '/business', '/legal'];
      if (unsupported.some((prefix) => path.startsWith(prefix))) return null;
      return PLATFORMS.TIKTOK;
    }
    if (host.includes('facebook.com') && path.startsWith('/reel')) {
      return PLATFORMS.FACEBOOK;
    }
  } catch (_) {
    return null;
  }

  return null;
}

const KEY_MAP = {
  space: 'Space', spacebar: 'Space', esc: 'Esc', escape: 'Esc',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  period: '.', dot: '.', comma: ',', slash: '/', question: '/',
  semicolon: ';', colon: ';', quote: "'", apostrophe: "'", backquote: '`', tilde: '`',
  minus: '-', underscore: '-', equal: '=', plus: '=', backslash: '\\', pipe: '\\',
  bracketleft: '[', braceleft: '[', bracketright: ']', braceright: ']',
  tab: 'Tab', enter: 'Enter', return: 'Enter', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

const CODE_MAP = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  IntlBackslash: '\\', IntlRo: '-', IntlYen: '\\',
};

const EVENT_KEY_MAP = {
  ' ': 'Space', Spacebar: 'Space', Space: 'Space', Escape: 'Esc', Esc: 'Esc',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Backspace: 'Backspace', Delete: 'Delete', Del: 'Delete', Enter: 'Enter', Return: 'Enter',
  Tab: 'Tab', PageUp: 'PageUp', PageDown: 'PageDown', Home: 'Home', End: 'End', Insert: 'Insert',
};

function normalizeShortcutKey(part) {
  const trimmed = (part || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (KEY_MAP[lower]) return KEY_MAP[lower];
  if (/^f[0-9]{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed;
}

function parseShortcutString(shortcutString) {
  if (!shortcutString || typeof shortcutString !== 'string') return null;

  const parts = shortcutString.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  const result = { ctrl: false, alt: false, shift: false, meta: false, key: '' };

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') result.ctrl = true;
    else if (lower === 'alt' || lower === 'option' || lower === 'opt') result.alt = true;
    else if (lower === 'shift') result.shift = true;
    else if (['meta', 'cmd', 'command', 'win', 'super'].includes(lower)) result.meta = true;
    else {
      if (result.key) return null; // two non-modifier keys is not a valid shortcut
      result.key = normalizeShortcutKey(part);
    }
  }

  return result.key ? result : null;
}

function getNormalizedShortcutModifiers(event) {
  const altGraphActive = Boolean(
    event &&
      ((typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')) ||
        event.key === 'AltGraph')
  );

  return {
    ctrl: altGraphActive ? false : Boolean(event?.ctrlKey),
    alt: altGraphActive ? true : Boolean(event?.altKey),
    shift: Boolean(event?.shiftKey),
    meta: Boolean(event?.metaKey),
  };
}

function getEventShortcutKey(event) {
  if (!event) return '';
  if (CODE_MAP[event.code]) return CODE_MAP[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  if (event.code === 'NumpadDecimal') return '.';
  if (event.code === 'NumpadAdd') return '+';
  if (event.code === 'NumpadSubtract') return '-';

  const key = event.key;
  if (!key) return '';
  if (key.length === 1) return key.toUpperCase();
  return EVENT_KEY_MAP[key] || key;
}

function matchesShortcut(event, shortcut) {
  if (!shortcut) return false;
  const modifiers = getNormalizedShortcutModifiers(event);
  return (
    modifiers.ctrl === shortcut.ctrl &&
    modifiers.alt === shortcut.alt &&
    modifiers.shift === shortcut.shift &&
    modifiers.meta === shortcut.meta &&
    getEventShortcutKey(event) === shortcut.key
  );
}

function clamp(value, minValue, maxValue) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minValue;
  return Math.min(maxValue, Math.max(minValue, numeric));
}

function formatShortcutForDisplay(shortcut) {
  if (!shortcut) return 'Disabled';
  const ua = typeof navigator !== 'undefined' ? navigator : null;
  const isMac = Boolean(
    ua && (ua.userAgentData?.platform?.toLowerCase().includes('mac') ||
      ua.userAgent?.toLowerCase().includes('mac'))
  );

  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'Meta') return isMac ? 'Cmd' : 'Meta';
      if (part === 'Esc' || part === 'Escape') return 'Esc';
      if (part.startsWith('Arrow')) return part.replace('Arrow', 'Arrow ');
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(' + ');
}

// --- DOM / page-interaction helpers (content script only) ------------------

function isElementVisible(element, options = {}) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

  const { ignoreOpacity = false, allowOffscreen = false } = options;
  const style = window.getComputedStyle(element);
  if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
  if (!ignoreOpacity && parseFloat(style.opacity || '1') === 0) return false;

  let rect;
  try {
    rect = element.getBoundingClientRect();
  } catch (_) {
    return false;
  }

  if (!rect || rect.width === 0 || rect.height === 0) return false;
  if (allowOffscreen) return true;
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function anyVisible(selectors = [], options = {}) {
  for (const selector of selectors) {
    let elements = [];
    if (typeof selector === 'string') {
      elements = Array.from(document.querySelectorAll(selector));
    } else if (typeof selector === 'function') {
      const result = selector();
      if (result instanceof Element) elements = [result];
      else if (Array.isArray(result) || result instanceof NodeList || result instanceof HTMLCollection) {
        elements = Array.from(result);
      }
    } else if (selector instanceof Element) {
      elements = [selector];
    }
    if (elements.some((el) => isElementVisible(el, options))) return true;
  }
  return false;
}

// The feeds advance on ArrowDown; keyCode/which are legacy but some handlers on
// YouTube/Instagram still read them. The event bubbles, so dispatch on one node.
function dispatchKeyEvent(currentVideo = null) {
  const target = currentVideo || document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
    bubbles: true, cancelable: true,
  }));
}

function dispatchFacebookKeyEvent() {
  const el = document.querySelector('[role="main"]') || document.body;
  if (typeof el.focus === 'function') {
    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
  }
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
    bubbles: true, cancelable: true,
  }));
}

function dispatchWheelEvent(currentVideo, additionalSelectors = []) {
  const target =
    currentVideo?.parentElement ||
    additionalSelectors.map((s) => document.querySelector(s)).find(Boolean) ||
    document.body;
  target.dispatchEvent(new WheelEvent('wheel', {
    deltaY: window.innerHeight, deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    bubbles: true, cancelable: true,
  }));
}

function scrollNearestContainer(video) {
  if (!video) return false;
  let el = video.parentElement;
  let inspected = 0;
  while (el && inspected < 25) {
    inspected++;
    if (el.scrollHeight > el.clientHeight + 8) {
      const style = window.getComputedStyle(el);
      if (['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflow)) {
        const before = el.scrollTop;
        el.scrollTop = before + window.innerHeight;
        if (el.scrollTop > before + 5) return true;
        el.scrollBy(0, window.innerHeight);
        if (el.scrollTop > before + 5) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

function simulateSwipe(currentVideo, startX, startY, endX, endY) {
  const target = currentVideo || document.body;
  try {
    const touch = (x, y) => new Touch({
      identifier: 1, target, clientX: x, clientY: y,
      radiusX: 2.5, radiusY: 2.5, rotationAngle: 10, force: 0.5,
    });
    const start = touch(startX, startY);
    const end = touch(endX, endY);
    target.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [start], targetTouches: [start], changedTouches: [start],
    }));
    setTimeout(() => target.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true, cancelable: true, touches: [end], targetTouches: [end], changedTouches: [end],
    })), 50);
    setTimeout(() => target.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [end],
    })), 100);
  } catch (_) {
    const mouse = (type, x, y) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    target.dispatchEvent(mouse('mousedown', startX, startY));
    setTimeout(() => target.dispatchEvent(mouse('mousemove', endX, endY)), 50);
    setTimeout(() => target.dispatchEvent(mouse('mouseup', endX, endY)), 100);
  }
}

function simulateVideoSwipe(currentVideo) {
  if (!currentVideo) return;
  const rect = currentVideo.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  simulateSwipe(currentVideo, centerX, rect.top + rect.height * 0.8, centerX, rect.top + rect.height * 0.2);
}

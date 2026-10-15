// Settings page controller. Persists everything to chrome.storage.local and
// broadcasts changes to open platform tabs so the content script reacts live.

const POSITION_OPTIONS = [
  ['custom', 'Custom (set on site)'],
  ['top-left', 'Top Left'],
  ['top-right', 'Top Right'],
  ['bottom-left', 'Bottom Left'],
  ['bottom-right', 'Bottom Right'],
];

const PLATFORM_MATCHES = [
  'https://*.instagram.com/*',
  'https://*.youtube.com/*',
  'https://*.tiktok.com/*',
  'https://*.facebook.com/*',
];

let capture = { active: false, key: null, displayId: null };
let hintEl = null;
let overlayEl = null;
let overlayTextEl = null;

// Apply stored theme before paint.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', system);
  chrome.storage.local.get(['themePreference']).then((r) => {
    const pref = r.themePreference || 'auto';
    applyTheme(pref);
  }).catch(() => {});
})();

function applyTheme(preference) {
  const theme = preference === 'auto' || preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  document.documentElement.setAttribute('data-theme', theme);
}

document.addEventListener('DOMContentLoaded', () => {
  hintEl = document.getElementById('shortcut-hint');
  overlayEl = document.getElementById('shortcut-overlay');
  overlayTextEl = document.getElementById('overlay-text');

  try {
    document.getElementById('settings-version').textContent = `Reels AutoScroller v${chrome.runtime.getManifest().version}`;
  } catch (_) {}

  buildPositionSelects();
  initTheme();
  loadSettings();
  loadStatistics();
  loadAccentColor();
  setupListeners();
});

function buildPositionSelects() {
  document.querySelectorAll('.preset-select').forEach((select) => {
    POSITION_OPTIONS.forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    });
  });
}

function initTheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', () => {
    if (document.getElementById('theme-preference').value === 'auto') applyTheme('auto');
  });
}

function loadAccentColor() {
  chrome.storage.local.get(['indicatorAccentColor']).then((r) => {
    setAccentVar(r.indicatorAccentColor || ACCENT_DEFAULT);
  }).catch(() => setAccentVar(ACCENT_DEFAULT));
}

function setAccentVar(color) {
  document.documentElement.style.setProperty('--accent', color);
}

function loadSettings() {
  chrome.storage.local.get(DEFAULT_SETTINGS).then((settings) => {
    const checkboxes = {
      'keyboard-shortcuts': 'keyboardShortcuts',
      'pause-on-comments': 'pauseOnComments',
      'auto-enable': 'autoEnable',
      'show-status-indicator': 'showStatusIndicator',
      'show-video-time': 'showVideoTime',
      'show-progress-bar': 'showProgressBar',
    };
    for (const [id, key] of Object.entries(checkboxes)) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(settings[key]);
    }

    document.getElementById('theme-preference').value = settings.themePreference;

    const opacity = settings.indicatorOpacity ?? DEFAULT_SETTINGS.indicatorOpacity;
    document.getElementById('indicator-opacity').value = opacity;
    document.getElementById('opacity-value').textContent = `${Math.round(opacity * 100)}%`;

    document.getElementById('accent-color').value = settings.indicatorAccentColor || ACCENT_DEFAULT;

    const positions = settings.platformPositions || {};
    document.querySelectorAll('.preset-select').forEach((select) => {
      select.value = positions[select.dataset.platform] || 'top-right';
    });

    // Shortcut displays
    setShortcutDisplay('shortcut-display', settings.keyboardShortcut || SHORTCUT_DEFAULTS.MAIN);
    setShortcutDisplay('speed-up-display', settings.speedUpShortcut || SHORTCUT_DEFAULTS.SPEED_UP);
    setShortcutDisplay('speed-down-display', settings.speedDownShortcut || SHORTCUT_DEFAULTS.SPEED_DOWN);
    setShortcutDisplay('reset-speed-display', settings.resetSpeedShortcut || SHORTCUT_DEFAULTS.RESET_SPEED);
    setShortcutDisplay('pause-display', settings.pauseShortcut || SHORTCUT_DEFAULTS.PAUSE);

    toggleShortcutsEnabled(settings.keyboardShortcuts);
    setShortcutHint(SHORTCUT_DEFAULTS.HINT);
    applyTheme(settings.themePreference);
  }).catch(() => {});
}

function loadStatistics() {
  chrome.storage.local.get(['scrolledVideos', 'statistics']).then((r) => {
    const videos = r.scrolledVideos || {};
    const stats = r.statistics || { totalScrolls: 0 };
    const total = stats.totalScrolls ||
      (videos.instagram || 0) + (videos.youtube || 0) + (videos.tiktok || 0) + (videos.facebook || 0);
    document.getElementById('total-scrolls').textContent = total;
    for (const platform of ['instagram', 'youtube', 'tiktok', 'facebook']) {
      document.getElementById(`${platform}-scrolls`).textContent = videos[platform] || 0;
    }
  }).catch(() => {});
}

function saveSetting(key, value) {
  chrome.storage.local.set({ [key]: value })
    .then(() => chrome.tabs.query({ url: PLATFORM_MATCHES }))
    .then((tabs) => {
      for (const tab of tabs) {
        if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'settingChanged', key, value }).catch(() => {});
      }
    })
    .catch(() => {});
}

function setupListeners() {
  document.getElementById('close-btn').addEventListener('click', () => window.close());

  const bindToggle = (id, key, after) => {
    document.getElementById(id).addEventListener('change', (e) => {
      saveSetting(key, e.target.checked);
      after?.(e.target.checked);
    });
  };
  bindToggle('keyboard-shortcuts', 'keyboardShortcuts', (on) => toggleShortcutsEnabled(on));
  bindToggle('pause-on-comments', 'pauseOnComments');
  bindToggle('auto-enable', 'autoEnable');
  bindToggle('show-status-indicator', 'showStatusIndicator');
  bindToggle('show-video-time', 'showVideoTime');
  bindToggle('show-progress-bar', 'showProgressBar');

  document.getElementById('theme-preference').addEventListener('change', (e) => {
    saveSetting('themePreference', e.target.value);
    applyTheme(e.target.value);
  });

  document.getElementById('accent-color').addEventListener('change', (e) => {
    saveSetting('indicatorAccentColor', e.target.value);
    setAccentVar(e.target.value);
  });

  const opacity = document.getElementById('indicator-opacity');
  const opacityValue = document.getElementById('opacity-value');
  opacity.addEventListener('input', (e) => {
    opacityValue.textContent = `${Math.round(parseFloat(e.target.value) * 100)}%`;
  });
  opacity.addEventListener('change', (e) => saveSetting('indicatorOpacity', parseFloat(e.target.value)));

  const positionsPanel = document.getElementById('positions-panel');
  document.getElementById('toggle-positions').addEventListener('click', (e) => {
    const hidden = positionsPanel.classList.toggle('hidden');
    e.target.textContent = hidden ? 'Configure' : 'Hide';
  });

  document.querySelectorAll('.preset-select').forEach((select) => {
    select.addEventListener('change', async (e) => {
      try {
        const r = await chrome.storage.local.get(['platformPositions']);
        const positions = r.platformPositions || {};
        positions[e.target.dataset.platform] = e.target.value;
        await chrome.storage.local.set({ platformPositions: positions });
      } catch (_) {}
    });
  });

  document.getElementById('reset-positions').addEventListener('click', resetPositions);
  document.getElementById('reset-stats').addEventListener('click', resetStatistics);
  document.getElementById('export-settings').addEventListener('click', exportSettings);
  document.getElementById('import-settings').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', importSettings);

  // Shortcut editors (delegated via each card's data attributes).
  document.querySelectorAll('.shortcut').forEach((card) => {
    const key = card.dataset.key;
    const displayId = card.dataset.display;
    const def = card.dataset.default;
    card.querySelector('.shortcut-edit').addEventListener('click', () => startCapture(key, displayId));
    card.querySelector('.shortcut-reset').addEventListener('click', () => {
      saveSetting(key, def);
      setShortcutDisplay(displayId, def);
      if (key === 'keyboardShortcut') setShortcutHint(`Shortcut reset to ${formatShortcutForDisplay(def)}.`);
    });
  });

  document.getElementById('shortcut-cancel').addEventListener('click', cancelCapture);
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) cancelCapture(); });
}

async function resetPositions() {
  const defaults = { instagram: 'top-right', youtube: 'top-right', tiktok: 'top-right', facebook: 'top-right' };
  try {
    await chrome.storage.local.remove(['statusIndicatorPositions']);
    await chrome.storage.local.set({ platformPositions: defaults });
    document.querySelectorAll('.preset-select').forEach((s) => { s.value = 'top-right'; });
  } catch (_) {}
}

async function resetStatistics() {
  if (!confirm('Reset all statistics? This cannot be undone.')) return;
  try {
    await chrome.storage.local.set({
      scrolledVideos: {},
      statistics: { totalScrolls: 0, totalWatchTime: 0, lastActive: Date.now() },
    });
    loadStatistics();
  } catch (_) {}
}

// --- shortcut capture ------------------------------------------------------

function startCapture(key, displayId) {
  if (capture.active) return;
  if (key === 'keyboardShortcut' && !document.getElementById('keyboard-shortcuts').checked) {
    setShortcutHint('Enable keyboard shortcuts first.', true);
    return;
  }
  capture = { active: true, key, displayId };
  overlayEl.classList.remove('hidden');
  overlayTextEl.textContent = 'Press your new shortcut…';
  window.addEventListener('keydown', onCaptureKeydown, true);
  window.addEventListener('keyup', suppressKeyup, true);
}

function onCaptureKeydown(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') return cancelCapture();

  const { shortcut, error } = formatShortcutFromEvent(event);
  if (error) { overlayTextEl.textContent = error; return; }

  saveSetting(capture.key, shortcut);
  setShortcutDisplay(capture.displayId, shortcut);
  if (capture.key === 'keyboardShortcut') setShortcutHint(`Shortcut updated to ${formatShortcutForDisplay(shortcut)}.`);
  stopCapture();
}

function suppressKeyup(event) {
  event.preventDefault();
  event.stopPropagation();
}

function stopCapture() {
  capture = { active: false, key: null, displayId: null };
  overlayEl.classList.add('hidden');
  window.removeEventListener('keydown', onCaptureKeydown, true);
  window.removeEventListener('keyup', suppressKeyup, true);
}

function cancelCapture() {
  if (!capture.active) return;
  stopCapture();
  setShortcutHint('Shortcut unchanged.');
}

function formatShortcutFromEvent(event) {
  const mods = getNormalizedShortcutModifiers(event);
  const parts = [];
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.alt) parts.push('Alt');
  if (mods.shift) parts.push('Shift');
  if (mods.meta) parts.push('Meta');

  const key = getEventShortcutKey(event);
  if (!key) return { shortcut: null, error: 'Press a key to assign.' };
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(key)) {
    return { shortcut: null, error: 'Add a letter, number, or function key.' };
  }
  if (!parts.length && key === 'Esc') return { shortcut: null, error: 'Esc cancels capture.' };
  return { shortcut: [...parts, key].join('+'), error: null };
}

// --- display helpers -------------------------------------------------------

function setShortcutDisplay(elementId, shortcut) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (shortcut) {
    el.dataset.shortcutValue = shortcut;
    el.textContent = formatShortcutForDisplay(shortcut);
  } else {
    el.textContent = 'Disabled';
  }
}

function toggleShortcutsEnabled(enabled) {
  document.querySelectorAll('.shortcut').forEach((card) => {
    card.classList.toggle('disabled', !enabled);
    card.querySelector('.shortcut-edit').disabled = !enabled;
    card.querySelector('.shortcut-reset').disabled = !enabled;
    const display = document.getElementById(card.dataset.display);
    if (display) {
      display.textContent = enabled
        ? formatShortcutForDisplay(display.dataset.shortcutValue || card.dataset.default)
        : 'Disabled';
    }
  });
}

function setShortcutHint(message = SHORTCUT_DEFAULTS.HINT, isError = false) {
  if (!hintEl) return;
  hintEl.textContent = message;
  hintEl.classList.toggle('error', Boolean(isError));
}

// --- data export / import --------------------------------------------------

async function exportSettings() {
  try {
    const data = await chrome.storage.local.get(null);
    const payload = {
      version: chrome.runtime.getManifest().version,
      exportDate: new Date().toISOString(),
      settings: data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reels-autoscroller-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (_) {}
}

function importSettings(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > IMPORT_LIMITS.MAX_FILE_SIZE_BYTES) {
    alert('Settings file is too large.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.settings) return alert('Invalid settings file.');
      const sanitized = sanitizeImportedSettings(parsed.settings);
      if (!sanitized) return alert('Settings file could not be validated.');
      if (!confirm('This replaces all current settings. Continue?')) return;
      await chrome.storage.local.clear();
      await chrome.storage.local.set(sanitized);
      loadSettings();
      loadStatistics();
      loadAccentColor();
      setShortcutHint('Settings imported.');
    } catch (_) {
      setShortcutHint('Could not read settings file.', true);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

// Whitelist every imported field — never trust the file's shape.
function sanitizeImportedSettings(raw, depth = 0) {
  if (depth > IMPORT_LIMITS.MAX_JSON_DEPTH) return null;
  if (Object.prototype.toString.call(raw) !== '[object Object]') return null;

  const out = Object.create(null);
  const isObj = (v) => Object.prototype.toString.call(v) === '[object Object]';
  const clampNum = (v, min, max, fb) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
  };

  for (const key of ['keyboardShortcuts', 'pauseOnComments', 'autoEnable', 'showStatusIndicator', 'showVideoTime', 'showProgressBar']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  for (const key of ['keyboardShortcut', 'speedUpShortcut', 'speedDownShortcut', 'resetSpeedShortcut', 'pauseShortcut']) {
    if (typeof raw[key] === 'string') out[key] = raw[key].slice(0, 64);
  }
  if (raw.playbackSpeed !== undefined) {
    out.playbackSpeed = clampNum(raw.playbackSpeed, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED, DEFAULT_SETTINGS.playbackSpeed);
  }
  if (raw.indicatorOpacity !== undefined) {
    out.indicatorOpacity = clampNum(raw.indicatorOpacity, 0, 1, DEFAULT_SETTINGS.indicatorOpacity);
  }
  if (typeof raw.themePreference === 'string') {
    const theme = raw.themePreference.toLowerCase();
    if (['auto', 'system', 'light', 'dark'].includes(theme)) out.themePreference = theme === 'system' ? 'auto' : theme;
  }
  if (typeof raw.indicatorAccentColor === 'string' && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(raw.indicatorAccentColor.trim())) {
    out.indicatorAccentColor = raw.indicatorAccentColor.trim();
  }
  if (isObj(raw.platformPositions)) {
    const allowed = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'custom']);
    const positions = Object.create(null);
    for (const platform of ['instagram', 'youtube', 'tiktok', 'facebook']) {
      const v = raw.platformPositions[platform];
      if (typeof v === 'string' && allowed.has(v)) positions[platform] = v;
    }
    if (Object.keys(positions).length) out.platformPositions = positions;
  }
  if (isObj(raw.statusIndicatorPositions)) {
    const safe = Object.create(null);
    for (const [k, v] of Object.entries(raw.statusIndicatorPositions)) {
      if (!isObj(v)) continue;
      const entry = {};
      for (const prop of ['top', 'right', 'bottom', 'left']) {
        if (typeof v[prop] === 'string' && v[prop].length < 24) entry[prop] = v[prop];
      }
      if (Object.keys(entry).length) safe[k] = entry;
    }
    if (Object.keys(safe).length) out.statusIndicatorPositions = safe;
  }
  if (isObj(raw.scrolledVideos)) {
    const stats = Object.create(null);
    for (const platform of ['instagram', 'youtube', 'tiktok', 'facebook']) {
      if (raw.scrolledVideos[platform] !== undefined) {
        stats[platform] = Math.max(0, Math.floor(Number(raw.scrolledVideos[platform]) || 0));
      }
    }
    out.scrolledVideos = stats;
  }
  if (isObj(raw.statistics)) {
    out.statistics = {
      totalScrolls: Math.max(0, Math.floor(Number(raw.statistics.totalScrolls) || 0)),
      totalWatchTime: Math.max(0, Number(raw.statistics.totalWatchTime) || 0),
      lastActive: Math.max(0, Number(raw.statistics.lastActive) || Date.now()),
    };
  }
  return out;
}

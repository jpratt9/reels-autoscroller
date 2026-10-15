const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const exists = (f) => fs.existsSync(path.join(__dirname, '..', f));

// Load the shared constants + utils into one vm script so the const bindings in
// constants.js are in scope for the functions in utils.js, then hand back the
// public surface. This mirrors how both files share scope as content scripts.
function loadShared(extraGlobals = {}) {
  const ctx = vm.createContext({
    URL, Date, Math, Number, JSON, console,
    navigator: { userAgent: 'node-test', userAgentData: null },
    ...extraGlobals,
  });
  const exportLine = `
    ;globalThis.__api = {
      detectPlatform, parseShortcutString, matchesShortcut, getEventShortcutKey,
      getNormalizedShortcutModifiers, normalizeShortcutKey, clamp, formatShortcutForDisplay,
      PLATFORMS, PLATFORM_NAMES, PLATFORM_URLS, ACCENT_DEFAULT, DEFAULT_SETTINGS,
      SHORTCUT_DEFAULTS, INDICATOR_POSITIONS, TIMING, VIDEO, IMPORT_LIMITS,
    };`;
  vm.runInContext(read('src/shared/constants.js') + '\n;\n' + read('src/shared/utils.js') + exportLine, ctx);
  return ctx.__api;
}

module.exports = { read, exists, loadShared };

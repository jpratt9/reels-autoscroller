const test = require('node:test');
const assert = require('node:assert');
const { loadShared } = require('./helpers');

const {
  parseShortcutString, matchesShortcut, getEventShortcutKey, formatShortcutForDisplay,
} = loadShared();

test('parses modifier + key combinations', () => {
  // Spread the vm-realm result into a plain object so deepStrictEqual compares
  // structure, not the (cross-realm) prototype.
  assert.deepStrictEqual({ ...parseShortcutString('Alt+T') }, { ctrl: false, alt: true, shift: false, meta: false, key: 'T' });
  assert.deepStrictEqual({ ...parseShortcutString('Ctrl+Shift+.') }, { ctrl: true, alt: false, shift: true, meta: false, key: '.' });
  assert.strictEqual(parseShortcutString('Cmd+K').meta, true);
});

test('rejects malformed shortcuts', () => {
  assert.strictEqual(parseShortcutString(''), null);
  assert.strictEqual(parseShortcutString('Alt'), null); // modifier with no key
  assert.strictEqual(parseShortcutString('A+B'), null); // two non-modifier keys
  assert.strictEqual(parseShortcutString(null), null);
});

test('matchesShortcut compares a keydown event against a parsed shortcut', () => {
  const shortcut = parseShortcutString('Alt+T');
  assert.ok(matchesShortcut({ altKey: true, code: 'KeyT', key: 't' }, shortcut));
  assert.ok(!matchesShortcut({ altKey: false, code: 'KeyT', key: 't' }, shortcut)); // missing Alt
  assert.ok(!matchesShortcut({ altKey: true, ctrlKey: true, code: 'KeyT', key: 't' }, shortcut)); // extra Ctrl
  assert.ok(!matchesShortcut({ altKey: true, code: 'KeyG', key: 'g' }, shortcut)); // wrong key
});

test('getEventShortcutKey normalizes physical codes', () => {
  assert.strictEqual(getEventShortcutKey({ code: 'KeyA' }), 'A');
  assert.strictEqual(getEventShortcutKey({ code: 'Digit4' }), '4');
  assert.strictEqual(getEventShortcutKey({ code: 'Numpad7' }), '7');
  assert.strictEqual(getEventShortcutKey({ code: 'Period' }), '.');
  assert.strictEqual(getEventShortcutKey({ code: 'ArrowDown', key: 'ArrowDown' }), 'ArrowDown');
});

test('formatShortcutForDisplay is human readable', () => {
  assert.strictEqual(formatShortcutForDisplay('Alt+T'), 'Alt + T');
  assert.strictEqual(formatShortcutForDisplay('Ctrl+Shift+.'), 'Ctrl + Shift + .');
  assert.strictEqual(formatShortcutForDisplay(null), 'Disabled');
  assert.strictEqual(formatShortcutForDisplay('Alt+ArrowDown'), 'Alt + Arrow Down');
});

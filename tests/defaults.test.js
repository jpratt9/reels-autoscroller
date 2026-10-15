const test = require('node:test');
const assert = require('node:assert');
const { loadShared } = require('./helpers');
const constants = require('../src/shared/constants.js');

const { clamp, DEFAULT_SETTINGS, VIDEO, ACCENT_DEFAULT } = loadShared();

test('ships the viewshot green accent as the default', () => {
  assert.strictEqual(ACCENT_DEFAULT, '#39d353');
  assert.strictEqual(DEFAULT_SETTINGS.indicatorAccentColor, '#39d353');
  assert.strictEqual(constants.ACCENT_DEFAULT, '#39d353');
});

test('default settings have the expected shape', () => {
  assert.strictEqual(DEFAULT_SETTINGS.keyboardShortcut, 'Alt+T');
  assert.strictEqual(DEFAULT_SETTINGS.playbackSpeed, 1);
  assert.strictEqual(DEFAULT_SETTINGS.themePreference, 'auto');
  for (const platform of ['instagram', 'youtube', 'tiktok', 'facebook']) {
    assert.strictEqual(DEFAULT_SETTINGS.platformPositions[platform], 'top-right');
  }
});

test('clamp keeps values within playback-speed bounds', () => {
  assert.strictEqual(clamp(10, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED), 5);
  assert.strictEqual(clamp(-3, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED), 0.1);
  assert.strictEqual(clamp(2.5, VIDEO.MIN_PLAYBACK_SPEED, VIDEO.MAX_PLAYBACK_SPEED), 2.5);
  assert.strictEqual(clamp('not a number', 0, 5), 0); // non-finite falls back to min
});

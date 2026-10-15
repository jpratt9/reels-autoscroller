const test = require('node:test');
const assert = require('node:assert');
const { loadShared } = require('./helpers');

const { detectPlatform } = loadShared();

test('detects each supported feed from its URL', () => {
  assert.strictEqual(detectPlatform('https://www.instagram.com/reels/abc123/'), 'instagram');
  assert.strictEqual(detectPlatform('https://www.instagram.com/reel/abc123/'), 'instagram');
  assert.strictEqual(detectPlatform('https://www.youtube.com/shorts/xYz'), 'youtube');
  assert.strictEqual(detectPlatform('https://m.youtube.com/shorts/xYz'), 'youtube');
  assert.strictEqual(detectPlatform('https://www.tiktok.com/'), 'tiktok');
  assert.strictEqual(detectPlatform('https://www.tiktok.com/@someone/video/123'), 'tiktok');
  assert.strictEqual(detectPlatform('https://www.facebook.com/reel/123'), 'facebook');
});

test('rejects pages that are not short-form feeds', () => {
  assert.strictEqual(detectPlatform('https://www.instagram.com/someuser/'), null);
  assert.strictEqual(detectPlatform('https://www.youtube.com/watch?v=abc'), null);
  assert.strictEqual(detectPlatform('https://www.facebook.com/'), null);
});

test('rejects TikTok account and marketing routes', () => {
  for (const path of ['/login', '/signup', '/upload', '/creator-center', '/business', '/legal/terms']) {
    assert.strictEqual(detectPlatform(`https://www.tiktok.com${path}`), null, `${path} should not be a feed`);
  }
});

test('returns null for unsupported hosts and bad input', () => {
  assert.strictEqual(detectPlatform('https://example.com/reels/'), null);
  assert.strictEqual(detectPlatform('not a url'), null);
  assert.strictEqual(detectPlatform(''), null);
  assert.strictEqual(detectPlatform(null), null);
});

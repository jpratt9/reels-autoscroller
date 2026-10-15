const test = require('node:test');
const assert = require('node:assert');
const { read, exists } = require('./helpers');

const manifest = JSON.parse(read('manifest.json'));

test('is a valid MV3 manifest', () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.name, 'Reels AutoScroller');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('tabs'));
});

test('every referenced content-script and popup file exists on disk', () => {
  const cs = manifest.content_scripts[0];
  for (const js of cs.js) assert.ok(exists(js), `missing content script: ${js}`);
  for (const css of cs.css) assert.ok(exists(css), `missing content CSS: ${css}`);
  assert.ok(exists(manifest.action.default_popup), 'missing popup');
});

test('all declared icons exist', () => {
  for (const size of Object.keys(manifest.icons)) {
    assert.ok(exists(manifest.icons[size]), `missing icon ${size}`);
  }
});

test('host permissions line up with content-script matches', () => {
  assert.deepStrictEqual(
    [...manifest.host_permissions].sort(),
    [...manifest.content_scripts[0].matches].sort()
  );
});

test('content scripts load constants before the code that depends on them', () => {
  const js = manifest.content_scripts[0].js;
  assert.ok(js.indexOf('src/shared/constants.js') < js.indexOf('src/shared/utils.js'));
  assert.ok(js.indexOf('src/content/platform.js') < js.indexOf('src/content/autoscroller.js'));
  assert.strictEqual(js[js.length - 1], 'src/content/autoscroller.js');
});

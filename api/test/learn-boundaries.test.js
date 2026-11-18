'use strict';
// The learning platform stands on its own (AT-12): no SCORM, Docebo, Larix or MediaMTX in it, and nothing it needs beyond the site.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const files = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => /\.(js|mjs|sql|html|css)$/.test(f)).map((f) => path.join(dir, f));
const NAMES = '(scorm|docebo|mediamtx|larix|xapi)';
// a dependency is code it loads or calls: an import, a require, a script or a web address. (The cameras guide tells iPhone users to
// install Larix for the referee cameras: that's guidance about the camera product, not something learning depends on.)
const DEPENDS = new RegExp(`(from\\s*['"][^'"]*${NAMES}|require\\(\\s*['"][^'"]*${NAMES}|src=["'][^"']*${NAMES}|https?://[^\\s'"]*${NAMES})`, 'i');

test('no SCORM, Docebo, Larix or MediaMTX dependency in the learning platform (AT-12)', () => {
  const all = [...files('api/src/learn'), ...files('api/src/learn/migrations'), ...files('learn')];
  assert.ok(all.length > 15);
  for (const f of all) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), DEPENDS, f);
  assert.match('import x from "scorm-again"', DEPENDS, 'the check itself catches one');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'package.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pkg.dependencies || {}).filter((d) => new RegExp(NAMES, 'i').test(d)), []);
});

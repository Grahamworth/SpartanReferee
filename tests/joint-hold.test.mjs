// The tracking lines stay steady: a joint the model is unsure of for a moment doesn't flash off the picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JointHold, JOINT_HOLD_MS } from '../pose-filter.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const joint = (x, visibility) => ({ x, y: 0.5, visibility });
const MIN = 0.5;

test('a joint the model is sure of is drawn where the model says', () => {
  const h = new JointHold();
  assert.equal(h.steady('a', [joint(0.1, 0.9)], MIN, 0)[0].x, 0.1);
  assert.equal(h.steady('a', [joint(0.2, 0.9)], MIN, 40)[0].x, 0.2);
});
test('a joint that dips below the cut-off stays where it was last seen, still shown', () => {
  const h = new JointHold();
  h.steady('a', [joint(0.1, 0.9)], MIN, 0);
  const p = h.steady('a', [joint(0.9, 0.2)], MIN, 100)[0];
  assert.equal(p.x, 0.1, 'not the unsure guess');
  assert.ok(p.visibility >= MIN, 'so it is still drawn');
});
test('a joint that hovers around the cut-off never flashes off', () => {
  const h = new JointHold();
  let off = 0;
  for (let i = 0; i < 40; i++) if (h.steady('a', [joint(0.5, i % 2 ? 0.45 : 0.55)], MIN, i * 80)[0].visibility < MIN) off++;
  assert.equal(off, 0);
});
test('a joint that has really gone does disappear', () => {
  const h = new JointHold();
  h.steady('a', [joint(0.1, 0.9)], MIN, 0);
  assert.ok(h.steady('a', [joint(0.1, 0.1)], MIN, JOINT_HOLD_MS + 1)[0].visibility < MIN);
});
test('a joint never seen isn\'t invented, and people are kept apart', () => {
  const h = new JointHold();
  assert.ok(h.steady('a', [joint(0.1, 0.1)], MIN, 0)[0].visibility < MIN);
  h.steady('a', [joint(0.1, 0.9)], MIN, 0);
  assert.ok(h.steady('b', [joint(0.7, 0.1)], MIN, 10)[0].visibility < MIN);
});
test('judging is never given the held positions: only drawing uses them', () => {
  const app = read('app.js');
  assert.equal(app.split('jointHold.').length - 1, 1, 'used in one place');
  assert.match(app.slice(app.indexOf('function drawSkeleton'), app.indexOf('function drawSkeleton') + 400), /jointHold\.steady/);
});
test('on a server, judging starts at once: nothing to answer, and no counter in the middle', () => {
  const app = read('app.js');
  assert.match(app, /if \(IN_RECEIVER && !PRACTICE\) \{ startAtOnce\(\); return; \}/);
  assert.match(app, /toggle\('multi', !!S\.multi \|\| \(IN_RECEIVER && !PRACTICE\)\)/);
  assert.match(app, /if \(IN_RECEIVER\) settings\.captureBib = true;/);
});
test('the review page: config pops out, can be shared, and comes before choosing a video', () => {
  const html = read('server/review/index.html'), js = read('server/review/review.js');
  assert.match(html, /id="judgeSettings" class="settingsbox popout"/);
  assert.match(html, /id="upSettings" class="settingsbox popout"/);
  assert.match(html, /id="settingsAll"/);
  assert.match(html, /id="upChoose"/);
  assert.doesNotMatch(html, /<label class="btn red upload">/);
  assert.match(js, /function shareSettings/);
  assert.match(js, /function waitingCard|const waitingCard/);
});
test('a viewer of a server\'s judge loads no AI model: it only draws what the server sends', () => {
  const app = read('app.js');
  assert.match(app, /if \(!FOLLOW && [^\n]*\) preloadModel\(\);/);
  assert.doesNotMatch(app, /^preloadModel\(\);/m);
  assert.match(app, /if \(!FOLLOW\) \{\s*loadLandmarker\(\)/);
  assert.match(app, /if \(!FOLLOW\) loadLandmarker\(\)/);
});

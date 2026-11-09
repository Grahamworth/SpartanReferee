import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the review\'s test mode is the real page, answered in the browser, for admins only', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  execFileSync('node', [path.join(ROOT, 'scripts/build-review-test.mjs'), site]);
  const out = path.join(site, 'review-test'), html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const f of ['review.js', 'review.css', 'counts.js', 'test-mode.js', 'test-judge.html']) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.equal(fs.readFileSync(path.join(out, 'review.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'server/review/review.js'), 'utf8'), 'the same page as on a server');
  assert.ok(html.indexOf('test-mode.js') < html.indexOf('review.js'), 'the pretend server is in place before the page starts');
  assert.match(html, /me\?\.admin/);
  assert.match(html, /TEST MODE/);
  const mode = fs.readFileSync(path.join(out, 'test-mode.js'), 'utf8');
  assert.ok(mode.includes("SITE_API = /^\\/api\\/(me|companies\\/mine)$/"), 'only who you are, and your company, go to the real API');
  assert.match(fs.readFileSync(path.join(out, 'test-judge.html'), 'utf8'), />TEST</);
});

test('camera 1 in test mode is the browser\'s own camera, asked for only once an admin is seen, and recorded in the browser', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  execFileSync('node', [path.join(ROOT, 'scripts/build-review-test.mjs'), site]);
  const html = fs.readFileSync(path.join(site, 'review-test/index.html'), 'utf8'), mode = fs.readFileSync(path.join(site, 'review-test/test-mode.js'), 'utf8');
  assert.match(html, /if \(me\?\.admin\) \{ cover\.remove\(\); window\.hjTestStart\?\.\(\);/, 'not before: non-admins aren\'t asked for their camera');
  assert.match(html, /<span id="tmCam">/, 'the banner says what camera 1 is doing');
  assert.equal(mode.match(/startCamera\(\)/g).length, 2, 'its definition, and hjTestStart: loading the page doesn\'t start the camera');
  assert.match(mode, /window\.hjTestStart = \(\) => \{ window\.hjTestStart = \(\) => \{\}; startCamera\(\); \};/);
  for (const what of ['getUserMedia', 'new MediaRecorder', 'new MediaSource', 'pathname.startsWith(\'/whep/\')) return whep(', "case '/api/recorded': return json(piecesIn("]) assert.ok(mode.includes(what), what);
  // a camera that drops out comes back by itself; nothing here is sent anywhere
  assert.match(mode, /addEventListener\('ended'[\s\S]{0,400}setTimeout\(startCamera/);
  assert.ok(!/realFetch\([^)]*(clip|whep|upload)/.test(mode));
});

test('the free camera: any approved company, one camera, the real AI judge in the browser on a minute at a time', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'review-free-'));
  execFileSync('node', [path.join(ROOT, 'scripts/build-review-test.mjs'), site]);
  const out = path.join(site, 'review-free'), html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.indexOf('window.HJ_FREE = true') < html.indexOf('test-mode.js'), 'free before the stand-in server starts');
  assert.match(html, /company\?\.status === 'approved'/, 'companies that are signed in and not blocked');
  assert.match(html, /cover\.remove\(\); window\.hjTestStart\?\.\(\); return;/, 'the camera is asked for only once they\'re let in');
  assert.match(html, /FREE CAMERA/);
  assert.doesNotMatch(html, /This server takes two cameras/);
  assert.match(html, /\.jtile \.track/, 'no Start AI judge: live judging needs a server');
  const judge = fs.readFileSync(path.join(site, 'judge-free.html'), 'utf8');
  assert.doesNotMatch(judge, /judge-gate\.js/, 'no referee check: the free page checked who it is');
  assert.ok(judge.indexOf('parent.hjFree') < judge.indexOf('app.js'), 'reports to the free page before the judge starts');
  assert.match(judge, /location\.replace\('\/review-free\/'\)/, 'opened by itself, it goes to the free camera');
  const mode = fs.readFileSync(path.join(out, 'test-mode.js'), 'utf8');
  assert.match(mode, /MAX_SECS = 60/);
  assert.match(mode, /BLOCK_MS = FREE \? 60e3/, 'recordings listed a minute at a time');
  assert.match(mode, /\/judge-free\.html\?/, 'the real judge, not TEST');
  assert.match(mode, /secs > MAX_SECS/, 'longer uploads are refused');
});

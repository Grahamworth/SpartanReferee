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
  assert.doesNotMatch(html, /\.jtile \.track/, 'Start AI judge stays: camera 1 is judged live, in this browser');
  const judge = fs.readFileSync(path.join(site, 'judge-free.html'), 'utf8');
  assert.doesNotMatch(judge, /judge-gate\.js/, 'no referee check: the free page checked who it is');
  assert.ok(judge.indexOf('parent.hjFree') < judge.indexOf('app.js'), 'reports to the free page before the judge starts');
  assert.match(judge, /location\.replace\('\/review-free\/'\)/, 'opened by itself, it goes to the free camera');
  const mode = fs.readFileSync(path.join(out, 'test-mode.js'), 'utf8');
  assert.match(mode, /MAX_SECS = 60/);
  assert.match(mode, /BLOCK_MS = FREE \? 60e3/, 'recordings listed a minute at a time');
  assert.match(mode, /\/judge-free\.html\?/, 'the real judge, not TEST');
  assert.ok(mode.includes(".replace(/([?&])follow=\\d+&?/, '$1')"), 'a live camera\'s judge judges here, not following a server\'s');
  assert.ok(mode.includes("|| p.startsWith('/whep/')"), 'and gets camera 1\'s picture from this page');
  assert.match(mode, /secs > MAX_SECS/, 'longer uploads are refused');
});

test('the judge: the free camera hands its live camera over directly, and frames never reported are not waited for in full', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(app, /const here = window\.hjLocalCamera\?\.\(url\);\n  if \(here\) return \{ pc: localLink\(here\), media: here \};/, 'only when the opener offers it: a server\'s judge uses WebRTC as before');
  assert.match(app, /unreported >= 5 \? UNREPORTED_WAIT_MS : NEW_FRAME_WAIT_MS/);
  assert.match(app, /framed = true; unreported = 0;/, 'a reported frame puts the full wait back');
  // Pick athlete and Details: the analysis only, never the judge's own home screen, and nothing about Spartans on its main screens
  assert.match(app, /if \(q\.get\('clip'\)\) document\.documentElement\.classList\.add\('analysis'\);/);
  assert.match(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'), /html\.analysis #attemptBack, html\.analysis #nextAthlete/);
  const judge = fs.readFileSync(path.join(ROOT, 'judge.html'), 'utf8'), home = judge.slice(judge.indexOf('<!-- HOME -->'));
  assert.doesNotMatch(home.replace(/<[^>]*>/g, ' '), /Spartan|Penalty station/i, 'in what it shows');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'judge-gate.js'), 'utf8'), /mango-glacier|referees\.<\/p>/);
});

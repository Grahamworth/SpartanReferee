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
  assert.match(mode, /path !== '\/api\/me'/, 'only who you are goes to the real API');
  assert.match(fs.readFileSync(path.join(out, 'test-judge.html'), 'utf8'), />TEST</);
});

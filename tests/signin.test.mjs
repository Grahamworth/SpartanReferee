import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('only a registered company signs in to the console and Results: any other account is signed back out and sent to register', () => {
  const con = read('console.js'), res = read('results.js');
  assert.match(con, /if \(!company && !me\.admin\) return notRegistered\(me\.user\.email\);/, 'the console: no company, not an admin');
  assert.match(con, /function notRegistered\(email\) \{\n  signOut\(\);/, 'signed straight back out');
  assert.match(res, /if \(!c && !me\.admin\) \{\n    signOut\(\);/, 'Results the same');
  for (const f of ['console.html', 'results.html']) {
    const html = read(f);
    assert.match(html, /id="registerFirst" href="register\.html" hidden>Register my company</, `${f}: a Register button for the refused`);
    assert.match(html, /New to SpartanReferee\? <a href="register\.html">Register your company<\/a> first/, `${f}: newcomers pointed at registering`);
  }
});

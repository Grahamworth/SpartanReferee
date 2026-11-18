import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('only an admin or a referee an admin added signs in to the console and Results: anyone else is signed back out and told to ask an admin', () => {
  const con = read('console.js'), res = read('results.js');
  assert.match(con, /if \(!company && !me\.admin\) return notRegistered\(me\.user\.email\);/, 'the console: no company, not an admin');
  assert.match(con, /function notRegistered\(email\) \{\n  signOut\(\);/, 'signed straight back out');
  assert.match(res, /if \(!c && !me\.admin\) \{\n    signOut\(\);/, 'Results the same');
  for (const f of ['console.html', 'results.html']) {
    const html = read(f);
    assert.doesNotMatch(html, /register\.html/, `${f}: no registering`);
    assert.match(html, /Referees are added by an admin: ask one to add the address you sign in with\./, `${f}: what to do instead`);
  }
});

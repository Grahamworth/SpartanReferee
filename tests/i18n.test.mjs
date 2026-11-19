// SpartanReferee in other languages (i18n.js, and the dictionaries in i18n/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { extract } from '../scripts/i18n-extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// a plain browser script: run as the page would, handing it somewhere to put its functions (as brand.test.mjs does)
const m = { exports: {} };
new Function('module', fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8'))(m);
const I = m.exports;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the language: ?lang= first, then the one picked before, then the browser\'s, then English', () => {
  assert.equal(I.pick('?lang=fr', 'de', ['nl']), 'fr');
  assert.equal(I.pick('', 'de', ['nl']), 'de');
  assert.equal(I.pick('', '', ['pt-BR', 'nl-BE', 'en']), 'nl');
  assert.equal(I.pick('?lang=xx', 'zz', ['pt']), 'en');
  assert.deepEqual(I.CODES, ['en', 'fr', 'de', 'nl', 'es', 'it', 'el', 'hr', 'cs', 'pl', 'fi', 'sv', 'da', 'ar', 'th']);
  assert.ok(I.RTL.has('ar'));
});

test('a whole text is swapped, a text with slots keeps what was in them, and numbers alone are left', () => {
  const c = I.compile({ 'Stand tall to start': 'Tenez-vous droit pour commencer', 'Camera {n}': 'Caméra {n}', 'No rep. {x}': 'Pas de rep. {x}', 'Chest to the ground': 'Poitrine au sol', 'Reps {count} · no reps {noReps}': 'Reps {count} · non valides {noReps}' });
  assert.equal(I.translate(c, 'fr', '  Stand   tall to start '), 'Tenez-vous droit pour commencer');
  assert.equal(I.translate(c, 'fr', 'Camera 3'), 'Caméra 3');
  assert.equal(I.translate(c, 'fr', 'No rep. Chest to the ground'), 'Pas de rep. Poitrine au sol', 'the reason in the slot is translated too');
  assert.equal(I.translate(c, 'fr', 'Reps {count} · no reps {noReps}', { count: 4, noReps: 1 }), 'Reps 4 · non valides 1');
  assert.equal(I.translate(c, 'fr', '12'), '12');
  assert.equal(I.translate(c, 'fr', 'Something new'), 'Something new', 'no translation: as it was');
  assert.equal(I.translate(null, 'en', 'Reps {count}', { count: 2 }), 'Reps 2', 'English fills its slots too');
});

test('a slot may be empty, and what a slot holds is translated when it is a text of its own (or matches one)', () => {
  const c = I.compile({ '{n} athlete{x}': { one: '{n} atleta', other: '{n} atleti' }, 'Camera {n}': 'Telecamera {n}', 'Watching {x}': 'Guardo {x}' });
  assert.equal(I.translate(c, 'it', '1 athlete'), '1 atleta');
  assert.equal(I.translate(c, 'it', '4 athletes'), '4 atleti');
  assert.equal(I.translate(c, 'it', 'Watching Camera 2'), 'Guardo Telecamera 2', 'a slot holding "Camera 2" is itself a pattern');
});

test('a short text with slots can\'t take over a longer sentence it happens to fit', () => {
  const c = I.compile({ '{reps} rep{x}{x2}': { one: '{reps} ripetizione', other: '{reps} ripetizioni' }, 'No rep. {x}': 'No rep. {x}', 'Chest to the ground': 'Petto a terra', '· {noReps} no rep{x}': '· no rep: {noReps}', '{noReps} no rep{x}{x2}': 'no rep: {noReps}{x2}' });
  assert.equal(I.translate(c, 'it', 'No rep. Chest to the ground'), 'No rep. Petto a terra');
  assert.equal(I.translate(c, 'it', '5 reps'), '5 ripetizioni', 'the "s" goes in the first of two slots side by side');
  assert.equal(I.translate(c, 'it', '1 rep'), '1 ripetizione');
  assert.equal(I.translate(c, 'it', '· 2 no reps'), '· no rep: 2', 'the one with more words outside its slots wins');
});

test('a slot after a word holds its ending or something after a space, and a text with too little of its own never matches', () => {
  const c = I.compile({ 'Cameras run on each day{yours}.': 'Kameras laufen jeden Tag{yours}.', 'Live{x}': 'En direct{x}', '{x6} at {x7}': '{x6} um {x7}', 'Booked by {who}.': 'Gebucht von {who}.' });
  assert.equal(I.translate(c, 'de', 'Cameras run on each day (03:00 to 14:00 your time).'), 'Kameras laufen jeden Tag (03:00 to 14:00 your time).');
  assert.equal(I.translate(c, 'fr', 'Live · video'), 'En direct · video');
  assert.equal(I.translate(c, 'de', 'Lunch at noon'), 'Lunch at noon', '"{x6} at {x7}" is too general to use');
  assert.equal(I.translate(c, 'de', 'Booked by ann@x.com.'), 'Gebucht von ann@x.com.');
});

test('plurals follow the language\'s own rules', () => {
  const c = I.compile({ '{n} reps': { one: '{n} powtórzenie', few: '{n} powtórzenia', many: '{n} powtórzeń', other: '{n} powtórzenia' } });
  assert.equal(I.translate(c, 'pl', '1 reps'), '1 powtórzenie');
  assert.equal(I.translate(c, 'pl', '3 reps'), '3 powtórzenia');
  assert.equal(I.translate(c, 'pl', '5 reps'), '5 powtórzeń');
});

test('every page loads i18n.js first and has a language menu; the review page loads it from the judge', () => {
  for (const f of ['index.html', 'console.html', 'results.html', 'streaming.html', 'phone.html', 'customers.html', 'broadcaster.html', 'judge.html']) {
    const p = read(f);
    assert.match(p, /<meta name="viewport"[^>]*>\n<script src="i18n\.js"><\/script>/, f);
    assert.match(p, /data-lang-picker/, f);
  }
  assert.match(read('server/review/index.html'), /<script src="\/judge\/i18n\.js"><\/script>/);
  assert.match(read('scripts/site-files.txt'), /^i18n\.js$/m);
  assert.match(read('scripts/build-server.sh'), /brand\.js i18n\.js"/);
  assert.match(read('scripts/build-broadcaster.sh'), /i18n\.js/);
});

test('a judge on a server never translates, and the review opens in the website\'s language', () => {
  assert.match(read('i18n.js'), /if \(params\.get\('engine'\) \|\| params\.get\('bg'\)\) return;/);
  const { landing } = require('../server/auth.js');
  assert.equal(landing(new URLSearchParams('tab=live&n=1&of=1&lang=fr')), '/?tab=live&n=1&of=1&lang=fr');
  assert.equal(landing(new URLSearchParams('tab=live&lang=<x>')), '/?tab=live&n=1&of=1');
  assert.match(read('apptabs.js'), /&lang=\$\{lang\}/);
});

test('the list to translate is up to date (node scripts/i18n-extract.mjs)', () => {
  const now = Object.keys(JSON.parse(read('i18n/en.json'))).sort();
  assert.deepEqual([...extract().keys()].sort(), now);
});

// what a translation must keep from the English: its {slots} and its <0>…</0> markers
const marks = (s) => [...String(s).matchAll(/\{\w+\}|<\/?\d+>/g)].map((m) => m[0]).sort().join(' ');
for (const f of fs.readdirSync(path.join(ROOT, 'i18n')).filter((x) => /^[a-z]{2}\.json$/.test(x) && x !== 'en.json')) {
  test(`${f}: every translation keeps the English's slots and markers, and is listed in the site's files`, () => {
    const en = JSON.parse(read('i18n/en.json')), d = JSON.parse(read('i18n/' + f));
    for (const [k, v] of Object.entries(d)) {
      assert.ok(k in en, `${f}: "${k}" isn't in en.json any more`);
      for (const one of typeof v === 'object' ? Object.values(v) : [v]) {
        if (typeof v === 'object') continue; // plural forms may leave the number out ("one")
        assert.equal(marks(one), marks(k), `${f}: "${k}" -> "${one}"`);
      }
    }
    assert.match(read('scripts/site-files.txt'), new RegExp(`^i18n/${f}$`, 'm'));
  });
}

test("an English plural ending the page puts in a slot (attempt{x} with 's') is left out in other languages, where it means nothing", () => {
  const c = I.compile({ '{n} attempt{x}': '{n} محاولة{x}', 'cited by {links} {x}': 'cité par {links} {x}', items: 'éléments' });
  assert.equal(I.translate(c, 'ar', '3 attempts'), '3 محاولة');
  assert.equal(I.translate(c, 'fr', 'cited by 4 items'), 'cité par 4 éléments', 'a whole word in a slot is still translated');
});

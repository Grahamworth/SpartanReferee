import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
// a plain browser script: run as the page would, handing it somewhere to put its functions
const m = { exports: {} };
new Function('module', fs.readFileSync(new URL('../brand.js', import.meta.url), 'utf8'))(m);
const { contrast, readable, on, themeVars } = m.exports;

test('a brand colour that can already be read is left exactly as chosen', () => {
  assert.strictEqual(readable('#ffc400', '#1c222a'), '#ffc400');
  assert.strictEqual(themeVars({ primary: '#e2231a', mode: 'light' })['--primary-text'], '#e2231a');
});

test('a dark colour on a dark page, or a pale one on a light page, is moved until it reads', () => {
  for (const [c, bg] of [['#0a1f44', '#1c222a'], ['#000000', '#1c222a'], ['#fff8dc', '#ffffff'], ['#ffffff', '#ffffff']]) {
    assert.ok(contrast(readable(c, bg), bg) >= 3, `${c} on ${bg}`);
  }
});

test('button text is whichever of black or white reads best', () => {
  assert.strictEqual(on('#ffc400'), '#101010');
  assert.strictEqual(on('#0a1f44'), '#ffffff');
  for (const c of ['#e2231a', '#3ddc97', '#7f7f7f', '#ff00ff']) assert.ok(contrast(c, on(c)) >= 3.9, c);
});

test('every theme gives readable text on its own background', () => {
  for (const theme of [{}, { mode: 'dark', primary: '#000000', accent: '#111111' }, { mode: 'light', primary: '#ffffff', accent: '#fefefe' }]) {
    const v = themeVars(theme);
    assert.ok(contrast(v['--text'], v['--bg']) >= 7);
    assert.ok(contrast(v['--muted'], v['--panel']) >= 4.5);
    assert.ok(contrast(v['--primary-text'], v['--panel']) >= 3);
    assert.ok(contrast(v['--accent'], v['--panel']) >= 3);
    assert.ok(contrast(v['--on-primary'], v['--primary']) >= 3.9);
  }
});

// The Assistant (21 November 2026): its answers become safe HTML (links only into the app, the event pages and the camera results),
// its button is on Home for whoever it's on for, its settings are in Config, and the full rulebook is in Rules.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { markdown, SAFE } from '../learn/assistant-md.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('an answer\'s links go only into the app, an event\'s page or the camera results', () => {
  const html = markdown('See [Spear Throw](#/obstacles/spear), [rule 3.17.7](#/rules/OCR-2026-3.17.7), [London](/event.html?id=10454) and [bib 12](/results.html?bib=12&day=2026-11-20&athlete=abc~3).');
  assert.match(html, /<a href="#\/obstacles\/spear">Spear Throw<\/a>/);
  assert.match(html, /<a href="#\/rules\/OCR-2026-3.17.7">rule 3.17.7<\/a>/);
  assert.match(html, /<a href="\/event.html\?id=10454">London<\/a>/);
  assert.match(html, /<a href="\/results.html\?bib=12&amp;day=2026-11-20&amp;athlete=abc~3">bib 12<\/a>/);
  for (const bad of ['https://evil.example/x', 'javascript:alert(1)', '//evil.example', '/learn/../admin', '#/x"onmouseover="y']) {
    assert.ok(!SAFE.test(bad), bad);
    assert.doesNotMatch(markdown(`[click](${bad})`), /<a /, bad);
  }
});
test('an answer\'s text can\'t carry HTML, and its lists and bold come out as such', () => {
  assert.doesNotMatch(markdown('<img src=x onerror=alert(1)> **bold**'), /<img/);
  assert.match(markdown('<b>x</b>'), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.strictEqual(markdown('**Pass:** in the target\n\n- one\n- two\n1. first'), '<p><b>Pass:</b> in the target</p><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>');
});
test('Home has the Assistant\'s button for whoever it\'s on for, and the app has its page', () => {
  assert.match(read('learn/home.js'), /helper\?\.allowed \? `<a class="btnLink primaryLink homeAssistant" href="#\/assistant">/);
  assert.match(read('learn/learn.js'), /import \* as assistant from '\.\/assistant\.js';/);
  assert.match(read('learn/assistant.js'), /export const views = \{ assistant: assistantView \};/);
});
test('Config sets who has it and the monthly limit; the API keeps no question or answer', () => {
  const html = read('customers.html');
  for (const v of ['off', 'chosen', 'all']) assert.match(html, new RegExp(`name="asMode" value="${v}"`));
  assert.match(html, /id="asCap" type="number"/);
  const sql = read('api/src/learn/migrations/012-assistant.sql');
  assert.match(sql, /monthly_cap_gbp DECIMAL\(9, 2\)\s+NOT NULL DEFAULT 50/);
  assert.doesNotMatch(sql, /^\s*\w*(question|answer)\w*\s+NVARCHAR/im, 'no question or answer column');
});
test('Rules shows each section\'s full text, under its chapter', () => {
  const g = read('learn/govern.js');
  assert.match(g, /r\.body \? `<div class="ruleBody">\$\{ruleText\(r\.body\)\}<\/div>`/);
  assert.match(g, /class="ruleGroup ruleDoc"/);
});

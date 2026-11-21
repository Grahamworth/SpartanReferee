'use strict';
// The Assistant (21 November 2026): what a question costs, who may use it, the monthly stop, and that it answers with the passages
// it found and the tools it called, never a link of its own making.
const test = require('node:test');
const assert = require('node:assert');
const { costOf, tokensOf } = require('../src/assistant-ai');
const { createAssistant } = require('../src/assistant');

const reply = (status, body) => ({ status, body });
test('a question costs what Azure charges for Luna: cached input at a tenth of the price', () => {
  const c = costOf({ input_tokens: 10000, input_tokens_details: { cached_tokens: 8000 }, output_tokens: 500 });
  assert.ok(Math.abs(c - (2000 * 0.0752 + 8000 * 0.0075 + 500 * 0.3759) / 1e6) < 1e-12);
  assert.deepStrictEqual(tokensOf({ prompt_tokens: 3, completion_tokens: 2 }), { input: 3, cached: 0, output: 2 });
});

// a pretend database: the one settings row, the people allowed, and the month's spending
function fakeDb({ mode = 'chosen', cap = 50, spent = 0, chosen = [] } = {}) {
  const usage = [];
  return {
    schema: 'learn_test', usage,
    async query(sql, p = {}) {
      if (/FROM \{S\}\.assistant_setting/.test(sql)) return [{ mode, monthly_cap_gbp: cap }];
      if (/SUM\(cost_gbp\)/.test(sql)) return [{ s: spent }];
      if (/FROM \{S\}\.person WHERE LOWER\(email\)/.test(sql)) return chosen.includes(p.e) ? [{ person_id: `id-${p.e}` }] : [{ person_id: `other-${p.e}` }];
      if (/FROM \{S\}\.assistant_access WHERE person_id/.test(sql)) return chosen.some((e) => `id-${e}` === p.p) ? [{ x: 1 }] : [];
      if (/INSERT INTO \{S\}\.assistant_usage/.test(sql)) { usage.push(p); return []; }
      return [];
    },
  };
}
const v = (x, y) => { const a = new Float32Array(1536); a[0] = x; a[1] = y; return a; };
const b64 = (a) => Buffer.from(a.buffer).toString('base64');
const INDEX = { builtAt: 'now', chunks: [
  { id: 'r', kind: 'rule', ref: 'OCR-2026-3.17.7', title: 'Rules 3.17.7: bells', link: '#/rules/OCR-2026-3.17.7', text: 'Kicking a bell is a fail.', v: b64(v(1, 0)) },
  { id: 'o', kind: 'obstacle', ref: 'spear', title: 'Obstacle: Spear Throw', link: '#/obstacles/spear', text: 'Spear in the target.', v: b64(v(0, 1)) },
] };
function make(dbOpts, answer = 'No: kicking is a fail. [Rules of Competition 3.17.7](#/rules/OCR-2026-3.17.7) [elsewhere](https://evil.example)') {
  const db = fakeDb(dbOpts), asked = [];
  const ai = { embed: async () => ({ vectors: [v(1, 0.1)], tokens: 5 }),
    respond: async (body) => { asked.push(body); return { output: [{ type: 'message', content: [{ type: 'output_text', text: answer }] }], usage: { input_tokens: 1000, output_tokens: 50 } }; } };
  const members = { 'ref@x.com': { admin: false, email: 'ref@x.com', name: 'Ref' }, 'boss@x.com': { admin: true, email: 'boss@x.com', name: 'Boss' } };
  const a = createAssistant({ db, ai, indexSigner: () => 'https://index', member: async (me) => members[me.email] || null, session: (h) => (h.who ? { email: h.who } : null), reply,
    events: { all: async () => [], upcoming: async () => [], fresh: async () => {} }, myEvents: async () => reply(200, { upcoming: [], past: [] }), recordings: async () => reply(200, { athletes: [] }),
    doFetch: async () => ({ ok: true, json: async () => INDEX }) });
  return { a, db, asked };
}
const ask = (a, who, q = 'Can they kick the bell?') => a.handle('POST', ['assistant', 'ask'], { lang: 'fr', messages: [{ role: 'user', content: q }] }, { who });

test('it\'s on for admins always, for chosen people when chosen, for everyone when all, and for no one else', async () => {
  assert.strictEqual((await ask(make({ mode: 'off' }).a, 'ref@x.com')).status, 403);
  assert.strictEqual((await ask(make({ mode: 'off' }).a, 'boss@x.com')).status, 200);
  assert.strictEqual((await ask(make({ mode: 'chosen' }).a, 'ref@x.com')).status, 403);
  assert.strictEqual((await ask(make({ mode: 'chosen', chosen: ['ref@x.com'] }).a, 'ref@x.com')).status, 200);
  assert.strictEqual((await ask(make({ mode: 'all' }).a, 'ref@x.com')).status, 200);
  assert.strictEqual((await ask(make({ mode: 'all' }).a, undefined)).status, 401);
  const s = await make({ mode: 'chosen' }).a.handle('GET', ['assistant'], null, { who: 'ref@x.com' });
  assert.deepStrictEqual([s.status, s.body.allowed], [200, false]);
});
test('it stops for everyone once the month\'s spending reaches the limit', async () => {
  const r = await ask(make({ mode: 'all', cap: 50, spent: 50 }).a, 'boss@x.com');
  assert.strictEqual(r.status, 429);
  assert.match(r.body.error, /spending limit/);
});
test('an answer: the closest passages go to Luna with the referee\'s language, each question\'s cost is noted, nothing of it is kept', async () => {
  const { a, db, asked } = make({ mode: 'all' });
  const r = await ask(a, 'ref@x.com');
  assert.strictEqual(r.status, 200);
  const sent = JSON.stringify(asked[0].input);
  assert.match(sent, /Kicking a bell is a fail/, 'the closest passage');
  assert.match(sent, /Reply in French/);
  assert.deepStrictEqual(r.body.sources, [{ link: '#/rules/OCR-2026-3.17.7', title: 'Rules 3.17.7: bells' }], 'only what the answer links');
  assert.strictEqual(db.usage.length, 1);
  assert.ok(db.usage[0].g > 0 && db.usage[0].i === 1000 && db.usage[0].o === 50);
  assert.ok(!Object.values(db.usage[0]).some((x) => String(x).includes('kick')), 'the question isn\'t stored');
});
test('the model\'s site pages written as app pages are put right', async () => {
  const { a } = make({ mode: 'all' }, 'The next one: [London](#/event.html?id=10454)');
  const r = await ask(a, 'ref@x.com', 'What\'s next?');
  assert.match(r.body.answer, /\[London\]\(\/event\.html\?id=10454\)/);
});
test('settings are admins\' only', async () => {
  const { a } = make({ mode: 'all' });
  assert.strictEqual((await a.handle('GET', ['assistant', 'settings'], null, { who: 'ref@x.com' })).status, 403);
  assert.strictEqual((await a.handle('PUT', ['assistant', 'settings'], { mode: 'sometimes' }, { who: 'boss@x.com' })).status, 400);
  assert.strictEqual((await a.handle('PUT', ['assistant', 'settings'], { capGbp: 5000 }, { who: 'boss@x.com' })).status, 400);
});

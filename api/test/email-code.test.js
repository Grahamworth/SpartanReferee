'use strict';
// Email (mailer.js) and signing in with a code emailed to the address (core.js).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { createMailer, memoryMailer, layout } = require('../src/mailer');

test('the mailer signs each request with the resource key, as Azure Communication Services expects', async () => {
  const key = Buffer.from('secret-key').toString('base64');
  let seen = null;
  const m = createMailer({ connection: `endpoint=https://sr.uk.communication.azure.com/;accesskey=${key}`, from: 'DoNotReply@x.azurecomm.net', now: () => new Date('2026-11-19T12:00:00Z'),
    doFetch: async (url, o) => { seen = { url, o }; return { status: 202, json: async () => ({ id: 'op1' }) }; } });
  assert.deepStrictEqual(await m.send({ to: 'ann@example.com', subject: 'Hi', text: 'Hello' }), { id: 'op1' });
  assert.strictEqual(seen.url, 'https://sr.uk.communication.azure.com/emails:send?api-version=2023-03-31');
  const h = seen.o.headers, body = JSON.parse(seen.o.body);
  assert.deepStrictEqual(body.recipients.to, [{ address: 'ann@example.com' }]); assert.strictEqual(body.senderAddress, 'DoNotReply@x.azurecomm.net');
  assert.strictEqual(h['x-ms-content-sha256'], crypto.createHash('sha256').update(seen.o.body).digest('base64'));
  const want = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(`POST\n/emails:send?api-version=2023-03-31\n${h['x-ms-date']};sr.uk.communication.azure.com;${h['x-ms-content-sha256']}`).digest('base64');
  assert.strictEqual(h.Authorization, `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${want}`);
  assert.strictEqual(createMailer({ connection: '', from: 'x' }), null, 'not set up: no mailer');
  const l = layout({ title: 'T', lines: ['<b>'], link: 'https://x/?a=1&b=2', linkText: 'Go' });
  assert.match(l.html, /&lt;b&gt;/); assert.match(l.text, /Go: https:\/\/x\/\?a=1&b=2/);
});

function api(mailer = memoryMailer()) {
  const store = memoryStore();
  return { mailer, store, api: createApi({ store, secret: 'test-secret-test-secret-test-secret', adminEmails: ['boss@example.com'], mailer, now: Date.now }) };
}
const call = (a, method, path, body, headers = {}) => a.handle({ method, path, headers, body });

test('a code goes only to an address that can sign in, works once, and gives a session for that address', async () => {
  const { api: a, mailer, store } = api();
  await store.put('people:spartan', 'ref@example.com', { email: 'ref@example.com', role: 'member' });
  assert.strictEqual((await call(a, 'POST', 'auth/code', { email: 'stranger@example.com' })).status, 200, 'the same answer for anyone');
  assert.strictEqual(mailer.sent.length, 0, 'but nothing is sent to an address that isn\'t in');
  assert.strictEqual((await call(a, 'POST', 'auth/code', { email: 'Ref@Example.com' })).status, 200);
  assert.strictEqual(mailer.sent.length, 1); assert.strictEqual(mailer.sent[0].to, 'ref@example.com');
  const code = /(\d{6})/.exec(mailer.sent[0].subject)[1];
  await call(a, 'POST', 'auth/code', { email: 'ref@example.com' });
  assert.strictEqual(mailer.sent.length, 1, 'one a minute at most');
  assert.strictEqual((await call(a, 'POST', 'auth/code/verify', { email: 'ref@example.com', code: code === '000000' ? '111111' : '000000' })).status, 401);
  const ok = await call(a, 'POST', 'auth/code/verify', { email: 'ref@example.com', code });
  assert.strictEqual(ok.status, 200); assert.ok(ok.body.token);
  assert.strictEqual((await call(a, 'POST', 'auth/code/verify', { email: 'ref@example.com', code })).status, 401, 'a code works once');
  const home = await call(a, 'GET', 'home', null, { 'x-session': ok.body.token });
  assert.strictEqual(home.status, 200); assert.strictEqual(home.body.email, 'ref@example.com');
});
test('five wrong codes and that code is spent', async () => {
  const { api: a, mailer } = api();
  await call(a, 'POST', 'auth/code', { email: 'boss@example.com' });
  const code = /(\d{6})/.exec(mailer.sent[0].subject)[1], wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await call(a, 'POST', 'auth/code/verify', { email: 'boss@example.com', code: wrong });
  assert.strictEqual((await call(a, 'POST', 'auth/code/verify', { email: 'boss@example.com', code })).status, 401);
});
test('no email set up: email sign-in says so, and the config says it\'s off', async () => {
  const a = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret' });
  assert.strictEqual((await call(a, 'POST', 'auth/code', { email: 'a@b.co' })).status, 503);
  assert.strictEqual((await call(a, 'GET', 'config')).body.codeSignIn, false);
});

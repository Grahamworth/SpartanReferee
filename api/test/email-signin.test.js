'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { createEmailSignIn, REDIRECT_URI } = require('../src/email-signin');

const TENANT = '3F85A2EE-0000-0000-0000-000000000001', CLIENT = 'broadcaster-client';
const VERIFIER = 'a'.repeat(43), NOW = 1_800_000_000_000;
const idToken = (c) => `x.${Buffer.from(JSON.stringify({ aud: CLIENT, tid: TENANT.toLowerCase(), exp: NOW / 1000 + 600, oid: 'person-1', email: 'sam@example.com', name: 'Sam', ...c })).toString('base64url')}.y`;
const answering = (status, body, sent = []) => async (url, init) => { sent.push({ url, form: Object.fromEntries(init.body) }); return { ok: status < 400, status, json: async () => body }; };
const signIn = (fetchFn) => createEmailSignIn({ subdomain: 'headjudge', tenantId: TENANT, clientId: CLIENT, fetchFn, now: () => NOW });

test('with no settings there is no email sign-in', () => {
  assert.strictEqual(createEmailSignIn({ subdomain: '', tenantId: TENANT, clientId: CLIENT }), null);
});

test('the app is told where to go, and nothing secret', () => {
  const { config } = signIn(answering(200, {}));
  assert.deepStrictEqual(config, { authorizeUrl: `https://headjudge.ciamlogin.com/${TENANT}/oauth2/v2.0/authorize`, clientId: CLIENT, redirectUri: REDIRECT_URI });
});

test('a code is swapped with its verifier, and gives who it is', async () => {
  const sent = [];
  const who = await signIn(answering(200, { id_token: idToken({}) }, sent)).redeem('the-code', VERIFIER);
  assert.deepStrictEqual(who, { sub: 'person-1', email: 'sam@example.com', name: 'Sam' });
  assert.strictEqual(sent[0].url, `https://headjudge.ciamlogin.com/${TENANT}/oauth2/v2.0/token`);
  assert.deepStrictEqual(sent[0].form, { grant_type: 'authorization_code', client_id: CLIENT, code: 'the-code', code_verifier: VERIFIER, redirect_uri: REDIRECT_URI, scope: 'openid profile email' });
});

test('the address falls back to the sign-in name when the email claim is missing', async () => {
  const who = await signIn(answering(200, { id_token: idToken({ email: undefined, preferred_username: 'jo@example.com' }) })).redeem('c', VERIFIER);
  assert.strictEqual(who.email, 'jo@example.com');
});

for (const [why, claims] of [['another app', { aud: 'someone-else' }], ['another tenant', { tid: 'other-tenant' }], ['expired', { exp: NOW / 1000 - 1 }], ['nobody', { oid: undefined }]]) {
  test(`a token for ${why} is refused`, async () => {
    await assert.rejects(signIn(answering(200, { id_token: idToken(claims) })).redeem('c', VERIFIER));
  });
}

test('Microsoft refusing the code is refused', async () => {
  await assert.rejects(signIn(answering(400, { error: 'invalid_grant', error_description: 'AADSTS70008: expired\nmore' })).redeem('c', VERIFIER), /AADSTS70008: expired$/);
});

function site(emailSignIn) {
  const store = memoryStore();
  const api = createApi({ store, now: () => NOW, secret: 'test-secret-test-secret-test-secret', adminEmails: ['boss@example.com'], emailSignIn });
  const post = (body, headers = {}) => api.handle({ method: 'POST', path: 'auth/email', headers, body });
  return { api, store, post };
}
const pretend = (who) => ({ config: { authorizeUrl: 'u', clientId: 'c', redirectUri: REDIRECT_URI }, redeem: async (code) => { if (code !== 'good') throw new Error('bad'); return who; } });

const DAY = 24 * 3600 * 1000;
const claims = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
function renewing(startAt) {
  let at = startAt;
  const api = createApi({ store: memoryStore(), now: () => at, secret: 'test-secret-test-secret-test-secret', adminEmails: [], emailSignIn: pretend({ sub: 'person-1', email: 'sam@example.com', name: 'Sam' }) });
  const renew = (token) => api.handle({ method: 'POST', path: 'auth/renew', headers: token ? { authorization: `Bearer ${token}` } : {}, body: {} });
  return { api, renew, later: (days) => { at += days * DAY; return at; } };
}
test('using the app renews its session, up to 90 days from the last email sign-in', async () => {
  const { api, renew, later } = renewing(NOW);
  const first = (await api.handle({ method: 'POST', path: 'auth/email', headers: {}, body: { code: 'good', verifier: VERIFIER } })).body.token;
  assert.strictEqual(claims(first).since, NOW);
  assert.strictEqual(claims(first).exp, NOW + 30 * DAY);
  const at20 = later(20);
  const second = (await renew(first)).body.token;
  assert.strictEqual(claims(second).exp, at20 + 30 * DAY);
  assert.strictEqual(claims(second).since, NOW, 'renewing doesn\'t restart the 90 days');
  later(25); // day 45
  const third = (await renew(second)).body.token;
  later(25); // day 70: the limit is now nearer than 30 days away
  const fourth = (await renew(third)).body.token;
  assert.strictEqual(claims(fourth).exp, NOW + 90 * DAY);
  later(19); // day 89
  assert.strictEqual(claims((await renew(fourth)).body.token).exp, NOW + 90 * DAY);
  later(2); // day 91: over, so it's back to email
  assert.strictEqual((await renew(fourth)).status, 401);
});
test('a session from before renewing existed counts its 90 days from when it began', async () => {
  const { api, renew, later } = renewing(NOW);
  const old = (await api.handle({ method: 'POST', path: 'auth/email', headers: {}, body: { code: 'good', verifier: VERIFIER } })).body.token;
  const c = claims(old); delete c.since;
  const crypto = require('node:crypto'), p = Buffer.from(JSON.stringify(c)).toString('base64url');
  const noSince = `${p}.${crypto.createHmac('sha256', 'test-secret-test-secret-test-secret').update(p).digest('base64url')}`;
  later(1);
  assert.strictEqual(claims((await renew(noSince)).body.token).since, NOW);
});
test('renewing needs a real, live email session', async () => {
  const { api, renew, later } = renewing(NOW);
  assert.strictEqual((await renew('')).status, 401);
  const token = (await api.handle({ method: 'POST', path: 'auth/email', headers: {}, body: { code: 'good', verifier: VERIFIER } })).body.token;
  assert.strictEqual((await renew(`${token}x`)).status, 401, 'an altered session');
  const [p] = token.split('.');
  assert.strictEqual((await renew(`${p}.forged`)).status, 401, 'a forged signature');
  later(31);
  assert.strictEqual((await renew(token)).status, 401, 'a session that has run out can\'t be renewed');
});
test('a Google session isn\'t renewed this way', async () => {
  const crypto = require('node:crypto'), { renew } = renewing(NOW);
  const p = Buffer.from(JSON.stringify({ uid: 'g_someone', exp: NOW + DAY })).toString('base64url');
  assert.strictEqual((await renew(`${p}.${crypto.createHmac('sha256', 'test-secret-test-secret-test-secret').update(p).digest('base64url')}`)).status, 401);
});
test('a good code gives a session, and the account is recorded', async () => {
  const { api, store, post } = site(pretend({ sub: 'person-1', email: 'sam@example.com', name: 'Sam' }));
  const r = await post({ code: 'good', verifier: VERIFIER });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.user.email, 'sam@example.com');
  assert.ok(r.body.user.id.startsWith('e_'));
  assert.strictEqual((await store.get('profile', r.body.user.id)).email, 'sam@example.com');
  const me = await api.handle({ method: 'GET', path: 'me', headers: { Authorization: `Bearer ${r.body.token}` } });
  assert.strictEqual(me.body.user.email, 'sam@example.com');
  const again = await post({ code: 'good', verifier: VERIFIER });
  assert.strictEqual(again.body.user.id, r.body.user.id, 'signing in again is the same account');
});

test('the app\'s plain-text form of the request works too', async () => {
  const { api } = site(pretend({ sub: 'p', email: 'a@example.com', name: '' }));
  const r = await api.handle({ method: 'POST', path: 'auth/email', body: { _env: 1, m: 'POST', d: '', b: { code: 'good', verifier: VERIFIER } } });
  assert.strictEqual(r.status, 200);
});

test('a bad code, or a badly formed request, gets no session', async () => {
  const { post } = site(pretend({ sub: 'p', email: 'a@example.com', name: '' }));
  assert.strictEqual((await post({ code: 'nope', verifier: VERIFIER })).status, 401);
  assert.strictEqual((await post({ code: 'good', verifier: 'short' })).status, 400);
  assert.strictEqual((await post({ code: { a: 1 }, verifier: VERIFIER })).status, 400);
  assert.strictEqual((await post(null)).status, 400);
});

test('an email account with the admin\'s address is not an admin', async () => {
  const { api, post } = site(pretend({ sub: 'p', email: 'boss@example.com', name: '' }));
  const { token } = (await post({ code: 'good', verifier: VERIFIER })).body;
  const me = await api.handle({ method: 'GET', path: 'me', headers: { Authorization: `Bearer ${token}` } });
  assert.strictEqual(me.body.admin, false);
});

test('the site says whether email sign-in is available', async () => {
  assert.strictEqual((await site(null).api.handle({ method: 'GET', path: 'config' })).body.emailSignIn, null);
  assert.strictEqual((await site(null).post({ code: 'good', verifier: VERIFIER })).status, 503);
  assert.strictEqual((await site(pretend({})).api.handle({ method: 'GET', path: 'config' })).body.emailSignIn.redirectUri, REDIRECT_URI);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { createMicrosoftSignIn, WEB_REDIRECT_URI, PERSONAL_ACCOUNTS } = require('../src/microsoft-signin');

const CLIENT = 'headjudge-client', WORK = '11111111-2222-3333-4444-555555555555';
const VERIFIER = 'a'.repeat(43), NOW = 1_800_000_000_000;
const idToken = (c) => {
  const tid = c.tid ?? WORK;
  return `x.${Buffer.from(JSON.stringify({ aud: CLIENT, tid, iss: `https://login.microsoftonline.com/${tid}/v2.0`, exp: NOW / 1000 + 600, oid: 'person-1', email: 'Sam@Example.com', preferred_username: 'sam@example.com', name: 'Sam', ...c })).toString('base64url')}.y`;
};
const answering = (status, body, sent = []) => async (url, init) => { sent.push({ url, form: Object.fromEntries(init.body) }); return { ok: status < 400, status, json: async () => body }; };
const signIn = (fetchFn) => createMicrosoftSignIn({ clientId: CLIENT, fetchFn, now: () => NOW });

test('with no client id there is no Microsoft sign-in', () => {
  assert.strictEqual(createMicrosoftSignIn({ clientId: '' }), null);
});

test('the page is told where to go, and nothing secret: any work, school or personal account', () => {
  assert.deepStrictEqual(signIn(answering(200, {})).config, { authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', clientId: CLIENT, webRedirectUri: WEB_REDIRECT_URI });
});

test('a code is swapped with its verifier; a work address its organisation has proved it owns is vouched for', async () => {
  const sent = [];
  const who = await signIn(answering(200, { id_token: idToken({ xms_edov: true }) }, sent)).redeem('the-code', VERIFIER, WEB_REDIRECT_URI);
  assert.deepStrictEqual(who, { sub: `${WORK}:person-1`, email: 'sam@example.com', shownEmail: 'sam@example.com', name: 'Sam' });
  assert.strictEqual(sent[0].url, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
  assert.deepStrictEqual(sent[0].form, { grant_type: 'authorization_code', client_id: CLIENT, code: 'the-code', code_verifier: VERIFIER, redirect_uri: WEB_REDIRECT_URI, scope: 'openid profile email' });
});

test('a personal account\'s own address is vouched for', async () => {
  const who = await signIn(answering(200, { id_token: idToken({ tid: PERSONAL_ACCOUNTS }) })).redeem('c', VERIFIER, WEB_REDIRECT_URI);
  assert.strictEqual(who.email, 'sam@example.com');
});

test('a work address nobody has proved is shown, but not vouched for', async () => {
  const who = await signIn(answering(200, { id_token: idToken({}) })).redeem('c', VERIFIER, WEB_REDIRECT_URI);
  assert.strictEqual(who.email, '');
  assert.strictEqual(who.shownEmail, 'sam@example.com');
  const noEmail = await signIn(answering(200, { id_token: idToken({ email: undefined, xms_edov: true }) })).redeem('c', VERIFIER, WEB_REDIRECT_URI);
  assert.strictEqual(noEmail.email, '');
  assert.strictEqual(noEmail.shownEmail, 'sam@example.com', 'the sign-in name stands in for the address');
});

for (const [why, claims] of [['another app', { aud: 'someone-else' }], ['another issuer', { iss: 'https://evil.example/v2.0' }], ['expired', { exp: NOW / 1000 - 1 }], ['nobody', { oid: undefined, sub: undefined }]]) {
  test(`a token for ${why} is refused`, async () => {
    await assert.rejects(signIn(answering(200, { id_token: idToken(claims) })).redeem('c', VERIFIER, WEB_REDIRECT_URI));
  });
}
test('a code meant for another address, or one Microsoft refuses, is refused', async () => {
  await assert.rejects(signIn(answering(200, { id_token: idToken({}) })).redeem('c', VERIFIER, 'https://evil.example/return'));
  await assert.rejects(signIn(answering(400, { error: 'invalid_grant' })).redeem('c', VERIFIER, WEB_REDIRECT_URI));
});

const apiWith = (claims, adminEmails = ['boss@example.com']) => createApi({
  store: memoryStore(), secret: 'test-secret-test-secret-test-secret', adminEmails, now: () => NOW,
  microsoftSignIn: signIn(answering(200, { id_token: idToken(claims) })),
});
const post = (api, body) => api.handle({ method: 'POST', path: 'auth/microsoft', headers: {}, body });
const meWith = (api, token) => api.handle({ method: 'GET', path: 'me', headers: { 'x-session': token, 'x-device': 'device-0123456789abcdef' } });

test('the site is told about Microsoft sign-in, and signing in gives a session', async () => {
  const api = apiWith({ email: 'boss@example.com', xms_edov: true });
  assert.deepStrictEqual((await api.handle({ method: 'GET', path: 'config', headers: {} })).body.microsoftSignIn.webRedirectUri, WEB_REDIRECT_URI);
  const r = await post(api, { code: 'c', verifier: VERIFIER, redirectUri: WEB_REDIRECT_URI });
  assert.strictEqual(r.status, 200);
  const me = (await meWith(api, r.body.token)).body;
  assert.strictEqual(me.user.email, 'boss@example.com');
  assert.strictEqual(me.admin, true, 'an admin\'s vouched-for address makes them an admin');
});

test('an address Microsoft doesn\'t vouch for never makes anyone an admin', async () => {
  const api = apiWith({ email: 'boss@example.com' });
  const r = await post(api, { code: 'c', verifier: VERIFIER, redirectUri: WEB_REDIRECT_URI });
  const me = (await meWith(api, r.body.token)).body;
  assert.strictEqual(me.user.email, 'boss@example.com', 'still shown as theirs');
  assert.strictEqual(me.admin, false);
});

test('a bad request, or a refused code, gets no session', async () => {
  const api = apiWith({ aud: 'someone-else' });
  assert.strictEqual((await post(api, { code: 'c', verifier: 'short' })).status, 400);
  assert.strictEqual((await post(api, { code: 'c', verifier: VERIFIER, redirectUri: WEB_REDIRECT_URI })).status, 401);
  const off = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret' });
  assert.strictEqual((await post(off, { code: 'c', verifier: VERIFIER })).status, 503);
});

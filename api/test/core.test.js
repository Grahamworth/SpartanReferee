'use strict';
// HeadJudge's backend core: sign-in, who you are, who's an admin. Spartans' parts (chat, groups, home content, profiles, news,
// scores) moved to the Spartans project on 8 November 2026 and aren't here.
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');

function setup() {
  const api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'], verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }) });
  const call = async (method, path, headers = {}, body) => api.handle({ method, path, headers, body });
  const signIn = async (who) => ({ 'X-Session': (await call('POST', 'auth/google', {}, { idToken: who })).body.token });
  return { call, signIn };
}

test('Google sign-in gives a session, and me says who you are and whether you\'re an admin', async () => {
  const { call, signIn } = setup();
  assert.strictEqual((await call('GET', 'config')).body.signIn, true);
  const boss = await signIn('boss'), sam = await signIn('sam');
  const me = (await call('GET', 'me', boss)).body;
  assert.strictEqual(me.user.email, 'boss@example.com'); assert.strictEqual(me.admin, true);
  assert.strictEqual((await call('GET', 'me', sam)).body.admin, false);
  assert.strictEqual((await call('GET', 'admin/admins', sam)).status, 403);
  assert.strictEqual((await call('GET', 'admin/admins', boss)).status, 200);
});

test('Spartans\' parts are gone from here', async () => {
  const { call, signIn } = setup();
  const boss = await signIn('boss');
  for (const path of ['content', 'board', 'board/general', 'groups', 'news', 'scores/burpee1', 'admin/people', 'admin/judgecode', 'admin/bans']) {
    assert.strictEqual((await call('GET', path, boss)).status, 404, path);
  }
  assert.strictEqual((await call('PUT', 'profile', boss, { name: 'x' })).status, 404);
});

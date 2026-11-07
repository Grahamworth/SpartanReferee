// The Broadcaster's sign-in: the parts that must be right whatever Microsoft's page does.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

globalThis.location ??= { protocol: 'file:', hostname: '', port: '' }; // api-base.js looks at where it's running
const { sessionOpen, randomText, challengeFor, signInAddress, readReturn } = await import('../broadcaster-signin.js');

const session = (exp) => `${Buffer.from(JSON.stringify({ uid: 'e_x', exp })).toString('base64url')}.signature`;
const REDIRECT = 'com.vdaso.spartans.broadcast://auth';
const pending = { verifier: 'v', state: 'the-state', redirectUri: REDIRECT };

test('a session counts until it runs out', () => {
  assert.strictEqual(sessionOpen(session(2000), 1000), true);
  assert.strictEqual(sessionOpen(session(1000), 2000), false);
});
test('anything that isn\'t a session doesn\'t count', () => {
  for (const t of ['', 'nonsense', 'a.b', null, undefined]) assert.strictEqual(sessionOpen(t), false);
});
test('the challenge is the standard PKCE one (RFC 7636\'s worked example)', async () => {
  assert.strictEqual(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('a verifier is long enough for Microsoft and the API, and different each time', () => {
  const a = randomText(), b = randomText();
  assert.match(a, /^[\w-]{43}$/);
  assert.notStrictEqual(a, b);
});
test('the sign-in address asks for a code with PKCE, and opens on sign-up or asks again', () => {
  const cfg = { authorizeUrl: 'https://headjudge.ciamlogin.com/t/oauth2/v2.0/authorize', clientId: 'cid', redirectUri: REDIRECT };
  const q = (create) => new URL(signInAddress(cfg, { create, state: 's', challenge: 'c' })).searchParams;
  assert.strictEqual(q(true).get('prompt'), 'create');
  assert.strictEqual(q(false).get('prompt'), 'login');
  assert.strictEqual(q(false).get('redirect_uri'), REDIRECT);
  assert.strictEqual(q(false).get('response_type'), 'code');
  assert.strictEqual(q(false).get('code_challenge_method'), 'S256');
  assert.strictEqual(q(false).get('scope'), 'openid profile email');
});
test('a good return gives the code', () => {
  assert.deepStrictEqual(readReturn(`${REDIRECT}?code=abc&state=the-state`, pending), { code: 'abc' });
});
test('Microsoft adds a slash to the address when it sends you back, and that still signs you in', () => {
  assert.deepStrictEqual(readReturn(`${REDIRECT}/?code=abc&state=the-state`, pending), { code: 'abc' });
  assert.match(readReturn(`${REDIRECT}/?error=login_required&error_description=AADSTS50058%3a+no+user&state=the-state`, pending).message, /AADSTS50058/);
  assert.strictEqual(readReturn(`${REDIRECT}/other?code=abc&state=the-state`, pending), null);
});
test('a return with the wrong state is refused, so a stranger\'s link can\'t sign you in as them', () => {
  assert.match(readReturn(`${REDIRECT}?code=abc&state=other`, pending).message, /match/);
});
test('other links, or a link with no sign-in under way, are ignored', () => {
  assert.strictEqual(readReturn('https://example.com/?code=abc', pending), null);
  assert.strictEqual(readReturn(`${REDIRECT}.evil?code=abc&state=the-state`, pending), null);
  assert.strictEqual(readReturn(`${REDIRECT}?code=abc&state=the-state`, null), null);
});
test('cancelling and Microsoft\'s errors say so, with its code to look up', () => {
  assert.match(readReturn(`${REDIRECT}?error=access_denied&state=the-state`, pending).message, /cancelled/);
  assert.match(readReturn(`${REDIRECT}?error=access_denied&error_description=AADSTS53003%3A+blocked&state=the-state`, pending).message, /AADSTS53003/);
});
test('the app is built with the sign-in screen, its link and the plugins it needs', () => {
  const s = fs.readFileSync(new URL('../scripts/build-broadcaster.sh', import.meta.url), 'utf8');
  assert.match(s, /broadcaster-signin\.js/);
  assert.match(s, /android:scheme="com\.vdaso\.spartans\.broadcast" android:host="auth"/);
  assert.match(s, /@capacitor\/browser/);
  assert.match(s, /@capacitor\/app/);
  assert.match(s, /html:not\(\.hj-in\) main/, 'the page stays hidden until signed in');
});

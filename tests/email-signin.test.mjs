// Email sign-in on the website: the parts that must be right whatever Microsoft's page does. And the Broadcaster has none.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { randomText, challengeFor, signInAddress, readReturn } from '../email-signin-core.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const RETURN = 'https://site.example/email-return.html', APP = 'com.vdaso.spartans.broadcast://auth';
const pending = { verifier: 'v', state: 'the-state', redirectUri: RETURN };

test('the challenge is the standard PKCE one (RFC 7636\'s worked example)', async () => {
  assert.strictEqual(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('a verifier is long enough for Microsoft and the API, and different each time', () => {
  const a = randomText(), b = randomText();
  assert.match(a, /^[\w-]{43}$/);
  assert.notStrictEqual(a, b);
});
test('the sign-in address asks for a code with PKCE, and opens on sign-up or asks again', () => {
  const cfg = { authorizeUrl: 'https://headjudge.ciamlogin.com/t/oauth2/v2.0/authorize', clientId: 'cid', redirectUri: RETURN };
  const q = (create) => new URL(signInAddress(cfg, { create, state: 's', challenge: 'c' })).searchParams;
  assert.strictEqual(q(true).get('prompt'), 'create');
  assert.strictEqual(q(false).get('prompt'), 'login');
  assert.strictEqual(q(false).get('redirect_uri'), RETURN);
  assert.strictEqual(q(false).get('response_type'), 'code');
  assert.strictEqual(q(false).get('code_challenge_method'), 'S256');
  assert.strictEqual(q(false).get('scope'), 'openid profile email');
});
test('a good return gives the code', () => {
  assert.deepStrictEqual(readReturn(`${RETURN}?code=abc&state=the-state`, pending), { code: 'abc' });
});
test('Microsoft adds a slash to an address with no path, and that still counts', () => {
  const app = { ...pending, redirectUri: APP };
  assert.deepStrictEqual(readReturn(`${APP}/?code=abc&state=the-state`, app), { code: 'abc' });
  assert.match(readReturn(`${APP}/?error=login_required&error_description=AADSTS50058%3a+no+user&state=the-state`, app).message, /AADSTS50058/);
  assert.strictEqual(readReturn(`${APP}/other?code=abc&state=the-state`, app), null);
});
test('a return with the wrong state is refused, so a stranger\'s link can\'t sign you in as them', () => {
  assert.match(readReturn(`${RETURN}?code=abc&state=other`, pending).message, /match/);
});
test('other links, or a link with no sign-in under way, are ignored', () => {
  assert.strictEqual(readReturn('https://example.com/?code=abc', pending), null);
  assert.strictEqual(readReturn(`${RETURN}.evil?code=abc&state=the-state`, pending), null);
  assert.strictEqual(readReturn(`${RETURN}?code=abc&state=the-state`, null), null);
});
test('cancelling and Microsoft\'s errors say so, with its code to look up', () => {
  assert.match(readReturn(`${RETURN}?error=access_denied&state=the-state`, pending).message, /cancelled/);
  assert.match(readReturn(`${RETURN}?error=access_denied&error_description=AADSTS53003%3A+blocked&state=the-state`, pending).message, /AADSTS53003/);
});
test('SpartanReferee is Microsoft sign-in only: no Google or email buttons on any page', () => {
  for (const f of ['console.html', 'console.js', 'results.html', 'results.js', 'customers.html', 'customers.js', 'email-signin-web.js', 'api-base.js']) {
    assert.doesNotMatch(read(f), /emailBtns|emailButtons|googleBtn|googleButton|accounts\.google\.com/, f);
  }
});
test('every sign-in page offers Sign in with Microsoft, which comes back to the same return page', () => {
  for (const [html, js] of [['console.html', 'console.js'], ['results.html', 'results.js'], ['customers.html', 'customers.js']]) {
    assert.match(read(html), /<div id="msBtn"><\/div>\s*<div id="devBtn">/, html);
    assert.match(read(js), new RegExp(`microsoftButton\\(\\$\\('msBtn'\\), '${html}'`), js);
  }
  const web = read('email-signin-web.js');
  assert.ok(web.includes("pending.provider === 'microsoft' ? 'auth/microsoft' : 'auth/email'"));
  assert.ok(web.includes("prompt: 'select_account'"), 'so someone who signed out can pick another account');
  const cfg = { authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', clientId: 'cid', redirectUri: RETURN };
  assert.strictEqual(new URL(signInAddress(cfg, { state: 's', challenge: 'c', prompt: 'select_account' })).searchParams.get('prompt'), 'select_account');
});
test('Sign out is at the top right of every page with an account, from the shared api-base.js', () => {
  const base = read('api-base.js');
  assert.ok(base.includes("button.className = 'link signOut'"));
  assert.ok(base.includes("querySelector('header.top, [data-account-bar]')"));
  for (const f of ['index.html', 'console.html', 'results.html', 'customers.html', 'streaming.html', 'phone.html']) {
    const page = read(f);
    assert.match(page, /<header class="top">/, f);
    const js = { 'console.html': 'console.js', 'results.html': 'results.js', 'customers.html': 'customers.js' }[f];
    assert.ok(page.includes('src="api-base.js"') || (js && read(js).includes("from './api-base.js'")), `${f} loads api-base.js`);
  }
  assert.match(read('recordings.html'), /data-account-bar/);
  assert.match(read('index.html'), /data-signin-link>Sign in</, 'the home page\'s Sign in becomes My console');
  // and the video review on the server
  assert.match(read('server/review/index.html'), /id="signOut" class="signout" href="logout"/);
});
test('the site sends its session in a header Azure leaves alone, as Azure replaces Authorization', () => {
  const base = read('api-base.js');
  assert.ok(base.includes("headers['X-Session'] = token"));
  assert.ok(!base.includes('headers.Authorization'));
});
test('there is no registration: its old address goes to the console', () => {
  assert.ok(!fs.existsSync(new URL('../register.js', import.meta.url)));
  assert.match(read('register.html'), /location\.replace\('console\.html'\)/);
  assert.doesNotMatch(read('scripts/site-files.txt'), /^register\.js$/m);
});
test('the console shows the way to the admin area only to admins', () => {
  assert.match(read('console.html'), /id="adminLink" href="customers.html" hidden/);
  assert.ok(read('console.js').includes("show($('adminLink'), !!me.admin)"));
});
test('the return page only ever goes back to our own pages', () => {
  assert.match(read('email-signin-web.js'), /new Set\(\['register\.html', 'console\.html', 'results\.html', 'customers\.html', 'learn\/'\]\)/);
});
test('the Broadcaster has no account: it opens straight on its camera page', () => {
  const s = read('scripts/build-broadcaster.sh');
  assert.ok(!read('broadcaster.html').includes('judge-gate.js'), 'no sign-in on its page');
  for (const gone of ['broadcaster-signin', '@capacitor/browser', '@capacitor/app', 'PhoneLock', 'biometric', 'android:scheme']) assert.ok(!s.includes(gone), gone);
  assert.ok(!fs.existsSync(new URL('../broadcaster-signin.js', import.meta.url)));
  for (const guide of ['phone.html', 'streaming.html']) assert.doesNotMatch(read(guide), /<b>Create account<\/b>/, guide);
});

// The Broadcaster's sign-in screen: nothing else in the app shows until you've signed in. Accounts are Microsoft
// Entra External ID (see api/src/email-signin.js): Microsoft's own page takes the email and password, sends the code
// that proves the address at sign-up, and sends a code at each sign-in. It opens in the phone's browser, and comes
// back to the app through its own link with a one-time code, which the API swaps for a 30-day session.
import { call, signOut } from './api-base.js';

const TOKEN = 'sp_token', EMAIL = 'hj_email', PENDING = 'hj_signin', CAMERA_SETTINGS = 'sp_station';
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } },
};
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Is this session still good? It's the API's own token: base64url(payload).signature */
export function sessionOpen(token, now = Date.now()) {
  try { return JSON.parse(atob(String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp > now; } catch { return false; }
}
export const randomText = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
export async function challengeFor(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
/** Microsoft's page. prompt=create opens on sign-up; prompt=login always asks again, so a shared phone is safe. */
export function signInAddress(cfg, { create, state, challenge }) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', response_mode: 'query', redirect_uri: cfg.redirectUri, scope: 'openid profile email',
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: create ? 'create' : 'login',
  });
  return `${cfg.authorizeUrl}?${q}`;
}
/** What came back from Microsoft's page: null when it isn't a link for this sign-in. */
export function readReturn(link, pending) {
  if (!pending || !String(link).startsWith(pending.redirectUri + '?')) return null;
  const q = new URLSearchParams(String(link).slice(pending.redirectUri.length + 1));
  if (q.get('state') !== pending.state) return { message: 'That sign-in didn’t match. Please try again.' };
  if (q.get('code')) return { code: q.get('code') };
  const err = q.get('error') || '', stated = /AADSTS\d+/.exec(q.get('error_description') || '');
  if (err === 'access_denied' && !stated) return { message: 'Sign-in was cancelled.' };
  return { message: `Sign-in didn’t finish${stated ? ` (${stated[0]})` : ''}. Please try again.` };
}

function start() {
  const { App, Browser } = (window.Capacitor && window.Capacitor.Plugins) || {};
  const gate = document.createElement('section');
  gate.id = 'signGate';
  gate.innerHTML = `<style>
    #signGate { position: fixed; inset: 0; z-index: 60; background: #1f2328; overflow-y: auto; padding: 32px 20px; }
    #signGate[hidden] { display: none; }
    #signGate > div { max-width: 420px; margin: 0 auto; }
    #signGate .btn { display: flex; width: 100%; justify-content: center; margin-top: 12px; }
    #signMsg { min-height: 1.5em; margin-top: 16px; color: #fff; }
    #signedIn { margin-top: 18px; overflow-wrap: anywhere; }
    #signOut { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
  </style><div>
    <h1 class="brand">HeadJudge <span>Broadcaster</span></h1>
    <p class="muted">Use your email address to create an account or sign in. After your password, we’ll email you a code to confirm it’s you.</p>
    <button class="btn btn-red btn-big" type="button" id="signCreate">Create account</button>
    <button class="btn btn-ghost" type="button" id="signIn">Sign in</button>
    <p id="signMsg" role="status"></p>
  </div>`;
  document.body.appendChild(gate);
  const bar = document.createElement('p');
  bar.className = 'muted'; bar.id = 'signedIn'; bar.hidden = true;
  bar.innerHTML = 'Signed in as <b id="signedEmail"></b> · <button type="button" id="signOut">Sign out</button>';
  document.querySelector('main').appendChild(bar);
  const $ = (id) => document.getElementById(id);

  const say = (s) => { $('signMsg').textContent = s; };
  const busy = (on) => { $('signCreate').disabled = on; $('signIn').disabled = on; };
  function show() {
    const inside = sessionOpen(store.get(TOKEN));
    if (!inside) signOut();
    gate.hidden = inside; bar.hidden = !inside;
    document.documentElement.classList.toggle('hj-in', inside);
    $('signedEmail').textContent = store.get(EMAIL);
  }

  async function go(create) {
    say('Opening the sign-in page…'); busy(true);
    try {
      const { emailSignIn: cfg } = await call('config');
      if (!cfg) { say('Sign-in isn’t switched on yet. Please try again later.'); return; }
      const verifier = randomText(), state = randomText(16);
      store.set(PENDING, JSON.stringify({ verifier, state, redirectUri: cfg.redirectUri }));
      await Browser.open({ url: signInAddress(cfg, { create, state, challenge: await challengeFor(verifier) }) });
      say('Finish in the page that opened. You’ll come back here.');
    } catch { say('Couldn’t reach HeadJudge. Check this phone’s internet, then try again.'); }
    finally { busy(false); }
  }

  async function finish(link) {
    let pending = null; try { pending = JSON.parse(store.get(PENDING)); } catch { /* none */ }
    const back = readReturn(link, pending);
    if (!back) return;
    store.set(PENDING, ''); // one try: the same link arriving twice does nothing
    if (Browser) Browser.close().catch(() => {});
    if (!back.code) { say(back.message); return; }
    say('Finishing sign-in…'); busy(true);
    try {
      const r = await call('auth/email', { method: 'POST', body: { code: back.code, verifier: pending.verifier } });
      store.set(TOKEN, r.token); store.set(EMAIL, r.user.email);
      say(''); show();
    } catch (e) { say(e.message || 'Sign-in didn’t work. Please try again.'); }
    finally { busy(false); }
  }

  $('signCreate').onclick = () => go(true);
  $('signIn').onclick = () => go(false);
  $('signOut').onclick = () => {
    if (!confirm('Sign out? This phone will forget its camera settings.')) return;
    signOut(); store.set(EMAIL, ''); store.set(CAMERA_SETTINGS, '');
    location.reload();
  };
  if (App) {
    App.addListener('appUrlOpen', (e) => finish(e.url));
    App.addListener('resume', show); // a session can run out while the app sits in the background
    App.getLaunchUrl().then((r) => { if (r && r.url) finish(r.url); }).catch(() => {});
  }
  show();
}

if (typeof document !== 'undefined') start();

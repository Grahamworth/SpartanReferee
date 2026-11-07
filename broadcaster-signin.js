// The Broadcaster's sign-in screen: nothing else in the app shows until you've signed in. Accounts are Microsoft
// Entra External ID (see api/src/email-signin.js): Microsoft's own page takes the email and password, sends the code
// that proves the address at sign-up, and sends a code at each sign-in. It opens in the phone's browser, and comes
// back to the app through its own link with a one-time code, which the API swaps for a 30-day session.
// After that the phone's own lock opens the app, as a banking app does: fingerprint, face or passcode (PhoneLockPlugin).
// Each unlock renews the session, up to 90 days from the last email sign-in (authRenew in api/src/core.js). A phone with
// no screen lock skips this, and signs in by email when its 30 days are up.
import { call, signOut } from './api-base.js';

const TOKEN = 'sp_token', EMAIL = 'hj_email', PENDING = 'hj_signin', CAMERA_SETTINGS = 'sp_station';
const DAY = 24 * 3600 * 1000, FULL_SESSION = 30 * DAY, ASK_AGAIN_AFTER = 5 * 60 * 1000;
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } },
};
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Is this session still good? It's the API's own token: base64url(payload).signature */
export function sessionOpen(token, now = Date.now()) {
  try { return JSON.parse(atob(String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp > now; } catch { return false; }
}
/** Worth asking for a longer session? At most about once a day, so it's not a call at every unlock. */
export function needsRenewal(token, now = Date.now()) {
  try { return JSON.parse(atob(String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp - now < FULL_SESSION - DAY; } catch { return false; }
}
/** Should the phone's lock ask again? `awayAt` is when the app went into the background: 0 if it hasn't. */
export const lockDue = (awayAt, now = Date.now()) => awayAt > 0 && now - awayAt >= ASK_AGAIN_AFTER;
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
  if (!pending || !String(link).startsWith(pending.redirectUri)) return null;
  // Microsoft adds a slash to the address it was given: com.vdaso.spartans.broadcast://auth/?code=...
  const query = /^\/?\?(.*)$/s.exec(String(link).slice(pending.redirectUri.length));
  if (!query) return null;
  const q = new URLSearchParams(query[1]);
  if (q.get('state') !== pending.state) return { message: 'That sign-in didn’t match. Please try again.' };
  if (q.get('code')) return { code: q.get('code') };
  const err = q.get('error') || '', stated = /AADSTS\d+/.exec(q.get('error_description') || '');
  if (err === 'access_denied' && !stated) return { message: 'Sign-in was cancelled.' };
  return { message: `Sign-in didn’t finish${stated ? ` (${stated[0]})` : ''}. Please try again.` };
}

function start() {
  const { App, Browser, PhoneLock } = (window.Capacitor && window.Capacitor.Plugins) || {};
  let hasLock = false, unlocked = false, unlocking = false, awayAt = 0;
  const gate = document.createElement('section');
  gate.id = 'signGate';
  gate.innerHTML = `<style>
    #signGate { position: fixed; inset: 0; z-index: 60; background: #1f2328; overflow-y: auto; padding: 32px 20px; }
    #signGate[hidden] { display: none; }
    #signGate > div { max-width: 420px; margin: 0 auto; }
    #signGate .btn { display: flex; width: 100%; justify-content: center; margin-top: 12px; }
    #signMsg { min-height: 1.5em; margin-top: 16px; color: #fff; }
    #signedIn { margin-top: 18px; overflow-wrap: anywhere; }
    #signOut, #lockEmail { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
    #lockEmail { display: block; margin-top: 18px; }
  </style><div>
    <h1 class="brand">HeadJudge <span>Broadcaster</span></h1>
    <div id="signChoices" hidden>
      <p class="muted">Use your email address to create an account or sign in. After your password, we’ll email you a code to confirm it’s you.</p>
      <button class="btn btn-red btn-big" type="button" id="signCreate">Create account</button>
      <button class="btn btn-ghost" type="button" id="signIn">Sign in</button>
    </div>
    <div id="lockChoices" hidden>
      <p class="muted">Use your fingerprint or phone passcode to open the app.</p>
      <button class="btn btn-red btn-big" type="button" id="lockOpen">Unlock</button>
      <button type="button" id="lockEmail">Sign out and use my email instead</button>
    </div>
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
  const isLocked = () => hasLock && !unlocked && sessionOpen(store.get(TOKEN));
  function show() {
    const open = sessionOpen(store.get(TOKEN));
    if (!open) { signOut(); unlocked = false; }
    const inside = open && !isLocked();
    gate.hidden = inside; bar.hidden = !inside;
    $('signChoices').hidden = open; $('lockChoices').hidden = !open || inside;
    document.documentElement.classList.toggle('hj-in', inside);
    $('signedEmail').textContent = store.get(EMAIL);
  }

  async function renew() {
    if (!needsRenewal(store.get(TOKEN))) return;
    try { const r = await call('auth/renew', { method: 'POST' }); if (sessionOpen(r.token)) store.set(TOKEN, r.token); }
    catch { /* no signal: the session still has its time left, and the next unlock asks again */ }
  }

  async function unlock() {
    if (unlocking) return;
    unlocking = true; say('');
    try {
      const r = await PhoneLock.unlock();
      if (r.unlocked) { unlocked = true; show(); renew(); }
      else say(r.cancelled || !r.message ? 'Tap Unlock to try again.' : r.message);
    } catch { say('Your phone’s lock didn’t open. Tap Unlock to try again.'); }
    finally { unlocking = false; }
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
      unlocked = true; awayAt = 0; // they've just proved it's them by email, so the phone's lock needn't ask as well
      say(''); show();
    } catch (e) { say(e.message || 'Sign-in didn’t work. Please try again.'); }
    finally { busy(false); }
  }

  $('signCreate').onclick = () => go(true);
  $('signIn').onclick = () => go(false);
  $('lockOpen').onclick = unlock;
  // Someone else may be holding the phone, so going back to email forgets the camera settings, as signing out does.
  $('signOut').onclick = $('lockEmail').onclick = () => {
    if (!confirm('Sign out? This phone will forget its camera settings.')) return;
    signOut(); store.set(EMAIL, ''); store.set(CAMERA_SETTINGS, '');
    location.reload();
  };
  const lockKnown = PhoneLock ? PhoneLock.available().then((r) => { hasLock = !!(r && r.available); }).catch(() => {}) : Promise.resolve();
  const check = () => { show(); if (isLocked()) unlock(); };
  if (App) {
    App.addListener('appUrlOpen', (e) => finish(e.url));
    App.addListener('pause', () => { awayAt = Date.now(); });
    App.addListener('resume', () => lockKnown.then(() => { // a session can also run out while the app sits in the background
      if (lockDue(awayAt)) unlocked = false;
      awayAt = 0;
      check();
    }));
    App.getLaunchUrl().then((r) => { if (r && r.url) finish(r.url); }).catch(() => {});
  }
  lockKnown.then(check);
}

if (typeof document !== 'undefined') start();

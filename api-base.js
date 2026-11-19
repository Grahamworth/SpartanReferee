// Where the backend is: the site's own /api, or (inside the Android / iPhone app, which runs from files on the
// phone) the hosted site's. Plus who you are: a random id for this phone, and your session once you've signed in.
const HOSTED = 'https://brave-forest-022879f03.3.azurestaticapps.net';
export const API = location.protocol.startsWith('http') && (location.hostname.endsWith('azurestaticapps.net') || location.port === '8795') ? '/api' : HOSTED + '/api';
const ls = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } } };

// A random id for this phone (sent with chat messages so you can delete your own; the server keeps only a hash).
export function deviceId() {
  let d = ls.get('sp_device');
  if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join(''); ls.set('sp_device', d); }
  return d;
}

export async function call(path, { method = 'GET', body, admin } = {}) {
  const token = ls.get('sp_token'), key = admin || ls.get('sp_admin');
  let r;
  if (API.startsWith('http')) {
    // in the app (another origin): one plain-text POST carrying everything, so the browser skips the CORS pre-check
    r = await fetch(`${API}/${path}`, { method: 'POST', body: JSON.stringify({ _env: 1, m: method, d: deviceId(), t: token, k: key, b: body }) });
  } else {
    const headers = { 'X-Device': deviceId() };
    if (token) headers['X-Session'] = token; // not Authorization: Azure Static Web Apps replaces that on the way to the API
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['X-Admin-Key'] = key;
    r = await fetch(`${API}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error((data && data.error) || `Couldn't reach the server (${r.status})`); e.status = r.status; throw e; }
  return data;
}

// ---------------------------------------------------------------- signing in (Microsoft, in email-signin-web.js)
let meCache = null;
/** who you are: { user (when signed in), profile, admin, judge } */
export async function getMe(fresh) {
  if (!meCache || fresh) meCache = call('me').catch(() => ({ user: null, profile: {}, admin: false, judge: false }));
  return meCache;
}
export const signedIn = () => !!ls.get('sp_token');
export function signOut() { ls.set('sp_token', ''); meCache = null; drawSignOut(); }
/** Local testing only (node api/dev-server.js): a "Sign in (test account)" button. On the real site companies sign in
 *  with Microsoft (email-signin-web.js), and this draws nothing. */
export async function devSignInButton(el, onDone, onError) {
  if (location.port !== '8795') return;
  const cfg = await call('config').catch(() => ({}));
  if (cfg.googleClientId !== 'dev') return;
  el.innerHTML = '<button class="btn btn-ghost" type="button">Sign in (test account)</button>';
  el.firstChild.onclick = async () => {
    try {
      const r = await call('auth/google', { method: 'POST', body: { idToken: 'dev:' + (prompt('Test email:', 'me@example.com') || '') } });
      ls.set('sp_token', r.token); meCache = null; drawSignOut();
      onDone(r.user);
    } catch (e) { onError(e); }
  };
}

// ---------------------------------------------------------------- Sign out, at the top right of every page while you're signed in
// Any page with a SpartanReferee header gets it just by loading this file. A "Sign in" link there (data-signin-link) becomes "My home".
export function drawSignOut() {
  const top = typeof document !== 'undefined' && document.querySelector('header.top, [data-account-bar]');
  if (!top) return;
  const on = signedIn();
  for (const a of document.querySelectorAll('[data-signin-link]')) a.textContent = on ? 'My home' : 'Sign in';
  let right = top.querySelector('.topRight'), button = top.querySelector('.signOut');
  if (!on) { if (button) button.remove(); return; }
  if (button) return;
  if (!right) { right = document.createElement('span'); right.className = 'topRight'; top.appendChild(right); }
  button = document.createElement('button');
  button.type = 'button'; button.className = 'link signOut'; button.textContent = 'Sign out';
  button.onclick = async () => {
    signOut();
    // what the app kept on this phone for offline use goes too (offline.js)
    try { await (await import('./offline.js')).clearAll(); } catch { /* nothing kept */ }
    location.reload();
  };
  right.appendChild(button);
}
// ---------------------------------------------------------------- the header on a phone: the name and a Menu button
// On a narrow screen (headjudge.css, under 640px) the header's links, language and Sign out fold into a menu that opens below it,
// one big row each, so the page starts at once and everything is easy to tap. Wider, the button is hidden and nothing changes.
export function drawPhoneMenu() {
  const top = typeof document !== 'undefined' && document.querySelector('header.top');
  const right = top && top.querySelector('.topRight');
  if (!right || top.querySelector('.menuBtn')) return;
  right.id = right.id || 'topMenu';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'menuBtn'; btn.setAttribute('aria-controls', right.id); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span></span>';
  btn.lastChild.textContent = 'Menu';
  const set = (open) => { top.classList.toggle('menuOpen', open); btn.setAttribute('aria-expanded', String(open)); };
  btn.onclick = () => set(!top.classList.contains('menuOpen'));
  right.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && top.classList.contains('menuOpen')) { set(false); btn.focus(); } });
  top.insertBefore(btn, right);
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drawSignOut); else drawSignOut();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drawPhoneMenu); else drawPhoneMenu();
  addEventListener('storage', (e) => { if (e.key === 'sp_token') drawSignOut(); }); // signed in or out in another tab
}

/** true inside the installed app (Android app, or added to the home screen) */
export const inApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- your Spartans Challenge attempts
// Every attempt is kept on the phone first, then sent to the server (at once, or the next time there's signal).
const ATTEMPTS_KEY = 'sp_burpeeAttempts';
export function loadLocalAttempts() { try { return JSON.parse(ls.get(ATTEMPTS_KEY)) || []; } catch { return []; } }
const keepAttempts = (list) => ls.set(ATTEMPTS_KEY, JSON.stringify(list));
export function saveAttempt(a) {
  const list = loadLocalAttempts().filter((x) => x.id !== a.id);
  keepAttempts([{ ...a, synced: false }, ...list].sort((x, y) => y.at - x.at));
  return syncAttempts();
}
export async function syncAttempts() {
  for (const a of loadLocalAttempts().filter((x) => !x.synced)) {
    try { await call('scores/attempts', { method: 'POST', body: a }); } catch { return; } // tried again next time
    keepAttempts(loadLocalAttempts().map((x) => (x.id === a.id ? { ...x, synced: true } : x)));
  }
}
/** Everything from this phone and the server, newest first, and the best scores the server holds. */
export async function loadAttempts() {
  await syncAttempts();
  let bests = {};
  try {
    const r = await call('scores/attempts');
    bests = r.bests;
    const here = new Set(loadLocalAttempts().map((x) => x.id));
    keepAttempts([...loadLocalAttempts(), ...r.attempts.filter((x) => !here.has(x.id)).map((x) => ({ ...x, synced: true }))].sort((x, y) => y.at - x.at));
    try { localStorage.setItem(ATTEMPTS_KEY + '.bests', JSON.stringify(bests)); } catch { /* private mode */ }
  } catch { try { bests = JSON.parse(localStorage.getItem(ATTEMPTS_KEY + '.bests')) || {}; } catch { /* none yet */ } }
  return { attempts: loadLocalAttempts(), bests };
}
/** The scoreboard an exercise's challenge goes on: burpees are plain 1min / 5min, the others squats.1min and so on. */
export const scoreKey = (exercise, mode) => (exercise === 'burpees' ? mode : `${exercise}.${mode}`);
/** Your best in a mode: a timed challenge only counts if it ran the full time. */
export function bestAttempt(attempts, exercise, mode, bests = {}) {
  const all = attempts.filter((a) => (a.exercise || 'burpees') === exercise && a.mode === mode && a.status === 'full');
  const server = bests[scoreKey(exercise, mode)];
  if (server) all.push(server);
  return all.sort((x, y) => y.reps - x.reps || x.at - y.at)[0] || null;
}

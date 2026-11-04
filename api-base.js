// Where the backend is: the site's own /api, or (inside the Android / iPhone app, which runs from files on the
// phone) the hosted site's. Plus who you are: a random id for this phone, and your Google sign-in once you've signed in.
const HOSTED = 'https://yellow-forest-09b984e03.6.azurestaticapps.net';
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
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['X-Admin-Key'] = key;
    r = await fetch(`${API}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error((data && data.error) || `Couldn't reach the server (${r.status})`);
  return data;
}

// ---------------------------------------------------------------- signing in (Google, as in SkiTour)
let meCache = null;
/** who you are: { user (when signed in), profile, admin, judge } */
export async function getMe(fresh) {
  if (!meCache || fresh) meCache = call('me').catch(() => ({ user: null, profile: {}, admin: false, judge: false }));
  return meCache;
}
export const signedIn = () => !!ls.get('sp_token');
export function signOut() { ls.set('sp_token', ''); meCache = null; }
async function exchange(idToken) {
  const r = await call('auth/google', { method: 'POST', body: { idToken } });
  ls.set('sp_token', r.token); meCache = null;
  if (r.user && r.user.name && !ls.get('sp_name')) ls.set('sp_name', r.user.name.slice(0, 30));
  return r.user;
}
/** draws Google's sign-in button into el (web); on Android/iPhone the native account picker when the app has it */
export async function googleButton(el, onDone, onError) {
  const cfg = await call('config').catch(() => ({}));
  if (!cfg.signIn) { el.innerHTML = '<p class="muted">Google sign-in isn’t switched on yet.</p>'; return; }
  if (location.port === '8795' && cfg.googleClientId === 'dev') { // local testing only
    el.innerHTML = '<button class="btn btn-ghost" type="button">Sign in (test account)</button>';
    el.firstChild.onclick = async () => { try { onDone(await exchange('dev:' + (prompt('Test email:', 'me@example.com') || ''))); } catch (e) { onError(e); } };
    return;
  }
  const SL = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin;
  if (SL) {
    el.innerHTML = '<button class="btn btn-ghost" type="button">Sign in with Google</button>';
    el.firstChild.onclick = async () => {
      try { await SL.initialize({ google: { webClientId: cfg.googleClientId } }); const res = await SL.login({ provider: 'google', options: {} }); onDone(await exchange(res.result.idToken)); }
      catch (e) { onError(e); }
    };
    return;
  }
  await new Promise((res, rej) => {
    if (window.google && window.google.accounts) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Couldn’t load Google sign-in (are you online?)'));
    document.head.appendChild(s);
  }).catch(onError);
  if (!window.google || !window.google.accounts) return;
  window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async (resp) => { try { onDone(await exchange(resp.credential)); } catch (e) { onError(e); } } });
  el.textContent = '';
  window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: Math.min(300, el.clientWidth || 300) });
}

/** true inside the installed app (Android app, or added to the home screen) */
export const inApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- your burpee challenge attempts
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
/** Your best in a mode: a timed challenge only counts if it ran the full time. */
export function bestAttempt(attempts, mode, bests = {}) {
  const all = attempts.filter((a) => a.mode === mode && a.status === 'full');
  if (bests[mode]) all.push(bests[mode]);
  return all.sort((x, y) => y.reps - x.reps || x.at - y.at)[0] || null;
}

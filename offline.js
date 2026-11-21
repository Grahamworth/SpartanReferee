// The installable app's offline side, shared by the home page and Learning.
//  - what the server said is kept on the phone (Cache Storage "sr-data"), under the signed-in person, so it opens again with no signal.
//    Only the session that kept it can read it back: a different sign-in on the same phone never sees it, and Sign out clears it.
//  - a bar at the top says when the page is showing a kept copy
//  - lesson progress made offline waits in an outbox and is sent when there's signal again
//  - the service worker (sw.js) is registered here, and the home page's "Install the app" card is drawn here
const DATA = 'sr-data';
const ls = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } } };
const tr = (text, values) => (globalThis.SR_I18N ? globalThis.SR_I18N.t(text, values) : text.replace(/\{(\w+)\}/g, (_, k) => values?.[k] ?? ''));
const hasCaches = () => typeof caches !== 'undefined';
// a short tag for the session, so kept copies stay with it (a hash, not the session itself)
const tag = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };

/** who the kept copies belong to: call once the server has said who's signed in */
export function setOwner(email) {
  const t = ls.get('sp_token');
  if (email && t) ls.set('sr_off_owner', JSON.stringify({ t: tag(t), e: String(email).toLowerCase() }));
}
export function owner() {
  try { const o = JSON.parse(ls.get('sr_off_owner')); return o && ls.get('sp_token') && o.t === tag(ls.get('sp_token')) ? o.e : ''; } catch { return ''; }
}
const keyFor = (o, path) => `${location.origin}/offline-data/${encodeURIComponent(o)}/${path}`;

export async function keep(path, data) {
  const o = owner(); if (!o || !hasCaches()) return;
  try { await (await caches.open(DATA)).put(keyFor(o, path), new Response(JSON.stringify({ at: Date.now(), data }), { headers: { 'Content-Type': 'application/json' } })); } catch { /* full, or private mode */ }
}
/** the kept copy: { at, data }, or null */
export async function recall(path) {
  const o = owner(); if (!o || !hasCaches()) return null;
  try { const r = await (await caches.open(DATA)).match(keyFor(o, path)); return r ? await r.json() : null; } catch { return null; }
}
/** a narration file, kept (blob) or read back */
export async function keepFile(path, blob) {
  const o = owner(); if (!o || !hasCaches()) return 0;
  await (await caches.open(DATA)).put(keyFor(o, path), new Response(blob, { headers: { 'Content-Type': blob.type } }));
  return blob.size;
}
export async function recallFile(path) {
  const o = owner(); if (!o || !hasCaches()) return null;
  try { const r = await (await caches.open(DATA)).match(keyFor(o, path)); return r ? await r.blob() : null; } catch { return null; }
}
export async function forget(paths) {
  const o = owner(); if (!o || !hasCaches()) return;
  const c = await caches.open(DATA);
  await Promise.all(paths.map((p) => c.delete(keyFor(o, p))));
}
/** everything kept on this phone goes (Sign out) */
export async function clearAll() {
  ls.set('sr_off_owner', ''); ls.set('sr_outbox', ''); ls.set('sr_saved', '');
  if (hasCaches()) try { await caches.delete(DATA); } catch { /* nothing kept */ }
}

/** a GET: the server's answer when there's signal (kept for next time), else the kept copy, with the bar saying so.
 *  With a kept copy, a network that hasn't answered in 8 seconds gets the copy (the answer still updates it when it comes). */
export async function viaCache(path, get) {
  const copy = owner() ? recall(path) : Promise.resolve(null);
  const fromCopy = async (why) => { const k = await copy; if (!k) return null; offlineBar(k.at, why); return k.data; };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const d = await fromCopy('offline'); if (d !== null) return d;
    throw notSaved();
  }
  const net = get().then(async (data) => { await keep(path, data); offlineBar(null); return data; });
  let timer;
  const slow = new Promise((res) => { timer = setTimeout(res, 8000, 'slow'); });
  try {
    const first = await Promise.race([net, copy.then((k) => (k ? slow : net))]).finally(() => clearTimeout(timer));
    if (first !== 'slow') return first;
    net.catch(() => {}); // it may still come: it updates the copy
    return await fromCopy('slow');
  } catch (e) {
    if (e.status && e.status < 500) throw e; // the server answered: no
    const d = await fromCopy(e.status ? 'server' : 'offline'); if (d !== null) return d;
    throw e.status ? e : notSaved();
  }
}
const notSaved = () => Object.assign(new Error(tr('You\'re offline, and this page isn\'t saved on this phone. It opens when there\'s signal again.')), { offline: true });

// ---------------------------------------------------------------- the outbox: lesson progress made offline
const outbox = () => { try { return JSON.parse(ls.get('sr_outbox')) || []; } catch { return []; } };
/** keep a change to send later; one with the same key replaces the earlier one (the furthest slide reached, say) */
export function queue(item) {
  const o = owner(); if (!o) return false;
  ls.set('sr_outbox', JSON.stringify([...outbox().filter((x) => !(item.key && x.key === item.key && x.owner === o)), { ...item, owner: o, at: Date.now() }]));
  return true;
}
export const waiting = () => outbox().filter((x) => x.owner === owner()).length;
/** the addresses of what's waiting to be sent (a lesson finished offline opens the next one already) */
export const queuedPaths = () => outbox().filter((x) => x.owner === owner()).map((x) => x.path);
let flushing = null;
/** send what's waiting: send(item) throws an error with no status when there's still no signal */
export function flush(send) {
  return (flushing = flushing || (async () => {
    try {
      for (const item of outbox().filter((x) => x.owner === owner())) {
        try { await send(item); } catch (e) { if (!e.status) return; } // no signal yet: next time. Refused by the server: dropped
        ls.set('sr_outbox', JSON.stringify(outbox().filter((x) => !(x.at === item.at && x.path === item.path))));
      }
    } finally { flushing = null; }
  })());
}

// ---------------------------------------------------------------- the bar at the top
let barAt = null;
/** at: when the copy shown was kept (null: hide the bar); why: offline, slow or server */
export function offlineBar(at, why = 'offline') {
  if (typeof document === 'undefined') return;
  let bar = document.getElementById('offlineBar');
  if (at === null) { barAt = null; if (bar && navigator.onLine !== false) bar.hidden = true; return; }
  if (at) barAt = barAt ? Math.min(barAt, at) : at; // the oldest copy on the page
  if (!bar) {
    bar = document.createElement('p'); bar.id = 'offlineBar'; bar.className = 'offlineBar'; bar.setAttribute('role', 'status');
    document.body.prepend(bar);
  }
  const when = barAt ? new Date(barAt).toLocaleString((window.SR_I18N && SR_I18N.lang) || undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  bar.textContent = !when ? tr('You\'re offline. Pages saved on this phone still open.')
    : why === 'slow' ? tr('The connection is slow: showing the copy saved on this phone ({when}).', { when })
      : why === 'server' ? tr('The server isn\'t answering: showing the copy saved on this phone ({when}).', { when })
        : tr('You\'re offline: showing the copy saved on this phone ({when}).', { when });
  bar.hidden = false;
}
if (typeof window !== 'undefined') {
  addEventListener('offline', () => offlineBar(0));
  addEventListener('online', () => { const b = document.getElementById('offlineBar'); if (b) b.hidden = true; barAt = null; });
}

// ---------------------------------------------------------------- the app itself
const hosted = () => typeof location !== 'undefined' && location.protocol.startsWith('http') && (location.hostname.endsWith('azurestaticapps.net') || location.port === '8795');
export function registerApp() {
  if (!hosted() || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* the page still works, online */ });
}
/** true when it's running as the installed app: added to the home screen, or the Android or iPhone app (scripts/build-app.sh) */
export const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let prompt = null;
if (typeof window !== 'undefined') addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; window.dispatchEvent(new Event('sr:installable')); });
const android = () => /Android/i.test(navigator.userAgent);
/** the app's header button (learn/index.html, 20 November 2026): only on an Android phone or tablet, an iPhone or an iPad, and not
 *  once it's installed. Android installs it straight from the button (when the browser offers it); on Apple devices the button shows
 *  the two taps in Safari (how, an element with a [data-close] button) */
export function installButton(btn, how) {
  if (!btn || installed() || !hosted() || !(android() || ios())) return;
  const draw = () => { btn.hidden = !(ios() || prompt); };
  btn.onclick = async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice.catch(() => ({}));
      prompt = null; if (outcome === 'accepted') btn.hidden = true; else draw();
    } else if (ios() && how) how.hidden = !how.hidden;
  };
  how?.querySelector('[data-close]')?.addEventListener('click', () => { how.hidden = true; });
  addEventListener('sr:installable', draw);
  addEventListener('appinstalled', () => { btn.hidden = true; if (how) how.hidden = true; });
  draw();
}
/** the home page's card offering to install the app: a button where the browser can do it, the steps on an iPhone */
export function installCard(card) {
  if (!card || installed() || !hosted()) return;
  if (Number(ls.get('sr_install_later')) > Date.now()) return;
  const draw = () => {
    const how = card.querySelector('[data-how]'), btn = card.querySelector('[data-install]');
    if (prompt) { how.hidden = true; btn.hidden = false; } else if (ios()) { how.hidden = false; btn.hidden = true; } else return;
    card.hidden = false;
  };
  card.querySelector('[data-install]').onclick = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({}));
    prompt = null; if (outcome === 'accepted') card.hidden = true;
  };
  card.querySelector('[data-later]').onclick = () => { ls.set('sr_install_later', String(Date.now() + 30 * 864e5)); card.hidden = true; };
  addEventListener('sr:installable', draw);
  addEventListener('appinstalled', () => { card.hidden = true; });
  draw();
}

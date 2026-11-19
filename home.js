// A referee's home page (home.html): hello, the events they're assigned to (each opens its page, where its cameras are booked), and the ways to
// the learning platform, the cameras and (admins) the admin page. Everything comes from /api/home.
import { call, devSignInButton, signedIn, signOut, esc } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const lang = () => (window.SR_I18N && SR_I18N.lang) || undefined;
// an event's dates are its own local dates, so they're shown as they are, whatever this computer's timezone
const day = (d) => new Date(`${d}T12:00:00Z`);
function datesOf(e) {
  const f = new Intl.DateTimeFormat(lang(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return e.endDate && e.endDate !== e.startDate && f.formatRange ? f.formatRange(day(e.startDate), day(e.endDate)) : f.format(day(e.startDate));
}

// the language: asked on the first visit (the browser's own first, marked), then kept with the referee so it follows them to any
// device and to their lessons; a change made with the menu at the top is saved back on the next visit here
const LANG_KEY = 'sr_lang';
const saved = () => { try { return localStorage.getItem(LANG_KEY) || ''; } catch { return ''; } };
const keep = (c) => { try { localStorage.setItem(LANG_KEY, c); } catch { /* private mode */ } };
function language(h) {
  const I = window.SR_I18N; if (!I) return false;
  if (!h.language) {
    const guess = I.lang, langs = [...I.LANGS.filter(([c]) => c === guess), ...I.LANGS.filter(([c]) => c !== guess)];
    $('langChoices').innerHTML = langs.map(([c, n]) => `<button type="button" lang="${c}" data-lang="${c}"${c === guess ? ' class="suggested"' : ''}>${esc(n)}${c === guess ? `<small>${esc(I.t('Suggested'))}</small>` : ''}</button>`).join('');
    for (const b of $('langChoices').querySelectorAll('[data-lang]')) b.onclick = async () => {
      for (const x of $('langChoices').querySelectorAll('button')) x.disabled = true;
      try { await call('home', { method: 'POST', body: { language: b.dataset.lang } }); } catch { /* still use it here */ }
      keep(b.dataset.lang); location.reload();
    };
    show($('langCard'), true);
    return false;
  }
  show($('langCard'), false);
  // a new device: use theirs
  if (!saved() && h.language !== I.lang) { keep(h.language); location.reload(); return true; }
  // changed with the menu since: remember that instead
  if (saved() && saved() !== h.language) call('home', { method: 'POST', body: { language: saved() } }).catch(() => {});
  return false;
}

function draw(h) {
  if (language(h)) return;
  $('who').textContent = h.email;
  $('name').textContent = h.name || h.email;
  $('roleLine').textContent = h.admin ? 'Spartan referee and admin' : 'Spartan referee';
  const now = Date.now();
  // each event opens its own page: its times, who's refereeing it, and booking or watching its cameras
  $('eventList').innerHTML = h.events.map((e) => `<li><a href="event.html?id=${encodeURIComponent(e.id)}"><span><b>${esc(e.name)}</b>
    <small>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small>
    <span class="chips">${e.role === 'head' ? '<span class="chip head">Head referee</span>' : '<span class="chip">Referee</span>'}${e.from <= now && now < e.until ? '<span class="chip now">On now</span>' : ''}</span></span>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></a></li>`).join('');
  show($('noEvents'), !h.events.length);
  show($('learnTile'), !!h.learn);
  show($('adminTile'), !!h.admin);
  show($('content'), true);
}

async function enter() {
  show($('signIn'), false);
  try { draw(await call('home')); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { signOut(); start(e.status === 403 ? e.message : ''); return; }
    $('error').textContent = e.message; show($('error'), true);
  }
}
async function start(why = '') {
  if (signedIn() && !why) return enter();
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  if (why) failed({ message: why });
  microsoftButton($('msBtn'), 'home.html', failed);
  await devSignInButton($('devBtn'), () => enter(), failed);
}
start();

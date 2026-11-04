// The Spartans home page: the next race (the soonest upcoming event, with a countdown, a link to it and the full
// list), your stats, the main buttons, and the Burpee Judge / Admin for referees and admins.
import { call, esc, getMe, inApp } from './api-base.js';
import { editor, field, val } from './hub-edit.js';

const $ = (id) => document.getElementById(id);
let C = null, ME = null;
const fmtDate = (d) => { const x = new Date(d + 'T12:00:00'); return isNaN(x) ? d : x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }); };
const today = () => new Date().toISOString().slice(0, 10);
// "Sat 7 – Sun 8 Nov 2026" (short enough for a phone)
function shortSpan(e) {
  const a = new Date(e.date + 'T12:00:00'), b = e.end && e.end !== e.date ? new Date(e.end + 'T12:00:00') : null;
  if (isNaN(a)) return e.date || 'Date to be announced';
  const day = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  const my = (d) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  if (!b || isNaN(b)) return `${day(a)} ${my(a)}`;
  return a.getMonth() === b.getMonth() ? `${day(a)} – ${day(b)} ${my(b)}` : `${day(a)} ${a.toLocaleDateString(undefined, { month: 'short' })} – ${day(b)} ${my(b)}`;
}
const upcoming = () => (C.events || []).filter((e) => (e.end || e.date || '9999') >= today()).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

function renderRace() {
  const list = upcoming(), e = list[0];
  if (!e) { $('race').innerHTML = '<div class="empty">No upcoming races listed yet.</div>'; return; }
  const when = new Date(e.date + 'T08:00:00'), ok = !isNaN(when);
  $('race').innerHTML = `
    <div class="name">${esc(e.name)}</div>
    <div class="where">${esc(e.place)}</div>
    <div class="when">${esc(shortSpan(e))}</div>
    ${ok ? '<div class="nr-cd" id="cd"></div>' : ''}
    ${e.races ? `<div class="courses">${esc(e.races)}</div>` : ''}
    <div class="actions">
      ${e.url ? `<a class="btn btn-red" href="${esc(e.url)}" target="_blank" rel="noopener">Take me to the race</a>` : ''}
      <button type="button" class="btn btn-ghost" id="allBtn">All upcoming events (${list.length})</button>
    </div>`;
  $('allBtn').onclick = () => {
    const s = $('allEvents'); s.hidden = !s.hidden;
    $('allBtn').textContent = s.hidden ? `All upcoming events (${list.length})` : 'Hide upcoming events';
    if (!s.hidden) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (ok) {
    const tick = () => {
      const s = Math.max(0, (when - Date.now()) / 1000), el = $('cd'); if (!el) return;
      el.innerHTML = [['days', Math.floor(s / 86400)], ['hrs', Math.floor((s % 86400) / 3600)], ['min', Math.floor((s % 3600) / 60)]].map(([k, v]) => `<div><b>${v}</b><small>${k}</small></div>`).join('');
    };
    tick(); clearInterval(renderRace.t); renderRace.t = setInterval(tick, 30000);
  }
}
function renderEvents() {
  const list = upcoming();
  $('events').innerHTML = list.length ? list.map((e) => {
    const d = new Date(e.date + 'T12:00:00'), ok = !isNaN(d);
    const span = e.end && e.end !== e.date ? `${fmtDate(e.date)} – ${fmtDate(e.end)}` : fmtDate(e.date);
    return `<article class="event"><div class="day">${ok ? `<b>${d.getDate()}</b><small>${d.toLocaleDateString(undefined, { month: 'short' })}<br>${d.getFullYear()}</small>` : '<small>TBC</small>'}</div>
      <div><h3>${esc(e.name)}</h3><p>${esc(e.place)}${e.races ? ' · ' + esc(e.races) : ''}</p><p>${esc(span)}</p></div>
      ${e.url ? `<a class="btn btn-red" href="${esc(e.url)}" target="_blank" rel="noopener">Tickets</a>` : ''}</article>`;
  }).join('') : '<div class="empty">No upcoming events listed.</div>';
}

// Your stats: race results will come from your Spartan profile; for now, what this phone knows (Course Run)
function renderStats() {
  const runs = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^cr_best_/.test(k)) runs.push([k.slice(8), +JSON.parse(localStorage.getItem(k))]); } } catch { /* private mode */ }
  const fmt = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`; };
  const NAMES = { sprint: 'Sprint', super: 'Super', beast: 'Beast', ultra: 'Ultra', kids4: 'Kids 4–6', kids7: 'Kids 7–9', kids10: 'Kids 10–14' };
  const p = (ME && ME.profile) || {};
  $('stats').innerHTML = `
    <div class="stat-grid">
      <div class="stat"><b>–</b><small>Races finished</small></div>
      <div class="stat"><b>–</b><small>Best race time</small></div>
      <div class="stat"><b>${runs.length}</b><small>Course Run courses done</small></div>
    </div>
    <p class="stat-line" id="burpeeBests"></p>
    ${runs.length ? `<p class="stat-line">Course Run bests: ${runs.map(([c, t]) => `${esc(NAMES[c] || c)} ${fmt(t)}`).join(' · ')}</p>` : ''}
    <p class="stat-note">${p.spartanUrl ? `Your race results will appear here from <a href="${esc(p.spartanUrl)}" target="_blank" rel="noopener">your Spartan profile</a>.` : 'Connect your Spartan profile in <a href="profile.html">your profile</a> and your race results will appear here.'}</p>`;
}

// burpee challenge bests (from the scoreboard), under Your stats
async function burpeeBests() {
  try {
    const r = await call('scores/me');
    const b = (m) => (r[m] && r[m].best ? r[m].best.reps : null);
    const el = document.getElementById('burpeeBests'); if (!el) return;
    el.innerHTML = b('1min') != null || b('5min') != null
      ? `Burpee bests: <b>1 minute ${b('1min') ?? '–'}</b> · <b>5 minutes ${b('5min') ?? '–'}</b> · <a href="scoreboard.html">Spartans challenge</a>`
      : 'Burpee bests: none yet. <a href="scoreboard.html">Take the challenge</a>.';
  } catch { /* offline */ }
}

async function load() {
  try { C = await call('content'); }
  catch (e) { $('race').innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; return; }
  renderRace(); renderEvents();
}
async function who() {
  ME = await getMe();
  renderStats();
  burpeeBests();
  const u = ME.user, p = ME.profile || {};
  $('profileIc').innerHTML = u && u.picture ? `<img src="${esc(u.picture)}" alt="">` : esc(((p.name || (u && u.name) || '').trim()[0] || '👤').toUpperCase());
  $('judgeTile').hidden = !(ME.judge || ME.admin); $('adminTile').hidden = !ME.admin; $('staffTiles').hidden = !(ME.judge || ME.admin);
  $('editEvents').hidden = !ME.admin;
}

const eventItem = (e = {}) => `<div class="item"><button type="button" class="rm" aria-label="Remove">×</button>${field('Event', 'name', e.name || '')}<div class="grid2">${field('Date', 'date', e.date || '', 'date')}${field('Last day (optional)', 'end', e.end || '', 'date')}</div>${field('Where', 'place', e.place || '')}${field('Races', 'races', e.races || '')}${field('Tickets link (https://…)', 'url', e.url || '', 'url')}</div>`;
$('editEvents').onclick = () => {
  editor('Upcoming events', (C.events || []).map(eventItem).join(''),
    (b) => call('content/events', { method: 'PUT', body: { value: [...b.querySelectorAll('.item')].map((it) => ({ name: val(it, 'name'), date: val(it, 'date'), end: val(it, 'end'), place: val(it, 'place'), races: val(it, 'races'), url: val(it, 'url') })) } }).then(load),
    (b) => b.insertAdjacentHTML('afterbegin', eventItem()));
};

// inside the installed app there's no need to offer the app
if (inApp()) $('getApp').hidden = true;
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
load(); who();

// First time in the app: nobody gets past this without a name, for the leaderboards and the chat. No account needed.
// It shows at once, without waiting for the server, so a slow connection can't let anyone skip it.
const savedName = () => { try { return localStorage.getItem('sp_name') || ''; } catch { return ''; } };
const saveName = (v) => { try { localStorage.setItem('sp_name', v); } catch { /* private mode */ } };
async function askName() {
  if (!inApp()) return;
  const saved = savedName();
  if (saved) { // named on this phone: if that was with no signal, the server gets it now
    try { const me = await call('me'); if (!(me.profile && me.profile.name)) await call('profile', { method: 'PUT', body: { name: saved } }); } catch { /* next time */ }
    return;
  }
  const box = document.createElement('div');
  box.className = 'modal name-gate';
  box.innerHTML = `<form class="modal-card" novalidate>
    <h2>What's your name?</h2>
    <p>It's what other Spartans see on the leaderboards and in the chat. You don't need an account.</p>
    <label class="name-field">Your name<input name="name" maxlength="30" autocomplete="name" required></label>
    <p class="error name-error" hidden></p>
    <button class="btn btn-red btn-big">Continue</button>
  </form>`;
  document.body.appendChild(box);
  const form = box.firstChild, err = box.querySelector('.name-error'), go = box.querySelector('button');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  // already named on the server (a reinstall, say): nothing to ask
  call('me').then((me) => { const n = me.profile && me.profile.name; if (n && box.isConnected) { saveName(n); box.remove(); } }).catch(() => {});
  form.onsubmit = async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) { fail('Enter your name to carry on.'); form.name.focus(); return; }
    go.disabled = true; go.textContent = 'Saving…';
    try {
      await call('profile', { method: 'PUT', body: { name } });
      saveName(name);
      box.remove();
    } catch (x) {
      // No signal: keep it on the phone and let them in; the server gets it next time. A refused name stays here.
      if (x instanceof TypeError || /couldn.t reach/i.test(x.message)) { saveName(name); box.remove(); return; }
      go.disabled = false; go.textContent = 'Continue';
      fail(x.message);
    }
  };
}
askName();

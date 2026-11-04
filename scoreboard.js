// The Spartans Challenge: one panel per exercise, Burpees first, swipe sideways for the others (the hand test only for
// admins). Each has 1 Minute, 5 Minute and Practice with your best and Start, its own leaderboard (today / this week /
// all time, best per person, your own row marked and shown below the top 20 if you're further down) and your attempts.
import { call, esc, getMe, loadAttempts, bestAttempt, scoreKey } from './api-base.js';
import { EXERCISES } from './exercises.js';

const $ = (id) => document.getElementById(id);
const LABELS = { '1min': '1 Minute', '5min': '5 Minute', free: 'Practice' };
const NAMES = { burpees: 'Burpees', squats: 'Air squats', pushups: 'Push-ups', jacks: 'Jumping jacks', situps: 'Sit-ups', practice: 'Hand test' };
const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const whenFull = (t) => `${when(t)}, ${new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
const took = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

const query = new URLSearchParams(location.search);
const askedMode = LABELS[query.get('mode')] ? query.get('mode') : '1min';
const askedExercise = query.get('exercise');
const pager = $('pager'), tabs = $('exTabs');
const panels = [];
let attempts = [], bests = {};

function makePanel(key) {
  const el = document.createElement('section');
  el.className = 'ex-panel';
  el.dataset.exercise = key;
  el.setAttribute('aria-label', NAMES[key]);
  el.innerHTML = `
    <h2 class="ex-name">${esc(NAMES[key])}</h2>
    <p class="muted ex-flow">${esc(EXERCISES[key].flow || '')}</p>
    <div class="chips big" role="group" aria-label="Challenge">
      ${Object.entries(LABELS).map(([m, label]) => `<button type="button" data-mode="${m}" aria-pressed="false">${label}</button>`).join('')}
    </div>
    <div class="best-row">
      <div class="best-score"><small>Your best</small><b class="best-reps">–</b><small class="best-when">No score yet</small></div>
      <a class="btn btn-red btn-big start-btn">Start</a>
    </div>
    <h2 class="board-title board-name"></h2>
    <p class="muted board-note" hidden>Practice just counts how many you do, so it doesn't go on a leaderboard.</p>
    <div class="chips" role="group" aria-label="When">
      <button type="button" data-period="today" aria-pressed="true">Today</button>
      <button type="button" data-period="week" aria-pressed="false">This week</button>
      <button type="button" data-period="all" aria-pressed="false">All time</button>
    </div>
    <table class="board"><tbody class="board-rows"></tbody></table>
    <h2 class="board-title">Your attempts</h2>
    <table class="board history"><tbody class="history-rows"></tbody></table>
    <button type="button" class="btn btn-ghost history-more" hidden>Show more</button>`;
  const p = { key, el, mode: askedMode, boardMode: askedMode === 'free' ? '1min' : askedMode, period: 'today', shown: 20, loaded: false };
  const q = (s) => el.querySelector(s);
  p.showBest = () => {
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === p.mode)));
    const best = bestAttempt(attempts, key, p.mode, bests);
    q('.best-reps').textContent = best ? best.reps : '–';
    q('.best-when').textContent = best ? when(best.at) : 'No score yet';
    q('.start-btn').href = `judge.html?mode=practice&exercise=${key}&challenge=${p.mode}`;
    q('.board-note').hidden = p.mode !== 'free';
  };
  p.loadBoard = async () => {
    p.loaded = true;
    const rows = q('.board-rows'), mode = p.boardMode, period = p.period;
    el.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === period)));
    q('.board-name').textContent = `${LABELS[mode]} leaderboard`;
    rows.innerHTML = '<tr><td class="empty">Loading…</td></tr>';
    fit();
    let html;
    try {
      const r = await call(`scores/${scoreKey(key, mode)}?period=${period}`);
      const row = (x) => `<tr class="${x.mine ? 'mine' : ''}"><td class="rank">${x.rank}</td><td class="name">${esc(x.name)}<br><small class="muted">${when(x.at)}</small></td><td class="reps">${x.reps}</td></tr>`;
      html = r.top.length
        ? r.top.map(row).join('') + (r.me ? '<tr class="gap"><td colspan="3">⋯</td></tr>' + row(r.me) : '')
        : `<tr><td class="empty">No scores ${period === 'today' ? 'today' : period === 'week' ? 'this week' : 'yet'}. Be the first!</td></tr>`;
    } catch (e) { html = `<tr><td class="empty">Couldn't load the leaderboard: ${esc(e.message)}</td></tr>`; }
    if (mode === p.boardMode && period === p.period) { rows.innerHTML = html; fit(); } // not if they've since picked another
  };
  p.showHistory = () => {
    const mine = attempts.filter((a) => (a.exercise || 'burpees') === key);
    const tag = (a) => (a.mode === 'free' ? '' : a.status !== 'full' ? 'Stopped early' : a.submitted ? 'On the leaderboard' : 'Not submitted');
    q('.history-rows').innerHTML = mine.length
      ? mine.slice(0, p.shown).map((a) => `<tr><td class="name">${esc(LABELS[a.mode] || a.mode)}<br><small class="muted">${esc(whenFull(a.at))} · ${esc(took(a.durationMs))} · ${Number(a.noReps)} no reps${tag(a) ? ` · ${esc(tag(a))}` : ''}</small></td><td class="reps">${Number(a.reps)}</td></tr>`).join('')
      : '<tr><td class="empty">No attempts yet.</td></tr>';
    q('.history-more').hidden = mine.length <= p.shown;
    fit();
  };
  el.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => {
    p.mode = b.dataset.mode;
    p.showBest();
    if (p.mode !== 'free' && p.mode !== p.boardMode) { p.boardMode = p.mode; p.loadBoard(); }
  }; });
  el.querySelectorAll('[data-period]').forEach((b) => { b.onclick = () => { p.period = b.dataset.period; p.loadBoard(); }; });
  q('.history-more').onclick = () => { p.shown += 20; p.showHistory(); };
  p.showBest();
  p.showHistory();
  pager.append(el);
  const tab = document.createElement('button');
  tab.type = 'button'; tab.textContent = NAMES[key]; tab.dataset.tab = key;
  tab.onclick = () => go(panels.indexOf(p), true);
  tabs.append(tab);
  panels.push(p);
  return p;
}

// The page is as tall as the panel on show, not the longest one.
let current = 0;
function fit() { const p = panels[current]; if (p) pager.style.height = `${p.el.offsetHeight}px`; }
function show(i) {
  current = i;
  const p = panels[i];
  tabs.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.tab === p.key;
    b.setAttribute('aria-pressed', String(on));
    if (on) tabs.scrollTo({ left: b.offsetLeft - (tabs.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
  });
  fit();
  if (!p.loaded) p.loadBoard();
}
function go(i, smooth) {
  pager.scrollTo({ left: panels[i].el.offsetLeft - panels[0].el.offsetLeft, behavior: smooth ? 'smooth' : 'instant' });
  show(i);
}
pager.addEventListener('scroll', () => {
  const i = Math.round(pager.scrollLeft / (pager.clientWidth || 1));
  if (i !== current && panels[i]) show(i);
}, { passive: true });
addEventListener('resize', () => go(current, false));

async function loadMine() {
  ({ attempts, bests } = await loadAttempts());
  for (const p of panels) { p.showBest(); p.showHistory(); }
}
// coming Back from a challenge can show this page exactly as it was left
addEventListener('pageshow', (e) => { if (e.persisted) { loadMine(); panels.forEach((p) => { if (p.loaded) p.loadBoard(); }); } });

for (const key of ['burpees', 'squats', 'pushups', 'jacks', 'situps']) makePanel(key);
const start = panels.findIndex((p) => p.key === askedExercise);
go(start < 0 ? 0 : start, false);
loadMine();
// the hand test is for admins only
getMe().then((me) => {
  if (!me.admin) return;
  const p = makePanel('practice');
  p.showBest(); p.showHistory();
  loadMine();
  if (askedExercise === 'practice') go(panels.indexOf(p), false);
});

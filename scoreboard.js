// The Burpee Challenge menu: pick 1 Minute, 5 Minute or Practice to see your best and Start; below it the leaderboard
// (today / this week / all time, best per person, your own row marked and shown below the top 20 if you're further
// down) and every attempt you've made.
import { call, esc, loadAttempts, bestAttempt } from './api-base.js';

const $ = (id) => document.getElementById(id);
const LABELS = { '1min': '1 Minute', '5min': '5 Minute', free: 'Practice' };
const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const whenFull = (t) => `${when(t)}, ${new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
const took = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

const asked = new URLSearchParams(location.search).get('mode');
let mode = LABELS[asked] ? asked : '1min', boardMode = mode === 'free' ? '1min' : mode, period = 'today';
let attempts = [], bests = {}, shown = 20;

const pressed = (attr, value) => document.querySelectorAll(`[${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value)));

function showBest() {
  pressed('data-mode', mode);
  const best = bestAttempt(attempts, mode, bests);
  $('bestScore').textContent = best ? best.reps : '–';
  $('bestWhen').textContent = best ? when(best.at) : 'No score yet';
  $('startBtn').href = `judge.html?mode=practice&challenge=${mode}`;
  $('boardNote').hidden = mode !== 'free';
}

async function loadBoard() {
  const board = $('board');
  pressed('data-period', period);
  $('boardTitle').textContent = `${LABELS[boardMode]} leaderboard`;
  board.innerHTML = '<tr><td class="empty">Loading…</td></tr>';
  try {
    const r = await call(`scores/${boardMode}?period=${period}`);
    const row = (x) => `<tr class="${x.mine ? 'mine' : ''}"><td class="rank">${x.rank}</td><td class="name">${esc(x.name)}<br><small class="muted">${when(x.at)}</small></td><td class="reps">${x.reps}</td></tr>`;
    board.innerHTML = r.top.length
      ? r.top.map(row).join('') + (r.me ? '<tr class="gap"><td colspan="3">⋯</td></tr>' + row(r.me) : '')
      : `<tr><td class="empty">No scores ${period === 'today' ? 'today' : period === 'week' ? 'this week' : 'yet'}. Be the first!</td></tr>`;
  } catch (e) { board.innerHTML = `<tr><td class="empty">Couldn't load the leaderboard: ${esc(e.message)}</td></tr>`; }
}

function showHistory() {
  const tag = (a) => (a.mode === 'free' ? '' : a.status !== 'full' ? 'Stopped early' : a.submitted ? 'On the leaderboard' : 'Not submitted');
  $('history').innerHTML = attempts.length
    ? attempts.slice(0, shown).map((a) => `<tr><td class="name">${esc(LABELS[a.mode] || a.mode)}<br><small class="muted">${esc(whenFull(a.at))} · ${esc(took(a.durationMs))} · ${Number(a.noReps)} no reps${tag(a) ? ` · ${esc(tag(a))}` : ''}</small></td><td class="reps">${Number(a.reps)}</td></tr>`).join('')
    : '<tr><td class="empty">No attempts yet.</td></tr>';
  $('historyMore').hidden = attempts.length <= shown;
}

async function loadMine() {
  ({ attempts, bests } = await loadAttempts());
  showBest();
  showHistory();
}

document.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => {
  mode = b.dataset.mode;
  showBest();
  if (mode !== 'free' && mode !== boardMode) { boardMode = mode; loadBoard(); }
}; });
document.querySelectorAll('[data-period]').forEach((b) => { b.onclick = () => { period = b.dataset.period; loadBoard(); }; });
$('historyMore').onclick = () => { shown += 20; showHistory(); };
// coming Back from a challenge can show this page exactly as it was left
addEventListener('pageshow', (e) => { if (e.persisted) { loadMine(); loadBoard(); } });

showBest();
loadBoard();
loadMine();

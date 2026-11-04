// Past competitions: each with its winners per course, and "Play the course" where the Course Run map exists.
import { call, esc, getMe } from './api-base.js';
import { editor, field, val } from './hub-edit.js';

const $ = (id) => document.getElementById(id);
const fmtDate = (d) => { const x = new Date(d + 'T12:00:00'); return isNaN(x) ? '' : x.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); };
const MAPS = { 'morzine-26': 'course.html#courses' }; // course packs in Course Run
let C = null;

async function load() {
  try { C = await call('content'); } catch (e) { $('comps').innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; return; }
  const list = (C.competitions || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('comps').innerHTML = list.length ? list.map((c) => `<article class="comp">
      <h3>${esc(c.name)}</h3>
      <div class="where">${esc(c.place)}${c.date ? ' · ' + esc(fmtDate(c.date)) : ''}</div>
      ${c.note ? `<p class="muted" style="margin:0 0 8px">${esc(c.note)}</p>` : ''}
      ${c.winners && c.winners.length ? `<table class="winners"><thead><tr><th>Course</th><th>Women</th><th>Men</th><th>Time</th></tr></thead><tbody>${c.winners.map((w) => `<tr><td>${esc(w.course)}</td><td>${esc(w.women)}</td><td>${esc(w.men)}</td><td>${esc(w.time)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Winners not added yet.</div>'}
      <div class="actions">${c.course && MAPS[c.course] ? `<a class="btn btn-red" href="${MAPS[c.course]}">▶ Play the course</a>` : ''}</div>
    </article>`).join('') : '<div class="empty">No past competitions yet.</div>';
}

// admins: competitions and their winners
const winRow = (w = {}) => `<div class="grid2" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px" data-w>${field('Course', 'course', w.course || '')}${field('Women', 'women', w.women || '')}${field('Men', 'men', w.men || '')}${field('Time', 'time', w.time || '')}</div>`;
const compItem = (c = {}) => `<div class="item"><button type="button" class="rm" aria-label="Remove">×</button>${field('Competition', 'name', c.name || '')}<div class="grid2">${field('Date', 'date', c.date || '', 'date')}${field('Where', 'place', c.place || '')}</div>${field('Course map (Course Run pack, e.g. morzine-26)', 'course', c.course || '')}${field('Note', 'note', c.note || '', 'area')}
  <div class="wins">${(c.winners && c.winners.length ? c.winners : [{}, {}, {}, {}]).map(winRow).join('')}</div><button type="button" class="btn btn-ghost addw">Add a winners row</button></div>`;
$('edit').onclick = () => {
  editor('Past competitions', (C.competitions || []).map(compItem).join(''),
    (b) => call('content/competitions', { method: 'PUT', body: { value: [...b.querySelectorAll('.item')].map((it) => ({ name: val(it, 'name'), date: val(it, 'date'), place: val(it, 'place'), course: val(it, 'course'), note: val(it, 'note'),
      winners: [...it.querySelectorAll('[data-w]')].map((r) => ({ course: val(r, 'course'), women: val(r, 'women'), men: val(r, 'men'), time: val(r, 'time') })) })) } }).then(load),
    (b) => b.insertAdjacentHTML('afterbegin', compItem()));
  document.querySelector('.ed').addEventListener('click', (e) => { if (e.target.classList.contains('addw')) e.target.previousElementSibling.insertAdjacentHTML('beforeend', winRow()); });
};
getMe().then((me) => { $('edit').hidden = !me.admin; });
load();

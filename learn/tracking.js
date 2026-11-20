// People (#/people), one list since 19 November 2026 (it was People and Progress): each person once, with how far they are in each
// programme under their name. Admins see everyone, regional coordinators their region, programme owners and assessors their
// programmes' people. Filter, tick people (or everyone shown) and email them a reminder to complete by a date.
// The server side is api/src/learn/tracking.js (progress) and api/src/learn/people.js (the people list, admins and coordinators).
import { $, S, call, esc, t, toast, act, bar, day, when, has, isAdmin, regionName } from './core.js';

const STATUS = [['all', 'Everyone'], ['todo', 'Still to do'], ['overdue', 'Overdue'], ['completed', 'Completed']];
let PEOPLE = [];

// the people list (admins and coordinators) adds the people with no training yet, and SR numbers; progress (all four) the rest
export async function peopleList({ title, tabs = '', addBtn = '' }) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const f = { programme: q.get('programme') || '', region: q.get('region') || '', status: q.get('status') || 'all', q: q.get('q') || '' };
  const canList = isAdmin() || has('regional_coordinator');
  const canProgress = canList || has('assessor') || has('programme_owner');
  const [list, d] = await Promise.all([
    canList ? call(`people?q=${encodeURIComponent(f.q)}&region=${encodeURIComponent(f.region)}`).then((r) => r.people.filter((p) => !p.synthetic || S.me.viewAs)) : null,
    canProgress ? call(`tracking?${new URLSearchParams(f)}`) : { rows: [], programmes: [], regions: [] },
  ]);
  // one entry per person, in name order: their programmes under them
  const byId = new Map();
  for (const p of list || []) byId.set(p.id, { id: p.id, name: p.preferredName || p.legalName, email: p.email, regionId: p.regionId, publicId: p.publicId, rows: [] });
  for (const r of d.rows) {
    if (!byId.has(r.personId)) {
      if (list && !f.programme && f.status === 'all') continue; // outside the people list's search (an SR number, say)
      byId.set(r.personId, { id: r.personId, name: r.name, email: r.email, regionId: r.regionId, rows: [] });
    }
    byId.get(r.personId).rows.push(r);
  }
  // with a programme or a status chosen, only the people it matches
  PEOPLE = [...byId.values()].filter((p) => p.rows.length || (!f.programme && f.status === 'all')).sort((a, b) => a.name.localeCompare(b.name));
  const regions = d.regions.length ? d.regions.map((r) => [r.id, r.name]) : S.regions.map((r) => [r.id, r.name]);
  const sel = (name, opts, value, all) => `<select name="${name}" aria-label="${esc(t(all))}"><option value="">${esc(t(all))}</option>${opts.map(([v, n]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const badge = (r) => (r.status === 'completed' ? '<span class="badge s-completed">Completed</span>' : r.status === 'overdue' ? '<span class="badge s-expired">Overdue</span>' : '');
  const programme = (r) => `<div class="personProg"><small><b>${esc(r.title)}</b> ${badge(r)}</small>${bar(r.done, r.total)}
      <small><span>${esc(t('{done} of {total} lessons', { done: r.done, total: r.total }))}</span>${r.due ? ` · <span>${esc(t('complete by {date}', { date: day(r.due) }))}</span>` : ''}${r.remindedAt ? ` · <span>${esc(t('reminded {date}', { date: when(r.remindedAt) }))}</span>` : ''}${r.lastLesson ? ` · <span>${esc(t('last lesson {date}', { date: day(r.lastLesson) }))}</span>` : ''}</small></div>`;
  // one line per person; their programmes and lessons open when the person is clicked (20 November 2026)
  const glance = (rows) => {
    if (!rows.length) return `<small class="muted">${esc(t('No training assigned yet'))}</small>`;
    const overdue = rows.filter((r) => r.status === 'overdue').length, done = rows.filter((r) => r.status === 'completed').length;
    return `<small>${esc(rows.length === 1 ? t('1 programme') : t('{n} programmes', { n: rows.length }))}${done ? ` · <span>${esc(t('{n} completed', { n: done }))}</span>` : ''}${overdue ? ` · <span class="badText">${esc(t('{n} overdue', { n: overdue }))}</span>` : ''}</small>`;
  };
  const person = (p, i) => {
    const open = p.rows.some((r) => r.status !== 'completed');
    return `<li class="personRow">${canProgress ? `<input type="checkbox" data-person="${i}" aria-label="${esc(p.name)}"${open ? '' : ' disabled'}>` : ''}
      <details class="personMore"><summary><b>${esc(p.name)}</b><small>${p.publicId ? `${esc(p.publicId)} · ` : ''}${esc(p.email)}${p.regionId ? ` · ${esc(regionName(p.regionId))}` : ''}</small>${glance(p.rows)}</summary>
      ${p.rows.map(programme).join('')}
      ${canList ? `<p class="personOpen"><a class="btnLink" href="#/people/${esc(p.id)}">${esc(t('Open their profile'))}</a></p>` : ''}</details></li>`;
  };
  return `<section class="card"><div class="titleRow"><h1>${esc(t(title))}</h1>${addBtn}</div>${tabs}
      <p class="note">Everyone you look after, and how far they are with their training. Tick people, or everyone shown, to email them a reminder with a date to complete by.</p>
      <form class="filters2 trackFilter" id="trackFilter">
        <input name="q" type="search" placeholder="Name, email or SR number" value="${esc(f.q)}" aria-label="Find a person">
        ${sel('region', regions, f.region, isAdmin() ? 'All regions' : 'All my regions')}
        ${canProgress ? sel('programme', d.programmes.map((p) => [p.id, p.title]), f.programme, 'All programmes') : ''}
        ${canProgress ? `<select name="status" aria-label="Status">${STATUS.map(([v, n]) => `<option value="${v}"${v === f.status ? ' selected' : ''}>${esc(t(n))}</option>`).join('')}</select>` : ''}
        <button class="small" type="submit">Find</button>
      </form>
      ${canProgress && PEOPLE.length ? `<p class="trackCount"><label class="tickLabel"><input type="checkbox" id="tickAll"> <span>${esc(t('Tick all {n} shown', { n: PEOPLE.length }))}</span></label></p>` : `<p class="trackCount muted">${esc(t('{n} shown', { n: PEOPLE.length }))}</p>`}
      <ul class="rowList trackList">${PEOPLE.map(person).join('') || `<li class="muted">${esc(t('Nobody found.'))}</li>`}</ul>
    </section>
    ${canProgress ? `<section class="card remindCard" id="remindCard"><h2>Email a reminder</h2>
      <p class="note">Goes to the people ticked, for each programme they haven't finished.</p>
      <form class="form2" id="remindForm">
        <div><label for="rm-due">Complete by</label><input id="rm-due" name="due" type="date" required></div>
        <div class="wide"><label for="rm-msg">A message (optional)</label><textarea id="rm-msg" name="message" rows="2" maxlength="1000"></textarea></div>
        <div class="wide"><button class="primary" type="submit" id="rm-go" disabled>Email the people ticked</button></div>
      </form><div id="rm-result" aria-live="polite"></div></section>` : ''}`;
}

// the old Progress tab's address opens People with the same filters
export const views = { progress: async () => { location.replace(location.hash.replace('#/progress', '#/people')); return ''; } };
export function wire() {
  const form = $('trackFilter'); if (!form) return;
  form.onsubmit = (e) => { e.preventDefault(); location.hash = `#/people?${new URLSearchParams([...new FormData(form)].filter(([, v]) => v))}`; };
  for (const s of form.querySelectorAll('select')) s.onchange = () => form.requestSubmit();
  if (!$('remindForm')) return;
  const boxes = () => [...document.querySelectorAll('input[data-person]:not(:disabled)')];
  const count = () => {
    const n = boxes().filter((b) => b.checked).length;
    $('rm-go').disabled = !n;
    $('rm-go').textContent = n ? t(n === 1 ? 'Email 1 person' : 'Email {n} people', { n }) : t('Email the people ticked');
  };
  if ($('tickAll')) $('tickAll').onchange = (e) => { for (const b of boxes()) b.checked = e.target.checked; count(); };
  for (const b of boxes()) b.onchange = count;
  $('remindForm').onsubmit = (e) => {
    e.preventDefault();
    const ids = boxes().filter((b) => b.checked).flatMap((b) => PEOPLE[Number(b.dataset.person)].rows.filter((r) => r.status !== 'completed').map((r) => r.enrolmentId));
    if (!ids.length) return;
    act(async () => {
      const r = await call('tracking/remind', { method: 'POST', body: { enrolmentIds: ids, due: e.target.due.value, message: e.target.message.value } });
      $('rm-result').innerHTML = `<p class="okText"><b>${esc(t(r.sent === 1 ? '1 reminder sent.' : '{n} reminders sent.', { n: r.sent }))}</b></p>${r.failed.length ? `<ul class="plain">${r.failed.map((x) => `<li class="badText">${esc(x.name)}: ${esc(x.error)}</li>`).join('')}</ul>` : ''}`;
      toast(t('Reminders sent'));
    }, e.submitter);
  };
}

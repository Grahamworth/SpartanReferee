// Progress (#/progress): who has done their lessons, for admins (everyone), programme owners and assessors (their programmes) and
// regional coordinators (their region). Filter, tick people (or everyone shown) and email them a reminder to complete by a date.
// The server side is api/src/learn/tracking.js.
import { $, call, esc, t, toast, act, bar, day, when } from './core.js';

const STATUS = [['todo', 'Still to do'], ['overdue', 'Overdue'], ['completed', 'Completed'], ['all', 'Everyone']];
let ROWS = [];

async function progressView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const f = { programme: q.get('programme') || '', region: q.get('region') || '', status: q.get('status') || 'todo', q: q.get('q') || '' };
  const d = await call(`tracking?${new URLSearchParams(f)}`);
  ROWS = d.rows;
  const sel = (name, list, value, all) => `<select name="${name}" aria-label="${esc(all)}"><option value="">${esc(t(all))}</option>${list.map(([v, n]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const rowStatus = (r) => (r.status === 'completed' ? '<span class="badge s-completed">Completed</span>' : r.status === 'overdue' ? '<span class="badge s-expired">Overdue</span>' : '');
  return `<section class="card"><h1>Progress</h1>
      <p class="note">Who has done their lessons. Tick people, or everyone shown, to email them a reminder with a date to complete by.</p>
      <form class="filters2 trackFilter" id="trackFilter">
        ${sel('programme', d.programmes.map((p) => [p.id, p.title]), f.programme, 'All programmes')}
        ${sel('region', d.regions.map((r) => [r.id, r.name]), f.region, 'All regions')}
        <select name="status" aria-label="Status">${STATUS.map(([v, n]) => `<option value="${v}"${v === f.status ? ' selected' : ''}>${esc(t(n))}</option>`).join('')}</select>
        <input name="q" type="search" placeholder="Name or email" value="${esc(f.q)}" aria-label="Find a person">
        <button class="small" type="submit">Show</button>
      </form>
      <p class="trackCount"><label class="tickLabel"><input type="checkbox" id="tickAll"> <span>${esc(t('Tick all {n} shown', { n: d.rows.length }))}</span></label></p>
      <ul class="rowList trackList">${d.rows.map((r, i) => `<li><label class="trackRow"><input type="checkbox" data-row="${i}"${r.status === 'completed' ? ' disabled' : ''}>
          <span><b>${esc(r.name)}</b> ${rowStatus(r)}<small><span>${esc(r.title)}</span> · ${esc(r.email)}</small>
          ${bar(r.done, r.total)}<small><span>${esc(t('{done} of {total} lessons', { done: r.done, total: r.total }))}</span>${r.due ? ` · <span>${esc(t('complete by {date}', { date: day(r.due) }))}</span>` : ''}${r.remindedAt ? ` · <span>${esc(t('reminded {date}', { date: when(r.remindedAt) }))}</span>` : ''}${r.lastLesson ? ` · <span>${esc(t('last lesson {date}', { date: day(r.lastLesson) }))}</span>` : ''}</small></span></label></li>`).join('') || `<li class="muted">${esc(t('Nobody here.'))}</li>`}</ul>
    </section>
    <section class="card remindCard" id="remindCard"><h2>Email a reminder</h2>
      <form class="form2" id="remindForm">
        <div><label for="rm-due">Complete by</label><input id="rm-due" name="due" type="date" required></div>
        <div class="wide"><label for="rm-msg">A message (optional)</label><textarea id="rm-msg" name="message" rows="2" maxlength="1000"></textarea></div>
        <div class="wide"><button class="primary" type="submit" id="rm-go" disabled>Email the people ticked</button></div>
      </form><div id="rm-result" aria-live="polite"></div></section>`;
}

export const views = { progress: progressView };
export function wire() {
  const form = $('trackFilter'); if (!form) return;
  form.onsubmit = (e) => { e.preventDefault(); location.hash = `#/progress?${new URLSearchParams([...new FormData(form)].filter(([, v]) => v))}`; };
  for (const s of form.querySelectorAll('select')) s.onchange = () => form.requestSubmit();
  const boxes = () => [...document.querySelectorAll('input[data-row]:not(:disabled)')];
  const count = () => {
    const n = boxes().filter((b) => b.checked).length;
    $('rm-go').disabled = !n;
    $('rm-go').textContent = n ? t(n === 1 ? 'Email 1 person' : 'Email {n} people', { n }) : t('Email the people ticked');
  };
  $('tickAll').onchange = (e) => { for (const b of boxes()) b.checked = e.target.checked; count(); };
  for (const b of boxes()) b.onchange = count;
  $('remindForm').onsubmit = (e) => {
    e.preventDefault();
    const ids = boxes().filter((b) => b.checked).map((b) => ROWS[Number(b.dataset.row)].enrolmentId);
    if (!ids.length) return;
    act(async () => {
      const r = await call('tracking/remind', { method: 'POST', body: { enrolmentIds: ids, due: e.target.due.value, message: e.target.message.value } });
      $('rm-result').innerHTML = `<p class="okText"><b>${esc(t(r.sent === 1 ? '1 reminder sent.' : '{n} reminders sent.', { n: r.sent }))}</b></p>${r.failed.length ? `<ul class="plain">${r.failed.map((x) => `<li class="badText">${esc(x.name)}: ${esc(x.error)}</li>`).join('')}</ul>` : ''}`;
      toast(t('Reminders sent'));
    }, e.submitter);
  };
}

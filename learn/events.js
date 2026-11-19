// Events (#/events): your events, upcoming and past; each event's page (#/events/<id>): its days and place, Spartan's own page for it,
// notes from its organisers, who's refereeing it, and its burpee cameras: everyone assigned watches and reviews them, and those ticked
// for it book them (on the event's camera page, event.html). Admins, and regional coordinators for their region, also manage events
// here: every event they look after with how many referees it has, and on each one, adding referees (paste many addresses), head
// referee, the camera tick, and notes. The server side is api/src/assignments.js (GET /api/my/events, /api/event/<id>, /api/manage/events).
import { $, call, esc, t, toast, act, redraw, has, isAdmin, when } from './core.js';
import { call as siteCall } from '../api-base.js';
import { viaCache } from '../offline.js';
import { datesOf, eventRow } from './home.js';

const managerish = () => isAdmin() || has('regional_coordinator');

async function eventsList() {
  const q = new URLSearchParams(location.hash.split('?')[1] || ''), manage = q.get('manage') === '1' && managerish(), find = q.get('q') || '';
  const mine = await viaCache('site/my/events', () => siteCall('my/events')).catch(() => ({ upcoming: [], past: [] }));
  const tabs = managerish() ? `<p class="chips inviteTabs"><a class="chipLink${manage ? '' : ' on'}" href="#/events">Your events</a><a class="chipLink${manage ? ' on' : ''}" href="#/events?manage=1">Manage events</a></p>` : '';
  if (manage) {
    const m = await siteCall(`manage/events?q=${encodeURIComponent(find)}`);
    return `<section class="card"><h1>Events</h1>${tabs}
      <p class="note">${esc(m.admin ? t('Every upcoming Spartan event. Open one to add its referees, choose its head referee, tick who books its cameras and leave notes for its referees.') : t('The upcoming events in your regions. Open one to add its referees, choose its head referee, tick who books its cameras and leave notes for its referees.'))}</p>
      <form class="filters2" id="eventFind"><input name="q" type="search" placeholder="Find an event, city or country" value="${esc(find)}" aria-label="Find an event"><button class="small" type="submit">Find</button></form>
      <ul class="rowList manageList">${m.events.map((e) => `<li><a href="#/events/${esc(e.id)}"><b>${esc(e.name)}</b><small>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small>
        <small class="${e.referees ? '' : 'badText'}">${esc(t('{n} referees', { n: e.referees }))} · ${esc(e.heads ? t('head referee set') : t('no head referee'))} · ${esc(t('{n} may book the cameras', { n: e.canBook }))}</small></a></li>`).join('') || `<li class="muted">${esc(t('No events found.'))}</li>`}</ul></section>`;
  }
  return `<section class="card"><h1>Events</h1>${tabs}
      <h2>Coming up</h2><ul class="events">${mine.upcoming.map((e) => eventRow(e)).join('') || `<li class="muted">${esc(t('No events assigned to you yet.'))}</li>`}</ul>
      ${mine.past.length ? `<details class="pastEvents"><summary>${esc(t('Past events ({n})', { n: mine.past.length }))}</summary><ul class="events">${mine.past.map((e) => eventRow(e)).join('')}</ul></details>` : ''}</section>`;
}

let PAGE = null;
async function eventPage(id) {
  const d = PAGE = await viaCache(`site/event/${id}`, () => siteCall(`event/${encodeURIComponent(id)}`));
  const e = d.event;
  const people = d.referees.map((r) => `<li class="refRow"><span><b>${esc(r.name || r.email || '')}</b>${r.you ? ` <small>(${esc(t('you'))})</small>` : ''}
      <small>${r.role === 'head' ? '<span class="chip head">Head referee</span>' : '<span class="chip">Referee</span>'}${r.canBook ? ' <span class="chip">Books the cameras</span>' : ''}${d.canManage && r.email && r.name ? ` · ${esc(r.email)}` : ''}</small></span>
      ${d.canManage ? `<span class="rowBtns">
        <button class="small" type="button" data-role="${r.role === 'head' ? 'referee' : 'head'}" data-email="${esc(r.email)}">${r.role === 'head' ? 'Make referee' : 'Make head referee'}</button>
        <label class="tickLabel"><input type="checkbox" data-book="${esc(r.email)}"${r.canBook ? ' checked' : ''}> <span>Books the cameras</span></label>
        <button class="small" type="button" data-remove="${esc(r.email)}">Remove</button></span>` : ''}</li>`).join('');
  return `<section class="card"><p class="crumbs"><a href="#/events${d.canManage && !d.you ? '?manage=1' : ''}">Events</a></p>
      <h1>${esc(e.name)}</h1>
      <p>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}${e.over ? ` · <span class="muted">${esc(t('over'))}</span>` : ''}</p>
      ${d.you ? `<p>${d.you.role === 'head' ? '<span class="chip head">You\'re its head referee</span>' : '<span class="chip">You\'re refereeing it</span>'}</p>` : ''}
      ${e.url ? `<p><a href="${esc(e.url)}" target="_blank" rel="noopener">Spartan's page for this event</a></p>` : ''}</section>
    ${d.notes ? `<section class="card eventNotes"><h2>Notes from the organisers</h2><p class="noteText">${esc(d.notes.text)}</p><p class="note">${esc(t('Updated {date}', { date: when(d.notes.at) }))}${d.notes.by ? ` · <span>${esc(d.notes.by)}</span>` : ''}</p></section>` : ''}
    <section class="card"><h2>SpartanReferee cameras</h2>
      <p class="note">${esc(t('The burpee cameras at the penalty station: watch them live and review every rep once they\'re running.'))}</p>
      <div class="btnRow"><a class="btnLink primaryLink" href="../console.html?unit=e${esc(e.id)}">Watch and review</a>${d.canBook ? `<a class="btnLink" href="../event.html?id=${esc(e.id)}">Book the cameras</a>` : ''}</div>
      ${d.booking ? `<p class="note">${esc(t('Cameras booked for this event.'))}</p>` : ''}
      ${!d.canBook && d.you ? `<p class="note">${esc(t('Booking them is for those the organisers ticked.'))}</p>` : ''}</section>
    <section class="card"><h2>${esc(t('Referees ({n})', { n: d.referees.length }))}</h2>
      <ul class="rowList refList">${people || `<li class="muted">${esc(t('Nobody assigned yet.'))}</li>`}</ul>
      ${d.canManage ? `<form class="form2 addRefs" id="addRefs"><div class="wide"><label for="ar-emails">Add referees: their email addresses</label>
          <textarea id="ar-emails" name="emails" rows="3" required placeholder="one or many: separated by commas, spaces or new lines" list="peopleSuggest"></textarea>
          <small class="note">Only people who've registered (from their invite) can be added.</small></div>
        <div><label for="ar-role">As</label><select id="ar-role" name="role"><option value="referee">Referee</option><option value="head">Head referee</option></select></div>
        <div><label class="tickLabel"><input type="checkbox" name="canBook"> <span>Can book the cameras</span></label></div>
        <div class="wide"><button class="small primaryish" type="submit">Add</button></div></form>
        <div id="ar-result" aria-live="polite"></div>` : ''}</section>
    ${d.canManage ? `<section class="card"><h2>Notes for the referees</h2><p class="note">Every referee at the event sees these on this page: where to meet, times, what to bring.</p>
      <form id="eventNotes"><textarea name="text" rows="5" maxlength="4000" aria-label="Notes for the referees">${esc(d.notes?.text || '')}</textarea>
      <div class="btnRow"><button class="small primaryish" type="submit">Save the notes</button></div></form></section>` : ''}`;
}

export const views = { async events(rest) { return rest ? eventPage(rest) : eventsList(); } };
export function wire() {
  $('eventFind')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/events?manage=1&q=${encodeURIComponent(e.target.q.value.trim())}`; });
  if (!PAGE || !$('addRefs') && !document.querySelector('[data-remove]')) return;
  const id = PAGE.event.id;
  const send = (body) => siteCall(`event/${encodeURIComponent(id)}/referees`, { method: 'POST', body });
  $('addRefs')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    act(async () => {
      const r = await send({ emails: f.emails.value, role: f.role.value, canBook: f.canBook.checked });
      $('ar-result').innerHTML = `<p class="okText">${esc(t(r.added.length === 1 ? '1 added.' : '{n} added.', { n: r.added.length }))}</p>${r.skipped.length ? `<ul class="plain">${r.skipped.map((s) => `<li>${esc(s.email)}: <span>${esc(s.why)}</span></li>`).join('')}</ul>` : ''}`;
      if (r.added.length) setTimeout(redraw, 1200);
    }, e.submitter);
  });
  for (const b of document.querySelectorAll('[data-role]')) b.onclick = () => act(async () => { await send({ email: b.dataset.email, role: b.dataset.role, ...(b.dataset.role === 'head' ? { canBook: true } : {}) }); toast(t('Changed')); redraw(); }, b);
  for (const c of document.querySelectorAll('[data-book]')) c.onchange = () => act(async () => { await send({ email: c.dataset.book, canBook: c.checked }); toast(c.checked ? t('Can book the cameras') : t('Can\'t book the cameras')); }, c);
  for (const b of document.querySelectorAll('[data-remove]')) b.onclick = () => { if (confirm(t('Take this referee off the event?'))) act(async () => { await send({ email: b.dataset.remove, remove: true }); toast(t('Removed')); redraw(); }, b); };
  $('eventNotes')?.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await siteCall(`event/${encodeURIComponent(id)}/notes`, { method: 'PUT', body: { text: e.target.text.value } }); toast(t('Notes saved')); redraw(); }, e.submitter); });
}

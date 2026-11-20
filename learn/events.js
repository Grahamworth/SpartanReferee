// My Events (#/events): your events, upcoming and past; each event's page (#/events/<id>): its days and place, Spartan's own page for it,
// notes from its organisers, who's refereeing it, and its burpee cameras: everyone assigned watches and reviews them, and those ticked
// for it book them (on the event's camera page, event.html). Admins, and regional coordinators for their region, also manage events
// here: every event they look after with how many referees it has, and on each one, adding referees (paste many addresses), head
// referee, the camera tick, and notes. The server side is api/src/assignments.js (GET /api/my/events, /api/event/<id>, /api/manage/events).
import { $, call, esc, t, toast, act, redraw, isAdmin, when } from './core.js';
import { call as siteCall } from '../api-base.js';
import { viaCache } from '../offline.js';
import { datesOf, eventRow } from './home.js';


// Manage Events (#/manage, admins and regional coordinators; its own tab since 19 November 2026): the events they look after, each
// opening its page here (#/manage/<id>) to set its referees; admins also sync Spartan's events (it was on the Config page)
async function manageList() {
  const q = new URLSearchParams(location.hash.split('?')[1] || ''), find = q.get('q') || '';
  const [m, sync] = await Promise.all([siteCall(`manage/events?q=${encodeURIComponent(find)}`), isAdmin() ? siteCall('events').catch((e) => ({ error: e.message, events: [] })) : null]);
  // admins: when Spartan's events were last synced, and Sync now, at the top (not under hundreds of events)
  const syncBox = sync ? `<div class="syncBox"><p class="note" id="syncLine">${esc(sync.syncedAt ? t('{n} upcoming events, last synced {date}', { n: sync.events.length, date: when(sync.syncedAt) }) : t('Not synced yet.'))}</p>
      ${sync.error ? `<p class="badText">${esc(t('The last sync didn\'t work: {error}. The events from the last good one are still used.', { error: sync.error }))}</p>` : ''}
      <p class="note">Synced from Spartan's race list every 6 hours, when someone opens the cameras. Referees book an event's cameras from 07:00 to 18:00 local time on its days; admins can book any time.</p>
      <div class="btnRow"><button class="small" type="button" id="syncNow">Sync now</button></div></div>` : '';
  return `<section class="card"><h1>Manage Events</h1>
      ${syncBox}
      <p class="note">${esc(m.admin ? t('Every upcoming Spartan event. Open one to add its referees, choose its head referee, tick who books its cameras and leave notes for its referees.') : t('The upcoming events in your regions. Open one to add its referees, choose its head referee, tick who books its cameras and leave notes for its referees.'))}</p>
      <form class="filters2" id="eventFind"><input name="q" type="search" placeholder="Find an event, city or country" value="${esc(find)}" aria-label="Find an event"><button class="small" type="submit">Find</button></form>
      <ul class="rowList manageList">${m.events.map((e) => `<li><a href="#/manage/${esc(e.id)}"><b>${esc(e.name)}</b><small>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small>
        <small class="${e.referees ? '' : 'badText'}">${esc(t('{n} referees', { n: e.referees }))} · ${esc(e.heads ? t('head referee set') : t('no head referee'))} · ${esc(t('{n} may book the cameras', { n: e.canBook }))}</small>
        ${e.camerasBooked ? `<small class="okText">${esc(t('Cameras booked'))}</small>` : `<small class="warnText">⚠ ${esc(t('Cameras not booked yet'))}</small>`}</a></li>`).join('') || `<li class="muted">${esc(t('No events found.'))}</li>`}</ul></section>`;
}

// Events (#/events): your own events, upcoming and past. Read only: the organisers' notes show here, and managing an event (its
// referees, its notes) is in Manage Events (20 November 2026)
async function eventsList() {
  const mine = await viaCache('site/my/events', () => siteCall('my/events')).catch(() => ({ upcoming: [], past: [] }));
  return `<section class="card"><h1>Events</h1>
      <h2>Coming up</h2><ul class="events">${mine.upcoming.map((e) => eventRow(e)).join('') || `<li class="muted">${esc(t('No events assigned to you yet.'))}</li>`}</ul>
      ${mine.past.length ? `<details class="pastEvents"><summary>${esc(t('Past events ({n})', { n: mine.past.length }))}</summary><ul class="events">${mine.past.map((e) => eventRow(e)).join('')}</ul></details>` : ''}</section>`;
}

let PAGE = null;
/** an event's page: on Events (#/events/<id>) everyone sees it as it is; on Manage Events (#/manage/<id>) its managers also change its
 *  referees and its notes, and see a warning while its cameras aren't booked */
async function eventPage(id) {
  const d = PAGE = await viaCache(`site/event/${id}`, () => siteCall(`event/${encodeURIComponent(id)}`));
  const e = d.event, managing = d.canManage && location.hash.startsWith('#/manage');
  const people = d.referees.map((r) => `<li class="refRow"><span><b>${esc(r.name || r.email || '')}</b>${r.you ? ` <small>(${esc(t('you'))})</small>` : ''}
      <small>${r.role === 'head' ? '<span class="chip head">Head referee</span>' : '<span class="chip">Referee</span>'}${r.canBook ? ' <span class="chip">Books the cameras</span>' : ''}${managing && r.email && r.name ? ` · ${esc(r.email)}` : ''}</small></span>
      ${managing ? `<span class="rowBtns">
        <button class="small" type="button" data-role="${r.role === 'head' ? 'referee' : 'head'}" data-email="${esc(r.email)}">${r.role === 'head' ? 'Make referee' : 'Make head referee'}</button>
        <label class="tickLabel"><input type="checkbox" data-book="${esc(r.email)}"${r.canBook ? ' checked' : ''}> <span>Books the cameras</span></label>
        <button class="small" type="button" data-remove="${esc(r.email)}">Remove</button></span>` : ''}</li>`).join('');
  const noteMeta = d.notes ? `<p class="note">${esc(t('Updated {date}', { date: when(d.notes.at) }))}${d.notes.by ? ` · <span>${esc(d.notes.by)}</span>` : ''}</p>` : '';
  // managing: the notes are written and changed where they show, in one card
  const notesCard = managing
    ? `<section class="card eventNotes" id="notesCard"><h2>Notes for the referees</h2>
        <p class="note">Every referee at the event sees these on its page in Events: where to meet, times, what to bring.</p>
        ${d.notes ? `<div id="notesShown"><p class="noteText">${esc(d.notes.text)}</p>${noteMeta}
          <div class="btnRow"><button class="small" type="button" id="notesEdit">Edit</button><button class="small" type="button" id="notesRemove">Remove</button></div></div>` : ''}
        <form id="eventNotes"${d.notes ? ' hidden' : ''}><textarea name="text" rows="5" maxlength="4000" aria-label="Notes for the referees" placeholder="${esc(t('Where to meet, times, what to bring'))}">${esc(d.notes?.text || '')}</textarea>
          <div class="btnRow"><button class="small primaryish" type="submit">${d.notes ? 'Save the notes' : 'Add the notes'}</button>${d.notes ? '<button class="small" type="button" id="notesCancel">Cancel</button>' : ''}</div></form></section>`
    : d.notes ? `<section class="card eventNotes"><h2>Notes from the organisers</h2><p class="noteText">${esc(d.notes.text)}</p>${noteMeta}</section>` : '';
  return `<section class="card"><p class="crumbs">${location.hash.startsWith('#/manage') ? '<a href="#/manage">Manage Events</a>' : '<a href="#/events">Events</a>'}</p>
      <h1>${esc(e.name)}</h1>
      <p>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}${e.over ? ` · <span class="muted">${esc(t('over'))}</span>` : ''}</p>
      ${d.you ? `<p>${d.you.role === 'head' ? '<span class="chip head">You\'re its head referee</span>' : '<span class="chip">You\'re refereeing it</span>'}</p>` : ''}
      ${e.url ? `<p><a href="${esc(e.url)}" target="_blank" rel="noopener">Spartan's page for this event</a></p>` : ''}
      ${d.canManage && !managing ? `<p><a class="btnLink" href="#/manage/${esc(e.id)}">Manage this event</a></p>` : ''}</section>
    ${managing && !d.booking && !e.over ? `<section class="card warnCard" role="status"><p><b>⚠ ${esc(t('Cameras not booked yet'))}</b></p><p class="note">${esc(t('Nobody has booked this event\'s cameras. Someone ticked "Books the cameras" can book them, or you can.'))}</p><div class="btnRow"><a class="btnLink" href="../event.html?id=${esc(e.id)}">Book the cameras</a></div></section>` : ''}
    ${notesCard}
    <section class="card"><h2>SpartanReferee cameras</h2>
      <p class="note">${esc(t('The burpee cameras at the penalty station: watch them live and review every rep once they\'re running.'))}</p>
      <div class="btnRow"><a class="btnLink primaryLink" href="../console.html?unit=e${esc(e.id)}">Watch and review</a>${d.canBook ? `<a class="btnLink" href="../event.html?id=${esc(e.id)}">Book the cameras</a>` : ''}</div>
      ${d.booking ? `<p class="note">${esc(t('Cameras booked for this event.'))}</p>` : ''}
      ${!d.canBook && d.you ? `<p class="note">${esc(t('Booking them is for those the organisers ticked.'))}</p>` : ''}</section>
    <section class="card"><h2>${esc(t('Referees ({n})', { n: d.referees.length }))}</h2>
      <ul class="rowList refList">${people || `<li class="muted">${esc(t('Nobody assigned yet.'))}</li>`}</ul>
      ${managing ? `<form class="form2 addRefs" id="addRefs"><div class="wide"><label for="ar-emails">Add referees: their email addresses</label>
          <textarea id="ar-emails" name="emails" rows="3" required placeholder="one or many: separated by commas, spaces or new lines" list="peopleSuggest"></textarea>
          <small class="note">Only people who've registered (from their invite) can be added.</small></div>
        <div><label for="ar-role">As</label><select id="ar-role" name="role"><option value="referee">Referee</option><option value="head">Head referee</option></select></div>
        <div><label class="tickLabel"><input type="checkbox" name="canBook"> <span>Can book the cameras</span></label></div>
        <div class="wide"><button class="small primaryish" type="submit">Add</button></div></form>
        <div id="ar-result" aria-live="polite"></div>` : ''}</section>`;
}

export const views = {
  async events(rest) { if (/[?&]manage=1/.test(location.hash)) { location.replace('#/manage'); return ''; } return rest ? eventPage(rest) : eventsList(); },
  async manage(rest) { return rest ? eventPage(rest) : manageList(); },
};
export function wire() {
  $('eventFind')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/manage?q=${encodeURIComponent(e.target.q.value.trim())}`; });
  $('syncNow')?.addEventListener('click', (e) => act(async () => { await siteCall('admin/events/sync', { method: 'POST', body: {} }); toast(t('Events synced')); redraw(); }, e.currentTarget));
  if (!PAGE || !$('addRefs') && !$('eventNotes')) return;
  const id = PAGE.event.id;
  const saveNotes = (text, btn, done) => act(async () => { await siteCall(`event/${encodeURIComponent(id)}/notes`, { method: 'PUT', body: { text } }); toast(t(done)); redraw(); }, btn);
  $('notesEdit')?.addEventListener('click', () => { $('notesShown').hidden = true; $('eventNotes').hidden = false; $('eventNotes').text.focus(); });
  $('notesCancel')?.addEventListener('click', () => { $('eventNotes').hidden = true; $('notesShown').hidden = false; });
  $('notesRemove')?.addEventListener('click', (e) => { if (confirm(t('Remove the notes for this event\'s referees?'))) saveNotes('', e.currentTarget, 'Notes removed'); });
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
  $('eventNotes')?.addEventListener('submit', (e) => { e.preventDefault(); saveNotes(e.target.text.value, e.submitter, e.target.text.value.trim() ? 'Notes saved' : 'Notes removed'); });
}

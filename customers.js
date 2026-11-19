// The admin area for SpartanReferee: who can sign in (the referees), who the admins are, and the servers and this month's use.
import { call, devSignInButton, signedIn, getMe, signOut, esc } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';

const { money, plural, timeLeft } = window.HeadJudgeBooking;
const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const toast = (s) => { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); };
const onDay = (t) => new Date(t).toLocaleDateString();
let referees = [], events = [], assigned = [], admins = [];

// ---------------------------------------------------------------- servers and this month
function serverLine(s) {
  if (!s || s.wanted !== 'on') return s?.state === 'stopping' ? 'Stopping' : 'Off';
  const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (s.scheduled) return `Booked · ${plural(s.cameras, 'camera')} · ${when(s.from)} to ${when(s.until)}`;
  return `${s.state === 'on' ? 'On' : 'Starting'} · ${s.camerasLive} of ${plural(s.cameras, 'camera')} live · until ${new Date(s.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${timeLeft(s.until - Date.now())})`;
}
// each booking (an event's, a referee's training, an admin's testing) that's on, booked ahead or stopping
const KIND = { event: 'Event', training: 'Training', testing: 'Testing' };
async function load() {
  const data = await call('admin/customers');
  const t = data.totals;
  $('monthName').textContent = new Date(`${data.month}-15`).toLocaleDateString([], { month: 'long', year: 'numeric' });
  $('tAzure').textContent = money(t.azure);
  $('tHours').textContent = String(t.cameraHours);
  $('tRunning').textContent = data.running; $('tRunningOf').textContent = `of ${plural(data.maxRunning, 'server')} allowed at once`;
  const live = data.customers.filter((b) => b.server.wanted === 'on' || b.server.state === 'stopping' || b.server.state === 'starting');
  $('bookingList').innerHTML = live.length ? live.map((b) => {
    const s = b.server, state = s.wanted === 'on' ? (s.scheduled ? 'booked' : s.state === 'on' ? 'on' : 'starting') : 'stopping';
    return `<li><span><b>${esc(KIND[b.kind] ? `${KIND[b.kind]}: ` : '')}${esc(b.name)}</b><small><span class="light" data-state="${state}" aria-hidden="true"></span> ${esc(serverLine(s))}${b.bookedBy ? ` · ${esc(b.bookedBy)}` : ''}</small>${s.error ? `<small class="error">${esc(s.error)}</small>` : ''}</span>${s.wanted === 'on' ? `<button class="small" type="button" data-stop="${esc(b.id)}" data-name="${esc(b.name)}">${s.scheduled ? 'Cancel' : 'Stop'}</button>` : ''}</li>`;
  }).join('') : '<li class="muted">Nothing booked or running.</li>';
  for (const btn of $('bookingList').querySelectorAll('button[data-stop]')) btn.onclick = () => stopBooking(btn.dataset.stop, btn.dataset.name);
}
async function stopBooking(id, name) {
  if (!confirm(`Stop ${name}'s servers now? Their cameras stop being recorded.`)) return;
  try { await call(`admin/customers/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); toast(`Stopping ${name}`); await load(); }
  catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- Spartan's events
function drawSync(r) {
  $('syncLine').textContent = r.syncedAt ? `${plural(r.events.length, 'upcoming event')}, last synced ${new Date(r.syncedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'Not synced yet.';
  $('syncError').textContent = r.error ? `The last sync didn't work: ${r.error}. The events from the last good one are still used.` : ''; show($('syncError'), !!r.error);
}
async function loadSync() { try { const r = await call('events'); drawSync(r); events = r.events; await loadAssignments(); } catch (e) { $('syncLine').textContent = e.message; } }
$('syncNow').addEventListener('click', async () => {
  $('syncNow').disabled = true;
  try { const r = await call('admin/events/sync', { method: 'POST', body: {} }); drawSync(r); events = r.events; await loadAssignments(); toast('Events synced'); } catch (e) { toast(e.message); }
  $('syncNow').disabled = false;
});

// ---------------------------------------------------------------- who's refereeing each event
const assignFail = (msg) => { $('assignError').textContent = msg || ''; show($('assignError'), !!msg); };
const eventDates = (e) => {
  const f = new Intl.DateTimeFormat([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), d = (x) => new Date(`${x}T12:00:00Z`);
  return e.endDate && e.endDate !== e.startDate && f.formatRange ? f.formatRange(d(e.startDate), d(e.endDate)) : f.format(d(e.startDate));
};
function drawAssignments() {
  const pick = $('assignEvent'), was = pick.value;
  const count = (id) => assigned.filter((a) => a.eventId === id).length;
  pick.innerHTML = events.length ? events.map((e) => { const n = count(e.id); return `<option value="${esc(e.id)}">${esc(`${n ? `${n} assigned · ` : ''}${e.name} · ${eventDates(e)}${e.city ? ` · ${e.city}` : ''}`)}</option>`; }).join('') : '<option value="">No upcoming events: sync them first</option>';
  pick.value = events.some((e) => e.id === was) ? was : (events.find((e) => count(e.id))?.id || events[0]?.id || '');
  const here = assigned.filter((a) => a.eventId === pick.value);
  // head referees first; each can be switched between head referee and referee
  $('assignList').innerHTML = here.length ? here.map((a) => `<li><span><b>${esc(a.email)}</b><small>${a.role === 'head' ? '<strong>Head referee</strong>' : 'Referee'} · assigned${a.by ? ` by ${esc(a.by)}` : ''} on ${esc(onDay(a.at))}</small></span><span class="rowBtns"><button class="small" type="button" data-role="${a.role === 'head' ? 'referee' : 'head'}" data-email="${esc(a.email)}">${a.role === 'head' ? 'Make referee' : 'Make head referee'}</button><button class="small" type="button" data-unassign="${esc(a.email)}">Remove</button></span></li>`).join('')
    : `<li class="muted">${pick.value ? 'Nobody assigned to this event yet.' : ''}</li>`;
  for (const b of $('assignList').querySelectorAll('button[data-unassign]')) b.onclick = () => unassign(b.dataset.unassign);
  for (const b of $('assignList').querySelectorAll('button[data-role]')) b.onclick = () => assign(b.dataset.email, b.dataset.role, true);
  // who can be assigned: the referees on the list, and the admins
  $('refereeEmails').innerHTML = [...new Set([...referees.map((p) => p.email), ...admins])].sort().map((e) => `<option value="${esc(e)}"></option>`).join('');
  $('addAssign').querySelector('button').disabled = !pick.value;
}
async function loadAssignments() { assigned = (await call('admin/assignments')).assignments; drawAssignments(); }
async function unassign(email) {
  const ev = events.find((e) => e.id === $('assignEvent').value);
  if (!ev || !confirm(`Take ${email} off ${ev.name}?`)) return;
  assignFail('');
  try { await call('admin/assignments', { method: 'POST', body: { eventId: ev.id, email, remove: true } }); await loadAssignments(); toast(`${email} is off ${ev.name}`); }
  catch (e) { assignFail(e.message); }
}
$('assignEvent').addEventListener('change', () => { assignFail(''); drawAssignments(); });
// assigns someone to the chosen event as head referee or referee, or (changing) switches their role there
async function assign(email, role, changing = false) {
  const ev = events.find((x) => x.id === $('assignEvent').value); if (!ev) return false;
  assignFail('');
  try {
    await call('admin/assignments', { method: 'POST', body: { eventId: ev.id, email, role } }); await loadAssignments();
    const as = role === 'head' ? 'head referee' : 'referee';
    toast(changing ? `${email} is now ${as} for ${ev.name}` : `${email} is assigned to ${ev.name} as ${as}`);
    return true;
  } catch (err) { assignFail(err.message); return false; }
}
$('addAssign').addEventListener('submit', async (e) => {
  e.preventDefault(); assignFail('');
  if (await assign($('assignEmail').value.trim(), $('assignRole').value)) { $('assignEmail').value = ''; $('assignRole').value = 'referee'; }
});

// ---------------------------------------------------------------- referees: who can sign in
const refereeFail = (msg) => { $('refereeError').textContent = msg || ''; show($('refereeError'), !!msg); };
function drawReferees() {
  const q = $('findReferee').value.trim().toLowerCase();
  show($('findReferee'), referees.length > 8);
  const list = referees.filter((p) => !q || p.email.includes(q));
  $('refereeList').innerHTML = list.length ? list.map((p) => `<li><span><b>${esc(p.email)}</b><small>${p.seen ? `Signed in ${esc(onDay(p.seen))}` : 'Not signed in yet'}${p.addedBy ? ` · added by ${esc(p.addedBy)}` : ''}</small></span><button class="small" type="button" data-remove="${esc(p.email)}">Remove</button></li>`).join('')
    : `<li class="muted">${referees.length ? 'Nobody matches that.' : 'No referees yet. Add the address each one signs in with.'}</li>`;
  for (const b of $('refereeList').querySelectorAll('button[data-remove]')) b.onclick = () => removeReferee(b.dataset.remove);
  if (events.length) drawAssignments(); // who can be assigned
}
async function loadReferees() { referees = (await call('admin/referees')).people; drawReferees(); }
async function removeReferee(email) {
  if (!confirm(`Remove ${email}? They can't sign in any more.`)) return;
  refereeFail('');
  try { referees = (await call('admin/referees', { method: 'POST', body: { email, remove: true } })).people; drawReferees(); toast(`${email} can't sign in any more`); }
  catch (e) { refereeFail(e.message); }
}
// referees join by invite now (learn/#/invites): the form is gone, so this only runs if it's ever brought back
$('addReferee')?.addEventListener('submit', async (e) => {
  e.preventDefault(); refereeFail('');
  const email = $('refereeEmail').value.trim();
  try { referees = (await call('admin/referees', { method: 'POST', body: { email } })).people; drawReferees(); $('refereeEmail').value = ''; toast(`${email} can now sign in`); }
  catch (err) { refereeFail(err.message); }
});
$('findReferee').addEventListener('input', drawReferees);

// ---------------------------------------------------------------- admins
function drawAdmins(a) {
  admins = [...a.permanent, ...a.added.map((x) => x.email)];
  $('adminList').innerHTML = [
    ...a.permanent.map((email) => `<li><span><b>${esc(email)}</b><small>Permanent${email === a.you ? ' · you' : ''}</small></span></li>`),
    ...a.added.map((x) => `<li><span><b>${esc(x.email)}</b><small>Added${x.addedBy ? ` by ${esc(x.addedBy)}` : ''} on ${esc(onDay(x.at))}${x.email === a.you ? ' · you' : ''}</small></span>${x.email === a.you ? '' : `<button class="small" type="button" data-remove="${esc(x.email)}">Remove</button>`}</li>`),
  ].join('');
  $('adminList').querySelectorAll('button[data-remove]').forEach((b) => { b.onclick = () => removeAdmin(b.dataset.remove); });
}
const adminFail = (msg) => { $('adminError').textContent = msg || ''; show($('adminError'), !!msg); };
async function removeAdmin(email) {
  if (!confirm(`Remove ${email} as an admin? They lose access within a minute.`)) return;
  adminFail('');
  try { drawAdmins(await call('admin/admins/remove', { method: 'POST', body: { email } })); toast(`${email} is no longer an admin`); }
  catch (e) { adminFail(e.message); }
}
$('addAdmin').addEventListener('submit', async (e) => {
  e.preventDefault(); adminFail('');
  const email = $('adminEmail').value.trim();
  if (!confirm(`Make ${email} an admin? They'll be able to add and remove referees and admins.`)) return;
  try { drawAdmins(await call('admin/admins', { method: 'POST', body: { email } })); $('adminEmail').value = ''; toast(`${email} is now an admin`); }
  catch (err) { adminFail(err.message); }
});

async function enter() {
  const me = await getMe(true);
  if (!me.user && !me.admin) { signOut(); return start(); }
  $('who').textContent = me.user?.email || '';
  show($('signIn'), false);
  if (!me.admin) { show($('refused'), true); return; }
  await load();
  await loadReferees();
  drawAdmins(await call('admin/admins'));
  loadSync();
  show($('content'), true);
  setInterval(() => load().catch(() => {}), 15000);
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  microsoftButton($('msBtn'), 'customers.html', (e) => { $('signInError').textContent = e.message; show($('signInError'), true); });
  await devSignInButton($('devBtn'), () => enter(), (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); });
}
// which commit is live (written by scripts/deploy-site.sh)
fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((v) => { if (v) $('liveVersion').textContent = `Live: ${v.commit}, deployed ${v.deployedAt.replace('T', ' ')} UTC`; }).catch(() => {});
start();

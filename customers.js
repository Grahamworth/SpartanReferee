// The admin area for SpartanReferee: who can sign in (the referees), who the admins are, and the servers and this month's use.
import { call, devSignInButton, signedIn, getMe, signOut, esc } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';

const { money, plural, timeLeft } = window.HeadJudgeBooking;
const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const toast = (s) => { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); };
const onDay = (t) => new Date(t).toLocaleDateString();
let org = null, referees = [];

// ---------------------------------------------------------------- servers and this month
function serverLine(s) {
  if (!s || s.wanted !== 'on') return s?.state === 'stopping' ? 'Stopping' : 'Off';
  const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (s.scheduled) return `Booked · ${plural(s.cameras, 'camera')} · ${when(s.from)} to ${when(s.until)}`;
  return `${s.state === 'on' ? 'On' : 'Starting'} · ${s.camerasLive} of ${plural(s.cameras, 'camera')} live · until ${new Date(s.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${timeLeft(s.until - Date.now())})`;
}
async function load() {
  const data = await call('admin/customers');
  org = data.customers[0] || null; // the one organisation, once anyone has used it
  const t = data.totals;
  $('monthName').textContent = new Date(`${data.month}-15`).toLocaleDateString([], { month: 'long', year: 'numeric' });
  $('tAzure').textContent = money(t.azure);
  $('tHours').textContent = String(t.cameraHours);
  $('tRunning').textContent = data.running; $('tRunningOf').textContent = `of ${plural(data.maxRunning, 'server')} allowed at once`;
  const s = org?.server;
  const state = s?.wanted === 'on' ? (s.scheduled ? 'booked' : s.state === 'on' ? 'on' : 'starting') : s?.state === 'stopping' ? 'stopping' : 'off';
  $('serverLine').innerHTML = `<span class="light" data-state="${state}" aria-hidden="true"></span><span>${esc(serverLine(s))}</span>`;
  $('serverError').textContent = s?.error || ''; show($('serverError'), !!s?.error);
  show($('stopAll'), s?.wanted === 'on');
}
$('stopAll').addEventListener('click', async () => {
  if (!org || !confirm('Stop the servers now? Their cameras stop being recorded, for every referee using them.')) return;
  try { await call(`admin/customers/${encodeURIComponent(org.id)}/stop`, { method: 'POST', body: {} }); toast('Stopping the servers'); await load(); }
  catch (e) { toast(e.message); }
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
}
async function loadReferees() { referees = (await call('admin/referees')).people; drawReferees(); }
async function removeReferee(email) {
  if (!confirm(`Remove ${email}? They can't sign in any more.`)) return;
  refereeFail('');
  try { referees = (await call('admin/referees', { method: 'POST', body: { email, remove: true } })).people; drawReferees(); toast(`${email} can't sign in any more`); }
  catch (e) { refereeFail(e.message); }
}
$('addReferee').addEventListener('submit', async (e) => {
  e.preventDefault(); refereeFail('');
  const email = $('refereeEmail').value.trim();
  try { referees = (await call('admin/referees', { method: 'POST', body: { email } })).people; drawReferees(); $('refereeEmail').value = ''; toast(`${email} can now sign in`); }
  catch (err) { refereeFail(err.message); }
});
$('findReferee').addEventListener('input', drawReferees);

// ---------------------------------------------------------------- admins
function drawAdmins(a) {
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
  show($('content'), true);
  setInterval(() => load().catch(() => {}), 15000);
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  microsoftButton($('msBtn'), 'customers.html', (e) => { $('signInError').textContent = e.message; show($('signInError'), true); });
  await devSignInButton($('devBtn'), () => enter(), (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); });
}
start();

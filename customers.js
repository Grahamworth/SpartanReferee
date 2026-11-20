// Config (customers.html, admins): the cameras (what's running and booked), the AI judge's costs and who the admins are. Who can sign
// in moved to Manage People (invites) and the events to Manage Events; on 20 November 2026 Config was cut to these three. Spartan's
// events (the sync) and who referees each one moved to the app's Manage Events tab (learn/events.js) on 19 November 2026.
import { call, devSignInButton, signedIn, getMe, signOut, esc } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';

const { money, plural, timeLeft } = window.HeadJudgeBooking;
const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const toast = (s) => { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); };
const onDay = (t) => new Date(t).toLocaleDateString();

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
  const pr = data.pricing || {};
  if (Number.isFinite(pr.azureServerHour)) { $('tServerHour').textContent = money(pr.azureServerHour); $('tPerServer').textContent = `${plural(pr.camerasPerServer, 'camera')} per server`; }
  if (Number.isFinite(pr.azureCameraHour)) $('tCameraHour').textContent = money(pr.azureCameraHour);
  const live = data.customers.filter((b) => b.server.wanted === 'on' || b.server.state === 'stopping' || b.server.state === 'starting');
  $('bookingList').innerHTML = live.length ? live.map((b) => {
    const s = b.server, state = s.wanted === 'on' ? (s.scheduled ? 'booked' : s.state === 'on' ? 'on' : 'starting') : 'stopping';
    return `<li><span><b>${esc(KIND[b.kind] ? `${KIND[b.kind]}: ` : '')}${esc(b.name)}</b><small><span class="light" data-state="${state}" aria-hidden="true"></span> ${esc(serverLine(s))}${b.bookedBy ? ` · ${esc(b.bookedBy)}` : ''}</small>${s.error ? `<small class="error">${esc(s.error)}</small>` : ''}</span>${s.wanted === 'on' ? `${state === 'on' ? `<button class="small" type="button" data-open="${esc(b.id)}">Open video review</button>` : ''}<button class="small" type="button" data-stop="${esc(b.id)}" data-name="${esc(b.name)}">${s.scheduled ? 'Cancel' : 'Stop'}</button>` : ''}</li>`;
  }).join('') : '<li class="muted">Nothing booked or running.</li>';
  for (const btn of $('bookingList').querySelectorAll('button[data-stop]')) btn.onclick = () => stopBooking(btn.dataset.stop, btn.dataset.name);
  // any booking that's on: its video review, whoever's it is (an admin's way in to a referee's training or another admin's testing)
  for (const btn of $('bookingList').querySelectorAll('button[data-open]')) btn.onclick = async () => {
    try { location.assign((await call(`admin/customers/${encodeURIComponent(btn.dataset.open)}/open`, { method: 'POST', body: { tab: 'live' } })).url); }
    catch (e) { toast(e.message); }
  };
}
async function stopBooking(id, name) {
  if (!confirm(`Stop ${name}'s servers now? Their cameras stop being recorded.`)) return;
  try { await call(`admin/customers/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }); toast(`Stopping ${name}`); await load(); }
  catch (e) { toast(e.message); }
}

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
// which commit is live (written by scripts/deploy-site.sh)
fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((v) => { if (v) $('liveVersion').textContent = `Live: ${v.commit}, deployed ${v.deployedAt.replace('T', ' ')} UTC`; }).catch(() => {});
start();

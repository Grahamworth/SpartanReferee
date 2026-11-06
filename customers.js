// The admin area for HeadJudge: every customer, what they've used and what you've made from it, and the percentage added to Azure's cost.
import { call, googleButton, signedIn, getMe, signOut, esc } from './api-base.js';

const { money, plural, timeLeft } = window.HeadJudgeBooking;
const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
let data = null, savedMarkup = 0;
const STATUS = { pending: 'Waiting for you', approved: 'Approved', suspended: 'Suspended', declined: 'Declined' };
const toast = (s) => { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); };
const pence = (v) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100;

function drawPricingSums() {
  if (!data) return;
  const p = data.pricing, m = Number($('markup').value), good = $('markup').value !== '' && m >= 0 && m <= 1000;
  $('azureLine').textContent = `Azure: ${money(p.azureServerHour)} a server hour, shared by ${p.camerasPerServer} cameras: ${money(p.azureCameraHour)} per camera hour`;
  if (!good) { for (const id of ['payLine', 'marginLine', 'exampleLine']) $(id).textContent = '–'; show($('oddNote'), false); $('savePricing').disabled = true; return; }
  const pay = pence(p.azureCameraHour * (1 + m / 100));
  $('payLine').textContent = `${money(pay)} per camera hour`;
  $('marginLine').textContent = money(pay - p.azureCameraHour);
  $('exampleLine').textContent = `${money(pay * 16)}, ${money((pay - p.azureCameraHour) * 16)} to you`;
  // a single camera still needs a whole server
  const loss = p.azureServerHour - pay;
  $('oddNote').textContent = loss > 0.004 ? `A camera on its own still needs a whole server. At this price you lose ${money(loss)} an hour on it, so any booking with an odd number of cameras makes less. ${Math.ceil(100 * (p.azureServerHour / p.azureCameraHour - 1))}% or more covers it.` : '';
  show($('oddNote'), loss > 0.004);
  $('savePricing').disabled = m === savedMarkup;
}
function serverLine(c) {
  const s = c.server;
  if (s.wanted !== 'on') return s.state === 'stopping' ? 'Stopping' : 'Off';
  const live = `${s.camerasLive} of ${plural(s.cameras, 'camera')} live`;
  return `${s.state === 'on' ? 'On' : 'Starting'} · ${live} · until ${new Date(s.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${timeLeft(s.until - Date.now())}) · ${money(s.bookedCameraHour)} per camera hour`;
}
function actions(c) {
  const b = [];
  if (c.status !== 'approved') b.push(`<button class="small primaryish" data-do="approve">${c.status === 'pending' ? 'Approve' : 'Reinstate'}</button>`);
  if (c.status === 'pending') b.push('<button class="small" data-do="decline">Decline</button>');
  if (c.status === 'approved') b.push('<button class="small" data-do="suspend">Suspend</button>');
  if (c.server.wanted === 'on') b.push('<button class="small" data-do="stop">Stop servers</button>');
  return b.join('');
}
function drawList() {
  const q = $('find').value.trim().toLowerCase(), want = $('statusFilter').value;
  const order = { pending: 0, approved: 1, suspended: 2, declined: 3 };
  const list = data.customers.filter((c) => (!want || c.status === want) && (!q || `${c.name} ${c.contact} ${c.email} ${c.id}`.toLowerCase().includes(q)))
    .sort((a, b) => order[a.status] - order[b.status] || (b.server.wanted === 'on') - (a.server.wanted === 'on') || b.at - a.at);
  $('list').innerHTML = list.length ? list.map((c) => `<article class="customer card" data-id="${esc(c.id)}">
      <div class="custHead">
        ${c.logo ? `<img src="${esc(c.logo)}" alt="" class="custLogo">` : ''}
        <div class="custName"><h3>${esc(c.name)}</h3><span class="chip" data-status="${esc(c.status)}">${esc(STATUS[c.status] || c.status)}</span></div>
        <div class="custActions">${actions(c)}</div>
      </div>
      <p class="custContact">${esc(c.contact)} · <a href="mailto:${esc(c.email)}">${esc(c.email || 'no email')}</a>${c.website ? ` · <a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\/|\/$/g, ''))}</a>` : ''} · joined ${esc(new Date(c.at).toLocaleDateString())}</p>
      ${c.about ? `<p class="muted custAbout">${esc(c.about)}</p>` : ''}
      ${c.note ? `<p class="custNote">Your note: ${esc(c.note)}</p>` : ''}
      ${c.server.error ? `<p class="error">${esc(c.server.error)}</p>` : ''}
      <p class="custServer"><span class="light" data-state="${c.server.wanted === 'on' ? (c.server.state === 'on' ? 'on' : 'starting') : c.server.state === 'stopping' ? 'stopping' : 'off'}" aria-hidden="true"></span>${esc(serverLine(c))}</p>
      <dl class="custUse">
        <div><dt>Camera hours</dt><dd>${c.usage.cameraHours}</dd></div>
        <div><dt>Charged</dt><dd>${money(c.usage.charge)}</dd></div>
        <div><dt>Azure's cost</dt><dd>${money(c.usage.azure)}</dd></div>
        <div><dt>Profit</dt><dd${c.usage.profit < 0 ? ' class="loss"' : ''}>${money(c.usage.profit)}</dd></div>
      </dl>
    </article>`).join('') : `<p class="muted">${data.customers.length ? 'Nobody matches that.' : 'No customers yet. They register at register.html.'}</p>`;
  $('list').querySelectorAll('button[data-do]').forEach((b) => { b.onclick = () => act(b.closest('[data-id]').dataset.id, b.dataset.do); });
}
function drawAll() {
  const t = data.totals;
  $('monthName').textContent = new Date(`${data.month}-15`).toLocaleDateString([], { month: 'long', year: 'numeric' });
  $('tCharge').textContent = money(t.charge); $('tAzure').textContent = money(t.azure); $('tProfit').textContent = money(t.profit);
  $('tProfit').classList.toggle('loss', t.profit < 0);
  $('tHours').textContent = plural(t.cameraHours, 'camera hour');
  $('tRunning').textContent = data.running; $('tRunningOf').textContent = `of ${plural(data.maxRunning, 'server')} allowed at once`;
  drawPricingSums(); drawList();
}
async function load(first) {
  data = await call('admin/customers');
  savedMarkup = data.pricing.markupPercent;
  if (first || document.activeElement !== $('markup')) { if (first) $('markup').value = savedMarkup; }
  drawAll();
}
async function act(id, what) {
  const c = data.customers.find((x) => x.id === id);
  try {
    if (what === 'stop') {
      if (!confirm(`Stop ${c.name}'s servers now? Their cameras will stop being recorded.`)) return;
      await call(`admin/customers/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} });
    } else {
      const ask = { decline: `Why decline ${c.name}? They'll see this.`, suspend: `Why suspend ${c.name}? They'll see this, and any servers running will stop.` }[what];
      const note = ask ? prompt(ask, '') : '';
      if (note === null) return;
      await call(`admin/companies/${encodeURIComponent(id)}/${what}`, { method: 'POST', body: { note } });
    }
    toast(`${c.name}: done`);
    await load();
  } catch (e) { toast(e.message); }
}
$('markup').addEventListener('input', drawPricingSums);
$('find').addEventListener('input', drawList);
$('statusFilter').addEventListener('change', drawList);
$('pricing').addEventListener('submit', async (e) => {
  e.preventDefault(); show($('pricingError'), false);
  try {
    const p = await call('admin/pricing', { method: 'PUT', body: { markupPercent: Number($('markup').value) } });
    data.pricing = p; savedMarkup = p.markupPercent; drawPricingSums();
    toast(`Saved: customers now pay ${money(p.cameraHour)} per camera hour`);
  } catch (err) { $('pricingError').textContent = err.message; show($('pricingError'), true); }
});

async function enter() {
  const me = await getMe(true);
  if (!me.user && !me.admin) { signOut(); return start(); }
  $('who').textContent = me.user?.email || '';
  show($('signIn'), false);
  if (!me.admin) { show($('refused'), true); return; }
  await load(true);
  show($('content'), true);
  setInterval(() => load().catch(() => {}), 15000);
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  await googleButton($('googleBtn'), () => enter(), (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); });
}
start();

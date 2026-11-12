// A company's own page: say how many cameras and when (now for some hours, or a start and end chosen ahead), see what it costs, book.
// Customers go through a payment page first (pretend for now); admins book straight away. The servers run for that long and shut down
// by themselves, so this page never has to be left open; while they run it opens each one's video review and extends the booking.
import { call, googleButton, signedIn, getMe, signOut, esc } from './api-base.js';
import { emailButtons, microsoftButton } from './email-signin-web.js';
import { drawTracked } from './tracked-demos.js';
import { drawAppTabs, openServer as openTab } from './apptabs.js';

const { applyTheme } = window.HeadJudgeBrand;
const { quote, timeLeft, money, plural } = window.HeadJudgeBooking;
const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
let poll = null, busy = false, last = null, listKey = '', payMessage = '';

const fail = (msg) => { $('error').textContent = msg || ''; show($('error'), !!msg); };
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayClock = (t) => (new Date(t).toDateString() === new Date().toDateString() ? clock(t) : new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
const stateWord = { on: 'On', starting: 'Starting', stopping: 'Stopping', off: 'Off' };

function fillHours(sel, max, chosen) {
  if (sel.options.length) return;
  for (const h of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24].filter((x) => x <= max)) sel.add(new Option(plural(h, 'hour'), h, false, h === chosen));
}
// ---------------------------------------------------------------- when: now for some hours, or a start and end chosen ahead
const HOUR = 3600e3;
const localInput = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromInput = (v) => (v ? new Date(v).getTime() : NaN); // a datetime-local value is in this computer's own time
const choosingTimes = () => document.querySelector('input[name="when"]:checked')?.value === 'times';
const longDay = (t) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const span = (from, until) => (new Date(from).toDateString() === new Date(until).toDateString() ? `${longDay(from)} to ${clock(until)}` : `${longDay(from)} to ${longDay(until)}`);
function setDefaultTimes() {
  if ($('fromAt').value) return;
  const start = new Date(); start.setHours(start.getHours() + 1, 0, 0, 0); // the next whole hour
  $('fromAt').value = localInput(start); $('untilAt').value = localInput(start.getTime() + 4 * HOUR);
}
/** what's being booked: { cameras, hours, body } or { error } */
function chosen() {
  const p = last.price, cams = Math.floor(Number($('cameras').value));
  if (!(cams >= 1)) return { error: 'How many cameras do you need?' };
  if (cams > p.maxCameras) return { error: `We can run ${p.maxCameras} cameras at once at the moment` };
  if (!choosingTimes()) { const hours = +$('hours').value; return { cameras: cams, hours, body: { cameras: cams, hours } }; }
  const from = fromInput($('fromAt').value), until = fromInput($('untilAt').value);
  if (!Number.isFinite(from) || !Number.isFinite(until)) return { error: 'Choose a start and an end time' };
  if (from < Date.now() - 5 * 60e3) return { error: 'That start time has passed' };
  if (from > Date.now() + p.maxDaysAhead * 24 * HOUR) return { error: `You can book up to ${p.maxDaysAhead} days ahead` };
  const hours = Math.round(((until - from) / HOUR) * 100) / 100;
  if (until <= from) return { error: 'The end needs to be after the start' };
  if (hours < 1 || hours > p.maxHours) return { error: `A booking runs between 1 and ${p.maxHours} hours` };
  return { cameras: cams, hours, body: { cameras: cams, from, until } };
}
function drawQuote() {
  if (!last) return;
  const p = last.price, b = chosen();
  // once card payments are on, the first booking asks for a card, unless it's an admin's
  const askCard = last.needsCard && last.canStart;
  // until card payments are properly set up, only admins can start servers
  const closed = !last.bookingsOpen && last.canStart;
  $('start').disabled = busy || !!b.error || !last.canStart || closed || (askCard && !last.cardsOn);
  $('payNote').textContent = payMessage || (closed ? 'Bookings open once card payments are set up. Get in touch with us if you need cameras before then.'
    : askCard ? (last.cardsOn ? 'Before your first booking, add a card on Stripe\'s secure page. Nothing is charged today.' : 'Card payments aren\'t switched on yet: please try again soon.') : '');
  show($('payNote'), !!$('payNote').textContent);
  $('payNote').classList.toggle('closedNote', closed);
  show($('nowFields'), !choosingTimes()); show($('timeFields'), choosingTimes());
  show($('nowNote'), !choosingTimes()); show($('timesNote'), choosingTimes());
  if (b.error) { $('quoteHow').textContent = b.error; $('quoteCost').textContent = ''; return; }
  const q = quote(b.cameras, b.hours, p);
  $('quoteHow').textContent = q.how; $('quoteCost').textContent = money(q.cost);
  $('start').textContent = askCard ? 'Add payment details' : last.paysFirst ? 'Continue to payment' : choosingTimes() ? 'Book' : 'Book and start';
}
function drawExtendQuote() {
  if (!last?.serverCount) return;
  const hrs = +$('extendHours').value, cost = Math.round(last.cameras * hrs * last.bookedCameraHour * 100) / 100;
  $('extendHow').textContent = `${plural(last.cameras, 'camera')} × ${plural(hrs, 'hour')}`;
  $('extendCost').textContent = `+${money(cost)}`;
}
function drawList(s) {
  const key = JSON.stringify(s.servers.map((x) => [x.n, x.state, x.cameras, x.judges]));
  if (key === listKey) return; listKey = key;
  const box = $('serverList'); box.replaceChildren();
  for (const x of s.servers) {
    const row = document.createElement('div'); row.className = 'serverRow';
    const info = document.createElement('div');
    const name = document.createElement('b'); name.textContent = s.servers.length > 1 ? `Server ${x.n}` : 'Your server';
    const note = document.createElement('small'); note.textContent = `${stateWord[x.state] || 'Starting'} · ${plural(x.cameras, 'camera')} live · ${plural(x.judges, 'AI judge')}`;
    info.append(name, note);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'primary'; btn.textContent = 'Open video review'; btn.disabled = x.state !== 'on';
    btn.onclick = () => openServer(x.n);
    row.append(info, btn); box.append(row);
  }
}
function draw(s) {
  last = s;
  // what's wanted shows straight away; the servers catch up within a minute
  const state = s.wanted === 'on' ? (s.scheduled ? 'booked' : s.state === 'on' ? 'on' : 'starting') : (s.state === 'on' || s.state === 'starting' || s.state === 'stopping' ? 'stopping' : 'off');
  $('light').dataset.state = state;
  const many = s.serverCount > 1;
  $('stateText').textContent = { off: 'Book your cameras', booked: `Booked for ${longDay(s.from)}`, starting: many ? 'Your servers are starting' : 'Your server is starting', on: many ? 'Your servers are on' : 'Your server is on', stopping: many ? 'Your servers are stopping' : 'Your server is stopping' }[state];
  const ending = s.until && s.until - Date.now() < 20 * 60e3;
  $('stateMore').textContent = state === 'stopping' ? 'Saving the recordings first, so nothing is lost. This can take a few minutes.'
    : state === 'off' ? (s.canStart ? 'How many cameras, and when?' : 'This company has been blocked from starting servers. Get in touch with us to sort this out.')
      : state === 'booked' ? `${plural(s.cameras, 'camera')}, ${span(s.from, s.until)}. We start ${many ? 'your servers' : 'your server'} ${s.price.startLeadMinutes} minutes early, ${timeLeft(s.from - s.price.startLeadMinutes * 60e3 - Date.now())}, so your cameras are ready on time.`
        : `${state === 'starting' ? 'This takes about 5 minutes. ' : ''}${s.from > Date.now() ? `Your booking starts at ${dayClock(s.from)}. ` : ''}${many ? 'They shut' : 'It shuts'} down at ${dayClock(s.until)}, ${timeLeft(s.until - Date.now())}.`;
  $('stateMore').classList.toggle('warn', !!ending);
  fail(state === 'off' ? s.error : '');
  show($('book'), state === 'off'); show($('running'), state === 'on' || state === 'starting' || state === 'booked');
  // booked ahead: nothing to open yet, and Stop cancels it
  show($('serverList'), state !== 'booked');
  $('stop').textContent = state === 'booked' ? 'Cancel booking' : 'Stop now';
  const p = s.price;
  fillHours($('hours'), p.maxHours, 4); fillHours($('extendHours'), p.maxExtendHours, 1);
  $('cameras').max = p.maxCameras;
  for (const el of document.querySelectorAll('.keepDays')) el.textContent = p.keepDays;
  for (const el of document.querySelectorAll('.leadMins')) el.textContent = p.startLeadMinutes;
  $('daysAhead').textContent = p.maxDaysAhead;
  const min = localInput(Date.now()), max = localInput(Date.now() + p.maxDaysAhead * 24 * HOUR);
  $('fromAt').min = min; $('fromAt').max = max; $('untilAt').min = min;
  setDefaultTimes();
  drawQuote(); drawExtendQuote(); drawList(s);
  $('extendBtn').disabled = busy || !s.bookingsOpen; $('stop').disabled = busy;
  show($('factBooked'), s.wanted === 'on');
  if (s.wanted === 'on') $('booked').textContent = `${plural(s.bookedHours, 'hour')} · ${money(s.bookedCost)}`;
  show($('factCard'), !!s.card || s.adminNoCard);
  $('cardText').textContent = s.card ? `${s.card.brand[0].toUpperCase()}${s.card.brand.slice(1)} ending ${s.card.last4}` : 'Not needed: you\'re an admin';
  show($('changeCard'), !!s.card && s.cardsOn);
  $('hours2').textContent = `${plural(s.used.cameraHours, 'camera hour')} · ${money(s.used.charge)}`;
  drawTabs(); // Live and Cameras come and go with the servers
}
const STATE_WORD = { booked: 'Booked', running: 'On now', stopped: 'Stopped early', finished: 'Finished', cancelled: 'Cancelled' };
let hasBookings = false;
async function drawHistory() {
  let bookings; try { ({ bookings } = await call('servers/mine/history')); } catch { return; }
  hasBookings = bookings.length > 0; drawTabs();
  $('history').innerHTML = bookings.length ? `<div class="historyTable" role="table" aria-label="Your bookings">
    <div class="historyRow head" role="row"><span role="columnheader">When</span><span role="columnheader">Cameras</span><span role="columnheader">Hours</span><span role="columnheader">Status</span><span role="columnheader">Cost</span></div>
    ${bookings.map((b) => `<div class="historyRow" role="row">
      <span role="cell">${esc(new Date(b.from || b.at).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
      <span role="cell">${esc(b.cameras)}</span>
      <span role="cell">${esc(b.state === 'stopped' ? `${b.hoursRun} of ${b.hours}` : b.hours)}</span>
      <span role="cell">${esc(STATE_WORD[b.state] || '')}</span>
      <span role="cell"><b>${esc(money(b.cost))}</b>${b.paid?.pretend ? `<small class="paidNote">Paid ${esc(money(b.paid.amount))} (pretend)</small>` : ''}</span>
    </div>`).join('')}</div>` : '<p class="muted">Your bookings will show here.</p>';
}
async function refresh() { try { draw((await call('servers/mine')).server); } catch { /* the next try */ } }
async function act(path, body = {}) {
  busy = true; fail('');
  try { listKey = ''; draw((await call(`servers/mine/${path}`, { method: 'POST', body })).server); drawHistory(); }
  catch (e) { fail(e.message); }
  busy = false; if (last) draw(last);
}
// a server's video review opens in this browser tab: its Booking tab comes back here
async function openServer(n, tab = 'live') {
  try { await openTab(tab, n); } catch (e) { fail(e.message); }
}

// ---------------------------------------------------------------- the tabs: Booking and History are here; Live, Results and Cameras on the servers
let view = 'booking';
function drawTabs() {
  drawAppTabs($('appTabs'), { active: view, server: last, hasBookings, local: (tab) => { if (tab !== 'booking' && tab !== 'history') return false; location.hash = tab === 'history' ? 'history' : ''; return true; }, onError: fail });
}
function showView(v) {
  view = v === 'history' ? 'history' : 'booking';
  checkout = null; show($('payArea'), false);
  const booking = view === 'booking';
  show($('server'), booking); show($('tracked'), booking); show($('more'), booking); show($('historyBox'), !booking);
  if (!booking) drawHistory();
  drawTabs();
}
addEventListener('hashchange', () => { if (last) { showView(location.hash.slice(1)); window.scrollTo({ top: 0 }); } });
async function addCard() {
  busy = true; payMessage = ''; drawQuote();
  try { const { url } = await call('servers/mine/payment', { method: 'POST', body: {} }); location.assign(url); return; }
  catch (e) { payMessage = e.message; }
  busy = false; drawQuote();
}
$('changeCard').onclick = addCard;

// ---------------------------------------------------------------- the payment page: customers pay before a booking is made (pretend for now)
let checkout = null;
function showPay(on) {
  if (on) { show($('server'), false); show($('historyBox'), false); show($('more'), false); show($('tracked'), false); show($('payArea'), true); }
  else showView('booking');
  window.scrollTo({ top: 0 });
}
function openPay(co) {
  checkout = co;
  $('payCams').textContent = `${plural(co.cameras, 'camera')}${co.servers > 1 ? ` (${co.servers} servers)` : ''}`;
  $('payWhen').textContent = co.startNow ? `Now, for ${plural(co.hours, 'hour')}` : `${span(co.from, co.until)} (${plural(co.hours, 'hour')})`;
  $('payRate').textContent = `${money(co.cameraHour)} per camera hour`;
  $('payTotal').textContent = money(co.cost);
  $('payBtn').textContent = `Pay ${money(co.cost)}`; $('payBtn').disabled = false;
  $('payMins').textContent = Math.round((co.expires - Date.now()) / 60e3);
  show($('payError'), false);
  showPay(true); $('payHead').focus?.();
}
$('payBack').onclick = () => { checkout = null; showPay(false); };
$('payBtn').onclick = async () => {
  if (!checkout) return;
  $('payBtn').disabled = true; show($('payError'), false);
  try {
    const { server } = await call('servers/mine/pay', { method: 'POST', body: { checkout: checkout.id } });
    checkout = null; showPay(false); listKey = ''; draw(server); drawHistory();
  } catch (e) { $('payError').textContent = e.message; show($('payError'), true); $('payBtn').disabled = false; }
};
async function goToPay(body) {
  busy = true; fail(''); drawQuote();
  try { openPay((await call('servers/mine/checkout', { method: 'POST', body })).checkout); } catch (e) { fail(e.message); }
  busy = false; if (last) draw(last);
}

$('book').addEventListener('submit', (e) => {
  e.preventDefault();
  if (last?.needsCard) { addCard(); return; }
  const b = chosen(); if (b.error) return fail(b.error);
  if (last?.paysFirst) goToPay(b.body); else act('start', b.body);
});
$('cameras').addEventListener('input', drawQuote);
$('hours').addEventListener('change', drawQuote);
for (const r of document.querySelectorAll('input[name="when"]')) r.addEventListener('change', drawQuote);
// moving the start keeps the booking the same length
let lastFrom = NaN;
$('fromAt').addEventListener('focus', () => { lastFrom = fromInput($('fromAt').value); });
$('fromAt').addEventListener('change', () => {
  const from = fromInput($('fromAt').value), until = fromInput($('untilAt').value);
  if (Number.isFinite(from) && Number.isFinite(lastFrom) && Number.isFinite(until)) $('untilAt').value = localInput(from + (until - lastFrom));
  lastFrom = from; drawQuote();
});
$('untilAt').addEventListener('change', drawQuote);
$('extendHours').addEventListener('change', drawExtendQuote);
$('extend').addEventListener('submit', (e) => { e.preventDefault(); act('extend', { hours: +$('extendHours').value }); });
$('stop').onclick = () => {
  const booked = last?.scheduled;
  if (confirm(booked ? 'Cancel this booking? Its servers won\'t start, and nothing is charged for it.' : 'Stop now? Any cameras still streaming will stop being recorded. You pay only for the time used.')) act('stop');
};

function enterBrand(c) {
  applyTheme(c.theme);
  document.title = `${c.name}: HeadJudge`;
  $('company').textContent = c.name;
  if (c.logo) { $('logo').src = c.logo; show($('logo'), true); }
}
async function cameBackFromStripe() {
  const back = new URLSearchParams(location.search).get('payment');
  if (!back) return;
  history.replaceState(null, '', location.pathname);
  if (back === 'cancelled') { payMessage = 'No card was saved. You can add one whenever you\'re ready.'; return; }
  try { await call('servers/mine/payment-done', { method: 'POST', body: { session: back } }); }
  catch (e) { payMessage = e.message; }
}
async function enter() {
  const me = await getMe(true);
  if (!me.user) { signOut(); return start(); }
  $('who').textContent = me.user.email;
  show($('adminLink'), !!me.admin); // only you see the way to customers and prices
  show($('testReviewLink'), !!me.admin); // and to the video review with pretend data, to try it without a server
  show($('signIn'), false);
  const { company } = await call('companies/mine');
  // only a registered company signs in here: any other account is signed straight back out and pointed at registering (admins
  // still get in, to reach Admin)
  if (!company && !me.admin) return notRegistered(me.user.email);
  if (!company) { show($('none'), true); return; }
  // the free camera: anyone with a company that isn't blocked
  const free = company.status === 'approved' || !!me.admin;
  show($('freeLink'), free); show($('freeNote'), free);
  enterBrand(company);
  drawTracked($('trackedList'));
  await cameBackFromStripe();
  await refresh();
  // the video review's Live, Results and Cameras tabs, and its server switcher, come through here: ?go=live&n=2
  const q = new URLSearchParams(location.search), go = q.get('go');
  if (go) {
    history.replaceState(null, '', location.pathname + location.hash);
    if (['live', 'results', 'cameras'].includes(go)) { try { await openTab(go, Math.max(1, Math.floor(Number(q.get('n')) || 1))); return; } catch (e) { fail(e.message); } }
  }
  showView(location.hash.slice(1));
  drawHistory();
  clearInterval(poll); poll = setInterval(refresh, 5000);
}
function notRegistered(email) {
  signOut();
  $('who').textContent = '';
  show($('signIn'), true);
  $('signInError').textContent = `${email || 'That account'} isn't registered with HeadJudge. Register your company first, then sign in here.`;
  show($('signInError'), true);
  show($('registerFirst'), true);
  start();
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  emailButtons($('emailBtns'), 'console.html', failed);
  microsoftButton($('msBtn'), 'console.html', failed);
  await googleButton($('googleBtn'), () => enter(), failed);
}
start();

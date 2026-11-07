// A company's own page: say how many cameras and for how long, see what it costs, start. The servers run for that long and shut down by
// themselves, so this page never has to be left open; while they run it opens each one's video review and extends the booking.
import { call, googleButton, signedIn, getMe, signOut } from './api-base.js';
import { emailButtons } from './email-signin-web.js';

const { applyTheme } = window.HeadJudgeBrand;
const { quote, timeLeft, money, plural } = window.HeadJudgeBooking;
const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
let poll = null, busy = false, last = null, listKey = '';

const fail = (msg) => { $('error').textContent = msg || ''; show($('error'), !!msg); };
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayClock = (t) => (new Date(t).toDateString() === new Date().toDateString() ? clock(t) : new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
const stateWord = { on: 'On', starting: 'Starting', stopping: 'Stopping', off: 'Off' };

function fillHours(sel, max, chosen) {
  if (sel.options.length) return;
  for (const h of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24].filter((x) => x <= max)) sel.add(new Option(plural(h, 'hour'), h, false, h === chosen));
}
function drawQuote() {
  if (!last) return;
  const p = last.price, cams = Math.floor(Number($('cameras').value)), ok = cams >= 1 && cams <= p.maxCameras;
  $('start').disabled = busy || !last.canStart || !ok;
  if (!ok) { $('quoteHow').textContent = cams > p.maxCameras ? `We can run ${p.maxCameras} cameras at once at the moment` : 'How many cameras do you need?'; $('quoteCost').textContent = ''; return; }
  const q = quote(cams, +$('hours').value, p);
  $('quoteHow').textContent = `${q.how} · ${plural(q.servers, 'server')} (${p.camerasPerServer} cameras each)`; $('quoteCost').textContent = money(q.cost);
  $('start').textContent = q.servers === 1 ? 'Start server' : `Start ${q.servers} servers`;
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
  const state = s.wanted === 'on' ? (s.state === 'on' ? 'on' : 'starting') : (s.state === 'on' || s.state === 'starting' || s.state === 'stopping' ? 'stopping' : 'off');
  $('light').dataset.state = state;
  const many = s.serverCount > 1;
  $('stateText').textContent = { off: 'Book your server', starting: many ? 'Your servers are starting' : 'Your server is starting', on: many ? 'Your servers are on' : 'Your server is on', stopping: many ? 'Your servers are stopping' : 'Your server is stopping' }[state];
  const ending = s.until && s.until - Date.now() < 20 * 60e3;
  $('stateMore').textContent = state === 'stopping' ? 'Saving the recordings first, so nothing is lost. This can take a few minutes.'
    : state === 'off' ? (s.canStart ? 'Tell us how many cameras and for how long.' : 'You can start a server once we\'ve approved your company.')
      : `${state === 'starting' ? 'This takes about 5 minutes. ' : ''}${many ? 'They shut' : 'It shuts'} down at ${dayClock(s.until)}, ${timeLeft(s.until - Date.now())}.`;
  $('stateMore').classList.toggle('warn', !!ending);
  fail(state === 'off' ? s.error : '');
  show($('book'), state === 'off'); show($('running'), state === 'on' || state === 'starting');
  const p = s.price;
  fillHours($('hours'), p.maxHours, 4); fillHours($('extendHours'), p.maxExtendHours, 1);
  $('cameras').max = p.maxCameras;
  drawQuote(); drawExtendQuote(); drawList(s);
  $('extendBtn').disabled = busy; $('stop').disabled = busy;
  show($('factBooked'), s.wanted === 'on');
  if (s.wanted === 'on') $('booked').textContent = `${plural(s.bookedHours, 'hour')} · ${money(s.bookedCost)}`;
  $('hours2').textContent = `${plural(s.used.cameraHours, 'camera hour')} · ${money(s.used.charge)}`;
}
async function refresh() { try { draw((await call('servers/mine')).server); } catch { /* the next try */ } }
async function act(path, body = {}) {
  busy = true; fail('');
  try { listKey = ''; draw((await call(`servers/mine/${path}`, { method: 'POST', body })).server); }
  catch (e) { fail(e.message); }
  busy = false; if (last) draw(last);
}
async function openServer(n) {
  // opened before the wait, so a browser doesn't treat it as a pop-up
  const w = window.open('about:blank', '_blank');
  try { const { url } = await call('servers/mine/open', { method: 'POST', body: { n } }); if (w) w.location = url; else location.href = url; }
  catch (e) { w?.close(); fail(e.message); }
}
$('book').addEventListener('submit', (e) => { e.preventDefault(); act('start', { cameras: Math.floor(Number($('cameras').value)), hours: +$('hours').value }); });
$('cameras').addEventListener('input', drawQuote);
$('hours').addEventListener('change', drawQuote);
$('extendHours').addEventListener('change', drawExtendQuote);
$('extend').addEventListener('submit', (e) => { e.preventDefault(); act('extend', { hours: +$('extendHours').value }); });
$('stop').onclick = () => { if (confirm('Stop now? Any cameras still streaming will stop being recorded. You pay only for the time used.')) act('stop'); };

function enterBrand(c) {
  applyTheme(c.theme);
  document.title = `${c.name}: HeadJudge`;
  $('company').textContent = c.name;
  if (c.logo) { $('logo').src = c.logo; show($('logo'), true); }
}
async function enter() {
  const me = await getMe(true);
  if (!me.user) { signOut(); return start(); }
  $('who').textContent = me.user.email;
  show($('adminLink'), !!me.admin); // only you see the way to customers and prices
  show($('signIn'), false);
  const { company } = await call('companies/mine');
  if (!company) { show($('none'), true); return; }
  enterBrand(company);
  show($('server'), true); show($('more'), true);
  await refresh();
  clearInterval(poll); poll = setInterval(refresh, 5000);
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  emailButtons($('emailBtns'), 'console.html', failed);
  await googleButton($('googleBtn'), () => enter(), failed);
}
start();

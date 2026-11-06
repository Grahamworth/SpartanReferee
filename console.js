// A company's own page: start and stop its server, and open the video review once it's on. The server does the rest by itself:
// it turns off when nobody's using it, so this page never has to be left open.
import { call, googleButton, signedIn, getMe, signOut } from './api-base.js';

const { applyTheme } = window.HeadJudgeBrand;
const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
let poll = null, busy = false;

const LOOK = {
  off: ['Your server is off', 'It takes about 5 minutes to start. It costs nothing while it\'s off, and turns itself off 30 minutes after nobody\'s using it.'],
  starting: ['Your server is starting', 'This takes about 5 minutes. You can leave this page and come back.'],
  on: ['Your server is on', 'It turns itself off 30 minutes after the last camera and the last person have gone.'],
  stopping: ['Your server is stopping', 'Finishing the recordings first, so nothing is lost. This can take a few minutes.'],
};
function draw(s) {
  // what's wanted shows straight away; the server catches up within a minute
  const state = s.state === 'off' && s.wanted === 'on' && !s.error ? 'starting' : s.state === 'on' && s.wanted === 'off' ? 'stopping' : s.state;
  const [head, more] = LOOK[state] || LOOK.off;
  $('stateText').textContent = head;
  $('stateMore').textContent = more;
  $('light').dataset.state = state;
  $('error').textContent = s.error || ''; show($('error'), !!s.error);
  show($('start'), state === 'off'); $('start').disabled = busy || !s.canStart;
  show($('open'), state === 'on'); $('open').disabled = busy;
  show($('stop'), state === 'on' || state === 'starting'); $('stop').disabled = busy;
  if (!s.canStart && state === 'off') $('stateMore').textContent = 'You can start a server once we\'ve approved your company.';
  $('cams').textContent = s.cameras; $('judges').textContent = s.judges;
  $('hours').textContent = `${s.hoursThisMonth} hour${s.hoursThisMonth === 1 ? '' : 's'}`;
}
async function refresh() {
  try { draw((await call('servers/mine')).server); } catch { /* the next try */ }
}
async function act(path) {
  busy = true; $('error').hidden = true;
  try { draw((await call(`servers/mine/${path}`, { method: 'POST', body: {} })).server); }
  catch (e) { $('error').textContent = e.message; $('error').hidden = false; }
  busy = false; refresh();
}
$('start').onclick = () => act('start');
$('stop').onclick = () => { if (confirm('Stop the server? Any cameras still streaming will stop being recorded.')) act('stop'); };
$('open').onclick = async () => {
  // opened before the wait, so a browser doesn't treat it as a pop-up
  const w = window.open('about:blank', '_blank');
  try { const { url } = await call('servers/mine/open', { method: 'POST', body: {} }); if (w) w.location = url; else location.href = url; }
  catch (e) { w?.close(); $('error').textContent = e.message; $('error').hidden = false; }
};

function enterBrand(c) {
  applyTheme(c.theme);
  document.title = `${c.name}: HeadJudge`;
  $('company').textContent = c.name;
  if (c.logo) { $('logo').src = c.logo; $('logo').alt = ''; show($('logo'), true); }
}
async function enter() {
  const me = await getMe(true);
  if (!me.user) { signOut(); return start(); }
  $('who').textContent = me.user.email;
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
  await googleButton($('googleBtn'), () => enter(), (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); });
}
start();

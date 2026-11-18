// A referee's home page (home.html): hello, the events they're assigned to (each with the way to book its cameras), and the ways to
// the learning platform, the cameras and (admins) the admin page. Everything comes from /api/home.
import { call, devSignInButton, signedIn, signOut, esc } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const lang = () => (window.SR_I18N && SR_I18N.lang) || undefined;
// an event's dates are its own local dates, so they're shown as they are, whatever this computer's timezone
const day = (d) => new Date(`${d}T12:00:00Z`);
function datesOf(e) {
  const f = new Intl.DateTimeFormat(lang(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return e.endDate && e.endDate !== e.startDate && f.formatRange ? f.formatRange(day(e.startDate), day(e.endDate)) : f.format(day(e.startDate));
}

function draw(h) {
  $('who').textContent = h.email;
  $('name').textContent = h.name || h.email;
  $('roleLine').textContent = h.admin ? 'Spartan referee and admin' : 'Spartan referee';
  const now = Date.now();
  $('eventList').innerHTML = h.events.map((e) => `<li><span><b>${esc(e.name)}${e.from <= now && now < e.until ? ' <span class="now">On now</span>' : ''}</b>
    <small>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small></span>
    <a class="book" href="console.html?unit=${encodeURIComponent(e.unit)}">Book cameras</a></li>`).join('');
  show($('noEvents'), !h.events.length);
  show($('learnTile'), !!h.learn);
  show($('adminTile'), !!h.admin);
  show($('content'), true);
}

async function enter() {
  show($('signIn'), false);
  try { draw(await call('home')); }
  catch (e) {
    if (e.status === 401 || e.status === 403) { signOut(); start(e.status === 403 ? e.message : ''); return; }
    $('error').textContent = e.message; show($('error'), true);
  }
}
async function start(why = '') {
  if (signedIn() && !why) return enter();
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  if (why) failed({ message: why });
  microsoftButton($('msBtn'), 'home.html', failed);
  await devSignInButton($('devBtn'), () => enter(), failed);
}
start();

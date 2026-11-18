// One Spartan event (event.html?id=<event id>): its days and camera hours, who's refereeing it and its cameras, with the way to book
// them (or watch them, once they're on) on the console. Everything comes from /api/event/<id>.
import { call, devSignInButton, signedIn, signOut, esc } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const lang = () => (window.SR_I18N && SR_I18N.lang) || undefined;
const id = String(new URLSearchParams(location.search).get('id') || '').replace(/\D/g, '');
const day = (d) => new Date(`${d}T12:00:00Z`);
function datesOf(e) {
  const f = new Intl.DateTimeFormat(lang(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return e.endDate && e.endDate !== e.startDate && f.formatRange ? f.formatRange(day(e.startDate), day(e.endDate)) : f.format(day(e.startDate));
}
const clock = (t, tz) => new Date(t).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
const when = (t) => new Date(t).toLocaleString(lang(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATE = { booked: 'Booked', starting: 'Starting', on: 'On now', stopping: 'Stopping' };

function draw(p) {
  const e = p.event, b = p.booking, now = Date.now(), consoleUrl = `console.html?unit=${encodeURIComponent(e.unit)}`;
  document.title = `${e.name}: SpartanReferee`;
  $('evName').textContent = e.name;
  $('evWhen').textContent = datesOf(e);
  $('evWhere').textContent = [e.city, e.country].filter(Boolean).join(', ');
  const tags = [];
  if (p.you) tags.push(p.you.role === 'head' ? '<li class="head">You: head referee</li>' : '<li>You: referee</li>');
  if (e.from <= now && now < e.until) tags.push('<li class="now">On now</li>');
  if (e.over) tags.push('<li>Over</li>');
  $('evTags').innerHTML = tags.join(''); show($('evTags'), tags.length > 0);

  // the cameras: book them, or see the booking, or watch them live
  $('camLight').dataset.state = b ? b.state : 'off';
  $('camState').textContent = b ? STATE[b.state] : e.over ? 'This event is over' : 'Not booked yet';
  // whole sentences, so each translates
  $('camMore').textContent = !b ? (e.over ? '' : p.canBook ? 'You book them as the head referee: they run from 07:00 to 18:00 local time on each day you choose.' : 'The head referee books them. Once they\'re on, you can watch them live and review the results.')
    : b.state === 'booked' ? `${b.cameras} cameras, ${when(b.from)} to ${clock(b.until)}.`
      : b.state === 'stopping' ? 'Saving the recordings, then shutting down.'
        : `${b.cameras} cameras, until ${clock(b.until)}.`;
  $('camBy').textContent = b && b.by ? `Booked by ${b.by}` : ''; show($('camBy'), !!(b && b.by));
  const go = $('camGo');
  show(go, !!b || (!e.over && p.canBook));
  go.textContent = !b ? 'Book the burpee cameras' : b.state === 'on' ? 'Watch live' : p.canBook ? 'Open the booking' : 'See the booking';
  go.href = b && b.state === 'on' ? `${consoleUrl}&go=live` : consoleUrl;
  go.classList.toggle('second', !!b && b.state !== 'on');

  // who's refereeing it: head referees first
  $('people').innerHTML = p.referees.map((r) => `<li><span><b>${esc(r.name || r.email)}${r.you ? ' (you)' : ''}</b>${r.name ? `<br><small>${esc(r.email)}</small>` : ''}</span>
    <span class="role${r.role === 'head' ? ' head' : ''}">${r.role === 'head' ? 'Head referee' : 'Referee'}</span></li>`).join('');
  show($('noPeople'), !p.referees.length);

  // each day's camera hours: local time, and this device's time when that's different
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayName = (d) => new Intl.DateTimeFormat(lang(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(day(d));
  $('days').innerHTML = e.windows.map((w) => {
    const local = e.tz ? `${clock(w.from, e.tz)} to ${clock(w.until, e.tz)} local time` : '07:00 to 18:00 local time';
    const yours = e.tz && e.tz !== here ? `<br><small>${esc(`${clock(w.from)} to ${clock(w.until)} your time`)}</small>` : '';
    return `<li><b>${esc(dayName(w.day))}</b><span><span>${esc(local)}</span>${yours}</span></li>`;
  }).join('') || '<li class="muted">This event is over.</li>';

  $('spartanLink').href = e.url; show($('spartanLink'), !!e.url);
  show($('content'), true);
}

async function enter() {
  show($('signIn'), false);
  if (!id) { $('error').textContent = 'Which event? Open one from your home page.'; show($('error'), true); return; }
  try { draw(await call(`event/${id}`)); }
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
  microsoftButton($('msBtn'), `event.html?id=${id}`, failed);
  await devSignInButton($('devBtn'), () => enter(), failed);
}
start();

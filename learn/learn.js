// The learning platform's one page (/learn/): signing in, the header and "view as" bar, and which view the part after # asks for.
// The views themselves are in their areas: programmes.js (overview, catalogue, a programme), people.js (profiles, people,
// duplicates, audit), practice.js (the camera course's practice cameras), and the later steps' areas. Everything is checked again on the server
// (api/src/learn); hiding a link here is only tidiness. An admin can view the page as any invented person: every request then
// says so (X-Learn-As).
import { devSignInButton, signedIn, signOut, call as siteCall } from '../api-base.js';
import { language } from '../language.js';
import { microsoftButton } from '../email-signin-web.js';
import { setOwner, keep, viaCache, registerApp } from '../offline.js';
import { $, S, show, call, esc, fail, store, AS_KEY, ROLE, has, isAdmin } from './core.js';
import * as programmes from './programmes.js';
import * as people from './people.js';
import * as lesson from './lesson.js';
import * as assess from './assess.js';
import * as govern from './govern.js';
import * as reports from './reports.js';
import * as diagnostics from './diagnostics.js';
import * as saved from './saved.js';
import * as home from './home.js';
import * as events from './events.js';
import * as sharp from './sharp.js';
import * as invites from './invites.js';

const AREAS = [programmes, people, lesson, assess, govern, reports, diagnostics, saved, home, events, sharp, invites];
const views = Object.assign({}, ...AREAS.map((a) => a.views));

async function draw() {
  fail('');
  // the old Cameras guide is now the Burpee camera station course
  if (location.hash.startsWith('#/cameras')) { location.replace('#/programmes/camera-station'); return; }
  const [, view = '', rest = ''] = (location.hash.split('?')[0] || '#/').split('/');
  const name = views[view] ? view : 'home';
  for (const a of $('learnNav').querySelectorAll('a')) a.classList.toggle('on', a.dataset.view === name || (a.dataset.also || '').split(' ').includes(name));
  $('profileBtn')?.classList.toggle('on', name === 'profile');
  // on a phone the tabs are a row to swipe along: bring the one you're on into view
  const on = $('learnNav').querySelector('a.on'), nav = $('learnNav');
  if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
  try {
    $('view').innerHTML = await views[name](decodeURIComponent(rest));
    for (const a of AREAS) a.wire?.({ reloadMe: loadMe });
  } catch (e) { $('view').innerHTML = ''; fail(e.message); }
}
window.addEventListener('learn:redraw', () => draw());

// the brief's user types (section 4), in the order the Preview as list shows them
const TYPES = [['', 'Learner / referee'], ['regional_coordinator', 'Regional coordinator'], ['programme_owner', 'Programme owner'], ['content_editor', 'Content editor / translator'], ['assessor', 'Assessor'], ['technical_admin', 'Technical admin'], ['global_admin', 'Global admin']];
function drawChrome() {
  const me = S.me;
  $('who').textContent = me.actingAs ? `${me.real.email} as ${me.person.legalName}` : me.person.email;
  show($('learnNav'), true); show($('demoBar'), true); show($('profileBtn'), true);
  const showNav = { people: isAdmin() || has('regional_coordinator'), duplicates: isAdmin(), audit: isAdmin() };
  for (const [v, on] of Object.entries(showNav)) show($('learnNav').querySelector(`[data-view="${v}"]`), on);
  for (const a of $('learnNav').querySelectorAll('[data-show]')) show(a, a.dataset.show.split(' ').some((r) => has(r)));
  show($('viewAsBox'), me.viewAs.length > 0);
  if (me.viewAs.length) {
    // each type of user first, shown by one of the invented people who is that type; then every invented person
    const types = TYPES.map(([role, label]) => [label, me.viewAs.find((p) => (role ? p.roles.includes(role) : !p.roles.length))]).filter(([, p]) => p);
    const pick = (p, text, sel) => `<option value="${esc(p.id)}"${sel ? ' selected' : ''}>${esc(text)}</option>`;
    const typeOn = types.find(([, p]) => p.id === me.actingAs);
    $('viewAs').innerHTML = `<option value="">Yourself (${esc(me.real.legalName)})</option>
      <optgroup label="Types of user">${types.map(([label, p]) => pick(p, `${label}: ${p.legalName}`, p === typeOn?.[1])).join('')}</optgroup>
      <optgroup label="Everyone invented">${me.viewAs.map((p) => pick(p, `${p.legalName}: ${p.roles.map((r) => ROLE[r] || r).join(', ') || 'Learner'}`, p.id === me.actingAs && !typeOn)).join('')}</optgroup>`;
  }
}
$('viewAs').addEventListener('change', async () => { store.set(AS_KEY, $('viewAs').value); await loadMe(); location.hash = '#/'; draw(); });
async function loadMe() {
  try { S.me = await call('me'); }
  catch (e) { if (store.get(AS_KEY)) { store.set(AS_KEY, ''); S.me = await call('me'); } else throw e; }
  // what's kept on the phone for offline use is this person's (offline.js)
  if (!S.me.actingAs) { setOwner(S.me.person.email); keep('me', S.me); }
  drawChrome();
}

async function enter() {
  show($('signIn'), false);
  try { await loadMe(); }
  catch (e) {
    if (e.status === 401) { signOut(); return start(); }
    if (e.status === 403) { $('closedText').textContent = e.message; show($('closed'), true); return; }
    fail(e.message); return; // e.g. the database waking up: try again in a minute
  }
  // the first visit asks for a language, as the home page does (someone may come here first)
  try { if (language(await viaCache('site/home', () => siteCall('home')), $('langCard'))) return; } catch { /* the page still works in this language */ }
  ({ regions: S.regions } = await call('regions'));
  addEventListener('hashchange', draw);
  draw();
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  microsoftButton($('msBtn'), 'learn/', failed);
  await devSignInButton($('devBtn'), () => enter(), failed);
}
start();
registerApp();

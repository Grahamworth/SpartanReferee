// The learning platform's one page (/learn/): signing in, the header and "view as" bar, and which view the part after # asks for.
// The views themselves are in their areas: programmes.js (overview, catalogue, a programme), people.js (profiles, people,
// duplicates, audit), practice.js (the camera course's practice cameras), and the later steps' areas. Everything is checked again on the server
// (api/src/learn); hiding a link here is only tidiness. An admin can view the page as any invented person: every request then
// says so (X-Learn-As).
import { devSignInButton, signedIn, signOut, call as siteCall } from '../api-base.js';
import { language } from '../language.js';
import { microsoftButton } from '../email-signin-web.js';
import { setOwner, keep, viaCache, registerApp } from '../offline.js';
import { $, S, show, call, esc, fail, store, AS_KEY, PREVIEW_KEY, has, isAdmin, t } from './core.js';
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
import * as tracking from './tracking.js';
import * as authoring from './authoring.js';

const AREAS = [programmes, people, lesson, assess, govern, reports, diagnostics, saved, home, events, sharp, invites, tracking, authoring];
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
  // a page that takes more than a moment shows it's loading (the database can be slow to wake)
  const slow = setTimeout(() => { $('view').innerHTML = LOADER; }, 150);
  try {
    const html = await views[name](decodeURIComponent(rest));
    clearTimeout(slow);
    $('view').innerHTML = html;
    for (const a of AREAS) a.wire?.({ reloadMe: loadMe });
  } catch (e) { clearTimeout(slow); $('view').innerHTML = ''; fail(e.message); }
}
const LOADER = '<div class="loader" role="status"><span class="spin" aria-hidden="true"></span><span>Loading…</span></div>';
window.addEventListener('learn:redraw', () => draw());

// the brief's user types (section 4), in the order the Preview as list shows them
// Preview as (admins only): your own account as a type of user, with only that type's roles; Yourself goes back (19 November 2026)
const TYPES = [['learner', 'Referee'], ['regional_coordinator', 'Regional coordinator'], ['assessor', 'Assessor'], ['programme_owner', 'Programme owner'], ['content_editor', 'Content editor / translator'], ['technical_admin', 'Technical admin']];
function drawChrome() {
  const me = S.me;
  const typeName = (r) => (TYPES.find(([k]) => k === r) || [0, r])[1];
  $('who').textContent = me.person.email;
  show($('learnNav'), true); show($('demoBar'), true); show($('profileBtn'), true);
  for (const a of $('learnNav').querySelectorAll('[data-show]')) show(a, a.dataset.show.split(' ').some((r) => has(r)));
  show($('viewAsBox'), !!me.canPreview);
  show($('previewBack'), !!me.previewRole);
  $('previewLine').textContent = me.previewRole ? t('Previewing as: {type}', { type: t(typeName(me.previewRole)) }) : '';
  if (me.canPreview) {
    $('viewAs').innerHTML = `<option value="">Yourself (admin)</option>${TYPES.map(([k, n]) => `<option value="${k}"${k === me.previewRole ? ' selected' : ''}>${esc(n)}</option>`).join('')}`;
  }
}
const setPreview = (role) => { store.set(PREVIEW_KEY, role); store.set(AS_KEY, ''); location.hash = '#/'; location.reload(); };
$('viewAs').addEventListener('change', () => setPreview($('viewAs').value));
$('previewBack').addEventListener('click', () => setPreview(''));
async function loadMe() {
  try { S.me = await call('me'); }
  catch (e) { if (store.get(PREVIEW_KEY)) { store.set(PREVIEW_KEY, ''); S.me = await call('me'); } else throw e; }
  if (!S.me.canPreview) store.set(PREVIEW_KEY, ''); // not an admin (any more): no preview
  if (store.get(AS_KEY) && !S.me.actingAs) store.set(AS_KEY, ''); // an invented person who's gone: be yourself again
  // what's kept on the phone for offline use is this person's (offline.js)
  if (!S.me.actingAs && !S.me.previewRole) { setOwner(S.me.person.email); keep('me', S.me); }
  drawChrome();
}

async function enter() {
  show($('signIn'), false);
  try { await loadMe(); }
  catch (e) {
    if (e.status === 401) { signOut(); return start(); }
    if (e.status === 403) { $('view').innerHTML = ''; $('closedText').textContent = e.message; show($('closed'), true); return; }
    // e.g. the database waking up: say so, with a way to try again, instead of the loading spinner going round for ever
    $('view').innerHTML = `<section class="card"><p>${esc(t('This didn\'t load. Try again in a moment.'))}</p><button class="small" type="button" onclick="location.reload()">${esc(t('Try again'))}</button></section>`;
    fail(e.message); return;
  }
  // the first visit asks for a language, as the home page does (someone may come here first)
  try { if (language(await viaCache('site/home', () => siteCall('home')), $('langCard'))) return; } catch { /* the page still works in this language */ }
  ({ regions: S.regions } = await call('regions'));
  addEventListener('hashchange', draw);
  draw();
}
async function start() {
  if (signedIn()) return enter();
  $('view').innerHTML = ''; // no loader: there's nothing to load until they sign in
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  microsoftButton($('msBtn'), 'learn/', failed);
  await devSignInButton($('devBtn'), () => enter(), failed);
}
start();
registerApp();

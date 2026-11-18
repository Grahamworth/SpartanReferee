// The learning platform's one page (/learn/): who you are, your profile, and for admins and coordinators the people, possible
// duplicates and the audit log. Everything is checked again on the server (api/src/learn); hiding a link here is only tidiness.
// An admin can view the page as any invented person (the bar under the header): every request then says so (X-Learn-As).
import { devSignInButton, signedIn, signOut, esc } from '../api-base.js';
import { microsoftButton } from '../email-signin-web.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const API = location.protocol.startsWith('http') && (location.hostname.endsWith('azurestaticapps.net') || location.port === '8795') ? '/api' : 'https://brave-forest-022879f03.3.azurestaticapps.net/api';
const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } } };
const AS_KEY = 'sr_learn_as';
const ROLE = { global_admin: 'Global admin', programme_owner: 'Programme owner', regional_coordinator: 'Regional coordinator', content_editor: 'Content editor', assessor: 'Assessor', technical_admin: 'Technical admin' };
const LANG = { en: 'English', fr: 'Français', de: 'Deutsch', nl: 'Nederlands', es: 'Español', it: 'Italiano', el: 'Ελληνικά', hr: 'Hrvatski', cs: 'Čeština', pl: 'Polski', fi: 'Suomi', sv: 'Svenska', da: 'Dansk', ar: 'العربية', th: 'ไทย' };
let me = null, regions = [];

async function call(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Session': store.get('sp_token') };
  if (store.get(AS_KEY)) headers['X-Learn-As'] = store.get(AS_KEY);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${API}/learn/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) { const e = new Error((data && data.error) || `Couldn't reach the server (${r.status})`); e.status = r.status; throw e; }
  return data;
}
const fail = (msg) => { $('error').textContent = msg || ''; show($('error'), !!msg); };
const toast = (s) => { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); };
const has = (role) => me.grants.some((g) => g.role === role);
const isAdmin = () => has('global_admin');
const roleText = (g) => `${ROLE[g.role] || g.role}${g.programmeId ? ` · ${g.programmeId}` : ''}${g.regionId ? ` · ${regionName(g.regionId)}` : ''}`;
const regionName = (id) => regions.find((r) => r.id === id)?.name || id || 'No region';
const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });


// ---------------------------------------------------------------- the cameras guide, and practising with a camera
// What every referee needs to know to set up and use the cameras, from the site's camera guides (streaming.html, phone.html) and
// the judge's advice on placing them. It ends with the only place a 30-minute practice camera is booked (/api/learn/practice-camera).
const CAMERA_GUIDE = `
  <section class="card guide"><h1>Cameras: setup and use</h1>
    <p>SpartanReferee films the penalty stations on phones and runs an AI judge on every camera, so each rep is counted and checked against the rules. Phones send their pictures to a SpartanReferee server over Wi-Fi or mobile data; the server records them, judges them and shows everything in a browser.</p>
    <nav class="toc" aria-label="In this guide"><a href="#g-before">Before the event</a><a href="#g-kit">What you need</a><a href="#g-place">Placing a camera</a><a href="#g-connect">Connecting a phone</a><a href="#g-judge">Judging</a><a href="#g-wrong">If something goes wrong</a><a href="#g-practice">Practise</a></nav>
  </section>
  <section class="card guide" id="g-before"><h2>1. Before the event</h2><ul>
    <li>Your events are on your home page. Open one to see its camera hours and who's refereeing it, and press <b>Book cameras</b>. Any referee can book, and each event has one booking for everyone.</li>
    <li>An event's cameras run from 07:00 to 18:00 local time on each of its days.</li>
    <li>Each server takes 2 cameras. A booking made ahead starts its servers 10 minutes early, so the cameras are ready on time; starting now takes about 5 minutes.</li>
    <li>Check the venue's connection before the day: each camera sends about 3.5 Mbit/s, and the venue has to carry them all.</li></ul></section>
  <section class="card guide" id="g-kit"><h2>2. What you need</h2><ul>
    <li>A phone for each camera, on a tripod or stand, with a power bank and mobile data or Wi-Fi.</li>
    <li>Android phones use the <b>SpartanReferee Broadcaster</b> app; iPhones use <b>Larix Broadcaster</b> from the App Store.</li>
    <li>Any phone, tablet or computer with a browser, to watch the cameras and judge. Nothing to install on it.</li></ul></section>
  <section class="card guide" id="g-place"><h2>3. Placing a camera</h2><ul>
    <li>Phone in landscape, on its stand, 3 to 4 metres from the athletes.</li>
    <li>Keep each athlete's whole body in the picture, including when they lie flat.</li>
    <li>A slightly angled or side-on view judges chest to ground better than straight on. Push-ups and sit-ups need the phone side-on at floor level.</li>
    <li>Officials in hi-vis yellow tops are never counted as athletes, but keep the lanes clear of anyone else standing in front of the camera.</li></ul></section>
  <section class="card guide" id="g-connect"><h2>4. Connecting a phone</h2>
    <p>Once the booking is on, open it on the console: each camera waiting for its phone shows QR codes on the <b>Live</b> and <b>Cameras</b> tabs. The codes change with every booking, so scan them again each time.</p>
    <h3>Android: SpartanReferee Broadcaster</h3><ol>
      <li>Install the app. The phone warns you, as it isn't from the Play Store: tap Settings, turn on Allow from this source, go back and tap Install.</li>
      <li>Tap <b>Scan the camera's QR code</b> and scan that camera's code.</li>
      <li>Leave the quality on 720p unless the signal is weak, tap <b>Open the camera</b> and <b>GO LIVE</b>.</li></ol>
    <h3>iPhone: Larix Broadcaster</h3><ol>
      <li>Install Larix Broadcaster and open it once, allowing the camera and microphone.</li>
      <li>Scan the camera's iPhone (Larix) code with the phone's camera, open the link in Larix and tap Import.</li>
      <li>In Larix, go to Settings, then Connections, tick the camera, and press the red button.</li></ol>
    <p class="note">The full guides: <a href="../streaming.html">setting up the cameras</a> and <a href="../phone.html">one camera phone</a>.</p></section>
  <section class="card guide" id="g-judge"><h2>5. Judging</h2><ul>
    <li>On the <b>Live</b> tab each phone's picture shows within a few seconds of going live.</li>
    <li>Press <b>Start AI judge</b> on a camera, give it a name and choose what it's judging (burpees, squats, push-ups and more), then <b>Start judging</b>.</li>
    <li>Do a few test reps in front of each camera and check they're counted. The judge runs on the server, so it carries on when you close the page.</li>
    <li><b>Results</b> lists everyone judged. <b>Watch</b> plays an athlete with every rep and no rep; <b>Find athlete number</b> searches every camera. Recordings and results are kept for 7 days.</li></ul></section>
  <section class="card guide" id="g-wrong"><h2>6. If something goes wrong</h2><ul>
    <li><b>A phone won't connect:</b> check its signal, and scan its code again from this booking.</li>
    <li><b>The picture stutters or drops:</b> the signal is too weak for 720p. Pick a lower quality.</li>
    <li><b>A camera shows but no picture:</b> the venue's network may block video. Try the browser on a phone's mobile data.</li>
    <li><b>The server didn't start:</b> the console says why. Sometimes Azure has no servers free for a few minutes: try again.</li>
    <li><b>The venue's internet fails:</b> nothing reaches the server until it's back. Only Larix keeps its own copy on the phone.</li></ul></section>
  <section class="card guide" id="g-practice"><h2>7. Practise</h2>
    <p>Try it all before an event with a practice camera: 30 minutes on a real server, at any time, just for you. Point a phone at yourself doing a few burpees and see them judged. It can't be extended: book another when it ends.</p>
    <div id="practice"><p class="muted">Checking for a practice camera…</p></div></section>`;

// ---------------------------------------------------------------- views
const views = {
  async home() {
    const p = me.person;
    return `<section class="card"><h1>${esc(p.preferredName || p.legalName)}</h1>
      <p class="muted">${esc(p.publicId)} · ${esc(regionName(p.regionId))}${p.country ? ` · ${esc(p.country)}` : ''}</p>
      <ul class="chips">${me.grants.length ? me.grants.map((g) => `<li>${esc(roleText(g))}</li>`).join('') : '<li>Learner</li>'}</ul></section>
      <section class="card"><h2>Cameras: setup and use</h2><p>How to set up the phones at a penalty station, connect them and judge with them, and a 30-minute practice camera to try it.</p><p><a class="small btnLink" href="#/cameras">Open the guide</a></p></section>
      <section class="card"><h2>Your programmes</h2><p class="muted">Programmes, lessons and qualifications arrive in the next step of the prototype.</p></section>`;
  },
  async profile() { return personView(me.person.id, true); },
  async cameras() { return CAMERA_GUIDE; },
  async people(rest) {
    if (rest) return personView(rest, false);
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const { people } = await call(`people?q=${encodeURIComponent(q.get('q') || '')}&region=${encodeURIComponent(q.get('region') || '')}`);
    const canAdd = isAdmin() || has('regional_coordinator');
    const myRegions = isAdmin() ? regions : regions.filter((r) => me.grants.some((g) => g.role === 'regional_coordinator' && g.regionId === r.id));
    return `<section class="card"><h1>People</h1>
      <form class="filters2" id="peopleFilter"><input name="q" type="search" placeholder="Name, email or SR number" value="${esc(q.get('q') || '')}" aria-label="Find a person">
        <select name="region" aria-label="Region"><option value="">${isAdmin() ? 'All regions' : 'All my regions'}</option>${myRegions.map((r) => `<option value="${esc(r.id)}"${q.get('region') === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <button class="small" type="submit">Find</button></form>
      <ul class="rowList">${people.map((p) => `<li><a href="#/people/${esc(p.id)}"><b>${esc(p.legalName)}</b><small>${esc(p.publicId)} · ${esc(p.email)} · ${esc(regionName(p.regionId))}${p.synthetic ? '' : ' · real account'}</small></a></li>`).join('') || '<li class="muted">Nobody found.</li>'}</ul></section>
      ${canAdd ? `<section class="card"><h2>Add a person</h2><p class="note">Invented people only, for the prototype.</p>
        <form class="form2" id="addPerson">
          <div><label for="np-name">Legal name</label><input id="np-name" name="legalName" required maxlength="120"></div>
          <div><label for="np-email">Email</label><input id="np-email" name="email" type="email" required maxlength="254" placeholder="name@demo.spartanreferee.test"></div>
          <div><label for="np-country">Country (two letters)</label><input id="np-country" name="country" maxlength="2" placeholder="GB"></div>
          <div><label for="np-region">Region</label><select id="np-region" name="regionId" required>${myRegions.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
          <div class="wide"><button class="primary" type="submit">Add</button></div></form></section>` : ''}`;
  },
  async duplicates() {
    const { flags } = await call('duplicates');
    return `<section class="card"><h1>Possible duplicates</h1><p class="note">Flagged when a new person has the same email, or the same name in the same region. Nobody is merged automatically.</p>
      <ul class="rowList">${flags.map((f) => `<li><span><b>${esc(f.a.legalName)} (${esc(f.a.publicId)}) and ${esc(f.b.legalName)} (${esc(f.b.publicId)})</b><small>${esc(f.reason)} · ${esc(f.a.email)} · ${esc(f.b.email)}</small></span><button class="small" type="button" data-not-dup="${esc(f.id)}">Not the same person</button></li>`).join('') || '<li class="muted">Nothing flagged.</li>'}</ul></section>`;
  },
  async audit() {
    const { events } = await call('audit');
    return `<section class="card"><h1>Audit log</h1><p class="note">Every privileged change, newest first. Changes made while viewing as someone show both people.</p>
      <table class="auditTable"><thead><tr><th>When</th><th>Who</th><th>What</th><th class="hideSmall">Details</th></tr></thead><tbody>
      ${events.map((e) => `<tr><td>${esc(when(e.at))}</td><td>${esc(e.actor || 'Seed script')}${e.actingAs ? `<br><small class="muted">as ${esc(e.actingAs)}</small>` : ''}</td><td>${esc(e.action)}<br><small class="muted">${esc(e.entityType)} ${esc(e.entityId.slice(0, 8))}</small></td><td class="hideSmall"><code>${esc(JSON.stringify(e.summary))}</code></td></tr>`).join('')}
      </tbody></table></section>`;
  },
};
const FIELD = { legal_name: ['legalName', 'Legal name'], preferred_name: ['preferredName', 'Preferred name'], email: ['email', 'Email'], country: ['country', 'Country (two letters)'], region_id: ['regionId', 'Region'], locale: ['locale', 'Language'], status: ['status', 'Status'] };
async function personView(id, own) {
  const { person: p, editable, grants } = await call(`people/${encodeURIComponent(id)}`);
  const input = (f) => {
    const [key, label] = FIELD[f], v = p[key] || '', ro = !editable.includes(f), dis = ro ? ' disabled' : '';
    if (f === 'region_id') return `<div><label for="f-${key}">${label}</label><select id="f-${key}" name="${key}"${dis}><option value="">No region</option>${regions.map((r) => `<option value="${esc(r.id)}"${r.id === v ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>`;
    if (f === 'locale') return `<div><label for="f-${key}">${label}</label><select id="f-${key}" name="${key}"${dis}>${Object.entries(LANG).map(([c, n]) => `<option value="${c}"${c === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`;
    if (f === 'status') return `<div><label for="f-${key}">${label}</label><select id="f-${key}" name="${key}"${dis}>${['active', 'suspended'].map((s) => `<option${s === v ? ' selected' : ''}>${s}</option>`).join('')}</select></div>`;
    return `<div><label for="f-${key}">${label}</label><input id="f-${key}" name="${key}" value="${esc(v)}"${dis}></div>`;
  };
  return `<section class="card"><h1>${esc(own ? 'My profile' : p.legalName)}</h1><p class="muted">${esc(p.publicId)}${p.synthetic ? ' · invented person' : ''} · created ${esc(when(p.createdAt))}</p>
    <form class="form2" id="editPerson" data-id="${esc(p.id)}">${['legal_name', 'preferred_name', 'email', 'country', 'region_id', 'locale', 'status'].map(input).join('')}
      ${editable.length ? '<div class="wide"><button class="primary" type="submit">Save</button></div>' : '<p class="note wide">You can\'t change this profile.</p>'}</form></section>
    <section class="card"><h2>Roles</h2><ul class="rowList">${grants.map((g) => `<li><span><b>${esc(roleText(g))}</b><small>since ${esc(when(g.grantedAt))}</small></span>${isAdmin() ? `<button class="small" type="button" data-remove-role="${esc(g.id)}">Remove</button>` : ''}</li>`).join('') || '<li class="muted">Learner only.</li>'}</ul>
    ${isAdmin() ? `<form class="form2" id="addRole" data-id="${esc(p.id)}"><div><label for="r-role">Give a role</label><select id="r-role" name="role">${Object.entries(ROLE).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
      <div><label for="r-prog">Programme (if any)</label><input id="r-prog" name="programmeId" placeholder="ocr-referee"></div>
      <div><label for="r-region">Region (coordinators)</label><select id="r-region" name="regionId"><option value="">None</option>${regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="wide"><button class="small" type="submit">Give role</button></div></form>` : ''}</section>`;
}

// ---------------------------------------------------------------- drawing and actions
async function draw() {
  fail('');
  const [, view = '', rest = ''] = (location.hash.split('?')[0] || '#/').split('/');
  const name = views[view] ? view : 'home';
  for (const a of $('learnNav').querySelectorAll('a')) a.classList.toggle('on', a.dataset.view === name);
  try { $('view').innerHTML = await views[name](rest); wire(); } catch (e) { $('view').innerHTML = ''; fail(e.message); }
}
const formBody = (form) => Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ''));
// the practice camera: whether one's on, or a way to start one (not while viewing as someone else: it'd be yours)
async function drawPractice() {
  const box = $('practice'); if (!box) return;
  if (me.actingAs) { box.innerHTML = '<p class="note">Practice cameras are booked as yourself: switch View as back to yourself.</p>'; return; }
  let r; try { r = await call('practice-camera'); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const s = r.server || {}, open = `../console.html?unit=${encodeURIComponent(r.unit)}`, clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (s.wanted === 'on') {
    box.innerHTML = `<p class="practiceState"><b>${s.state === 'on' ? `Your practice camera is on until ${esc(clock(s.until))}.` : 'Your practice camera is starting: about 5 minutes.'}</b></p>
      <p>Open it on the console to scan its code with a phone, start the AI judge and watch.</p><a class="practiceBtn" href="${open}">Open my practice camera</a>`;
    return;
  }
  box.innerHTML = `<form id="practiceForm" class="practiceForm"><label for="pc-cams">Cameras</label>
    <select id="pc-cams" name="cameras"><option value="1">1 camera</option><option value="2">2 cameras</option></select>
    <button class="practiceBtn" type="submit">Start a 30-minute practice camera</button></form><p class="note">It starts now and takes about 5 minutes to be ready.</p>`;
  $('practiceForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await call('practice-camera', { method: 'POST', body: { cameras: Number($('pc-cams').value) } }); toast('Practice camera starting'); drawPractice(); }
    catch (err) { fail(err.message); btn.disabled = false; }
  });
}
function wire() {
  drawPractice();
  // the guide's own contents links scroll within it, without changing the page's view
  for (const a of document.querySelectorAll('.toc a')) a.onclick = (e) => { e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('peopleFilter')?.addEventListener('submit', (e) => { e.preventDefault(); const b = formBody(e.target); location.hash = `#/people?${new URLSearchParams(b)}`; });
  $('addPerson')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await call('people', { method: 'POST', body: formBody(e.target) });
      toast(r.duplicates.length ? `Added ${r.person.publicId}: flagged as a possible duplicate of ${r.duplicates.map((d) => d.publicId).join(', ')}` : `Added ${r.person.publicId}`);
      location.hash = `#/people/${r.person.id}`;
    } catch (err) { fail(err.message); }
  });
  $('editPerson')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target, body = {};
    for (const el of form.querySelectorAll('input:not([disabled]), select:not([disabled])')) body[el.name] = el.value;
    try { await call(`people/${form.dataset.id}`, { method: 'PUT', body }); toast('Saved'); await loadMe(); draw(); } catch (err) { fail(err.message); }
  });
  $('addRole')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await call('roles', { method: 'POST', body: { personId: e.target.dataset.id, ...formBody(e.target) } }); toast('Role given'); draw(); } catch (err) { fail(err.message); }
  });
  for (const b of document.querySelectorAll('[data-remove-role]')) b.onclick = async () => { try { await call(`roles/${b.dataset.removeRole}`, { method: 'DELETE' }); toast('Role removed'); draw(); } catch (err) { fail(err.message); } };
  for (const b of document.querySelectorAll('[data-not-dup]')) b.onclick = async () => { try { await call(`duplicates/${b.dataset.notDup}`, { method: 'POST', body: { decision: 'not_duplicate' } }); toast('Marked as different people'); draw(); } catch (err) { fail(err.message); } };
}
function drawChrome() {
  $('who').textContent = me.actingAs ? `${me.real.email} as ${me.person.legalName}` : me.person.email;
  show($('learnNav'), true); show($('demoBar'), true);
  for (const v of ['people', 'duplicates', 'audit']) show($('learnNav').querySelector(`[data-view="${v}"]`), v === 'people' ? isAdmin() || has('regional_coordinator') : isAdmin());
  show($('viewAsBox'), me.viewAs.length > 0);
  if (me.viewAs.length) {
    $('viewAs').innerHTML = `<option value="">Yourself (${esc(me.real.legalName)})</option>${me.viewAs.map((p) => `<option value="${esc(p.id)}"${p.id === me.actingAs ? ' selected' : ''}>${esc(p.legalName)}: ${esc(p.roles.map((r) => ROLE[r] || r).join(', ') || 'Learner')}</option>`).join('')}`;
  }
}
$('viewAs').addEventListener('change', async () => { store.set(AS_KEY, $('viewAs').value); await loadMe(); location.hash = '#/'; draw(); });
async function loadMe() {
  try { me = await call('me'); }
  catch (e) { if (store.get(AS_KEY)) { store.set(AS_KEY, ''); me = await call('me'); } else throw e; }
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
  ({ regions } = await call('regions'));
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

// Your profile: sign in with Google (as in SkiTour), your name and details, the link to your Spartan profile,
// and becoming a Burpee judge with the code an admin gives you.
import { call, esc, getMe, googleButton, signOut } from './api-base.js';
import { toast } from './hub-edit.js';

const $ = (id) => document.getElementById(id);
const setName = (v) => { try { localStorage.setItem('sp_name', v); } catch { /* private mode */ } };

// burpee challenge bests and the latest attempts, from the scoreboard
async function bests() {
  try {
    const r = await call('scores/me');
    const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const card = (m, label) => { const x = r[m] || {}; return `<div class="stat"><b>${x.best ? x.best.reps : '–'}</b><small>${label}</small></div>`; };
    const recent = [...(r['1min'].recent || []).map((x) => ({ ...x, m: '1 min' })), ...(r['5min'].recent || []).map((x) => ({ ...x, m: '5 min' }))].sort((a, b) => b.at - a.at).slice(0, 8);
    $('bestsBox').innerHTML = `<div class="stat-grid" style="grid-template-columns:1fr 1fr">${card('1min', '1-minute best')}${card('5min', '5-minute best')}</div>
      ${recent.length ? `<p class="muted" style="margin:0">Latest: ${recent.map((x) => `${esc(x.m)} <b>${Number(x.reps)}</b> (${when(x.at)})`).join(' · ')}</p>` : '<p class="muted" style="margin:0">No challenges yet.</p>'}
      <div class="row"><a class="btn btn-red" href="scoreboard.html">Spartans challenge</a></div>`;
  } catch (e) { $('bestsBox').innerHTML = `<p class="muted" style="margin:0">Couldn't load your bests: ${esc(e.message)}</p>`; }
}
bests();
// five taps on the title: the sign-in that's hidden for now, for admins (the app has no address bar)
let titleTaps = 0;
document.querySelector('h1.brand').onclick = () => { if (++titleTaps >= 5) location.search = '?signin=1'; };

async function render() {
  const me = await getMe(true), u = me.user, p = me.profile || {};
  const roles = `${me.admin ? '<span class="badge-role">Admin</span>' : ''}${me.judge ? '<span class="badge-role">Burpee judge</span>' : ''}`;
  if (u) {
    $('account').innerHTML = `<div class="who-card">${u.picture ? `<img src="${esc(u.picture)}" alt="">` : `<span class="ini">${esc((u.name || u.email || '?')[0].toUpperCase())}</span>`}
      <div style="flex:1"><b>${esc(u.name || p.name || '')}</b>${roles}<br><span class="muted">${esc(u.email)}</span></div>
      <button class="btn btn-ghost" id="out" type="button">Sign out</button></div>`;
    $('out').onclick = () => { signOut(); toast('Signed out'); render(); };
  } else if (!new URLSearchParams(location.search).has('signin')) { // sign-in is hidden for now; admins use profile.html?signin=1
    $('accountHead').hidden = !roles;
    $('account').innerHTML = roles ? `<div class="form">${roles}</div>` : '';
  } else {
    $('accountHead').hidden = false;
    $('account').innerHTML = `<div class="form"><p class="muted" style="margin:0">Sign in with Google to keep your profile, groups and chat name on any phone.${roles ? ' ' + roles : ''}</p><div id="gbtn"></div></div>`;
    googleButton($('gbtn'), (user) => { toast(`Signed in as ${user.email}`); render(); }, (e) => toast(e.message));
  }
  const f = $('profileForm');
  f.name.value = p.name || ''; f.country.value = p.country || ''; f.ageGroup.value = p.ageGroup || '';
  $('spartanForm').spartanUrl.value = p.spartanUrl || '';
  $('judgeBox').innerHTML = me.judge
    ? `<p style="margin:0">✅ You’re a Burpee judge${me.admin ? ' (as an admin)' : ''}: Official judging is on your home page.</p><div class="row"><a class="btn btn-red" href="judging.html">Official judging</a></div>`
    : `<p class="muted" style="margin:0">Referees: enter the judge code an admin gives you to get the Burpee Judge.</p><form id="judgeForm" class="row"><input name="code" maxlength="8" placeholder="Judge code" style="flex:1;min-width:140px;text-transform:uppercase"><button class="btn btn-red" type="submit">Become a judge</button></form>`;
  if ($('judgeForm')) $('judgeForm').onsubmit = async (e) => { e.preventDefault(); try { await call('profile/judge', { method: 'POST', body: { code: e.target.code.value } }); toast('You’re now a Burpee judge'); render(); } catch (err) { toast(err.message); } };
}
$('profileForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, body = { name: f.name.value, country: f.country.value, ageGroup: f.ageGroup.value };
  try { await call('profile', { method: 'PUT', body }); if (body.name) setName(body.name); toast('Saved'); } catch (err) { toast(err.message); }
};
$('spartanForm').onsubmit = async (e) => {
  e.preventDefault();
  try { await call('profile', { method: 'PUT', body: { spartanUrl: e.target.spartanUrl.value.trim() } }); toast('Spartan profile linked'); } catch (err) { toast(err.message); }
};
render();

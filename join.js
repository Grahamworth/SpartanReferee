// Joining from an invite (join.html?t=<token>): step 1 your full name, region and language; step 2 sign in (Google, Microsoft, or a code
// emailed to the invited address). The form waits in this tab (sessionStorage) while Microsoft's page is open; back here, signed in, it
// registers you (POST /api/invite/<token>/accept) and opens the app.
import { call, esc, signedIn } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';

const $ = (id) => document.getElementById(id);
const t = (s, v) => (window.SR_I18N ? SR_I18N.t(s, v) : s);
const token = new URLSearchParams(location.search).get('t') || '';
const KEY = 'sr_join';
const keep = (v) => { try { sessionStorage.setItem(KEY, JSON.stringify({ token, ...v })); } catch { /* private mode */ } };
const kept = () => { try { const v = JSON.parse(sessionStorage.getItem(KEY)); return v && v.token === token ? v : null; } catch { return null; } };
const LANG_NAMES = Object.fromEntries((window.SR_I18N?.LANGS || []).map(([c, n]) => [c, n]));
const ROLE = { regional_coordinator: 'Regional coordinator', assessor: 'Assessor', programme_owner: 'Programme owner', content_editor: 'Content editor', technical_admin: 'Technical admin', global_admin: 'Admin' };
const fail = (m) => { $('error').textContent = m || ''; $('error').hidden = !m; };
const day = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString((window.SR_I18N && SR_I18N.lang) || undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function register(form) {
  fail('');
  $('joinCard').innerHTML = `<p class="muted">${esc(t('Setting up your account…'))}</p>`;
  try {
    await call(`invite/${encodeURIComponent(token)}/accept`, { method: 'POST', body: form });
    try { sessionStorage.removeItem(KEY); localStorage.setItem('sr_lang', form.locale); } catch { /* fine */ }
    location.replace('learn/');
  } catch (e) {
    fail(e.message);
    $('joinCard').innerHTML = `<p><a class="btnLink" href="join.html?t=${encodeURIComponent(token)}">Try again</a></p>`;
    try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
  }
}

function drawSignIn(inv, form) {
  $('joinCard').innerHTML = `<ol class="joinSteps"><li>1. About you</li><li class="on">2. Sign in</li></ol>
    <h1>Sign in to finish</h1>
    <p class="note">${esc(t('Use your Google or Microsoft account, or your email address ({email}) with a code we email you. Use the same way each time you sign in.', { email: inv.email }))}</p>
    <div id="msBtn"></div><p class="error" id="signInError" role="alert" hidden></p>
    <p><button class="link" type="button" id="back">‹ Back</button></p>`;
  $('back').onclick = () => drawForm(inv, form);
  microsoftButton($('msBtn'), `join.html?t=${token}`, (e) => { $('signInError').textContent = e.message || t('Sign-in didn\'t work: try again'); $('signInError').hidden = false; }, { email: '' });
  // the code box asks for the address: the invited one is filled in when they choose it
  const fill = () => { const i = document.getElementById('codeEmail'); if (i && !i.value) i.value = inv.email; };
  new MutationObserver(fill).observe($('msBtn'), { childList: true, subtree: true });
}

function drawForm(inv, was = {}) {
  const lang = was.locale || (window.SR_I18N && SR_I18N.lang) || 'en';
  const roles = inv.roles.filter((r) => ROLE[r]).map((r) => t(ROLE[r]));
  $('joinCard').innerHTML = `<ol class="joinSteps"><li class="on">1. About you</li><li>2. Sign in</li></ol>
    <h1>Welcome to SpartanReferee</h1>
    <p>${esc(inv.invitedBy ? t('{name} has invited you as a Spartan referee.', { name: inv.invitedBy }) : t('You\'re invited as a Spartan referee.'))}</p>
    ${roles.length ? `<p class="note">${esc(t('Your role: {roles}', { roles: roles.join(', ') }))}</p>` : ''}
    ${inv.programmes.length ? `<p class="note">${esc(t('Training you\'ll be asked to complete:'))}</p><ul class="assigned">${inv.programmes.map((p) => `<li><span>${esc(p.title)}</span>${p.due ? ` · <span>${esc(t('by {date}', { date: day(p.due) }))}</span>` : ''}</li>`).join('')}</ul>` : ''}
    <form id="joinForm">
      <label for="jName">Your full name</label>
      <input id="jName" name="name" required minlength="2" maxlength="120" autocomplete="name" value="${esc(was.name || inv.name)}">
      <label for="jRegion">Your region</label>
      <select id="jRegion" name="regionId" required><option value="">Choose…</option>${inv.regions.map((r) => `<option value="${esc(r.id)}"${r.id === (was.regionId || inv.regionId) ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <label for="jLang">Your language</label>
      <select id="jLang" name="locale" data-i18n-skip>${inv.languages.map((c) => `<option value="${c}"${c === lang ? ' selected' : ''}>${esc(LANG_NAMES[c] || c)}</option>`).join('')}</select>
      <button class="primary" type="submit">Continue</button>
    </form>`;
  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target, form = { name: f.name.value.trim(), regionId: f.regionId.value, locale: f.locale.value };
    keep(form);
    // whoever was signed in on this device (an admin trying the link, say) isn't the new person: they sign in afresh
    try { localStorage.removeItem('sp_token'); } catch { /* fine */ }
    if (form.locale !== ((window.SR_I18N && SR_I18N.lang) || 'en')) { try { localStorage.setItem('sr_lang', form.locale); } catch { /* fine */ } location.reload(); return; } // the page in their language, then on
    drawSignIn(inv, form);
  };
}

async function start() {
  if (!token) { $('joinCard').innerHTML = `<h1>Join SpartanReferee</h1><p>${esc(t('You join SpartanReferee from the invite an admin emails you. Open the link in that email.'))}</p>`; return; }
  let inv;
  try { inv = await call(`invite/${encodeURIComponent(token)}`); } catch (e) { $('joinCard').innerHTML = `<h1>This invite link isn't right</h1><p>${esc(t('Check you opened the whole link from the email, or ask an admin to send it again.'))}</p>`; return; }
  if (inv.state === 'accepted') { $('joinCard').innerHTML = `<h1>You've already registered</h1><p><a class="btnLink primaryLink" href="learn/">Sign in</a></p>`; return; }
  if (inv.state !== 'pending') { $('joinCard').innerHTML = `<h1>${inv.state === 'expired' ? 'This invite has expired' : 'This invite was cancelled'}</h1><p>${esc(t('Ask an admin to send you a new one.'))}</p>`; return; }
  const form = kept();
  if (form && signedIn()) return register(form); // back from signing in
  if (form) return drawSignIn(inv, form); // the language changed: straight on to signing in
  drawForm(inv);
}
start();

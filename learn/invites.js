// Invites (#/invites, admins): everyone joins by invite. Paste one address or hundreds, choose what type of user they are and tick the
// programmes they must do (with a date to finish by); each gets an email with a link to register (join.html). Below, every invite, by
// state, with Resend and Cancel. The server side is api/src/learn/invites.js.
import { $, call, esc, toast, act, redraw, when, day, t } from './core.js';
import { peopleTabs } from './people.js';

const TYPE = [
  ['learner', 'Referee'], ['regional_coordinator', 'Regional coordinator'], ['assessor', 'Assessor'], ['programme_owner', 'Programme owner'],
  ['content_editor', 'Content editor / translator'], ['technical_admin', 'Technical admin'], ['global_admin', 'Admin'],
];
const STATE = { pending: 'Waiting', expired: 'Expired', accepted: 'Registered', revoked: 'Cancelled' };
let OPTS = null;

async function invitesView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || ''), state = q.get('state') || 'pending', find = q.get('q') || '';
  const [opts, data] = await Promise.all([OPTS ? Promise.resolve(OPTS) : call('invites/options'), call(`invites?state=${encodeURIComponent(state)}&q=${encodeURIComponent(find)}`)]);
  OPTS = opts;
  const c = data.counts || {};
  const tab = (s) => `<a href="#/invites?state=${s}" class="chipLink${s === state ? ' on' : ''}">${esc(t(STATE[s]))} (${c[s] || 0})</a>`;
  const typeName = (g) => (TYPE.find(([k]) => k === g.role) || [0, g.role])[1];
  return `<section class="card"><p class="crumbs"><a href="#/people">Manage People</a></p><h1>Invite people</h1>${peopleTabs('invites')}
      <p class="note">Everyone joins by invite. Each address gets an email with a link to register: they give their full name, region and language, and sign in with Google, Microsoft or a code emailed to them.</p>
      <form class="form2 inviteForm" id="inviteForm">
        <div class="wide"><label for="iv-emails">Email addresses</label>
          <textarea id="iv-emails" name="emails" rows="4" required placeholder="one or many: separated by commas, spaces or new lines"></textarea>
          <small class="note" id="iv-count" aria-live="polite"></small></div>
        <div><label for="iv-type">Type of user</label><select id="iv-type" name="role">${TYPE.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></div>
        <div id="iv-progBox" hidden><label for="iv-prog">For the programme</label><select id="iv-prog" name="roleProgramme">${opts.programmes.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}</select></div>
        <div id="iv-regionBox" hidden><label for="iv-region">Region they coordinate</label><select id="iv-region" name="roleRegion">${opts.regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
        <div><label for="iv-home">Their region (they can change it)</label><select id="iv-home" name="regionId"><option value="">They choose</option>${opts.regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
        <fieldset class="wide progPick"><legend>Programmes they must complete</legend>
          ${opts.programmes.map((p) => `<label class="progTick"><input type="checkbox" name="prog" value="${esc(p.id)}"><span>${esc(p.title)}</span></label>`).join('')}
          <label for="iv-due" class="dueLabel">Complete by (optional)</label><input id="iv-due" name="due" type="date">
        </fieldset>
        <div class="wide"><label for="iv-msg">A message in the email (optional)</label><textarea id="iv-msg" name="message" rows="2" maxlength="1000"></textarea></div>
        <div class="wide"><button class="primary" type="submit">Send the invites</button></div>
      </form>
      <div id="iv-result" aria-live="polite"></div></section>
    <section class="card"><h2>Invites</h2>
      <p class="chips inviteTabs">${['pending', 'expired', 'accepted', 'revoked'].map(tab).join(' ')}</p>
      <form class="filters2" id="inviteFind"><input name="q" type="search" placeholder="Find an address or name" value="${esc(find)}" aria-label="Find an invite"><button class="small" type="submit">Find</button></form>
      <ul class="rowList inviteList">${data.invites.map((i) => `<li><span><b>${esc(i.name || i.email)}</b>
          <small>${i.name ? `${esc(i.email)} · ` : ''}${esc(i.grants.length ? i.grants.map(typeName).join(', ') : 'Referee')}${i.programmes.length ? ` · ${i.programmes.length} ${i.programmes.length === 1 ? 'programme' : 'programmes'}` : ''}</small>
          <small>${esc(t(STATE[i.state]))} · ${i.state === 'accepted' ? esc(t('registered {date}', { date: when(i.acceptedAt) })) : esc(t('sent {date}', { date: when(i.lastSentAt || i.createdAt) }))}${i.invitedBy ? ` · <span>${esc(t('by {name}', { name: i.invitedBy }))}</span>` : ''}${i.sendError ? ` · <span class="badText">${esc(t('the email failed: {error}', { error: i.sendError }))}</span>` : ''}</small></span>
          ${['pending', 'expired'].includes(i.state) ? `<span class="rowBtns"><button class="small" type="button" data-resend="${esc(i.id)}">Resend</button><button class="small" type="button" data-revoke="${esc(i.id)}">Cancel</button></span>` : ''}</li>`).join('') || `<li class="muted">${esc(t('None here.'))}</li>`}</ul>
    </section>`;
}

const split = (s) => [...new Set(String(s || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
export const views = { invites: invitesView };
export function wire() {
  const f = $('inviteForm'); if (!f) return;
  const showFor = () => {
    const r = f.role.value;
    $('iv-progBox').hidden = !(OPTS?.needsProgramme || []).includes(r);
    $('iv-regionBox').hidden = r !== 'regional_coordinator';
  };
  f.role.onchange = showFor; showFor();
  const count = () => { const n = split(f.emails.value).length; $('iv-count').textContent = n ? t(n === 1 ? '1 address' : '{n} addresses', { n }) : ''; };
  f.emails.oninput = count;
  f.onsubmit = (e) => {
    e.preventDefault();
    const role = f.role.value;
    const grants = [{ role, ...((OPTS?.needsProgramme || []).includes(role) ? { programmeId: f.roleProgramme.value } : {}), ...(role === 'regional_coordinator' ? { regionId: f.roleRegion.value } : {}) }];
    const programmes = [...f.querySelectorAll('input[name=prog]:checked')].map((x) => ({ id: x.value, due: f.due.value || undefined }));
    act(async () => {
      const r = await call('invites', { method: 'POST', body: { emails: f.emails.value, grants, programmes, regionId: f.regionId.value || undefined, message: f.message.value } });
      $('iv-result').innerHTML = `<p class="okText"><b>${esc(t(r.created === 1 ? '1 invite sent.' : '{n} invites sent.', { n: r.created }))}</b></p>
        ${r.skipped.length ? `<p class="note">${esc(t('Not sent:'))}</p><ul class="plain">${r.skipped.map((s) => `<li>${esc(s.email)}: <span>${esc(s.why)}</span></li>`).join('')}</ul>` : ''}
        ${r.failed.length ? `<p class="badText">${esc(t('The email failed for:'))}</p><ul class="plain">${r.failed.map((s) => `<li>${esc(s.email)}: ${esc(s.error)}</li>`).join('')}</ul>` : ''}`;
      if (r.created) { f.emails.value = ''; count(); toast(t('Invites sent')); setTimeout(redraw, 1500); }
    }, e.submitter);
  };
  $('inviteFind').onsubmit = (e) => { e.preventDefault(); const p = new URLSearchParams(location.hash.split('?')[1] || ''); p.set('q', e.target.q.value.trim()); location.hash = `#/invites?${p}`; };
  for (const b of document.querySelectorAll('[data-resend]')) b.onclick = () => act(async () => { await call(`invites/${b.dataset.resend}/resend`, { method: 'POST' }); toast(t('Sent again, with a new link')); redraw(); }, b);
  for (const b of document.querySelectorAll('[data-revoke]')) b.onclick = () => { if (confirm(t('Cancel this invite? Its link stops working.'))) act(async () => { await call(`invites/${b.dataset.revoke}/revoke`, { method: 'POST' }); toast(t('Cancelled')); redraw(); }, b); };
}

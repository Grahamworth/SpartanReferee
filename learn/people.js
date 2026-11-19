// People: your profile, and for admins and coordinators everyone they look after, possible duplicates and the audit log (step 1).
// Each profile ends with the person's learning record (programmes.js).
import { $, S, call, esc, toast, has, isAdmin, regionName, roleText, when, formBody, ROLE, LANG, redraw, act, t } from './core.js';
import { recordSection, wireRecord } from './programmes.js';

const FIELD = { legal_name: ['legalName', 'Legal name'], preferred_name: ['preferredName', 'Preferred name'], email: ['email', 'Email'], country: ['country', 'Country (two letters)'], region_id: ['regionId', 'Region'], locale: ['locale', 'Language'], status: ['status', 'Status'] };
async function personView(id, own) {
  const { person: p, editable, grants } = await call(`people/${encodeURIComponent(id)}`);
  const input = (f) => {
    const [key, label] = FIELD[f], v = p[key] || '', dis = editable.includes(f) ? '' : ' disabled';
    if (f === 'region_id') return `<div><label for="f-${key}">${label}</label><select id="f-${key}" name="${key}"${dis}><option value="">No region</option>${S.regions.map((r) => `<option value="${esc(r.id)}"${r.id === v ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>`;
    if (f === 'locale') return `<div><label for="f-${key}">${label}</label><select id="f-${key}" name="${key}"${dis}>${Object.entries(LANG).map(([c, n]) => `<option value="${c}"${c === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>`;
    if (f === 'status') return `<div><label for="f-${key}">${label}</label><select id="f-${key}" name="${key}"${dis}>${['active', 'suspended'].map((s) => `<option${s === v ? ' selected' : ''}>${s}</option>`).join('')}</select></div>`;
    return `<div><label for="f-${key}">${label}</label><input id="f-${key}" name="${key}" value="${esc(v)}"${dis}></div>`;
  };
  return `<section class="card"><h1>${esc(own ? 'My profile' : p.legalName)}</h1><p class="muted">${esc(p.publicId)}${p.synthetic ? ' · invented person' : ''} · created ${esc(when(p.createdAt))}</p>
    <form class="form2" id="editPerson" data-id="${esc(p.id)}">${['legal_name', 'preferred_name', 'email', 'country', 'region_id', 'locale', 'status'].map(input).join('')}
      ${editable.length ? '<div class="wide"><button class="primary" type="submit">Save</button></div>' : '<p class="note wide">You can\'t change this profile.</p>'}</form></section>
    ${await recordSection(p.id, own)}
    ${own && !S.me.actingAs ? `<section class="card"><h2>Your data</h2><p class="note">Download everything the learning platform holds about you, as a file.</p><button class="small" type="button" data-export="${esc(p.id)}">Download my data</button></section>`
      : !own && isAdmin() && !S.me.actingAs ? `<section class="card"><h2>Their data</h2><p class="note">Export everything held about this person, or erase them: their name, address and sign-in link go, and their learning records stay, anonymised. Erasing can't be undone.</p>
        <div class="btnRow"><button class="small" type="button" data-export="${esc(p.id)}">Export their data</button></div>
        ${p.status === 'erased' ? '<p class="muted">Erased.</p>' : `<form class="inlineForm" id="erasePerson" data-id="${esc(p.id)}"><label for="er-c">To erase, type ERASE</label><input id="er-c" name="confirm" autocomplete="off" maxlength="10"><button class="small" type="submit">Erase this person</button></form>`}</section>` : ''}
    <section class="card"><h2>Roles</h2><ul class="rowList">${grants.map((g) => `<li><span><b>${esc(roleText(g))}</b><small>since ${esc(when(g.grantedAt))}</small></span>${isAdmin() ? `<button class="small" type="button" data-remove-role="${esc(g.id)}">Remove</button>` : ''}</li>`).join('') || '<li class="muted">Learner only.</li>'}</ul>
    ${isAdmin() ? `<form class="form2" id="addRole" data-id="${esc(p.id)}"><div><label for="r-role">Give a role</label><select id="r-role" name="role">${Object.entries(ROLE).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
      <div><label for="r-prog">Programme (if any)</label><input id="r-prog" name="programmeId" placeholder="ocr-referee"></div>
      <div><label for="r-region">Region (coordinators)</label><select id="r-region" name="regionId"><option value="">None</option>${S.regions.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="wide"><button class="small" type="submit">Give role</button></div></form>` : ''}</section>`;
}

export const views = {
  async profile() { return personView(S.me.person.id, true); },
  async people(rest) {
    if (rest) return personView(rest, false);
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const { people } = await call(`people?q=${encodeURIComponent(q.get('q') || '')}&region=${encodeURIComponent(q.get('region') || '')}`);
    const canAdd = isAdmin() || has('regional_coordinator');
    const myRegions = isAdmin() ? S.regions : S.regions.filter((r) => S.me.grants.some((g) => g.role === 'regional_coordinator' && g.regionId === r.id));
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
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const filter = ['entityType', 'entityId'].filter((k) => q.get(k)).map((k) => `${k}=${encodeURIComponent(q.get(k))}`).join('&');
    const { events } = await call(`audit${filter ? `?${filter}` : ''}`);
    return `<section class="card"><h1>Audit log</h1><p class="note">Every privileged change, newest first. Changes made while viewing as someone show both people.${filter ? ' <a href="#/audit">Show everything</a>' : ''}</p>
      <table class="auditTable"><thead><tr><th>When</th><th>Who</th><th>What</th><th class="hideSmall">Details</th></tr></thead><tbody>
      ${events.map((e) => `<tr><td>${esc(when(e.at))}</td><td>${esc(e.actor || 'Seed script')}${e.actingAs ? `<br><small class="muted">as ${esc(e.actingAs)}</small>` : ''}</td><td>${esc(e.action)}<br><small class="muted">${esc(e.entityType)} ${esc(e.entityId.slice(0, 8))}</small></td><td class="hideSmall"><code>${esc(JSON.stringify(e.summary))}</code></td></tr>`).join('')}
      </tbody></table></section>`;
  },
};

export function wire({ reloadMe }) {
  wireRecord();
  for (const b of document.querySelectorAll('[data-export]')) b.onclick = () => act(async () => {
    const data = await call(`people/${b.dataset.export}/export`);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `learning-data-${data.person?.public_id || 'person'}.json`; a.click(); URL.revokeObjectURL(a.href); toast('Downloaded');
  }, b);
  $('erasePerson')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!confirm(t('Erase this person? Their name, address and sign-in link are removed for good.'))) return;
    act(async () => { const r = await call(`people/${e.target.dataset.id}/erase`, { method: 'POST', body: { confirm: e.target.confirm.value.trim() } }); toast(`${r.erased} erased`); alert(r.note); redraw(); }, e.submitter);
  });
  $('peopleFilter')?.addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/people?${new URLSearchParams(formBody(e.target))}`; });
  $('addPerson')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => {
      const r = await call('people', { method: 'POST', body: formBody(e.target) });
      toast(r.duplicates.length ? `Added ${r.person.publicId}: flagged as a possible duplicate of ${r.duplicates.map((d) => d.publicId).join(', ')}` : `Added ${r.person.publicId}`);
      location.hash = `#/people/${r.person.id}`;
    }, e.submitter);
  });
  $('editPerson')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target, body = {};
    for (const el of form.querySelectorAll('input:not([disabled]), select:not([disabled])')) body[el.name] = el.value;
    act(async () => { await call(`people/${form.dataset.id}`, { method: 'PUT', body }); toast('Saved'); await reloadMe(); redraw(); }, e.submitter);
  });
  $('addRole')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => { await call('roles', { method: 'POST', body: { personId: e.target.dataset.id, ...formBody(e.target) } }); toast('Role given'); redraw(); }, e.submitter);
  });
  for (const b of document.querySelectorAll('[data-remove-role]')) b.onclick = () => act(async () => { await call(`roles/${b.dataset.removeRole}`, { method: 'DELETE' }); toast('Role removed'); redraw(); }, b);
  for (const b of document.querySelectorAll('[data-not-dup]')) b.onclick = () => act(async () => { await call(`duplicates/${b.dataset.notDup}`, { method: 'POST', body: { decision: 'not_duplicate' } }); toast('Marked as different people'); redraw(); }, b);
}

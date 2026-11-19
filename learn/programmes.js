// Programmes (step 2): your overview, the catalogue, one programme's page (its versions, policy and curriculum, with editing, review
// and approval for its editors and owner), and each person's learning record. The server checks everything again.
import { $, S, call, esc, toast, regionName, roleText, day, formBody, badge, bar, redraw, act, hooks, runHooks, LANG } from './core.js';

const RULE = { lessons: 'Complete every lesson', assessment: 'Pass the assessment', 'lessons+assessment': 'Complete every lesson and pass the assessment' };
const CATEGORY = { referee: 'Referee', judge: 'Judge', other: 'Other' };
let catalogueCache = null;
const programmesList = async () => (catalogueCache = catalogueCache || call('programmes'));
window.addEventListener('learn:redraw', () => { catalogueCache = null; });

// ---------------------------------------------------------------- a person's learning record (PER-04), on their profile and overview
function enrolmentCard(e, own) {
  const total = e.lessons || 0, done = e.done || 0;
  return `<li class="enrolCard"><a href="#/programmes/${esc(e.programmeId)}">
      <span class="enrolTop"><b>${esc(e.title)}</b>${badge(e.state)}</span>
      <small>${esc(e.role)}${e.grade ? ` · ${esc(e.grade)}` : ''} · ${esc(e.edition)} edition${e.versionState === 'superseded' ? ' (superseded)' : ''}${e.demo ? ' · demonstration' : ''}</small>
      <span class="enrolProgress">${bar(done, total)}<small>${done} of ${total} lessons${e.attemptText ? ` · ${esc(e.attemptText)}` : ''}</small></span>
      ${e.credential ? `<span class="enrolCred">${badge(e.credential.status)} <small>${esc(e.credential.qualification)}${e.credential.expiresAt ? ` · until ${esc(day(e.credential.expiresAt))}` : ''}</small></span>` : ''}
    </a>${!own && e.state === 'active' && e.canWithdraw ? `<button class="small" type="button" data-withdraw="${esc(e.id)}">Withdraw</button>` : ''}</li>`;
}
export async function recordSection(personId, own) {
  let rec; try { rec = await call(`people/${encodeURIComponent(personId)}/record`); } catch (e) { return `<section class="card"><h2>Learning</h2><p class="error">${esc(e.message)}</p></section>`; }
  const enrolForm = !own && rec.canEnrol ? await (async () => {
    const { programmes } = await programmesList(); const open = programmes.filter((p) => p.current && p.status === 'active');
    return open.length ? `<form class="inlineForm" id="enrolOther" data-person="${esc(personId)}"><label for="eo-prog">Enrol in</label><select id="eo-prog" name="programmeId">${open.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} (${esc(p.current.edition)})</option>`).join('')}</select><button class="small" type="submit">Enrol</button></form>` : '';
  })() : '';
  return `<section class="card"><h2>${own ? 'Your learning' : 'Learning record'}</h2>
    <ul class="enrolList">${rec.enrolments.map((e) => enrolmentCard({ ...e, canWithdraw: rec.canEnrol }, own)).join('') || `<li class="muted">${own ? 'You\'re not enrolled in anything yet. <a href="#/programmes">See the programmes</a>.' : 'Not enrolled in anything yet.'}</li>`}</ul>
    ${enrolForm}${await runHooks(hooks.record, { ...rec, own })}</section>`;
}
export function wireRecord() {
  $('enrolOther')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => { await call('enrolments', { method: 'POST', body: { programmeId: e.target.programmeId.value, personId: e.target.dataset.person } }); toast('Enrolled'); redraw(); }, e.submitter);
  });
  for (const b of document.querySelectorAll('[data-withdraw]')) b.onclick = () => { if (confirm('Withdraw from this programme? Their record is kept.')) act(async () => { await call(`enrolments/${b.dataset.withdraw}`, { method: 'DELETE' }); toast('Withdrawn'); redraw(); }, b); };
}

// ---------------------------------------------------------------- the overview
async function overview() {
  const p = S.me.person;
  return `<section class="card hello"><h1>${esc(p.preferredName || p.legalName)}</h1>
      <p class="muted">${esc(p.publicId)} · ${esc(regionName(p.regionId))}${p.country ? ` · ${esc(p.country)}` : ''}</p>
      <ul class="chips">${S.me.grants.length ? S.me.grants.map((g) => `<li>${esc(roleText(g))}</li>`).join('') : '<li>Learner</li>'}</ul></section>
    ${await recordSection(p.id, true)}
    <section class="card"><h2>Burpee camera station</h2><p>The course on setting up the phones at the penalty station, connecting them, judging with the AI judge and sorting out problems. It ends with the free camera, to try the judge on your own phone.</p><p><a class="btnLink" href="#/programmes/camera-station">Open the course</a></p></section>`;
}

// ---------------------------------------------------------------- the catalogue
async function catalogue() {
  const { programmes, canCreate } = await programmesList();
  const card = (p) => `<li class="progCard">
      <a href="#/programmes/${esc(p.id)}"><span class="enrolTop"><b>${esc(p.title)}</b>${p.current ? badge('published', `${p.current.edition}`) : badge('draft', 'Not published')}</span>
      <small>${esc(CATEGORY[p.category] || p.category)} · ${p.modules} modules · ${esc(p.locales.map((l) => LANG[l] || l).join(', '))}${p.demo ? ' · demonstration content' : ''}${p.status === 'archived' ? ' · archived' : ''}</small>
      ${p.description ? `<span class="progDesc">${esc(p.description)}</span>` : ''}
      ${p.drafts.length ? `<small>Being worked on: ${p.drafts.map((d) => `${esc(d.edition)} (${d.state === 'review' ? 'in review' : 'draft'})`).join(', ')}</small>` : ''}</a>
      ${p.enrolment ? `<span class="progFoot">${badge(p.enrolment.state, p.enrolment.state === 'active' ? 'Enrolled' : null)}</span>` : p.current && p.status === 'active' ? `<span class="progFoot"><button class="small" type="button" data-enrol="${esc(p.id)}">Enrol</button></span>` : ''}
    </li>`;
  return `<section class="card"><h1>Programmes</h1><p class="note">Each programme has its own lessons, assessment, pass mark and qualification. One profile can be enrolled in any number of them.</p>
      <ul class="progList">${programmes.map(card).join('') || '<li class="muted">No programmes yet.</li>'}</ul></section>
    ${canCreate ? `<section class="card"><h2>New programme</h2><p class="note">Any number of programmes, set up here with no code change. It starts as a draft for you to fill in.</p>
      <form class="form2" id="newProgramme">
        <div><label for="np-title">Title</label><input id="np-title" name="title" required maxlength="120" placeholder="Spartan Kids Course Marshal"></div>
        <div><label for="np-id">Short id (in addresses)</label><input id="np-id" name="id" required maxlength="32" pattern="[a-z][a-z0-9-]{1,30}[a-z0-9]" placeholder="kids-marshal"></div>
        <div><label for="np-cat">Category</label><select id="np-cat" name="category">${Object.entries(CATEGORY).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
        <div><label for="np-role">A learner in it is a…</label><input id="np-role" name="learnerRole" maxlength="60" placeholder="Course Marshal"></div>
        <div><label for="np-ed">First edition</label><input id="np-ed" name="edition" maxlength="40" value="${new Date().getFullYear() + 1}"></div>
        <div><label for="np-qual">Completing it earns</label><input id="np-qual" name="qualification" maxlength="120" placeholder="Kids Course Marshal 2027"></div>
        <div><label for="np-loc">Languages (codes)</label><input id="np-loc" name="locales" maxlength="80" value="en"></div>
        <div class="wide"><label for="np-desc">Description</label><textarea id="np-desc" name="description" maxlength="1000" rows="2"></textarea></div>
        <div class="wide"><button class="primary" type="submit">Create programme</button></div></form></section>` : ''}`;
}

// ---------------------------------------------------------------- one programme
const policyText = (v) => [
  `${RULE[v.completionRule] || v.completionRule}`,
  `Pass mark ${v.passMark}%`,
  v.maxAttempts ? `${v.maxAttempts} attempts${v.retakeWaitHours ? `, then ${v.retakeWaitHours} hours before trying again` : ''}` : 'Unlimited attempts',
  v.validityMonths ? `Valid for ${v.validityMonths} months, due for renewal ${v.renewalDueDays} days before` : 'Never expires',
];
function versionActions(d) {
  const v = d.version, out = [];
  if (v.state === 'draft' && d.can.edit) out.push(`<button class="small" type="button" data-state="review">Send for review</button>`);
  if (v.state === 'review' && d.can.approve) out.push(`<button class="primary small" type="button" data-state="published">Approve and publish</button>`, `<button class="small" type="button" data-state="draft">Send back to draft</button>`);
  if (['draft', 'published', 'superseded'].includes(v.state) && d.can.programme) out.push(`<button class="small" type="button" data-state="archived">Archive</button>`);
  return out.join('');
}
async function programmePage(id) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = await call(`programmes/${encodeURIComponent(id)}${q.get('version') ? `?version=${encodeURIComponent(q.get('version'))}` : ''}`);
  const { programme: p, version: v, modules, enrolment: e } = d, editable = v.state === 'draft' && d.can.edit;
  const doneSet = new Set(d.completed || []);
  const lessonRow = (l) => `<li class="lessonRow"><a href="#/lesson/${esc(l.id)}"><span class="tick${doneSet.has(l.id) ? ' done' : ''}" aria-label="${doneSet.has(l.id) ? 'Completed' : 'Not completed yet'}"></span><span><b>${esc(l.title)}</b><small>${l.minutes} min${l.summary ? ` · ${esc(l.summary)}` : ''}${d.lessonNotes?.[l.id] ? ` · ${esc(d.lessonNotes[l.id])}` : ''}</small></span></a>
      ${editable ? `<button class="small" type="button" data-del-lesson="${esc(l.id)}" aria-label="Delete lesson ${esc(l.title)}">Delete</button>` : ''}</li>`;
  return `<section class="card progHead" data-current-version="${esc(v.id)}">
      <p class="crumbs"><a href="#/programmes">Programmes</a></p>
      <h1>${esc(p.title)}</h1>
      <p class="badges">${badge(v.state, `${v.edition}: ${({ draft: 'draft', review: 'in review', published: 'published', superseded: 'superseded', archived: 'archived' })[v.state]}`)}${p.demo ? badge('preview', 'Demonstration content') : ''}${p.status === 'archived' ? badge('archived') : ''}</p>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      ${d.versions.length > 1 ? `<label class="versionPick">Version <select id="versionPick">${d.versions.map((x) => `<option value="${esc(x.id)}"${x.id === v.id ? ' selected' : ''}>${esc(x.edition)} (${esc(x.state)})</option>`).join('')}</select></label>` : ''}
      ${v.state !== 'published' && !d.can.edit ? '' : v.state !== 'published' ? '<p class="note">Learners only ever see a published version.</p>' : ''}
    </section>
    <section class="card"><h2>${e ? 'Your progress' : 'Take part'}</h2>
      ${e ? `<p>${badge(e.state)} Enrolled ${esc(day(e.enrolledAt))}${e.versionId !== v.id ? ' on another version' : ''}.</p>${d.progress ? `${bar(d.progress.done, d.progress.total)}<p class="note">${d.progress.done} of ${d.progress.total} lessons done.${d.nextLesson ? ` <a href="#/lesson/${esc(d.nextLesson)}">Continue</a>` : ''}</p>` : ''}`
    : d.can.enrol && v.state === 'published' ? `<p>Enrol to start the lessons, take the assessment and earn ${esc(v.qualification)}.</p><button class="primary" type="button" data-enrol="${esc(p.id)}">Enrol</button>` : '<p class="muted">Not open for enrolment.</p>'}
      ${d.newer ? `<p class="reviewNote"><b>A newer edition</b> The ${esc(d.newer.edition)} edition is published. Your progress here stays on your record. <button class="small" type="button" data-enrol="${esc(p.id)}">Move to ${esc(d.newer.edition)}</button></p>` : ''}
      ${await runHooks(hooks.programme, { ...d, slot: 'progress' })}
    </section>
    <section class="card"><h2>Curriculum</h2>
      <ol class="moduleList">${modules.map((m) => `<li><div class="moduleHead"><span><b>${esc(m.title)}</b>${m.sourceSection ? `<small>${esc(m.sourceSection)}</small>` : ''}</span>${editable ? `<button class="small" type="button" data-del-module="${esc(m.id)}" aria-label="Delete module ${esc(m.title)}">Delete</button>` : ''}</div>
        ${m.summary ? `<p class="note">${esc(m.summary)}</p>` : ''}
        <ul class="lessonList">${m.lessons.map(lessonRow).join('') || '<li class="muted">No lessons yet.</li>'}</ul>
        ${editable ? `<form class="inlineForm addLesson" data-module="${esc(m.id)}"><label for="al-${esc(m.id)}">Add a lesson</label><input id="al-${esc(m.id)}" name="title" required maxlength="160" placeholder="Lesson title"><input name="minutes" type="number" min="1" max="120" value="5" aria-label="Minutes"><button class="small" type="submit">Add</button></form>` : ''}</li>`).join('') || '<li class="muted">No modules yet.</li>'}</ol>
      ${editable ? `<form class="inlineForm" id="addModule"><label for="am-title">Add a module</label><input id="am-title" name="title" required maxlength="160" placeholder="Module title"><input name="sourceSection" maxlength="80" placeholder="Source (optional)" aria-label="Source"><button class="small" type="submit">Add</button></form>` : ''}
    </section>
    ${await runHooks(hooks.programme, { ...d, slot: 'sections' })}
    <section class="card"><h2>Qualification and pass policy</h2>
      <p><b>${esc(v.qualification)}</b></p><ul class="plain">${policyText(v).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      ${v.policyNote ? `<p class="note">${esc(v.policyNote)}</p>` : ''}
      ${editable && d.can.programme ? `<details class="edit"><summary>Change the policy</summary><form class="form2" id="policyForm" data-version="${esc(v.id)}">
        <div><label for="pf-q">Qualification</label><input id="pf-q" name="qualification" value="${esc(v.qualification)}" maxlength="120"></div>
        <div><label for="pf-r">Completion</label><select id="pf-r" name="completionRule">${Object.entries(RULE).map(([k, n]) => `<option value="${k}"${k === v.completionRule ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
        <div><label for="pf-p">Pass mark (%)</label><input id="pf-p" name="passMark" type="number" min="1" max="100" value="${v.passMark}"></div>
        <div><label for="pf-a">Attempts before a wait</label><input id="pf-a" name="maxAttempts" type="number" min="1" max="50" value="${v.maxAttempts ?? ''}" placeholder="Unlimited"></div>
        <div><label for="pf-w">Wait (hours)</label><input id="pf-w" name="retakeWaitHours" type="number" min="0" max="720" value="${v.retakeWaitHours}"></div>
        <div><label for="pf-v">Valid for (months)</label><input id="pf-v" name="validityMonths" type="number" min="1" max="120" value="${v.validityMonths ?? ''}" placeholder="No expiry"></div>
        <div><label for="pf-d">Renewal due (days before)</label><input id="pf-d" name="renewalDueDays" type="number" min="0" max="365" value="${v.renewalDueDays}"></div>
        <div><label for="pf-e">Effective from</label><input id="pf-e" name="effectiveDate" type="date" value="${esc(String(v.effectiveDate || '').slice(0, 10))}"></div>
        <div class="wide"><label for="pf-n">Note shown with the policy</label><input id="pf-n" name="policyNote" value="${esc(v.policyNote)}" maxlength="400"></div>
        <div class="wide"><button class="small" type="submit">Save the policy</button></div></form></details>` : ''}
    </section>
    ${d.can.edit || d.can.approve || d.can.programme ? `<section class="card"><h2>This version</h2>
      <p>${badge(v.state)} Edition ${esc(v.edition)}${v.publishedAt ? ` · published ${esc(day(v.publishedAt))}` : ''}${v.effectiveDate ? ` · effective ${esc(day(v.effectiveDate))}` : ''}</p>
      <p class="note">${v.state === 'draft' ? 'A draft can change. Send it for review when it\'s ready: the owner approves it, and once published it never changes.' : v.state === 'review' ? 'Waiting for the programme\'s owner to approve it, or send it back.' : v.state === 'published' ? 'Published versions never change. To change anything, start a new version.' : ''}</p>
      <div class="btnRow">${versionActions(d)}</div>
      ${d.can.programme ? `<form class="inlineForm" id="newVersion" data-programme="${esc(p.id)}"><label for="nv-ed">New version</label><input id="nv-ed" name="edition" required maxlength="40" placeholder="Edition, e.g. ${Number(v.edition) ? Number(v.edition) + 1 : '2028'}"><button class="small" type="submit">Start it</button></form>` : ''}
    </section>` : ''}
    ${d.can.programme ? `<section class="card"><details class="edit"><summary>Programme settings</summary><form class="form2" id="progForm" data-programme="${esc(p.id)}">
      <div><label for="ps-t">Title</label><input id="ps-t" name="title" value="${esc(p.title)}" maxlength="120"></div>
      <div><label for="ps-r">A learner in it is a…</label><input id="ps-r" name="learnerRole" value="${esc(p.learnerRole)}" maxlength="60"></div>
      <div><label for="ps-l">Languages (codes)</label><input id="ps-l" name="locales" value="${esc(p.locales.join(','))}" maxlength="80"></div>
      <div><label for="ps-s">Status</label><select id="ps-s" name="status">${['active', 'archived'].map((s) => `<option${s === p.status ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="wide"><label for="ps-d">Description</label><textarea id="ps-d" name="description" rows="2" maxlength="1000">${esc(p.description)}</textarea></div>
      <div class="wide"><button class="small" type="submit">Save</button></div></form></details></section>` : ''}`;
}

export const views = {
  home: overview,
  async programmes(rest) { return rest ? programmePage(rest) : catalogue(); },
};

export function wire() {
  wireRecord();
  for (const b of document.querySelectorAll('[data-enrol]')) b.onclick = () => act(async () => { await call('enrolments', { method: 'POST', body: { programmeId: b.dataset.enrol } }); toast('Enrolled'); redraw(); }, b);
  $('newProgramme')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => { const r = await call('programmes', { method: 'POST', body: formBody(e.target) }); toast(`Created ${r.programme.title}`); location.hash = `#/programmes/${r.programme.id}`; }, e.submitter);
  });
  $('versionPick')?.addEventListener('change', (e) => { location.hash = `${location.hash.split('?')[0]}?version=${e.target.value}`; });
  const versionId = () => document.querySelector('[data-current-version]')?.dataset.currentVersion;
  for (const b of document.querySelectorAll('[data-state]')) b.onclick = () => {
    const to = b.dataset.state;
    if (to === 'published' && !confirm('Publish this version? Learners move to it for new enrolments, and it can never change afterwards.')) return;
    if (to === 'archived' && !confirm('Archive this version?')) return;
    act(async () => {
      await call(`versions/${versionId()}/state`, { method: 'POST', body: { to } }); toast({ review: 'Sent for review', published: 'Published', draft: 'Sent back to draft', archived: 'Archived' }[to]); redraw();
    }, b);
  };
  $('addModule')?.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`versions/${versionId()}/modules`, { method: 'POST', body: formBody(e.target) }); toast('Module added'); redraw(); }, e.submitter); });
  for (const f of document.querySelectorAll('.addLesson')) f.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`modules/${f.dataset.module}/lessons`, { method: 'POST', body: { ...formBody(f), minutes: Number(f.minutes.value) } }); toast('Lesson added'); redraw(); }, e.submitter); });
  for (const b of document.querySelectorAll('[data-del-module]')) b.onclick = () => { if (confirm('Delete this module and its lessons from the draft?')) act(async () => { await call(`modules/${b.dataset.delModule}`, { method: 'DELETE' }); redraw(); }, b); };
  for (const b of document.querySelectorAll('[data-del-lesson]')) b.onclick = () => { if (confirm('Delete this lesson from the draft?')) act(async () => { await call(`lessons/${b.dataset.delLesson}`, { method: 'DELETE' }); redraw(); }, b); };
  $('policyForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const b = Object.fromEntries([...new FormData(e.target)]);
    for (const k of ['passMark', 'maxAttempts', 'retakeWaitHours', 'validityMonths', 'renewalDueDays']) b[k] = b[k] === '' ? null : Number(b[k]);
    act(async () => { await call(`versions/${e.target.dataset.version}`, { method: 'PUT', body: b }); toast('Policy saved'); redraw(); }, e.submitter);
  });
  $('newVersion')?.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { const r = await call(`programmes/${e.target.dataset.programme}/versions`, { method: 'POST', body: formBody(e.target) }); toast(`Draft ${r.version.edition} started`); location.hash = `#/programmes/${e.target.dataset.programme}?version=${r.version.id}`; }, e.submitter); });
  $('progForm')?.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`programmes/${e.target.dataset.programme}`, { method: 'PUT', body: Object.fromEntries([...new FormData(e.target)]) }); toast('Saved'); redraw(); }, e.submitter); });
  for (const f of hooks.wire) f();
}

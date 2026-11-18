// Assessments and credentials (step 4): taking an assessment, its result with feedback and rule references, assessors' decisions,
// the question bank for editors, and demonstration credentials with their history and a PDF (ASM-01..05, AT-04, AT-08, AT-10).
import { $, S, call, esc, toast, badge, bar, day, when, redraw, act, hooks, loadPdf } from './core.js';
import { clip } from './judgement.js';

const TYPE = { single: 'Single choice', multiple: 'Multiple choice', video: 'Video judgement' };
const pct = (n) => (n === null || n === undefined ? '' : `${n}%`);
const ruleChip = (id, rules = []) => { const r = rules.find((x) => x.id === id); return `<a class="ruleChip${r && r.state !== 'approved' ? ' pending' : ''}" href="#/rules/${encodeURIComponent(id)}" title="${esc(r ? r.title : id)}">${esc(id.replace(/^[A-Z]+-\d{4}-/, ''))}</a>`; };

// ---------------------------------------------------------------- on a programme's page and a person's record
hooks.programme.push(async (d) => {
  if (d.slot === 'progress') {
    const c = d.credential;
    const creds = c ? `<div class="credLine">${badge(c.status)} <a href="#/credential/${esc(c.id)}"><b>${esc(c.qualification)}</b></a> <small class="muted">${esc(c.publicId)}${c.expiresAt ? ` · until ${esc(day(c.expiresAt))}` : ''}</small></div>` : '';
    const list = (d.assessments || []).map((a) => `<li class="assessRow"><a href="#/assessment/${esc(a.id)}"><b>${esc(a.title)}</b><small>${a.questions} questions · pass mark ${d.version.passMark}%${a.attempts.length ? ` · ${a.attempts.map((t) => (t.result === 'open' ? 'in progress' : t.result === 'pending' ? 'with an assessor' : `${t.result === 'pass' ? 'passed' : 'not passed'} ${pct(t.percent)}`)).join(', ')}` : ''}</small></a></li>`).join('');
    return `${creds}${list ? `<h3 class="sub">Assessment</h3><ul class="plain">${list}</ul>` : ''}`;
  }
  if (d.slot === 'sections' && d.can.edit && d.version.state === 'draft') {
    return `<section class="card"><h2>Assessments</h2><ul class="rowList">${(d.assessments || []).map((a) => `<li><a href="#/assessment/${esc(a.id)}"><b>${esc(a.title)}</b><small>${a.questions} questions: edit them</small></a></li>`).join('') || '<li class="muted">None yet.</li>'}</ul>
      <form class="inlineForm" id="addAssessment" data-version="${esc(d.version.id)}"><label for="aa-t">Add an assessment</label><input id="aa-t" name="title" required maxlength="160" placeholder="Knowledge check"><button class="small" type="submit">Add</button></form></section>`;
  }
  return '';
});
hooks.record.push(async (rec) => {
  const creds = rec.credentials || [];
  if (!creds.length && !(rec.attempts || []).length) return '';
  return `<h3 class="sub">Credentials</h3><ul class="credList">${creds.map((c) => `<li><a href="#/credential/${esc(c.id)}"><span class="enrolTop"><b>${esc(c.qualification)}</b>${badge(c.status)}</span>
      <small>${esc(c.publicId)} · ${esc(c.programmeTitle)} ${esc(c.edition)} · issued ${esc(day(c.issuedAt))}${c.expiresAt ? ` · ${c.status === 'expired' ? 'expired' : 'expires'} ${esc(day(c.expiresAt))}` : ''} · demonstration</small></a></li>`).join('') || '<li class="muted">None yet.</li>'}</ul>
    ${(rec.attempts || []).length ? `<h3 class="sub">Assessment attempts</h3><ul class="plain attemptList">${rec.attempts.map((t) => `<li><a href="#/attempt/${esc(t.id)}">${esc(t.title)}</a> ${badge(t.result === 'open' ? 'draft' : t.result, t.result === 'open' ? 'In progress' : null)} <small class="muted">${esc(pct(t.percent))}${t.submittedAt ? ` · ${esc(day(t.submittedAt))}` : ''}</small></li>`).join('')}</ul>` : ''}`;
});
hooks.lesson.push(async (L) => {
  // at the end of the last lesson with content: the way on to the assessment
  if (!L.enrolled || L.nav.next) return '';
  const p = await call(`programmes/${encodeURIComponent(L.programme.id)}`).catch(() => null);
  const a = p?.assessments?.[0];
  return a ? `<p><a class="btnLink" href="#/assessment/${esc(a.id)}">Go to the assessment: ${esc(a.title)}</a></p>` : '';
});

// ---------------------------------------------------------------- an assessment, and taking it
async function assessmentView(id) {
  const d = await call(`assessments/${encodeURIComponent(id)}`);
  const a = d.assessment, may = d.may, p = d.policy;
  const head = `<section class="card"><p class="crumbs"><a href="#/programmes/${esc(a.programmeId)}">Back to the programme</a></p><h1>${esc(a.title)}</h1>
    ${a.description ? `<p>${esc(a.description)}</p>` : ''}
    <ul class="plain"><li>${a.questions} questions</li><li>Pass mark ${p.passMark}%</li><li>${p.maxAttempts ? `${p.maxAttempts} attempts${p.retakeWaitHours ? `, then a ${p.retakeWaitHours}-hour wait` : ''}` : 'Unlimited attempts'}</li><li>Edition ${esc(a.edition)}${a.versionState !== 'published' ? ` (${esc(a.versionState)})` : ''}</li></ul>
    ${d.attempts.length ? `<h3 class="sub">Your attempts</h3><ul class="plain">${d.attempts.map((t) => `<li><a href="#/attempt/${esc(t.id)}">${esc(day(t.startedAt))}</a> ${badge(t.result === 'open' ? 'draft' : t.result, t.result === 'open' ? 'In progress' : null)} ${esc(pct(t.percent))}</li>`).join('')}</ul>` : ''}
    ${may.ok ? `<button class="primary" type="button" id="startAttempt" data-id="${esc(a.id)}">${may.resume ? 'Carry on with your attempt' : 'Start the assessment'}</button>` : `<p class="note">${esc(may.why)}</p>`}</section>`;
  if (!d.can.edit && !d.questions.length) return head;
  return `${head}<section class="card"><h2>Questions</h2><p class="note">Editors only. A published version's questions never change: a new version copies them.</p>
    <ol class="qList">${d.questions.map((q) => `<li><p><b>${esc(q.prompt)}</b> <small class="muted">${esc(TYPE[q.type])}${q.needsAssessor ? ' · an assessor confirms it' : ''}</small></p>
      <ul class="plain">${q.options.map((o) => `<li>${o.correct ? '✓' : '·'} ${esc(o.text)}</li>`).join('')}</ul>
      ${q.rules.length ? `<p class="lpRules"><span>Rules</span>${q.rules.map((r) => ruleChip(r, d.rules)).join('')}</p>` : ''}${q.reviewNote ? `<p class="reviewNote"><b>Under review</b> ${esc(q.reviewNote)}</p>` : ''}
      ${d.can.edit ? `<button class="small" type="button" data-del-q="${esc(q.id)}">Delete</button>` : ''}</li>`).join('') || '<li class="muted">No questions yet.</li>'}</ol>
    ${d.can.edit ? `<details class="edit"><summary>Add a question</summary><form class="form2" id="addQuestion" data-id="${esc(a.id)}">
      <div class="wide"><label for="aq-p">Question</label><textarea id="aq-p" name="prompt" rows="2" required maxlength="1000"></textarea></div>
      <div><label for="aq-t">Type</label><select id="aq-t" name="type"><option value="single">Single choice</option><option value="multiple">Multiple choice</option><option value="video">Video judgement (a burpee clip)</option></select></div>
      <div><label for="aq-v">Clip (video judgement)</label><select id="aq-v" name="variant"><option value="good">A good burpee</option><option value="noJump">No jump</option><option value="shallow">Chest not to the ground</option><option value="noExtension">Hips not extended</option></select></div>
      <div class="wide"><label for="aq-o">Answers, one per line: start the right ones with *</label><textarea id="aq-o" name="options" rows="4" required placeholder="*The right answer&#10;A wrong answer"></textarea></div>
      <div><label for="aq-r">Rules (ids, comma separated)</label><input id="aq-r" name="rules" placeholder="OCR-2026-3.17.4"></div>
      <div><label class="checkLine"><input type="checkbox" name="needsAssessor"> An assessor confirms the answer (video)</label></div>
      <div class="wide"><label for="aq-f">Feedback shown after the attempt</label><textarea id="aq-f" name="feedback" rows="2" maxlength="1000"></textarea></div>
      <div class="wide"><button class="small" type="submit">Add the question</button></div></form></details>` : ''}</section>`;
}

function questionCard(q, i, rules, done) {
  const input = q.type === 'multiple' ? 'checkbox' : 'radio', a = q.answer;
  const chosen = new Set(a?.chosen || []);
  const mark = (o) => (!done ? '' : o.correct ? ' right' : chosen.has(o.id) ? ' wrong' : '');
  return `<fieldset class="qCard${done ? (a?.correct === true ? ' ok' : a?.correct === false ? ' bad' : ' wait') : ''}" data-q="${esc(q.id)}" data-type="${esc(q.type)}">
    <legend><span class="qNo">${i + 1}</span>${esc(q.prompt)}</legend>
    ${q.type === 'multiple' && !done ? '<p class="note">Choose all that apply.</p>' : ''}
    ${q.clip ? `<div class="clipHolder" data-variant="${esc(q.clip.variant)}"></div>` : ''}
    <div class="qOptions">${q.options.map((o) => `<label class="qOpt${mark(o)}"><input type="${input}" name="q-${esc(q.id)}" value="${esc(o.id)}"${chosen.has(o.id) ? ' checked' : ''}${done ? ' disabled' : ''}><span>${esc(o.text)}</span></label>`).join('')}</div>
    ${q.needsAssessor ? (done ? (a?.reason ? `<p class="note">Your reasons: ${esc(a.reason)}</p>` : '') : `<label class="qReason">Why? (an assessor reads this)<textarea name="reason-${esc(q.id)}" rows="2" maxlength="1000"></textarea></label>`) : ''}
    ${done ? `<p class="qResult">${a?.correct === true ? '<b class="okText">Right</b>' : a?.correct === false ? '<b class="badText">Not right</b>' : '<b class="waitText">Waiting for an assessor</b>'}${a?.decided ? ' (assessor\'s decision)' : ''}</p>${q.feedback ? `<p>${esc(q.feedback)}</p>` : ''}` : ''}
    ${q.rules.length ? `<p class="lpRules"><span>Rules</span>${q.rules.map((r) => ruleChip(r, rules)).join('')}</p>` : ''}
    ${q.reviewNote ? `<p class="reviewNote"><b>Under review</b> ${esc(q.reviewNote)}</p>` : ''}
  </fieldset>`;
}
async function attemptView(id) {
  const { attempt: t, rules, credential: c } = await call(`attempts/${encodeURIComponent(id)}`);
  const done = t.result !== 'open';
  const head = `<section class="card"><p class="crumbs"><a href="#/assessment/${esc(t.assessmentId)}">${esc(t.title)}</a> · ${esc(t.programmeTitle)}</p>
    <h1>${done ? 'Your result' : esc(t.title)}</h1>${t.person ? `<p class="muted">${esc(t.person.name)} · ${esc(t.person.publicId)}</p>` : ''}
    ${done ? `<p class="bigResult">${badge(t.result)} <b>${esc(pct(t.percent))}</b> <span class="muted">(${t.score} of ${t.maxScore}; pass mark ${t.passMark}%)</span></p>${bar(t.score || 0, t.maxScore || 1)}
      ${t.result === 'pending' ? '<p>An assessor checks your video judgement; your result follows.</p>' : ''}${t.assessorNote ? `<p class="note">Assessor: ${esc(t.assessorNote)}</p>` : ''}
      ${c ? `<p class="credIssued">${badge(c.status)} <b>${esc(c.qualification)}</b> issued: <a href="#/credential/${esc(c.id)}">see the credential</a></p>` : ''}`
    : `<p class="note">Answer every question, then submit. You can't change your answers once submitted.</p>`}</section>`;
  return `${head}<form id="attemptForm" data-id="${esc(t.id)}">${t.questions.map((q, i) => questionCard(q, i, rules, done)).join('')}
    ${done ? '' : '<div class="card"><button class="primary" type="submit">Submit my answers</button></div>'}</form>`;
}

// ---------------------------------------------------------------- assessors
async function assessingView(rest) {
  if (rest) {
    const { attempt: t, rules } = await call(`attempts/${encodeURIComponent(rest)}`);
    const waiting = t.questions.filter((q) => q.answer && q.answer.correct === null);
    return `<section class="card"><p class="crumbs"><a href="#/assessing">Assessing</a></p><h1>${esc(t.title)}</h1><p class="muted">${esc(t.person?.name || '')} · ${esc(t.person?.publicId || '')} · submitted ${esc(when(t.submittedAt))}</p></section>
      <form id="decideForm" data-id="${esc(t.id)}">${t.questions.map((q, i) => `${questionCard({ ...q, feedback: '' }, i, rules, true)}${q.answer && q.answer.correct === null ? `<div class="card decideBox"><p><b>Your decision on question ${i + 1}</b></p><label class="qOpt"><input type="radio" name="d-${esc(q.id)}" value="true" required><span>Right: the call and the reasons meet the standard</span></label><label class="qOpt"><input type="radio" name="d-${esc(q.id)}" value="false"><span>Not right</span></label></div>` : ''}`).join('')}
      ${waiting.length ? '<section class="card"><label class="qReason">A note for the learner (optional)<textarea name="note" rows="2" maxlength="1000"></textarea></label><button class="primary" type="submit">Record my decision</button></section>' : ''}</form>`;
  }
  const { attempts } = await call('assessing');
  return `<section class="card"><h1>Assessing</h1><p class="note">Answers waiting for an assessor's decision. Every decision is in the audit log.</p>
    <ul class="rowList">${attempts.map((t) => `<li><a href="#/assessing/${esc(t.id)}"><b>${esc(t.person.name)} · ${esc(t.title)}</b><small>${esc(t.person.publicId)} · submitted ${esc(when(t.submittedAt))}</small></a></li>`).join('') || '<li class="muted">Nothing waiting.</li>'}</ul></section>`;
}

// ---------------------------------------------------------------- a credential
async function credentialPdf(c) {
  const JsPDF = await loadPdf(), doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setTextColor(232, 232, 232); doc.setFont('helvetica', 'bold'); doc.setFontSize(76); doc.text('DEMONSTRATION', 148, 125, { align: 'center', angle: 22 });
  doc.setDrawColor(226, 35, 26); doc.setLineWidth(1.2); doc.rect(12, 12, 273, 186);
  doc.setTextColor(20, 20, 20); doc.setFontSize(12); doc.text('SPARTANREFEREE LEARNING PLATFORM', 148, 32, { align: 'center' });
  doc.setFontSize(30); doc.text(c.qualification, 148, 62, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.text('awarded to', 148, 78, { align: 'center' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.text(c.personName || S.me.person.legalName, 148, 94, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
  const lines = [`Credential ${c.publicId}`, `${c.programmeTitle}, ${c.edition} edition`, `Issued ${day(c.issuedAt)}${c.expiresAt ? ` · valid until ${day(c.expiresAt)}` : ''}`, `Status: ${c.status}`];
  lines.forEach((l, i) => doc.text(l, 148, 116 + i * 8, { align: 'center' }));
  doc.setTextColor(226, 35, 26); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('DEMONSTRATION CREDENTIAL: not an official Spartan qualification. Issued by a prototype with sample policies.', 148, 180, { align: 'center' });
  doc.save(`${c.publicId}.pdf`);
}
async function credentialView(id) {
  const { credential: c, history, canChange } = await call(`credentials/${encodeURIComponent(id)}`);
  return `<section class="card certificate"><div class="watermark" aria-hidden="true">DEMONSTRATION</div>
      <p class="certTop">SpartanReferee learning platform</p><h1>${esc(c.qualification)}</h1><p class="certName">${esc(c.personName)}</p>
      <p>${badge(c.status)} <b>${esc(c.publicId)}</b></p>
      <ul class="plain"><li>${esc(c.programmeTitle)}, ${esc(c.edition)} edition</li><li>Issued ${esc(day(c.issuedAt))}</li><li>${c.expiresAt ? `${c.status === 'expired' ? 'Expired' : 'Valid until'} ${esc(day(c.expiresAt))}` : 'No expiry'}</li>${c.reason ? `<li>${esc(c.reason)}</li>` : ''}</ul>
      <p class="demoNote">Demonstration credential: not an official Spartan qualification.</p>
      <div class="btnRow"><button class="small" type="button" id="credPdf">Download the PDF</button>${c.attemptId ? `<a class="btnLink" href="#/attempt/${esc(c.attemptId)}">The attempt it was earned with</a>` : ''}</div></section>
    <section class="card"><h2>History</h2><ul class="rowList">${history.map((h) => `<li><span><b>${esc(h.action.replace('credential.', ''))}</b><small>${esc(when(h.at))} · by ${esc(h.by)}${h.summary.reason ? ` · ${esc(h.summary.reason)}` : ''}${h.summary.after ? ` · ${esc(h.summary.before)} → ${esc(h.summary.after)}` : ''}</small></span></li>`).join('') || '<li class="muted">No changes.</li>'}</ul>
      ${canChange && c.storedStatus !== 'revoked' ? `<form class="form2" id="credStatus" data-id="${esc(c.id)}"><div><label for="cs-s">Change status</label><select id="cs-s" name="status">${['active', 'suspended', 'revoked'].filter((s) => s !== c.storedStatus).map((s) => `<option>${s}</option>`).join('')}</select></div>
        <div><label for="cs-r">Why (kept in the audit log)</label><input id="cs-r" name="reason" required maxlength="400"></div><div class="wide"><button class="small" type="submit">Change it</button></div></form>` : ''}</section>`;
}

export const views = { assessment: assessmentView, attempt: attemptView, assessing: assessingView, credential: credentialView };

export function wire() {
  for (const h of document.querySelectorAll('.clipHolder')) clip(h, h.dataset.variant);
  $('startAttempt')?.addEventListener('click', (e) => act(async () => { const r = await call(`assessments/${e.currentTarget.dataset.id}/attempts`, { method: 'POST' }); location.hash = `#/attempt/${r.attempt.id}`; }, e.currentTarget));
  $('attemptForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target, answers = {};
    for (const card of form.querySelectorAll('.qCard')) {
      const qid = card.dataset.q, chosen = [...card.querySelectorAll('input:checked')].map((x) => x.value);
      answers[qid] = { chosen, reason: card.querySelector('textarea')?.value || '' };
    }
    const blank = Object.values(answers).filter((a) => !a.chosen.length).length;
    if (blank && !confirm(`${blank} question${blank === 1 ? ' has' : 's have'} no answer. Submit anyway?`)) return;
    act(async () => {
      const r = await call(`attempts/${form.dataset.id}/submit`, { method: 'POST', body: { answers } });
      toast(r.attempt.result === 'pass' ? (r.credential ? 'Passed: credential issued' : 'Passed') : r.attempt.result === 'pending' ? 'Submitted: an assessor checks it next' : 'Submitted');
      redraw(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }, e.submitter);
  });
  $('decideForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target, decisions = {};
    for (const r of form.querySelectorAll('input[type=radio][name^="d-"]:checked')) decisions[r.name.slice(2)] = r.value === 'true';
    act(async () => { const r = await call(`attempts/${form.dataset.id}/decide`, { method: 'POST', body: { decisions, note: form.note?.value || '' } }); toast(`Recorded: ${r.result === 'pass' ? 'passed' : 'not passed'} (${r.percent}%)`); location.hash = '#/assessing'; }, e.submitter);
  });
  $('credPdf')?.addEventListener('click', (e) => act(async () => { const { credential } = await call(`credentials/${location.hash.split('/')[2]}`); await credentialPdf(credential); }, e.currentTarget));
  $('credStatus')?.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`credentials/${e.target.dataset.id}/status`, { method: 'POST', body: { status: e.target.status.value, reason: e.target.reason.value } }); toast('Credential changed'); redraw(); }, e.submitter); });
  $('addAssessment')?.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { const r = await call(`versions/${e.target.dataset.version}/assessments`, { method: 'POST', body: { title: e.target.title.value } }); location.hash = `#/assessment/${r.assessment.id}`; }, e.submitter); });
  $('addQuestion')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, options = f.options.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ text: l.replace(/^\*\s*/, ''), correct: l.startsWith('*') }));
    act(async () => {
      await call(`assessments/${f.dataset.id}/questions`, { method: 'POST', body: { prompt: f.prompt.value, type: f.type.value, options, rules: f.rules.value, feedback: f.feedback.value, needsAssessor: f.needsAssessor.checked, clip: { variant: f.variant.value } } });
      toast('Question added'); redraw();
    }, e.submitter);
  });
  for (const b of document.querySelectorAll('[data-del-q]')) b.onclick = () => { if (confirm('Delete this question from the draft?')) act(async () => { await call(`questions/${b.dataset.delQ}`, { method: 'DELETE' }); redraw(); }, b); };
}

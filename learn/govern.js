// Governance (step 5): rule references and their versions, what each affects, review items, and the handbook with its PDF
// (RUL-01..04, LRN-06, AT-06, AT-07). Rule chips on lessons and questions lead here.
import { $, call, esc, toast, badge, day, when, redraw, act, hooks, loadPdf, LANG } from './core.js';

const KIND = { rule_change: 'Rule change', dispute: 'The sources disagree' };
const stateBadge = (r) => badge(r.state === 'baseline' ? 'preview' : r.state === 'under_review' ? 'under_review' : r.state === 'draft' ? 'draft' : 'approved', r.stateText);

// ---------------------------------------------------------------- the handbook on a programme's page, and review notices on a lesson
hooks.programme.push(async (d) => {
  if (d.slot !== 'sections') return '';
  const locales = d.programme.locales;
  return `<section class="card"><h2>Handbook</h2><p class="note">The programme as a printable handbook: every lesson's points, the rule references they cite, and what's under review, stamped with the edition, language, approval state and date.</p>
    <div class="btnRow">${locales.map((l) => `<a class="btnLink" href="#/handbook/${esc(d.programme.id)}?locale=${esc(l)}">${esc(LANG[l] || l)}</a>`).join('')}</div>
    <p class="note"><a href="#/rules?programme=${esc(d.programme.id)}">Rule references</a> · <a href="#/reviews?programme=${esc(d.programme.id)}">Review items</a></p></section>`;
});

// ---------------------------------------------------------------- rule references
async function rulesView(rest) {
  if (rest) return ruleView(rest);
  const q = new URLSearchParams(location.hash.split('?')[1] || ''), pid = q.get('programme') || 'ocr-referee';
  const d = await call(`rules?programme=${encodeURIComponent(pid)}`);
  return `<section class="card"><h1>Rule references</h1><p class="note">The sections of the source documents that lessons and questions teach. Each change is a new version, approved before it's current, and flags everything that cites it for review.</p>
      <ul class="plain docList">${d.documents.map((x) => `<li><b>${esc(x.title)} ${esc(x.edition)}</b> ${badge(x.approval === 'baseline' ? 'preview' : x.approval, x.approvalText)}<br><small class="muted">${esc(x.note)}</small></li>`).join('')}</ul></section>
    <section class="card"><ul class="rowList">${d.rules.map((r) => `<li><a href="#/rules/${encodeURIComponent(r.id)}"><b>${esc(r.section)} ${esc(r.title)}</b><small>${esc(r.id)} · v${r.versionNo} · cited by ${r.links} ${r.links === 1 ? 'item' : 'items'}${r.draftChange ? ' · a change is drafted' : ''}</small></a>${stateBadge(r)}</li>`).join('') || '<li class="muted">None yet.</li>'}</ul></section>`;
}
async function ruleView(id) {
  const d = await call(`rules/${encodeURIComponent(id)}`), r = d.rule;
  const draft = d.versions.find((v) => v.ruleState === 'draft');
  return `<section class="card"><p class="crumbs"><a href="#/rules?programme=${esc(r.programmeId)}">Rule references</a></p>
      <h1>${esc(r.section)} ${esc(r.title)}</h1><p class="badges">${stateBadge(r)}${badge('draft', `v${r.versionNo}`)}</p>
      <blockquote class="excerpt">${esc(r.excerpt)}</blockquote><p class="note">${esc(r.citation)}${r.effectiveDate ? ` · effective ${esc(day(r.effectiveDate))}` : ''}</p></section>
    ${d.reviews.length ? `<section class="card"><h2>Review items</h2><ul class="rowList">${d.reviews.map((i) => `<li><span><b>${esc(i.title)}</b><small>${esc(KIND[i.kind])} · ${esc(day(i.createdAt))}${i.resolution ? ` · ${esc(i.resolution)}` : ''}</small></span>${badge(i.state)}</li>`).join('')}</ul><p class="note"><a href="#/reviews?programme=${esc(r.programmeId)}">All review items</a></p></section>` : ''}
    <section class="card"><h2>Cited by</h2><ul class="rowList">${d.links.map((l) => `<li><a href="${l.type === 'lesson' ? `#/lesson/${esc(l.id)}` : `#/assessment/${esc(l.assessmentId)}`}"><b>${esc(l.title)}</b><small>${l.type === 'lesson' ? 'Lesson' : 'Question'} · ${esc(l.edition)} (${esc(l.versionState)}) · written against v${l.ruleVersion}</small></a></li>`).join('') || '<li class="muted">Nothing cites it yet.</li>'}</ul></section>
    <section class="card"><h2>Versions</h2><ul class="rowList">${d.versions.map((v) => `<li><span><b>v${v.versionNo}: ${esc(v.title)}</b><small>${esc(v.ruleState)} · ${esc(day(v.createdAt))}${v.changeNote ? ` · ${esc(v.changeNote)}` : ''}</small></span>
      ${v.ruleState === 'draft' && d.can.approve ? `<span class="rowBtns"><button class="primary small" type="button" data-rule-state="approved" data-key="${esc(v.key)}">Approve</button><button class="small" type="button" data-rule-state="withdrawn" data-key="${esc(v.key)}">Withdraw</button></span>` : ''}</li>`).join('')}</ul>
      ${d.can.draft && !draft ? `<details class="edit"><summary>Draft a change</summary><p class="note">Published lessons and questions stay exactly as they are: everything that cites this rule gets a review item, for someone to update or confirm.</p>
        <form class="form2" id="ruleChange" data-id="${esc(r.id)}"><div class="wide"><label for="rc-e">New text</label><textarea id="rc-e" name="excerpt" rows="4">${esc(r.excerpt)}</textarea></div>
        <div><label for="rc-t">Title</label><input id="rc-t" name="title" value="${esc(r.title)}" maxlength="200"></div><div><label for="rc-d">Effective from</label><input id="rc-d" name="effectiveDate" type="date"></div>
        <div class="wide"><label for="rc-n">What changed (goes on the review item)</label><input id="rc-n" name="changeNote" required maxlength="600"></div>
        <div class="wide"><button class="small" type="submit">Draft the change</button></div></form></details>` : draft ? '<p class="note">A change is drafted: it needs approving (or withdrawing) before another.</p>' : ''}</section>`;
}

// ---------------------------------------------------------------- review items
async function reviewsView() {
  const q = new URLSearchParams(location.hash.split('?')[1] || ''), pid = q.get('programme') || '', state = q.get('state') || 'open';
  const d = await call(`reviews?state=${state}${pid ? `&programme=${encodeURIComponent(pid)}` : ''}`);
  const tab = (s, label) => `<a class="${s === state ? 'on' : ''}" href="#/reviews?state=${s}${pid ? `&programme=${encodeURIComponent(pid)}` : ''}">${label}</a>`;
  return `<section class="card"><h1>Review items</h1><p class="note">Raised when a rule changes (listing what it affects) or when the source documents disagree. Nothing published changes by itself: an owner resolves each one.</p>
      <nav class="tabs2">${tab('open', 'Open')}${tab('resolved', 'Resolved')}${tab('dismissed', 'Dismissed')}</nav></section>
    ${d.reviews.map((i) => `<section class="card reviewCard"><p class="badges">${badge(i.state)}${badge(i.kind === 'dispute' ? 'under_review' : 'review', KIND[i.kind])}${i.ruleId ? `<a class="ruleChip" href="#/rules/${encodeURIComponent(i.ruleId)}">${esc(i.ruleId.replace(/^[A-Z]+-\d{4}-/, ''))}</a>` : ''}</p>
      <h2>${esc(i.title)}</h2><p>${esc(i.detail)}</p>
      ${i.affected.length ? `<h3 class="sub">Affects</h3><ul class="plain">${i.affected.map((a) => `<li><a href="${a.type === 'lesson' ? `#/lesson/${esc(a.id)}` : `#/assessment/${esc(a.assessmentId)}`}">${esc(a.title)}</a> <small class="muted">${a.type} · ${esc(a.edition)} ${esc(a.versionState || '')}</small></li>`).join('')}</ul>` : '<p class="note">Nothing cites it yet.</p>'}
      ${i.state !== 'open' ? `<p class="note">${esc(i.resolution)} · ${esc(day(i.resolvedAt))}</p>` : d.can.decide ? `<form class="inlineForm reviewForm" data-id="${esc(i.id)}"><label for="rv-${esc(i.id)}">Resolution</label><input id="rv-${esc(i.id)}" name="resolution" required maxlength="1000" placeholder="e.g. 2027 ruling: the rulebook stands; slide 4.5 updated"><button class="primary small" type="submit" value="resolved">Resolve</button><button class="small" type="submit" value="dismissed">Dismiss</button></form>` : ''}
    </section>`).join('') || '<section class="card"><p class="muted">Nothing here.</p></section>'}`;
}

// ---------------------------------------------------------------- the handbook (AT-06)
let H = null;
async function handbookView(rest) {
  const q = new URLSearchParams(location.hash.split('?')[1] || ''), locale = q.get('locale') || 'en';
  H = await call(`handbook/${encodeURIComponent(rest)}?locale=${encodeURIComponent(locale)}`);
  const v = H.version;
  return `<section class="card"><p class="crumbs"><a href="#/programmes/${esc(H.programme.id)}">${esc(H.programme.title)}</a></p><h1>Handbook</h1>
      <ul class="plain stampList"><li><b>Programme</b> ${esc(H.programme.title)}</li><li><b>Edition</b> ${esc(v.edition)} (${esc(v.state)}${v.effectiveDate ? `, effective ${esc(day(v.effectiveDate))}` : ''})</li>
        <li><b>Language</b> ${esc(LANG[H.locale] || H.locale)}: ${esc(H.language.state)}</li><li><b>Made</b> ${esc(when(H.generatedAt))}</li>
        <li><b>Status</b> ${H.programme.demo ? 'Demonstration content, built on the 2026 baseline: not approved 2027 rules' : 'Approved'}</li></ul>
      <button class="primary" type="button" id="handbookPdf">Download the PDF</button></section>
    ${H.sections.map((m, mi) => `<section class="card"><h2>${mi + 1}. ${esc(m.title)}</h2>${m.summary ? `<p class="note">${esc(m.summary)}</p>` : ''}
      ${m.lessons.map((l) => `<h3 class="sub">${esc(l.title)}${l.preview ? ' (preview translation)' : ''}</h3>${l.written ? l.slides.map((s) => `<p><b>${esc(s.heading)}</b></p><ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>${s.review ? `<p class="reviewNote"><b>Under review</b> ${esc(s.review)}</p>` : ''}`).join('') : '<p class="muted">Being written.</p>'}`).join('')}</section>`).join('')}
    <section class="card"><h2>Rule references</h2><ul class="plain">${H.rules.map((r) => `<li><b>${esc(r.section)} ${esc(r.title)}</b> <small class="muted">${esc(r.stateText)}</small><br>${esc(r.excerpt || '')}</li>`).join('')}</ul></section>
    ${H.reviews.length ? `<section class="card"><h2>Under review</h2><ul class="plain">${H.reviews.map((i) => `<li>${esc(i.title)} <small class="muted">${esc(KIND[i.kind])}</small></li>`).join('')}</ul></section>` : ''}`;
}
async function handbookPdf() {
  const JsPDF = await loadPdf(), doc = new JsPDF({ unit: 'mm', format: 'a4' }), v = H.version;
  const W = 210, M = 18, width = W - 2 * M;
  const stamp = `${H.programme.title} · ${v.edition} edition (${v.state}) · ${LANG[H.locale] || H.locale}: ${H.language.state} · made ${day(H.generatedAt)}`;
  let y = 0, page = 1;
  const header = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
    doc.text(doc.splitTextToSize(stamp, width), M, 10);
    doc.text(`DEMONSTRATION · page ${page}`, W - M, 290, { align: 'right' }); doc.text(`Version ${v.id.slice(0, 8)}`, M, 290);
    doc.setTextColor(20, 20, 20); y = 22;
  };
  const room = (h) => { if (y + h > 280) { doc.addPage(); page++; header(); } };
  const para = (t, size = 10.5, style = 'normal', gap = 1.5) => { doc.setFont('helvetica', style); doc.setFontSize(size); for (const line of doc.splitTextToSize(String(t), width)) { room(size * 0.45); doc.text(line, M, y); y += size * 0.45; } y += gap; };
  // the cover
  header();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26); y = 60; doc.text(doc.splitTextToSize(`${H.programme.title}`, width), M, y); y += 22;
  doc.setFontSize(16); doc.text('Referee handbook', M, y); y += 14;
  para(`Edition ${v.edition} · ${v.state}${v.effectiveDate ? ` · effective ${day(v.effectiveDate)}` : ''}`, 12);
  para(`Language: ${LANG[H.locale] || H.locale} (${H.language.state})`, 12);
  para(`Made ${when(H.generatedAt)} from version ${v.id}`, 10);
  y += 6; doc.setTextColor(226, 35, 26);
  para('DEMONSTRATION: built on the 2026 baseline documents. Not approved 2027 rules, and not an official Spartan publication.', 11, 'bold');
  doc.setTextColor(20, 20, 20);
  para(`Sources: ${H.documents.map((x) => `${x.title} ${x.edition} (${x.approval})`).join('; ')}`, 9);
  // the lessons
  H.sections.forEach((m, mi) => {
    doc.addPage(); page++; header();
    para(`${mi + 1}. ${m.title}`, 16, 'bold', 3); if (m.summary) para(m.summary, 10, 'italic', 3);
    for (const l of m.lessons) {
      room(16); para(`${l.title}${l.preview ? ' (preview translation)' : ''}`, 12.5, 'bold', 2);
      if (!l.written) { para('Being written.', 10, 'italic', 3); continue; }
      for (const s of l.slides) {
        para(s.heading, 10.5, 'bold', 1);
        for (const p of s.points) para(`•  ${p}`, 10, 'normal', 0.5);
        if (s.review) { doc.setTextColor(170, 110, 0); para(`Under review: ${s.review.replace(/^(Under review for 2027|En revisión para 2027):\s*/, '')}`, 9, 'italic', 1); doc.setTextColor(20, 20, 20); }
        y += 1.5;
      }
      para(`Content ${l.locale} v${l.contentVersion} · ${l.sourceHash} · ${l.sources}`, 7.5, 'normal', 4);
    }
  });
  // the rules and open items
  doc.addPage(); page++; header();
  para('Rule references', 16, 'bold', 3);
  for (const r of H.rules) { para(`${r.section} ${r.title}  (${r.stateText})`, 10.5, 'bold', 0.5); para(r.excerpt || '', 9.5, 'normal', 3); }
  if (H.reviews.length) { para('Under review', 16, 'bold', 3); for (const i of H.reviews) para(`•  ${i.title}`, 10, 'normal', 1); }
  doc.save(`${H.programme.id}-${v.edition}-${H.locale}-handbook.pdf`);
}

export const views = { rules: rulesView, reviews: reviewsView, handbook: handbookView };

export function wire() {
  $('handbookPdf')?.addEventListener('click', (e) => act(() => handbookPdf(), e.currentTarget));
  $('ruleChange')?.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`rules/${encodeURIComponent(e.target.dataset.id)}/versions`, { method: 'POST', body: Object.fromEntries([...new FormData(e.target)]) }); toast('Change drafted: review items raised'); redraw(); }, e.submitter); });
  for (const b of document.querySelectorAll('[data-rule-state]')) b.onclick = () => act(async () => { await call(`rule-versions/${b.dataset.key}/state`, { method: 'POST', body: { to: b.dataset.ruleState } }); toast(b.dataset.ruleState === 'approved' ? 'Approved: it\'s the current version' : 'Withdrawn'); redraw(); }, b);
  for (const f of document.querySelectorAll('.reviewForm')) f.addEventListener('submit', (e) => { e.preventDefault(); act(async () => { await call(`reviews/${f.dataset.id}`, { method: 'POST', body: { state: e.submitter.value, resolution: f.resolution.value } }); toast(e.submitter.value === 'resolved' ? 'Resolved' : 'Dismissed'); redraw(); }, e.submitter); });
}

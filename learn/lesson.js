// The lesson player (step 3), phone first: slides with a figure, narration through the media adapter (Azure narration, the device's own
// voice, or captions only), captions and a full transcript, keyboard controls, a bookmark, completion, a language switcher with clear
// Preview translation labels, and for editors the content versions with writing, review and approval (LRN-02..05, LRN-07, AT-04, AT-05).
import { $, call, esc, toast, fail, badge, day, redraw, act, hooks, runHooks, LANG } from './core.js';

// ---------------------------------------------------------------- figures: simple drawings, in the page's own colours
const svg = (body) => `<svg class="fig" viewBox="0 0 240 120" role="img" aria-hidden="true">${body}</svg>`;
const ground = '<line x1="8" y1="104" x2="232" y2="104" class="f-ground"/>';
const person = (x, arm = 'up') => `<g class="f-person"><circle cx="${x}" cy="40" r="7"/><line x1="${x}" y1="47" x2="${x}" y2="76"/><line x1="${x}" y1="76" x2="${x - 9}" y2="102"/><line x1="${x}" y1="76" x2="${x + 9}" y2="102"/>${arm === 'up' ? `<line x1="${x}" y1="54" x2="${x + 16}" y2="38"/><line x1="${x}" y1="54" x2="${x - 12}" y2="64"/>` : `<line x1="${x}" y1="54" x2="${x + 14}" y2="66"/><line x1="${x}" y1="54" x2="${x - 14}" y2="66"/>`}</g>`;
const target = (x, spear = 'in') => `<g class="f-target"><rect x="${x}" y="30" width="34" height="56" rx="3"/><line x1="${x + 17}" y1="86" x2="${x + 17}" y2="104"/><circle cx="${x + 17}" cy="58" r="10" class="f-ring"/></g>${spear === 'in' ? `<line x1="${x - 46}" y1="56" x2="${x + 14}" y2="58" class="f-spear"/>` : spear === 'ground' ? `<line x1="${x - 40}" y1="104" x2="${x + 8}" y2="62" class="f-spear f-bad"/>` : ''}`;
const FIGURES = {
  lane: svg(`${ground}${person(40)}<line x1="62" y1="88" x2="62" y2="104" class="f-barrier"/><line x1="74" y1="34" x2="150" y2="50" class="f-spear f-flight"/>${target(176, 'none')}`),
  barrier: svg(`${ground}${person(44)}<rect x="60" y="92" width="6" height="12" class="f-barrier-box"/><text x="63" y="88" class="f-label">barrier</text>${target(176, 'none')}`),
  release: svg(`${ground}${person(52)}<line x1="66" y1="40" x2="104" y2="30" class="f-spear"/><path d="M110 30 l14 -2 m-14 2 l12 6" class="f-arrow"/><text x="120" y="22" class="f-label">released forward: an attempt</text>${target(184, 'none')}`),
  target: svg(`${ground}${target(70, 'in')}<text x="66" y="22" class="f-label f-ok">pass</text>${target(176, 'ground')}<text x="166" y="22" class="f-label f-bad">fail</text>`),
  distance: svg(`${ground}<line x1="40" y1="88" x2="40" y2="104" class="f-barrier"/>${person(150, 'down')}<path d="M44 96 H140" class="f-arrow"/><text x="66" y="90" class="f-label">2 m away</text>${target(196, 'none')}`),
  burpee: svg(`${ground}<g class="f-person"><circle cx="40" cy="92" r="6"/><line x1="46" y1="96" x2="96" y2="100"/></g><text x="30" y="80" class="f-label">chest down</text>${person(140)}<text x="128" y="24" class="f-label">jump, hands up</text><text x="190" y="60" class="f-big">30</text>`),
  referee: svg(`${ground}${person(40)}<g class="f-ref"><circle cx="120" cy="52" r="7"/><line x1="120" y1="59" x2="120" y2="84"/><line x1="120" y1="84" x2="112" y2="104"/><line x1="120" y1="84" x2="128" y2="104"/><line x1="120" y1="66" x2="138" y2="58"/></g><path d="M128 46 q30 -16 56 0" class="f-arrow"/>${target(186, 'none')}<text x="104" y="24" class="f-label">clear view</text>`),
  summary: svg('<g class="f-check"><circle cx="120" cy="58" r="34"/><path d="M104 58 l12 12 l22 -24"/></g>'),
  placeholder: svg('<rect x="70" y="24" width="100" height="70" rx="6" class="f-target"/><text x="120" y="64" class="f-label" text-anchor="middle">sample</text>'),
};

// ---------------------------------------------------------------- the player
let L = null, slide = 0, playing = false, captions = true, audio = null, saveTimer = null;
const lessonUrl = (id, q = '') => `#/lesson/${id}${q ? `?${q}` : ''}`;
function stopVoice() {
  playing = false;
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
async function speak(i) {
  const c = L.content, m = L.media, text = c.slides[i]?.narration || '';
  if (!text || m.kind === 'text') { playing = false; drawControls(); return; }
  playing = true; drawControls();
  const next = () => { if (!playing) return; if (slide < c.slides.length - 1) { go(slide + 1, true); } else { playing = false; drawControls(); } };
  if (m.kind === 'audio') {
    try {
      const { url } = await call(`content/${c.id}/narration/${i}`);
      if (!playing || slide !== i) return;
      audio = new Audio(url); audio.onended = next; audio.onerror = () => { playing = false; drawControls(); fail('The narration couldn\'t play: the captions are below'); };
      await audio.play();
    } catch (e) { playing = false; drawControls(); fail(e.message); }
    return;
  }
  // the device reads it aloud itself
  if (!('speechSynthesis' in window)) { playing = false; drawControls(); fail('This device can\'t read aloud: the captions are below'); return; }
  const u = new SpeechSynthesisUtterance(text); u.lang = m.lang; u.rate = 1;
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').startsWith(m.lang.slice(0, 2)));
  if (v) u.voice = v;
  u.onend = next; speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function go(i, keepPlaying = false) {
  const n = L.content.slides.length;
  const was = playing && keepPlaying;
  stopVoice();
  slide = Math.max(0, Math.min(n - 1, i));
  drawSlide();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => call(`lessons/${L.lesson.id}/progress`, { method: 'PUT', body: { contentId: L.content.id, slide } }).catch(() => {}), 600);
  if (was) speak(slide);
}
function drawControls() {
  const p = $('lpPlay'); if (!p) return;
  const off = L.media.kind === 'text';
  p.hidden = off;
  p.textContent = playing ? 'Pause' : 'Play';
  p.setAttribute('aria-pressed', String(playing));
  $('lpCc').setAttribute('aria-pressed', String(captions));
}
function ruleChip(id) {
  const r = (L.rules || []).find((x) => x.id === id);
  return `<a class="ruleChip${r && r.state !== 'approved' ? ' pending' : ''}" href="#/rules/${encodeURIComponent(id)}" title="${esc(r ? `${r.title} (${r.stateText || r.state})` : id)}">${esc(id.replace(/^[A-Z]+-\d{4}-/, ''))}</a>`;
}
function drawSlide() {
  const c = L.content, s = c.slides[slide], n = c.slides.length;
  $('lpStage').innerHTML = `<div class="lpFig">${FIGURES[s.figure] || FIGURES.placeholder}</div>
    <div class="lpText"><p class="lpCount">${slide + 1} of ${n}</p><h2>${esc(s.heading)}</h2>
      <ul class="lpPoints">${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      ${s.review ? `<p class="reviewNote"><b>${esc(L.content.locale === 'es' ? 'En revisión' : 'Under review')}</b> ${esc(s.review.replace(/^(Under review for 2027|En revisión para 2027):\s*/, ''))}</p>` : ''}
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
      ${s.rules?.length ? `<p class="lpRules"><span>Rules</span>${s.rules.map(ruleChip).join('')}</p>` : ''}</div>`;
  $('lpCaption').textContent = s.narration || '';
  $('lpCaption').hidden = !captions || !s.narration;
  $('lpDots').innerHTML = c.slides.map((_, i) => `<button type="button" class="dot${i === slide ? ' on' : ''}${i < slide ? ' seen' : ''}" data-slide="${i}" aria-label="Slide ${i + 1}"${i === slide ? ' aria-current="step"' : ''}></button>`).join('');
  for (const b of $('lpDots').querySelectorAll('[data-slide]')) b.onclick = () => go(Number(b.dataset.slide));
  $('lpPrev').disabled = slide === 0;
  $('lpNext').hidden = slide === n - 1;
  $('lpEnd').hidden = slide !== n - 1;
  drawControls();
}

function langSwitch() {
  if (L.locales.length < 2 && L.content) return '';
  return `<label class="langSwitch">Language <select id="lpLang">${L.locales.map((x) => `<option value="${esc(x.locale)}"${x.locale === L.content.locale ? ' selected' : ''}>${esc(LANG[x.locale] || x.locale)}${x.preview ? ' (preview translation)' : ''}</option>`).join('')}</select></label>`;
}
function editorPanel() {
  if (!L.can.edit) return '';
  const c = L.content;
  const rows = L.drafts.map((d) => `<li><a href="${lessonUrl(L.lesson.id, `content=${d.id}`)}"><b>${esc(LANG[d.locale] || d.locale)} v${d.versionNo}</b> ${badge(d.preview ? 'preview' : d.state, d.preview ? 'In review (preview)' : null)}<small>${esc(day(d.createdAt))}${d.translationOf ? ' · translation' : ''}</small></a></li>`).join('');
  const actions = [];
  if (c && c.state === 'draft') actions.push('<button class="small" type="button" data-cstate="review">Send for review</button>');
  if (c && c.state === 'review' && L.can.approve) actions.push('<button class="primary small" type="button" data-cstate="published">Approve and publish</button>', '<button class="small" type="button" data-cstate="draft">Send back</button>');
  const locales = L.programme.locales;
  return `<section class="card"><h2>Content versions</h2><p class="note">English is the master. A published version never changes: edit by making a new version, which an owner approves. Each completion records the exact version it was done on.</p>
    <ul class="rowList">${rows || '<li class="muted">No content yet.</li>'}</ul>
    ${c ? `<p>Showing ${esc(LANG[c.locale] || c.locale)} v${c.versionNo}: ${badge(c.preview ? 'preview' : c.state, c.preview ? 'In review (preview)' : null)} <small class="muted">source ${esc(c.sourceHash.slice(0, 12))}</small></p><div class="btnRow">${actions.join('')}</div>` : ''}
    <form class="inlineForm" id="newContent"><label for="nc-loc">New version</label><select id="nc-loc" name="locale">${locales.map((l) => `<option value="${esc(l)}"${c && l === c.locale ? ' selected' : ''}>${esc(LANG[l] || l)}</option>`).join('')}</select><button class="small" type="submit">Start a draft from this one</button></form>
    ${c && c.state === 'draft' ? `<details class="edit" open><summary>Edit this draft</summary><form id="slideEditor" class="slideEditor">
      ${c.slides.map((s, i) => `<fieldset class="slideEdit" data-i="${i}"><legend>Slide ${i + 1}</legend>
        <label>Heading<input name="heading" value="${esc(s.heading)}" maxlength="160"></label>
        <label>Points, one per line<textarea name="points" rows="3">${esc(s.points.join('\n'))}</textarea></label>
        <label>Narration (also the captions)<textarea name="narration" rows="4">${esc(s.narration)}</textarea></label>
        <label>Rules (ids, comma separated)<input name="rules" value="${esc((s.rules || []).join(', '))}"></label>
        <label>Under review note<textarea name="review" rows="2">${esc(s.review || '')}</textarea></label>
        <label>Note under the slide<textarea name="note" rows="2">${esc(s.note || '')}</textarea></label>
        <input type="hidden" name="figure" value="${esc(s.figure || '')}"></fieldset>`).join('')}
      <label>Sources<input name="sources" value="${esc(c.sources)}" maxlength="1000"></label>
      <div class="btnRow"><button class="small" type="button" id="addSlide">Add a slide</button><button class="primary small" type="submit">Save the draft</button></div></form></details>` : ''}
  </section>`;
}

async function lessonView(rest) {
  const [id, qs = ''] = rest.split('?');
  const q = new URLSearchParams(qs || location.hash.split('?')[1] || '');
  stopVoice();
  L = await call(`lessons/${encodeURIComponent(id)}?${new URLSearchParams([...(q.get('locale') ? [['locale', q.get('locale')]] : []), ...(q.get('content') ? [['content', q.get('content')]] : [])])}`);
  const c = L.content, back = `#/programmes/${encodeURIComponent(L.programme.id)}`;
  slide = c && L.progress && L.progress.contentId === c.id ? Math.min(L.progress.slide, c.slides.length - 1) : 0;
  const done = L.completions.find((x) => !x.preview), donePreview = L.completions.find((x) => x.preview);
  const head = `<section class="card lpHead"><p class="crumbs"><a href="${back}">${esc(L.programme.title)}</a> · ${esc(L.module.title)}</p>
    <h1>${esc(L.lesson.title)}</h1>
    <p class="badges">${L.version.state !== 'published' ? badge(L.version.state, `${L.version.edition} ${L.version.state}`) : ''}${L.programme.demo ? badge('preview', 'Demonstration content') : ''}${done ? badge('completed', 'Completed') : donePreview ? badge('pending', 'Done in a preview translation') : ''}${c && c.state !== 'published' && !c.preview ? badge(c.state) : ''}</p>
    ${L.extra?.reviews?.length ? `<p class="reviewNote"><b>Under review</b> ${L.extra.reviews.map((i) => esc(i.title)).join('; ')}. <a href="#/reviews?programme=${esc(L.programme.id)}">See the review items</a></p>` : ''}
    ${langSwitch()}</section>`;
  if (!c) return `${head}<section class="card"><h2>Being written</h2><p>This lesson's content hasn't been published yet.</p><p><a class="btnLink" href="${back}">Back to the programme</a></p></section>${editorPanel()}`;
  const preview = c.preview ? `<p class="previewBanner" role="note"><b>Preview translation.</b> ${esc(c.translatedBy || 'Not reviewed yet')}. The English is the approved version. Completing the lesson in this language is recorded, but it counts towards your qualification only in an approved language.</p>` : '';
  return `${head}${preview}
    <section class="card lpPlayer" aria-label="Lesson player">
      <div id="lpStage" class="lpStage" aria-live="polite"></div>
      <p class="lpCaption" id="lpCaption"></p>
      <div class="lpDots" id="lpDots"></div>
      <div class="lpControls">
        <button type="button" id="lpPrev" class="lpBtn" aria-label="Previous slide">‹ Back</button>
        <button type="button" id="lpPlay" class="lpBtn lpMain" aria-pressed="false">Play</button>
        <button type="button" id="lpNext" class="lpBtn" aria-label="Next slide">Next ›</button>
        <button type="button" id="lpEnd" class="lpBtn lpMain" hidden>${done ? 'Done' : 'Finish'}</button>
      </div>
      <div class="lpTools"><button type="button" class="link" id="lpCc" aria-pressed="true">Captions</button><button type="button" class="link" id="lpTx" aria-expanded="false">Transcript</button>
        <span class="muted lpMedia">${esc(L.media.label)}${L.media.kind !== 'text' ? ` · ${esc(L.media.voice)}` : ''}${L.media.note ? ` · ${esc(L.media.note)}` : ''}</span></div>
      <p class="note lpKeys">Keys: ← and → move between slides, space plays or pauses, C turns captions on or off.</p>
      <div id="lpTranscript" class="lpTranscript" hidden><h3>Transcript</h3>${c.slides.map((s, i) => `<p><b>${i + 1}. ${esc(s.heading)}</b> ${esc(s.narration)}</p>`).join('')}</div>
    </section>
    <section class="card" id="lpFinish" hidden><h2>${done ? 'You\'ve completed this lesson' : 'Finish the lesson'}</h2>
      ${L.enrolled ? (done ? `<p>Completed ${esc(day(done.at))} (${esc(LANG[done.locale] || done.locale)}, content version ${done.versionNo}).</p>` : `<p>Mark it complete to record it against your programme: the record keeps this lesson, its content version (${esc(LANG[c.locale] || c.locale)} v${c.versionNo}) and the date.</p><button class="primary" type="button" id="lpComplete">Mark as complete</button>`)
        : `<p>Enrol in ${esc(L.programme.title)} to record your progress.</p><a class="btnLink" href="${back}">Go to the programme</a>`}
      ${await runHooks(hooks.lesson || [], L)}
      ${L.nav.next ? `<p><a class="btnLink" href="${lessonUrl(L.nav.next)}">Next: ${esc(L.nav.nextTitle)}</a></p>` : `<p><a class="btnLink" href="${back}">Back to the programme</a></p>`}
    </section>
    <section class="card"><h2>About this lesson</h2><p>${esc(L.lesson.summary)}</p><p class="note">Sources: ${esc(c.sources || 'not given')}. ${esc(LANG[c.locale] || c.locale)} content version ${c.versionNo}${c.approvedAt ? `, approved ${esc(day(c.approvedAt))}` : ''}.</p></section>
    ${editorPanel()}`;
}

function onKey(e) {
  if (!L || !$('lpStage') || e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); go(slide + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(slide - 1); }
  else if (e.key === ' ' || e.key === 'k') { if (L.media.kind !== 'text') { e.preventDefault(); if (playing) { stopVoice(); drawControls(); } else speak(slide); } }
  else if (e.key === 'c' || e.key === 'C') { captions = !captions; drawSlide(); }
}
addEventListener('keydown', onKey);
addEventListener('hashchange', () => { if (!location.hash.startsWith('#/lesson/')) stopVoice(); });

// ---------------------------------------------------------------- media settings (AT-11): which provider plays the lessons, and the voices
async function mediaView() {
  const d = await call('media');
  return `<section class="card"><h1>Media</h1><p class="note">How lessons are played: narration by Azure AI Speech, the device's own voice, or captions only, for every programme or one. Changing it never changes a lesson's content or anyone's completions, which record the content version, not how it was played.${d.speechOn ? '' : " Azure narration isn't set up on this server: the device's voice stands in."}</p>
    ${d.scopes.map((s) => `<form class="mediaForm" data-scope="${esc(s.id)}"><h2>${esc(s.title)}</h2>${s.set || s.id === 'default' ? '' : '<p class="note">Uses the default until set here.</p>'}
      <label>Provider <select name="provider">${d.providers.map((p) => `<option value="${esc(p.id)}"${p.id === s.provider ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      ${['en', 'es'].map((loc) => `<label>${esc(LANG[loc])} voice <select name="voice-${loc}">${d.voices[loc].map((v) => `<option${(s.voices[loc] || d.voices[loc][0]) === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}
      <button class="small" type="submit">Save</button></form>`).join('')}</section>`;
}
function wireMedia() {
  for (const f of document.querySelectorAll('.mediaForm')) f.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => { await call(`media/${f.dataset.scope}`, { method: 'PUT', body: { provider: f.provider.value, voices: { en: f['voice-en'].value, es: f['voice-es'].value } } }); toast('Media settings saved'); redraw(); }, e.submitter);
  });
}

export const views = { lesson: lessonView, media: mediaView };

export function wire() {
  wireMedia();
  if (!$('lpStage') && !$('newContent')) return;
  if ($('lpStage')) {
    drawSlide();
    $('lpPrev').onclick = () => go(slide - 1);
    $('lpNext').onclick = () => go(slide + 1);
    $('lpPlay').onclick = () => { if (playing) { stopVoice(); drawControls(); } else speak(slide); };
    $('lpEnd').onclick = () => { stopVoice(); drawControls(); $('lpFinish').hidden = false; $('lpFinish').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $('lpCc').onclick = () => { captions = !captions; drawSlide(); };
    $('lpTx').onclick = () => { const t = $('lpTranscript'); t.hidden = !t.hidden; $('lpTx').setAttribute('aria-expanded', String(!t.hidden)); };
    $('lpComplete')?.addEventListener('click', (e) => act(async () => {
      const r = await call(`lessons/${L.lesson.id}/complete`, { method: 'POST', body: { contentId: L.content.id } });
      toast(r.preview ? 'Recorded: done in a preview translation' : r.enrolment.state === 'completed' ? 'Lesson complete: programme complete!' : 'Lesson complete');
      redraw();
    }, e.currentTarget));
  }
  $('lpLang')?.addEventListener('change', (e) => { stopVoice(); location.hash = lessonUrl(L.lesson.id, `locale=${e.target.value}`); });
  for (const b of document.querySelectorAll('[data-cstate]')) b.onclick = () => {
    if (b.dataset.cstate === 'published' && !confirm('Publish this content? Learners see it at once, and it never changes afterwards.')) return;
    act(async () => { await call(`content/${L.content.id}/state`, { method: 'POST', body: { to: b.dataset.cstate } }); toast('Done'); redraw(); }, b);
  };
  $('newContent')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const locale = e.target.locale.value, from = L.content;
    const english = L.drafts.find((d) => d.locale === 'en' && d.state === 'published');
    act(async () => {
      const r = await call(`lessons/${L.lesson.id}/content`, { method: 'POST', body: { locale, slides: from ? from.slides : [{ heading: L.lesson.title, points: [], narration: '' }], sources: from?.sources || '', ...(locale !== 'en' && english ? { translationOf: english.id, translatedBy: 'Translator draft' } : {}) } });
      toast('Draft started'); location.hash = lessonUrl(L.lesson.id, `content=${r.content.id}`);
    }, e.submitter);
  });
  const editor = $('slideEditor');
  if (editor) {
    $('addSlide').onclick = () => {
      const n = editor.querySelectorAll('.slideEdit').length;
      editor.querySelector('.slideEdit:last-of-type').insertAdjacentHTML('afterend', `<fieldset class="slideEdit" data-i="${n}"><legend>Slide ${n + 1}</legend><label>Heading<input name="heading" maxlength="160"></label><label>Points, one per line<textarea name="points" rows="3"></textarea></label><label>Narration (also the captions)<textarea name="narration" rows="4"></textarea></label><label>Rules (ids, comma separated)<input name="rules"></label><label>Under review note<textarea name="review" rows="2"></textarea></label><input type="hidden" name="figure" value=""></fieldset>`);
    };
    editor.addEventListener('submit', (e) => {
      e.preventDefault();
      const slides = [...editor.querySelectorAll('.slideEdit')].map((f) => ({ heading: f.querySelector('[name=heading]').value, points: f.querySelector('[name=points]').value.split('\n').map((x) => x.trim()).filter(Boolean),
        narration: f.querySelector('[name=narration]').value, rules: f.querySelector('[name=rules]').value.split(',').map((x) => x.trim()).filter(Boolean), review: f.querySelector('[name=review]').value, note: f.querySelector('[name=note]')?.value || '', figure: f.querySelector('[name=figure]').value })).filter((s) => s.heading);
      act(async () => { await call(`content/${L.content.id}`, { method: 'PUT', body: { slides, sources: editor.querySelector('[name=sources]').value } }); toast('Draft saved'); redraw(); }, e.submitter);
    });
  }
}

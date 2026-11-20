// The lesson player (step 3), phone first: slides with a figure, narration through the media adapter (Azure narration, the device's own
// voice, or captions only), captions and a full transcript, keyboard controls, a bookmark, completion, a language switcher with clear
// Preview translation labels, and for editors the content versions with writing, review and approval (LRN-02..05, LRN-07, AT-04, AT-05).
import { visualHtml, wireVisual } from './slide-visual.js';
import { $, call, esc, toast, fail, badge, day, redraw, act, hooks, runHooks, LANG, t } from './core.js';
import { programsTabs } from './authoring.js';
import { drawAction } from './practice.js';
import { recallFile, queuedPaths } from '../offline.js';
import { checkSection, wireCheck, celebrate } from './sharp.js';

// ---------------------------------------------------------------- figures: simple drawings, in the page's own colours
const svg = (body) => `<svg class="fig" viewBox="0 0 240 120" role="img" aria-hidden="true">${body}</svg>`;
const ground = '<line x1="8" y1="104" x2="232" y2="104" class="f-ground"/>';
const person = (x, arm = 'up') => `<g class="f-person"><circle cx="${x}" cy="40" r="7"/><line x1="${x}" y1="47" x2="${x}" y2="76"/><line x1="${x}" y1="76" x2="${x - 9}" y2="102"/><line x1="${x}" y1="76" x2="${x + 9}" y2="102"/>${arm === 'up' ? `<line x1="${x}" y1="54" x2="${x + 16}" y2="38"/><line x1="${x}" y1="54" x2="${x - 12}" y2="64"/>` : `<line x1="${x}" y1="54" x2="${x + 14}" y2="66"/><line x1="${x}" y1="54" x2="${x - 14}" y2="66"/>`}</g>`;
const target = (x, spear = 'in') => `<g class="f-target"><rect x="${x}" y="30" width="34" height="56" rx="3"/><line x1="${x + 17}" y1="86" x2="${x + 17}" y2="104"/><circle cx="${x + 17}" cy="58" r="10" class="f-ring"/></g>${spear === 'in' ? `<line x1="${x - 46}" y1="56" x2="${x + 14}" y2="58" class="f-spear"/>` : spear === 'ground' ? `<line x1="${x - 40}" y1="104" x2="${x + 8}" y2="62" class="f-spear f-bad"/>` : ''}`;
export const FIGURES = {
  lane: svg(`${ground}${person(40)}<line x1="62" y1="88" x2="62" y2="104" class="f-barrier"/><line x1="74" y1="34" x2="150" y2="50" class="f-spear f-flight"/>${target(176, 'none')}`),
  barrier: svg(`${ground}${person(44)}<rect x="60" y="92" width="6" height="12" class="f-barrier-box"/><text x="63" y="88" class="f-label">barrier</text>${target(176, 'none')}`),
  release: svg(`${ground}${person(52)}<line x1="66" y1="40" x2="104" y2="30" class="f-spear"/><path d="M110 30 l14 -2 m-14 2 l12 6" class="f-arrow"/><text x="120" y="22" class="f-label">released forward: an attempt</text>${target(184, 'none')}`),
  target: svg(`${ground}${target(70, 'in')}<text x="66" y="22" class="f-label f-ok">pass</text>${target(176, 'ground')}<text x="166" y="22" class="f-label f-bad">fail</text>`),
  distance: svg(`${ground}<line x1="40" y1="88" x2="40" y2="104" class="f-barrier"/>${person(150, 'down')}<path d="M44 96 H140" class="f-arrow"/><text x="66" y="90" class="f-label">2 m away</text>${target(196, 'none')}`),
  burpee: svg(`${ground}<g class="f-person"><circle cx="40" cy="92" r="6"/><line x1="46" y1="96" x2="96" y2="100"/></g><text x="30" y="80" class="f-label">chest down</text>${person(140)}<text x="128" y="24" class="f-label">jump, hands up</text><text x="190" y="60" class="f-big">30</text>`),
  referee: svg(`${ground}${person(40)}<g class="f-ref"><circle cx="120" cy="52" r="7"/><line x1="120" y1="59" x2="120" y2="84"/><line x1="120" y1="84" x2="112" y2="104"/><line x1="120" y1="84" x2="128" y2="104"/><line x1="120" y1="66" x2="138" y2="58"/></g><path d="M128 46 q30 -16 56 0" class="f-arrow"/>${target(186, 'none')}<text x="104" y="24" class="f-label">clear view</text>`),
  summary: svg('<g class="f-check"><circle cx="120" cy="58" r="34"/><path d="M104 58 l12 12 l22 -24"/></g>'),
  camera: svg(`${ground}<g class="f-target"><rect x="28" y="40" width="30" height="18" rx="3"/></g><line x1="43" y1="58" x2="32" y2="104" class="f-barrier"/><line x1="43" y1="58" x2="54" y2="104" class="f-barrier"/><path d="M62 46 L160 28 M62 54 L160 104" class="f-arrow f-flight"/>${person(186)}<text x="86" y="76" class="f-label">3 to 4 m</text>`),
  qr: svg('<g class="f-target"><rect x="44" y="16" width="44" height="84" rx="7"/><rect x="140" y="28" width="64" height="64"/><rect x="148" y="36" width="14" height="14"/><rect x="182" y="36" width="14" height="14"/><rect x="148" y="70" width="14" height="14"/><rect x="170" y="58" width="6" height="6"/><rect x="186" y="74" width="6" height="6"/></g><path d="M94 60 H130 m-8 -6 l8 6 l-8 6" class="f-arrow"/><text x="98" y="50" class="f-label">scan</text>'),
  network: svg('<g class="f-target"><rect x="14" y="40" width="26" height="44" rx="4"/><rect x="100" y="34" width="40" height="52" rx="3"/><line x1="106" y1="48" x2="134" y2="48"/><line x1="106" y1="60" x2="134" y2="60"/><rect x="184" y="40" width="46" height="32" rx="3"/><line x1="198" y1="84" x2="216" y2="84"/></g><path d="M46 62 H92 m-8 -6 l8 6 l-8 6 M146 60 H176 m-8 -6 l8 6 l-8 6" class="f-arrow"/><text x="16" y="104" class="f-label">phone</text><text x="102" y="104" class="f-label">server</text><text x="184" y="104" class="f-label">browser</text>'),
  wall: svg(`${ground}<rect x="120" y="34" width="14" height="70" class="f-barrier-box"/>${person(70)}<path d="M84 50 Q110 20 140 30" class="f-arrow f-flight"/><text x="146" y="28" class="f-label">over</text>`),
  loop: svg(`${ground}<ellipse cx="120" cy="66" rx="90" ry="30" class="f-loop"/><path d="M200 70 l10 -8 m-10 8 l-2 -12" class="f-arrow"/>${person(40)}<text x="96" y="70" class="f-label">penalty loop</text>`),
  radio: svg(`${person(36)}<g class="f-ref"><circle cx="120" cy="40" r="7"/><line x1="120" y1="47" x2="120" y2="76"/><line x1="120" y1="76" x2="112" y2="102"/><line x1="120" y1="76" x2="128" y2="102"/></g><g class="f-target"><rect x="186" y="34" width="22" height="40" rx="3"/><line x1="192" y1="34" x2="192" y2="20"/></g><path d="M50 56 H104 M136 56 H178" class="f-arrow f-flight"/><text x="26" y="116" class="f-label">referee</text><text x="96" y="116" class="f-label">head referee</text><text x="172" y="116" class="f-label">race director</text>`),
  clipboard: svg('<g class="f-target"><rect x="84" y="14" width="72" height="94" rx="5"/><rect x="104" y="8" width="32" height="12" rx="3"/><line x1="98" y1="40" x2="142" y2="40"/><line x1="98" y1="58" x2="142" y2="58"/><line x1="98" y1="76" x2="128" y2="76"/></g><text x="98" y="98" class="f-label">bib · time · call</text>'),
  safety: svg('<path d="M120 14 L196 104 H44 Z" class="f-warn"/><line x1="120" y1="44" x2="120" y2="76" class="f-warn"/><circle cx="120" cy="90" r="3" class="f-warn"/>'),
  athletes: svg(`${ground}${person(50)}${person(100, 'down')}${person(150)}<g class="f-ref"><circle cx="206" cy="40" r="7"/><line x1="206" y1="47" x2="206" y2="76"/><line x1="206" y1="76" x2="198" y2="102"/><line x1="206" y1="76" x2="214" y2="102"/></g>`),
  placeholder: svg('<rect x="70" y="24" width="100" height="70" rx="6" class="f-target"/><text x="120" y="64" class="f-label" text-anchor="middle">sample</text>'),
};

// ---------------------------------------------------------------- the player
let L = null, slide = 0, playing = false, captions = true, audio = null, saveTimer = null;
const lessonUrl = (id, q = '') => `#/lesson/${id}${q ? `?${q}` : ''}`;
/** the API address of a lesson in a language: the same for the player and for saving it for offline use (saved.js) */
export const lessonPath = (id, locale, content) => `lessons/${encodeURIComponent(id)}?${new URLSearchParams([...(locale ? [['locale', locale]] : []), ...(content ? [['content', content]] : [])])}`;
/** where a slide's narration is kept on the phone (saved.js) */
export const audioPath = (contentId, voice, i) => `audio/${contentId}/${voice}/${i}`;
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
      // saved on this phone (saved.js), or from the server; with no signal and nothing saved, the device reads it instead
      const kept = await recallFile(audioPath(c.id, m.voice, i));
      let url = kept ? URL.createObjectURL(kept) : '';
      if (!url) {
        try { ({ url } = await call(`content/${c.id}/narration/${i}`)); }
        catch (e) { if (e.status || !('speechSynthesis' in window)) throw e; return deviceVoice(text, m.lang, next); }
      }
      if (!playing || slide !== i) return;
      audio = new Audio(url); audio.onended = next; audio.onerror = () => { playing = false; drawControls(); fail('The narration couldn\'t play: the captions are below'); };
      await audio.play();
    } catch (e) { playing = false; drawControls(); fail(e.message); }
    return;
  }
  // the device reads it aloud itself
  if (!('speechSynthesis' in window)) { playing = false; drawControls(); fail('This device can\'t read aloud: the captions are below'); return; }
  deviceVoice(text, m.lang, next);
}
function deviceVoice(text, lang, next) {
  const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = 1;
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').startsWith(lang.slice(0, 2)));
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
  $('lpCc')?.setAttribute('aria-pressed', String(captions));
  const p = $('lpPlay'); if (!p) return;
  // the voice button by the slide's text: a speaker; while it reads, it's filled in with a stop square, and a tap stops it
  const label = playing ? t('Stop reading aloud') : t('Read this slide aloud');
  p.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="spk" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>${playing ? '<rect class="stop" x="15.5" y="9" width="6" height="6" rx="1"/>' : '<path class="wave w1" d="M15.5 9.5a3.5 3.5 0 010 5"/><path class="wave w2" d="M18 7a7 7 0 010 10"/>'}</svg>`;
  p.setAttribute('aria-label', label); p.title = label;
  p.setAttribute('aria-pressed', String(playing));
  p.classList.toggle('on', playing);
}
function ruleChip(id) {
  const r = (L.rules || []).find((x) => x.id === id);
  return `<a class="ruleChip${r && r.state !== 'approved' ? ' pending' : ''}" href="#/rules/${encodeURIComponent(id)}" title="${esc(r ? `${r.title} (${r.stateText || r.state})` : id)}">${esc(id.replace(/^[A-Z]+-\d{4}-/, ''))}</a>`;
}
// a slide's review note starts with "Under review for 2027:" in the lesson's own language: that part in bold
function reviewNote(text) {
  const m = /^([^:：]{1,60}2027\s*[:：])\s*/.exec(text);
  return `<p class="reviewNote">${m ? `<b>${esc(m[1])}</b> ${esc(text.slice(m[0].length))}` : esc(text)}</p>`;
}
function drawSlide() {
  const c = L.content, s = c.slides[slide], n = c.slides.length;
  $('lpStage').innerHTML = `<div class="lpFig${s.media ? ' lpFigMedia' : ''}" data-media="${esc(s.media?.type || '')}">${visualHtml(s, FIGURES)}</div>
    <div class="lpText"><p class="lpCount"><span dir="ltr">${slide + 1} / ${n}</span></p><div class="lpHeadRow"><h2>${esc(s.heading)}</h2>${L.media.kind !== 'text' && s.narration ? '<button type="button" id="lpPlay" class="lpVoice" aria-pressed="false"></button>' : ''}</div>
      <ul class="lpPoints">${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      ${s.review ? reviewNote(s.review) : ''}
      ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
      ${s.rules?.length ? `<p class="lpRules"><span>Rules</span>${s.rules.map(ruleChip).join('')}</p>` : ''}
      ${s.action ? '<div class="lpAction" id="lpAction"></div>' : ''}</div>`;
  wireVisual($('lpStage').querySelector('.lpFig'));
  if (s.action) drawAction($('lpAction'), s.action);
  if ($('lpPlay')) $('lpPlay').onclick = () => { if (playing) { stopVoice(); drawControls(); } else speak(slide); };
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
// editors change a lesson in Programs (authoring.js), in place, as a draft a programme owner publishes; here is only the way there
function editorPanel() {
  if (!L.can.edit) return '';
  const loc = L.content?.locale || 'en';
  return `<section class="card editHere"><p class="note">${esc(t('You can change this lesson: its text, pictures, bullet points, quick check and translations.'))}</p>
    <a class="btnLink" href="#/programs/${esc(L.programme.id)}/${esc(L.lesson.id)}?lang=${esc(loc)}">Edit this lesson</a></section>`;
}

async function lessonView(rest) {
  const [id, qs = ''] = rest.split('?');
  const q = new URLSearchParams(qs || location.hash.split('?')[1] || '');
  stopVoice();
  // the language picked at the top of the page, unless this address names one (the lesson's own language switch)
  const pageLang = (window.SR_I18N && SR_I18N.lang) || '';
  L = await call(lessonPath(id, q.get('locale') || pageLang, q.get('content')));
  const c = L.content, back = `#/programmes/${encodeURIComponent(L.programme.id)}`;
  slide = c && L.progress && L.progress.contentId === c.id ? Math.min(L.progress.slide, c.slides.length - 1) : 0;
  const done = L.completions.find((x) => !x.preview), donePreview = L.completions.find((x) => x.preview);
  const head = `<section class="card lpHead"><p class="crumbs"><a href="${back}">${esc(L.programme.title)}</a> · <span>${esc(L.module.title)}</span></p>
    <h1>${esc(L.lesson.title)}</h1>
    <p class="badges">${L.version.state !== 'published' ? badge(L.version.state, `${L.version.edition} ${L.version.state}`) : ''}${L.programme.demo ? badge('preview', 'Demonstration content') : ''}${done ? badge('completed', 'Completed') : donePreview ? badge('pending', 'Done in a preview translation') : ''}${c && c.state !== 'published' && !c.preview ? badge(c.state) : ''}</p>
    ${L.extra?.reviews?.length ? `<div class="reviewNote"><b>Under review</b><ul class="reviewTitles">${L.extra.reviews.map((i) => `<li>${esc(i.title)}</li>`).join('')}</ul><a href="#/reviews?programme=${esc(L.programme.id)}">See the review items</a></div>` : ''}
    ${langSwitch()}</section>`;
  // you move on once the lesson's quick check is answered (right or wrong) and, enrolled, the lesson is complete (which needs the check)
  const checks = L.extra?.checks || [], st = L.extra?.checkState || {};
  const answered = checks.length > 0 && checks.every((k) => st[k.key]);
  const moveOn = L.enrolled ? !!done : !checks.length || answered;
  // a lesson opens once the one before is finished (the server says which); one finished offline counts already
  if (L.lock && !queuedPaths().includes(`lessons/${L.lock.lessonId}/complete`)) {
    return `${head}<section class="card lockedCard"><h2>Not open yet</h2><p>${esc(t('This lesson opens once you\'ve finished {title}, with its quick check.', { title: t(L.lock.title) }))}</p><a class="btnLink primaryLink" href="${lessonUrl(L.lock.lessonId)}">Go to that lesson</a></section>`;
  }
  if (!c) return `${head}<section class="card"><h2>Being written</h2><p>This lesson's content hasn't been published yet.</p><p><a class="btnLink" href="${back}">Back to the programme</a></p></section>${editorPanel()}`;
  const preview = c.preview ? `<p class="previewBanner" role="note"><b>Preview translation.</b> ${esc(c.translatedBy || 'Not reviewed yet')}. The English is the approved version. Completing the lesson in this language is recorded, but it counts towards your qualification only in an approved language.</p>` : '';
  return `${head}${preview}
    <section class="card lpPlayer" aria-label="Lesson player">
      <div id="lpStage" class="lpStage" aria-live="polite"></div>
      <p class="lpCaption" id="lpCaption"></p>
      <div class="lpDots" id="lpDots"></div>
      <div class="lpControls">
        <button type="button" id="lpPrev" class="lpBtn" aria-label="Previous slide">‹ Back</button>
        <button type="button" id="lpNext" class="lpBtn lpMain" aria-label="Next slide">Next ›</button>
        <button type="button" id="lpEnd" class="lpBtn lpMain" hidden>${checks.length ? esc(t('Finish and test')) : done ? 'Done' : 'Finish'}</button>
      </div>
      <div class="lpTools"><button type="button" class="link" id="lpCc" aria-pressed="true">Captions</button><button type="button" class="link" id="lpTx" aria-expanded="false">Transcript</button>
        <span class="muted lpMedia"><span>${esc(L.media.label)}</span>${L.media.kind !== 'text' ? ` · <span dir="ltr">${esc(L.media.voice)}</span>` : ''}${L.media.note ? ` · <span>${esc(L.media.note)}</span>` : ''}</span></div>
      <p class="note lpKeys">Keys: ← and → move between slides, space plays or pauses, C turns captions on or off.</p>
      <div id="lpTranscript" class="lpTranscript" hidden><h3>Transcript</h3>${c.slides.map((s, i) => `<p><b>${i + 1}. ${esc(s.heading)}</b> ${esc(s.narration)}</p>`).join('')}</div>
    </section>
    <section class="card" id="lpFinish" hidden><h2>${done ? 'You\'ve completed this lesson' : 'Finish the lesson'}</h2>
      ${checkSection(L)}
      ${L.enrolled ? (done ? `<p>Completed ${esc(day(done.at))} (${esc(LANG[done.locale] || done.locale)}, content version ${done.versionNo}).</p>` : !checks.length || answered ? `<p>Mark it complete to record it against your programme: the record keeps this lesson, its content version (${esc(LANG[c.locale] || c.locale)} v${c.versionNo}) and the date.</p><button class="primary" type="button" id="lpComplete">Mark as complete</button>` : '')
        : `<p>Enrol in ${esc(L.programme.title)} to record your progress.</p><a class="btnLink" href="${back}">Go to the programme</a>`}
      ${await runHooks(hooks.lesson || [], L)}
      <p class="lpNextWrap" id="lpNextWrap"${moveOn ? '' : ' hidden'}>${L.nav.next ? `<a class="btnLink primaryLink" href="${lessonUrl(L.nav.next)}">Next: ${esc(L.nav.nextTitle)}</a>` : `<a class="btnLink primaryLink" href="${back}">Back to the programme</a>`}</p>
    </section>
    <section class="card" id="lpAbout"><h2>About this lesson</h2><p>${esc(L.lesson.summary)}</p><p class="note">Sources: ${esc(String(c.sources || 'not given').replace(/\.$/, ''))}. ${esc(LANG[c.locale] || c.locale)} content version ${c.versionNo}${c.approvedAt ? `, approved ${esc(day(c.approvedAt))}` : ''}.</p></section>
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
  return `<section class="card"><h1>Media</h1>${programsTabs('media')}<p class="note">How lessons are played: narration by Azure AI Speech, the device's own voice, or captions only, for every programme or one. Changing it never changes a lesson's content or anyone's completions, which record the content version, not how it was played.${d.speechOn ? '' : " Azure narration isn't set up on this server: the device's voice stands in."}</p>
    ${d.scopes.map((s) => `<form class="mediaForm" data-scope="${esc(s.id)}"><h2>${esc(s.title)}</h2>${s.set || s.id === 'default' ? '' : '<p class="note">Uses the default until set here.</p>'}
      <label>Provider <select name="provider">${d.providers.map((p) => `<option value="${esc(p.id)}"${p.id === s.provider ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
      ${Object.keys(LANG).filter((loc) => d.voices[loc]).map((loc) => `<label>${esc(LANG[loc])} voice <select name="voice-${loc}">${d.voices[loc].map((v) => `<option${(s.voices[loc] || d.voices[loc][0]) === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}
      <button class="small" type="submit">Save</button></form>`).join('')}</section>`;
}
function wireMedia() {
  for (const f of document.querySelectorAll('.mediaForm')) f.addEventListener('submit', (e) => {
    e.preventDefault();
    act(async () => { await call(`media/${f.dataset.scope}`, { method: 'PUT', body: { provider: f.provider.value, voices: Object.fromEntries([...f.querySelectorAll('select[name^="voice-"]')].map((x) => [x.name.slice(6), x.value])) } }); toast('Media settings saved'); redraw(); }, e.submitter);
  });
}

export const views = { lesson: lessonView, media: mediaView };

export function wire() {
  wireMedia();
  $('view')?.classList.remove('lpTesting'); // a page drawn afresh starts with the lesson showing
  if (!$('lpStage') && !$('lpLang')) return;
  if ($('lpStage')) {
    drawSlide();
    $('lpPrev').onclick = () => go(slide - 1);
    $('lpNext').onclick = () => go(slide + 1);
    // "Finish and test": the slides are put away while the questions are asked; going through the lesson again brings them back
    const view = $('view');
    const redo = () => { view.classList.remove('lpTesting'); $('lpFinish').hidden = true; go(0); $('lpStage').closest('.lpPlayer').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const startTest = wireCheck(L, { redo });
    $('lpEnd').onclick = () => {
      stopVoice(); drawControls(); $('lpFinish').hidden = false;
      if (startTest) { view.classList.add('lpTesting'); startTest(); } else $('lpFinish').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    $('lpCc').onclick = () => { captions = !captions; drawSlide(); };
    $('lpTx').onclick = () => { const t = $('lpTranscript'); t.hidden = !t.hidden; $('lpTx').setAttribute('aria-expanded', String(!t.hidden)); };
    $('lpComplete')?.addEventListener('click', (e) => act(async () => {
      const r = await call(`lessons/${L.lesson.id}/complete`, { method: 'POST', body: { contentId: L.content.id } });
      toast(r.queued ? 'Saved on this phone: it goes to your record when there\'s signal' : r.preview ? 'Recorded: done in a preview translation' : r.enrolment.state === 'completed' ? 'Lesson complete: programme complete!' : 'Lesson complete');
      celebrate(r.badges);
      redraw();
    }, e.currentTarget));
  }
  $('lpLang')?.addEventListener('change', (e) => { stopVoice(); location.hash = lessonUrl(L.lesson.id, `locale=${e.target.value}`); });
}

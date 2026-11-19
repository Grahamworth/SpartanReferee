// Programs (#/programs; 19 November 2026): for admins, programme owners and content editors / translators. Change a programme where
// it stands: a lesson looks as learners see it, and you type straight into it (headings, bullet points, what the voice says, notes),
// tap its picture to choose another, and write its quick-check questions. Another language shows the English above each line to
// translate. Everything is saved as a draft as you go; learners see nothing until a programme owner (or an admin) presses Publish,
// which publishes every draft of the programme and its new lesson order at once. Reviews and Media live here too.
// The server side is api/src/learn/authoring.js.
import { ANIMS, animName, mediaUrl, youtubeId, upload } from './slide-visual.js';
import { $, call, esc, t, toast, act, redraw, has, isAdmin, LANG } from './core.js';
import { FIGURES } from './lesson.js';

// ---------------------------------------------------------------- the switch at the top: Programs, Reviews, Media
export function programsTabs(on) {
  const tabs = [['programs', '#/programs', t('Programs'), true],
    ['reviews', '#/reviews', t('Reviews'), isAdmin() || has('programme_owner') || has('content_editor')],
    ['media', '#/media', t('Media'), isAdmin() || has('programme_owner')]].filter((x) => x[3]);
  return tabs.length > 1 ? `<p class="chips inviteTabs">${tabs.map(([k, href, label]) => `<a class="chipLink${k === on ? ' on' : ''}" href="${href}">${esc(label)}</a>`).join('')}</p>` : '';
}

const langName = (c) => LANG[c] || c;
const pending = (p) => [p.lessonsChanged ? t(p.lessonsChanged === 1 ? '1 lesson changed' : '{n} lessons changed', { n: p.lessonsChanged }) : '', p.orderChanged ? t('new lesson order') : ''].filter(Boolean).join(' · ');

// ---------------------------------------------------------------- the list
async function listView() {
  const { programmes } = await call('authoring');
  return `<section class="card"><h1>Programs</h1>${programsTabs('programs')}
    <p class="note">Change a programme's lessons where they stand: text, pictures, bullet points, quick-check questions, translations and the order. Changes are drafts until a programme owner publishes them.</p>
    <ul class="rowList progEdList">${programmes.map((p) => `<li><a href="#/programs/${esc(p.id)}"><b>${esc(p.title)}</b>
      <small>${esc([p.edition, p.locales.map(langName).join(', ')].filter(Boolean).join(' · '))}</small>
      ${p.drafts || p.orderChanged ? `<small class="draftLine">${esc(t('Not published yet: {what}', { what: pending(p) }))}</small>` : `<small>${esc(t('Everything published'))}</small>`}</a></li>`).join('') || `<li class="muted">${esc(t('No programmes you can change.'))}</li>`}</ul></section>`;
}

// ---------------------------------------------------------------- a programme: its lessons, their order, publishing
let PROG = null;
function publishBar(d) {
  const changed = d.drafts || d.order;
  return `<div class="publishBar${changed ? ' isDraft' : ''}" id="publishBar">
    <span>${changed ? esc(t('Not published yet: {what}', { what: pending({ lessonsChanged: new Set((d.modules || []).flatMap((m) => m.lessons.filter((l) => l.draftLocales.length))).size || d.drafts, orderChanged: !!d.order }) })) : esc(t('Everything published'))}</span>
    ${changed ? `<span class="btnRow">${d.can.publish ? '<button class="primary small" type="button" id="publishAll">Publish</button>' : `<small class="muted">${esc(t('A programme owner publishes it.'))}</small>`}
      <button class="small" type="button" id="discardAll">Discard changes</button></span>` : ''}</div>`;
}
async function programmeView(pid) {
  const d = PROG = await call(`authoring/${encodeURIComponent(pid)}`);
  // a new order waiting to be published shows as it will be
  const ordered = d.modules.map((m) => {
    const o = d.order?.find((x) => x.moduleId === m.id);
    return { ...m, lessons: o ? o.lessons.map((id) => m.lessons.find((l) => l.id === id)).filter(Boolean) : m.lessons };
  });
  const lessonRow = (m, l, i) => `<li class="edLessonRow" data-lesson="${esc(l.id)}">
      <span class="moveBtns"><button class="iconSmall" type="button" data-move="-1" aria-label="${esc(t('Move up'))}"${i === 0 ? ' disabled' : ''}>▲</button><button class="iconSmall" type="button" data-move="1" aria-label="${esc(t('Move down'))}"${i === m.lessons.length - 1 ? ' disabled' : ''}>▼</button></span>
      <a href="#/programs/${esc(pid)}/${esc(l.id)}"><b>${esc(l.title)}</b>
      <small>${l.draftLocales.length ? `<span class="draftTag">${esc(t('Draft'))}</span> ${esc(l.draftLocales.map(langName).join(', '))}` : esc(!l.publishedLocales.length ? t('Being written') : l.publishedLocales.length > 3 ? t('Published in {n} languages', { n: l.publishedLocales.length }) : l.publishedLocales.map(langName).join(', '))}</small></a></li>`;
  return `<section class="card"><p class="crumbs"><a href="#/programs">Programs</a></p><h1>${esc(d.programme.title)}</h1>
      <p class="muted">${esc(d.version.edition)}</p>${publishBar(d)}</section>
    ${ordered.map((m) => `<section class="card"><h2>${esc(m.title)}</h2>
      <ol class="rowList edLessons" data-module="${esc(m.id)}">${m.lessons.map((l, i) => lessonRow(m, l, i)).join('')}</ol></section>`).join('')}`;
}

// ---------------------------------------------------------------- a lesson, edited in place
let ED = null; // { pid, lessonId, locale, data, timer, saving }
const ce = (field, value, cls = '', label = '') => `<div class="ce ${cls}" contenteditable="plaintext-only" spellcheck="true" data-f="${field}" role="textbox" aria-label="${esc(t(label || field))}" data-placeholder="${esc(t(label || field))}">${esc(value || '')}</div>`;
const enLine = (text) => (ED.locale !== 'en' && text ? `<p class="edEn" lang="en"><span>${esc(t('English'))}</span> ${esc(text)}</p>` : '');

/** what the picture box shows while editing: the drawing, or a still of the media (an animation or a video plays in the lesson itself) */
function previewHtml(s) {
  const m = s.media;
  if (m?.type === 'image') return `<img class="edPrev" src="${esc(mediaUrl(m.src))}" alt="">`;
  if (m?.type === 'video') return `<video class="edPrev" src="${esc(mediaUrl(m.src))}#t=0.5" muted playsinline preload="metadata"></video><span class="edTag">${esc(t('Video'))}</span>`;
  if (m?.type === 'youtube') return `<img class="edPrev" src="https://i.ytimg.com/vi/${esc(m.src)}/hqdefault.jpg" alt=""><span class="edTag">YouTube</span>`;
  if (m?.type === 'anim') return `<span class="edAnimTag"><b>▶</b> ${esc(t('Animation: {title}', { title: t(animName(m.src)) }))}</span>`;
  return FIGURES[s.figure] || FIGURES.placeholder;
}
function slideHtml(s, i, n, en) {
  const tr = ED.locale !== 'en';
  const points = s.points.length ? s.points : [''];
  return `<article class="edSlide" data-i="${i}">
    <header class="edBar"><span class="lpCount">${esc(t('Slide {n} of {total}', { n: i + 1, total: n }))}</span>
      ${tr ? '' : `<span class="btnRow"><button class="iconSmall" type="button" data-slide-move="-1" aria-label="${esc(t('Move up'))}"${i === 0 ? ' disabled' : ''}>▲</button><button class="iconSmall" type="button" data-slide-move="1" aria-label="${esc(t('Move down'))}"${i === n - 1 ? ' disabled' : ''}>▼</button><button class="iconSmall" type="button" data-slide-del aria-label="${esc(t('Remove this slide'))}"${n === 1 ? ' disabled' : ''}>✕</button></span>`}</header>
    <button class="lpFig edFig" type="button" data-fig="${esc(s.figure || '')}" data-media="${esc(s.media ? JSON.stringify(s.media) : '')}"${tr ? ' disabled' : ''} aria-label="${esc(t('Change the picture'))}">${previewHtml(s)}${tr ? '' : `<span class="edFigHint">${esc(t('Change the picture'))}</span>`}</button>
    <div class="figPick" hidden></div>
    <div class="lpText">
      ${enLine(en?.heading)}${ce('heading', s.heading, 'edHeading', 'Heading')}
      <ul class="lpPoints edPoints">${points.map((p, j) => `<li>${enLine(en?.points?.[j])}${ce('point', p, '', 'Bullet point')}</li>`).join('')}</ul>
      ${tr ? '' : `<button class="link addPoint" type="button">+ ${esc(t('Add a bullet point'))}</button>`}
      <div class="edVoice"><span class="edLabel">${esc(t('What the voice says (and the captions)'))}</span>${enLine(en?.narration)}${ce('narration', s.narration, 'edNarr', 'What the voice says')}</div>
      ${s.note || en?.note || !tr ? `<div class="edVoice"><span class="edLabel">${esc(t('Note under the slide (optional)'))}</span>${enLine(en?.note)}${ce('note', s.note, 'edNote', 'Note under the slide')}</div>` : ''}
    </div></article>`;
}
function checkHtml(k, i, en) {
  const tr = ED.locale !== 'en', right = tr ? en?.answer : k.answer;
  const options = k.options.length ? k.options : ['', ''];
  return `<article class="edQ" data-i="${i}" data-key="${esc(k.key || '')}">
    <header class="edBar"><span class="lpCount">${esc(t('Question {n}', { n: i + 1 }))}</span>${tr ? '' : `<button class="iconSmall" type="button" data-q-del aria-label="${esc(t('Remove this question'))}">✕</button>`}</header>
    ${enLine(en?.prompt)}${ce('prompt', k.prompt, 'quizQ', 'The question')}
    <ul class="edOptions">${options.map((o, j) => `<li class="${j === right ? 'isRightOpt' : ''}">
      ${tr ? `<span class="optMark" aria-hidden="true">${j === right ? '✓' : ''}</span>` : `<label class="optMark"><input type="radio" name="right-${i}" value="${j}"${j === right ? ' checked' : ''} aria-label="${esc(t('The right answer'))}"></label>`}
      <div class="optText">${enLine(en?.options?.[j])}${ce('option', o, '', 'An answer')}</div>
      ${tr ? '' : `<button class="iconSmall" type="button" data-opt-del aria-label="${esc(t('Remove this answer'))}"${options.length <= 2 ? ' disabled' : ''}>✕</button>`}</li>`).join('')}</ul>
    ${tr ? '' : `<button class="link addOpt" type="button">+ ${esc(t('Add an answer'))}</button><p class="note">${esc(t('Tick the right answer.'))}</p>`}
    <div class="edVoice"><span class="edLabel">${esc(t('Shown after answering (optional)'))}</span>${enLine(en?.feedback)}${ce('feedback', k.feedback, '', 'Shown after answering')}</div></article>`;
}

async function lessonEditView(pid, lessonId) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = await call(`authoring/lessons/${encodeURIComponent(lessonId)}?locale=${encodeURIComponent(q.get('lang') || 'en')}`);
  // what's being edited: this language's draft, else what's published in it, else (a new translation) the English to translate
  const base = d.draft || d.published || (d.english && { slides: d.english.slides, checks: d.english.checks.map((k) => ({ ...k, ...(d.locale === 'en' ? {} : { prompt: '', options: k.options.map(() => ''), feedback: '' }) })) });
  const work = base ? JSON.parse(JSON.stringify(base)) : { slides: [{ heading: d.lesson.title, points: [], narration: '', figure: '' }], checks: [] };
  if (d.locale !== 'en' && d.english) {
    // a translation follows the English: the same slides, pictures and questions, in its words
    work.slides = d.english.slides.map((en, i) => ({ ...en, heading: work.slides[i]?.heading ?? '', points: en.points.map((_, j) => work.slides[i]?.points?.[j] ?? ''), narration: work.slides[i]?.narration ?? '', note: work.slides[i]?.note ?? '' }));
    work.checks = d.english.checks.map((en) => { const k = work.checks?.find((x) => x.key === en.key); return { key: en.key, prompt: k?.prompt || '', options: en.options.map((_, j) => k?.options?.[j] || ''), feedback: k?.feedback || '' }; });
  }
  ED = { pid, lessonId, locale: d.locale, data: d, english: d.english, timer: null, dirty: false };
  const en = d.locale === 'en' ? null : d.english;
  const state = d.draft ? `<span class="draftTag">${esc(t('Draft'))}</span> ${esc(t('Not published yet'))}` : d.published ? esc(t('Published: your changes make a draft')) : esc(t('New: nothing published yet'));
  return `<section class="card edHead"><p class="crumbs"><a href="#/programs">Programs</a> › <a href="#/programs/${esc(pid)}">${esc(d.lesson.programme)}</a></p>
      <h1>${esc(d.lesson.title)}</h1><p class="muted">${esc(d.lesson.module)}</p>
      <p class="chips edLangs" data-i18n-skip>${d.locales.map((c) => `<a class="chipLink${c === d.locale ? ' on' : ''}" href="#/programs/${esc(pid)}/${esc(lessonId)}?lang=${esc(c)}">${esc(langName(c))}</a>`).join('')}</p>
      <p class="edState"><span id="edState">${state}</span> <span class="muted" id="edSaved" aria-live="polite"></span></p>
      <div class="btnRow">${d.can.publish ? `<button class="primary small" type="button" id="publishAll"${d.draft ? '' : ' hidden'}>Publish</button>` : ''}<button class="small" type="button" id="discardDraft"${d.draft ? '' : ' hidden'}>${esc(t('Discard this draft'))}</button>
        <a class="btnLink" href="#/lesson/${esc(lessonId)}?locale=${esc(d.locale)}">${esc(t('See it as learners do'))}</a></div>
      ${d.locale !== 'en' ? `<p class="note">${esc(t('Translating into {lang}: the English is shown above each line. Pictures and the right answers come from the English. A line left empty shows in English.', { lang: langName(d.locale) }))}</p>` : `<p class="note">${esc(t('Type straight into the lesson. It saves as a draft as you go; learners see it once it is published.'))}</p>`}
    </section>
    <section class="card edLesson" id="edLesson">${work.slides.map((s, i) => slideHtml(s, i, work.slides.length, en?.slides?.[i])).join('')}
      ${d.locale === 'en' ? `<button class="small" type="button" id="addSlide">+ ${esc(t('Add a slide'))}</button>` : ''}</section>
    <section class="card edChecks"><h2>Quick check</h2><p class="note">${esc(t('The questions at the end of the lesson. Practice only: they help it stick.'))}</p>
      <div id="edQs">${work.checks.map((k, i) => checkHtml(k, i, en?.checks?.[i])).join('')}</div>
      ${d.locale === 'en' ? `<button class="small" type="button" id="addQ">+ ${esc(t('Add a question'))}</button>` : ''}</section>`;
}

// what's on the page, as the draft to save
function collect() {
  const val = (el) => (el?.innerText || '').replace(/ /g, ' ').trim();
  const enSlides = ED.english?.slides || [];
  const slides = [...document.querySelectorAll('.edSlide')].map((a, i) => {
    const en = enSlides[i] || {};
    // a translation's line left empty keeps the English, so its slides and bullet points stay matched to the English ones
    const or = (x, e) => (ED.locale === 'en' ? x : x || e || '');
    return { heading: or(val(a.querySelector('[data-f=heading]')), en.heading), points: [...a.querySelectorAll('[data-f=point]')].map((p, j) => or(val(p), en.points?.[j])).filter(Boolean),
      narration: or(val(a.querySelector('[data-f=narration]')), en.narration), note: or(val(a.querySelector('[data-f=note]')), en.note), figure: a.querySelector('.edFig').dataset.fig || '',
      ...(ED.locale === 'en' ? (a.querySelector('.edFig').dataset.media ? { media: JSON.parse(a.querySelector('.edFig').dataset.media) } : {}) : (en.media ? { media: en.media } : {})),
      // what only the English sets: rules, a review note, a box under the slide
      ...(ED.locale === 'en' ? { rules: ED.base?.[i]?.rules || [], review: ED.base?.[i]?.review || '', action: ED.base?.[i]?.action } : { rules: en.rules || [], review: '', action: en.action }) };
  });
  const checks = [...document.querySelectorAll('.edQ')].map((q) => ({ key: q.dataset.key, prompt: val(q.querySelector('[data-f=prompt]')),
    options: [...q.querySelectorAll('[data-f=option]')].map(val), feedback: val(q.querySelector('[data-f=feedback]')),
    ...(ED.locale === 'en' ? { answer: Number(q.querySelector('input[type=radio]:checked')?.value ?? 0), rules: ED.checkRules?.[q.dataset.key] || [] } : {}) }));
  return { slides, checks };
}
// the line under the lesson's title that says how saving went (it may be gone: the page moved on while saving)
const said = (text) => { if ($('edSaved')) $('edSaved').textContent = text; };
async function save() {
  const ed = ED; if (!ed) return;
  clearTimeout(ed.timer); ed.timer = null;
  if (!ed.dirty || !document.querySelector('.edSlide')) return;
  ed.dirty = false;
  const body = collect();
  // a heading is needed for each slide: say so rather than lose the rest
  if (body.slides.some((x) => !x.heading)) { ed.dirty = true; said(t('Not saved: every slide needs a heading')); return; }
  said(t('Saving…'));
  try {
    await call(`authoring/lessons/${encodeURIComponent(ed.lessonId)}/${encodeURIComponent(ed.locale)}`, { method: 'PUT', body });
    if (ED !== ed) return;
    said(t('Saved as a draft'));
    if (!ed.data.draft) {
      ed.data.draft = { id: 'new' };
      if ($('edState')) $('edState').innerHTML = `<span class="draftTag">${esc(t('Draft'))}</span> ${esc(t('Not published yet'))}`;
      for (const id of ['publishAll', 'discardDraft']) if ($(id)) $(id).hidden = false;
    }
  } catch (e) { ed.dirty = true; said(e.message); if (ED !== ed) toast(e.message); }
}
const changed = () => { ED.dirty = true; said(t('Editing…')); clearTimeout(ED.timer); ED.timer = setTimeout(save, 1200); };
// leaving the lesson: what's typed is saved first
window.addEventListener('hashchange', () => { if (ED?.dirty) save(); });
window.addEventListener('pagehide', () => { if (ED?.dirty) save(); });

function renumber() {
  const slides = [...document.querySelectorAll('.edSlide')], n = slides.length;
  slides.forEach((a, i) => {
    a.querySelector('.lpCount').textContent = t('Slide {n} of {total}', { n: i + 1, total: n });
    const [up, down, del] = a.querySelectorAll('.edBar button');
    if (up) { up.disabled = i === 0; down.disabled = i === n - 1; del.disabled = n === 1; }
  });
  [...document.querySelectorAll('.edQ')].forEach((q, i) => {
    q.querySelector('.lpCount').textContent = t('Question {n}', { n: i + 1 });
    q.querySelectorAll('input[type=radio]').forEach((r) => { r.name = `right-${i}`; });
  });
}
function figurePicker(slide) {
  const box = slide.querySelector('.figPick'), fig = slide.querySelector('.edFig');
  if (!box.hidden) { box.hidden = true; return; }
  const media = fig.dataset.media ? JSON.parse(fig.dataset.media) : null;
  const set = (figure, m) => {
    fig.dataset.fig = figure ?? fig.dataset.fig; fig.dataset.media = m ? JSON.stringify(m) : '';
    fig.innerHTML = `${previewHtml({ figure: fig.dataset.fig, media: m })}<span class="edFigHint">${esc(t('Change the picture'))}</span>`;
    box.hidden = true; changed();
  };
  const tab = media?.type === 'anim' ? 'anim' : media?.type === 'youtube' ? 'yt' : media ? 'file' : 'draw';
  const tabs = [['draw', 'Drawing'], ['anim', 'Animation'], ['file', 'Picture or video'], ['yt', 'YouTube link']];
  box.innerHTML = `<div class="figTabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="small${k === tab ? ' on' : ''}" data-tab="${k}" aria-selected="${k === tab}">${esc(t(l))}</button>`).join('')}</div>
    <div class="figPane" data-pane="draw"${tab === 'draw' ? '' : ' hidden'}><div class="figGrid">${Object.entries(FIGURES).map(([k, f]) => `<button type="button" class="figOpt${!media && (fig.dataset.fig === k || (!fig.dataset.fig && k === 'placeholder')) ? ' on' : ''}" data-pick="${esc(k)}" aria-label="${esc(k)}">${f}</button>`).join('')}</div></div>
    <div class="figPane" data-pane="anim"${tab === 'anim' ? '' : ' hidden'}><p class="note">${esc(t('It plays a good run, then slows down on what counts and on a fail, with captions.'))}</p>
      <div class="animList">${ANIMS.map(([k, l]) => `<button type="button" class="small${media?.type === 'anim' && media.src === k ? ' on' : ''}" data-anim="${esc(k)}">${esc(t(l))}</button>`).join('')}</div></div>
    <div class="figPane" data-pane="file"${tab === 'file' ? '' : ' hidden'}><p class="note">${esc(t('A picture (JPG, PNG, WebP, GIF, up to 15 MB) or a video (MP4, WebM, MOV, up to 500 MB).'))}</p>
      <label class="btnLink figUpload">${esc(t('Choose a file'))}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" hidden></label>
      <span class="bar figBar" hidden><span style="width:0"></span></span><span class="muted figMsg" aria-live="polite"></span></div>
    <div class="figPane" data-pane="yt"${tab === 'yt' ? '' : ' hidden'}><label class="figYt"><span>${esc(t('Paste a YouTube link'))}</span>
      <input type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" value="${media?.type === 'youtube' ? esc(`https://www.youtube.com/watch?v=${media.src}`) : ''}"></label>
      <button type="button" class="small" data-yt-use>${esc(t('Use this video'))}</button><span class="muted figMsg" aria-live="polite"></span>
      <p class="note">${esc(t('Captions show in the learner’s language where YouTube can translate them.'))}</p></div>
    ${media ? `<p class="figRemove"><button type="button" class="link" data-media-off>${esc(t('Use the drawing instead'))}</button></p>` : ''}`;
  box.hidden = false;
  for (const b of box.querySelectorAll('[data-tab]')) b.onclick = () => {
    for (const x of box.querySelectorAll('[data-tab]')) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); }
    for (const p of box.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== b.dataset.tab;
  };
  for (const b of box.querySelectorAll('[data-pick]')) b.onclick = () => set(b.dataset.pick === 'placeholder' ? '' : b.dataset.pick, null);
  for (const b of box.querySelectorAll('[data-anim]')) b.onclick = () => set(null, { type: 'anim', src: b.dataset.anim });
  box.querySelector('[data-media-off]')?.addEventListener('click', () => set(null, null));
  const ytPane = box.querySelector('[data-pane=yt]');
  ytPane.querySelector('[data-yt-use]').onclick = () => {
    const id = youtubeId(ytPane.querySelector('input').value);
    if (!id) { ytPane.querySelector('.figMsg').textContent = t('That isn’t a YouTube link'); return; }
    set(null, { type: 'youtube', src: id });
  };
  const filePane = box.querySelector('[data-pane=file]'), input = filePane.querySelector('input[type=file]');
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    const bar = filePane.querySelector('.figBar'), msg = filePane.querySelector('.figMsg');
    bar.hidden = false; msg.textContent = t('Uploading {name}…', { name: f.name });
    try {
      const m = await upload(f, call, { programmeId: ED.pid, progress: (k) => { bar.firstElementChild.style.width = `${Math.round(k * 100)}%`; } });
      set(null, m);
    } catch (e) { msg.textContent = e.message || t('The upload didn’t work: try again'); bar.hidden = true; }
  };
}
function wireLesson() {
  const root = $('edLesson'); if (!root) return;
  // what the English alone sets, kept as it was (rules on each slide and question)
  const own = ED.data.draft || ED.data.published || ED.data.english;
  ED.base = (ED.locale === 'en' ? own?.slides : null) || [];
  ED.checkRules = Object.fromEntries((ED.data.english?.checks || []).map((k) => [k.key, k.rules || []]));
  root.addEventListener('input', changed);
  $('edQs').addEventListener('input', changed);
  $('edQs').addEventListener('change', (e) => { const q = e.target.closest('.edQ'); if (!q) return; for (const li of q.querySelectorAll('.edOptions li')) li.classList.toggle('isRightOpt', !!li.querySelector('input')?.checked); changed(); });
  // a bullet point: Enter starts the next one, Backspace in an empty one takes it away
  root.addEventListener('keydown', (e) => {
    const f = e.target.closest?.('[data-f]'); if (!f) return;
    if (f.dataset.f === 'point' && e.key === 'Enter' && ED.locale === 'en') {
      e.preventDefault();
      const li = f.closest('li'), next = document.createElement('li'); next.innerHTML = ce('point', '', '', 'Bullet point'); li.after(next); next.querySelector('[data-f]').focus(); changed();
    } else if (f.dataset.f === 'point' && e.key === 'Backspace' && !f.innerText.trim() && ED.locale === 'en' && f.closest('ul').children.length > 1) {
      e.preventDefault();
      const li = f.closest('li'), prev = li.previousElementSibling || li.nextElementSibling; li.remove(); placeEnd(prev?.querySelector('[data-f]')); changed();
    } else if (['heading', 'prompt', 'option'].includes(f.dataset.f) && e.key === 'Enter') e.preventDefault(); // one line
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const slide = b.closest('.edSlide');
    if (b.classList.contains('edFig')) figurePicker(slide);
    else if (b.classList.contains('addPoint')) { const li = document.createElement('li'); li.innerHTML = ce('point', '', '', 'Bullet point'); slide.querySelector('.edPoints').append(li); li.querySelector('[data-f]').focus(); changed(); }
    else if (b.dataset.slideMove) { const dir = Number(b.dataset.slideMove), other = dir < 0 ? slide.previousElementSibling : slide.nextElementSibling; if (other?.classList.contains('edSlide')) { if (dir < 0) other.before(slide); else other.after(slide); ED.base = moveIn(ED.base, Number(slide.dataset.i), dir); reindex(); renumber(); changed(); } }
    else if (b.hasAttribute('data-slide-del')) { if (confirm(t('Remove this slide?'))) { ED.base.splice(Number(slide.dataset.i), 1); slide.remove(); reindex(); renumber(); changed(); } }
  });
  $('addSlide')?.addEventListener('click', () => {
    const n = document.querySelectorAll('.edSlide').length;
    $('addSlide').insertAdjacentHTML('beforebegin', slideHtml({ heading: '', points: [''], narration: '', note: '', figure: '' }, n, n + 1));
    ED.base.push({}); renumber(); document.querySelectorAll('.edSlide')[n].querySelector('[data-f=heading]').focus();
  });
  const qs = $('edQs');
  qs.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest?.('[data-f=prompt], [data-f=option]')) e.preventDefault(); });
  qs.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const q = b.closest('.edQ');
    if (b.hasAttribute('data-q-del')) { if (confirm(t('Remove this question?'))) { q.remove(); renumber(); changed(); } }
    else if (b.classList.contains('addOpt')) {
      const ul = q.querySelector('.edOptions'), j = ul.children.length; if (j >= 6) return;
      ul.insertAdjacentHTML('beforeend', `<li><label class="optMark"><input type="radio" name="${esc(q.querySelector('input[type=radio]')?.name || 'right')}" value="${j}" aria-label="${esc(t('The right answer'))}"></label><div class="optText">${ce('option', '', '', 'An answer')}</div><button class="iconSmall" type="button" data-opt-del aria-label="${esc(t('Remove this answer'))}">✕</button></li>`);
      ul.lastElementChild.querySelector('[data-f]').focus(); optButtons(q); changed();
    } else if (b.hasAttribute('data-opt-del')) {
      const ul = q.querySelector('.edOptions'); if (ul.children.length <= 2) return;
      b.closest('li').remove(); [...ul.querySelectorAll('input[type=radio]')].forEach((r, j) => { r.value = j; });
      if (!ul.querySelector('input:checked')) ul.querySelector('input').checked = true;
      for (const li of ul.children) li.classList.toggle('isRightOpt', li.querySelector('input')?.checked);
      optButtons(q); changed();
    }
  });
  $('addQ')?.addEventListener('click', () => {
    const n = qs.querySelectorAll('.edQ').length; if (n >= 8) { toast(t('Up to 8 questions')); return; }
    qs.insertAdjacentHTML('beforeend', checkHtml({ key: '', prompt: '', options: ['', ''], answer: 0, feedback: '' }, n));
    qs.lastElementChild.querySelector('[data-f=prompt]').focus();
  });
  $('discardDraft')?.addEventListener('click', (e) => {
    if (!confirm(t('Throw this draft away? The lesson goes back to what is published.'))) return;
    act(async () => { ED.dirty = false; await call(`authoring/lessons/${encodeURIComponent(ED.lessonId)}/${encodeURIComponent(ED.locale)}`, { method: 'DELETE' }); toast(t('Draft thrown away')); redraw(); }, e.currentTarget);
  });
  $('publishAll')?.addEventListener('click', (e) => publish(ED.pid, e.currentTarget));
}
const optButtons = (q) => { const n = q.querySelectorAll('.edOptions li').length; for (const b of q.querySelectorAll('[data-opt-del]')) b.disabled = n <= 2; };
const moveIn = (arr, i, dir) => { const a = [...arr], j = i + dir; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };
const reindex = () => document.querySelectorAll('.edSlide').forEach((a, i) => { a.dataset.i = i; });
function placeEnd(el) { if (!el) return; el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

async function publish(pid, btn) {
  if (ED?.dirty) await save();
  if (!confirm(t('Publish every change to this programme? Learners see it straight away.'))) return;
  act(async () => { const r = await call(`authoring/${encodeURIComponent(pid)}/publish`, { method: 'POST' }); toast(t(r.published === 1 ? 'Published 1 change' : 'Published {n} changes', { n: r.published + (r.order ? 1 : 0) })); redraw(); }, btn);
}

function wireProgramme() {
  if (!PROG || !document.querySelector('.edLessons')) return;
  const pid = PROG.programme.id;
  for (const b of document.querySelectorAll('.edLessonRow [data-move]')) b.onclick = () => {
    const li = b.closest('li'), dir = Number(b.dataset.move), other = dir < 0 ? li.previousElementSibling : li.nextElementSibling; if (!other) return;
    if (dir < 0) other.before(li); else other.after(li);
    const modules = [...document.querySelectorAll('.edLessons')].map((ol) => ({ id: ol.dataset.module, lessons: [...ol.children].map((x) => x.dataset.lesson) }));
    act(async () => { await call(`authoring/${encodeURIComponent(pid)}/order`, { method: 'PUT', body: { modules } }); redraw(); }, b);
  };
  $('publishAll')?.addEventListener('click', (e) => publish(pid, e.currentTarget));
  $('discardAll')?.addEventListener('click', (e) => {
    if (!confirm(t('Throw away every unpublished change to this programme?'))) return;
    act(async () => { await call(`authoring/${encodeURIComponent(pid)}/discard`, { method: 'POST' }); toast(t('Changes thrown away')); redraw(); }, e.currentTarget);
  });
}

export const views = {
  async programs() {
    ED = null; PROG = null;
    // #/programs/<programme>/<lesson>: the app hands a view only the first part after its name, so read the address itself
    const [pid, lessonId] = location.hash.split('?')[0].split('/').slice(2).map(decodeURIComponent);
    if (pid && lessonId) return lessonEditView(pid, lessonId);
    if (pid) return programmeView(pid);
    return listView();
  },
};
export function wire() { if (ED) wireLesson(); else wireProgramme(); }

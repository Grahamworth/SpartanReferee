// The Referee Assistant (#/assistant, 21 November 2026): a chat, like a messaging app, with a helper that knows the obstacles, the
// rules, the lessons, the events and the athletes the cameras filmed. Type or talk; the answer comes back in your language with the
// rule cited, the lesson quoted and links into the app. Asked by voice, it answers by voice too (or always, with the speaker in the
// header). The conversation stays in this tab while you follow its links and come back; nothing is kept on the server but what each
// question cost (api/src/assistant.js).
import { call as siteCall } from '../api-base.js';
import { $, S, esc, t, store } from './core.js';
import { startRecording, play, stopPlaying } from './voice.js';
import { markdown } from './assistant-md.js';
import { visualHtml, wireVisual } from './slide-visual.js';
import { FIGURES } from './lesson.js';

const KEPT = 'sr_assistant', SPEAK = 'sr_assistant_speak';
const lang = () => (window.SR_I18N && window.SR_I18N.lang) || document.documentElement.lang || 'en';
const kept = () => { try { return JSON.parse(sessionStorage.getItem(KEPT)) || []; } catch { return []; } };
const keep = (list) => { try { sessionStorage.setItem(KEPT, JSON.stringify(list.slice(-24))); } catch { /* private mode */ } };
let status = null, busy = false, rec = null;

/** may this person use it? (cached for the page: Home asks it too) */
export async function assistantStatus(fresh) {
  if (!status || fresh) status = siteCall('assistant').catch(() => ({ allowed: false }));
  return status;
}

export const BOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 7V4M9 4h6"/><circle cx="9" cy="13" r="1.4" fill="currentColor"/><circle cx="15" cy="13" r="1.4" fill="currentColor"/><path d="M2 12v3M22 12v3"/></svg>';
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>';
const SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2-6-8-2z"/></svg>';
const NEW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
const TICKS = '<svg class="asTicks" viewBox="0 0 18 12" aria-hidden="true"><path d="M1 6.5l3 3 6-7M7 9.5l1 1 6-8.5"/></svg>';

// the time as the phone shows it (24-hour in the UK), in the site's language
const clock = (at) => (at ? new Date(at).toLocaleTimeString(navigator.language?.startsWith(lang()) ? navigator.language : lang(), { hour: '2-digit', minute: '2-digit' }) : '');
// the pictures, videos and animations an answer shows (api/src/assistant.js picks them from the knowledge), drawn as lesson slides
// draw theirs (slide-visual.js): an animation with its player, a YouTube video waiting for a tap, a lesson's picture, video or drawing
const MEDIA_SRC = { anim: /^[a-z]{2,20}$/, figure: /^[a-z]{2,20}$/, youtube: /^[\w-]{11}$/, image: /^[\w-]{8,64}\.\w{2,5}$/, video: /^[\w-]{8,64}\.\w{2,5}$/ };
const mediaHtml = (list) => {
  const ok = (Array.isArray(list) ? list : []).filter((x) => x && MEDIA_SRC[x.type]?.test(String(x.src)) && (x.type !== 'figure' || FIGURES[x.src]));
  return ok.length ? `<div class="asMedia">${ok.map((x) => `<div class="asShow lpFig lpFigMedia" data-media="${esc(x.type)}">${visualHtml(x.type === 'figure' ? { figure: x.src } : { media: { type: x.type, src: x.src }, heading: x.title }, FIGURES)}</div>`).join('')}</div>` : '';
};
const bubble = (m, i) => m.role === 'user'
  ? `<li class="asMsg asYou"><p>${esc(m.content)}</p><span class="asTime">${esc(clock(m.at))}${TICKS}</span></li>`
  : `<li class="asMsg asIt${m.media?.length ? ' asHasMedia' : ''}">${markdown(m.content)}${mediaHtml(m.media)}<span class="asTime">${esc(clock(m.at))}</span>${m.voice !== false ? `<button class="asReplay" type="button" data-say="${i}" aria-label="${esc(t('Read it aloud'))}" title="${esc(t('Read it aloud'))}">${SPEAKER}</button>` : ''}</li>`;
const hello = () => {
  const p = S.me?.person || {}, name = String(p.preferredName || p.legalName || '').split(' ')[0];
  return `<li class="asMsg asIt asHello"><p>${esc(name ? t('Hi {name}! You can ask me anything about Spartan\'s rules, obstacles and refereeing.', { name }) : t('Hi! You can ask me anything about Spartan\'s rules, obstacles and refereeing.'))}</p></li>`;
};
const logHtml = (list) => hello() + list.map(bubble).join('');

async function assistantView() {
  const s = await assistantStatus(true);
  if (!s.allowed) {
    return `<section class="card"><h1>${esc(t('Referee Assistant'))}</h1><p class="note">${esc(t('The Referee Assistant isn\'t switched on for you yet. An admin can turn it on in Admin Config.'))}</p></section>`;
  }
  const list = kept(), speak = store.get(SPEAK) === '1';
  return `<section class="asChat" id="asChat">
    <header class="asBar">
      <span class="asAvatar">${BOT}</span>
      <span class="asWho"><b>${esc(t('Referee Assistant'))}</b><small><span class="asDot" aria-hidden="true"></span><span id="asState">${esc(t('Online'))}</span></small></span>
      ${s.voice ? `<button class="asIcon${speak ? ' on' : ''}" type="button" id="asSpeak" aria-pressed="${speak}" aria-label="${esc(t('Read answers aloud'))}" title="${esc(t('Read answers aloud'))}">${SPEAKER}</button>` : ''}
      <button class="asIcon" type="button" id="asNew" aria-label="${esc(t('New conversation'))}" title="${esc(t('New conversation'))}">${NEW}</button>
    </header>
    <ol class="asLog" id="asLog" aria-live="polite">${logHtml(list)}</ol>
    <p class="asError" id="asError" role="alert" hidden></p>
    <form class="asAsk" id="asAsk">
      <div class="asField">
        <textarea id="asQ" rows="1" maxlength="2000" placeholder="${esc(t('Type a message'))}" aria-label="${esc(t('Your question'))}" enterkeyhint="send"></textarea>
        <p class="asListening" id="asListening" hidden><span class="asRec" aria-hidden="true"></span><span>${esc(t('Listening… tap the microphone again when you\'ve finished.'))}</span><span class="asLevel"><span id="asLevel"></span></span></p>
      </div>
      ${s.voice ? `<button class="asRound asMic" type="button" id="asMic" aria-label="${esc(t('Ask by voice'))}" title="${esc(t('Ask by voice'))}">${MIC}</button>` : ''}
      <button class="asRound asSend" type="submit" id="asSend" aria-label="${esc(t('Send'))}" title="${esc(t('Send'))}"${s.voice ? ' hidden' : ''}>${SEND}</button>
    </form></section>`;
}

const failAs = (msg) => { const e = $('asError'); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; };
const toBottom = (smooth) => { const log = $('asLog'); if (log) log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); };
function draw(list) {
  const log = $('asLog'); if (!log) return;
  log.innerHTML = logHtml(list);
  wireVisual(log);
  toBottom(true);
}
async function say(text) {
  try { const r = await siteCall('assistant/speak', { method: 'POST', body: { text, lang: lang() } }); play(r.audio); } catch (e) { failAs(e.message); }
}
const typing = (on) => { const s = $('asState'); if (s) s.textContent = on ? t('Typing…') : t('Online'); };
// with voice, the round button is the microphone until there's something typed, then it's Send (as in a messaging app)
function swap() {
  const mic = $('asMic'); if (!mic) return;
  const typed = !!$('asQ')?.value.trim();
  mic.hidden = typed && !rec; $('asSend').hidden = !typed || !!rec;
}

async function ask(question, byVoice = false) {
  question = String(question || '').trim();
  if (!question || busy) return;
  busy = true; failAs(''); stopPlaying();
  const list = [...kept(), { role: 'user', content: question, at: Date.now() }];
  keep(list);
  draw(list);
  $('asLog').insertAdjacentHTML('beforeend', `<li class="asMsg asIt asThinking" id="asThinking"><span class="asDots" aria-hidden="true"><i></i><i></i><i></i></span><span class="visuallyHidden">${esc(t('Looking it up…'))}</span></li>`);
  toBottom(true); typing(true);
  $('asSend').disabled = true;
  try {
    const r = await siteCall('assistant/ask', { method: 'POST', body: { lang: lang(), messages: list.map(({ role, content }) => ({ role, content })) } });
    const done = [...list, { role: 'assistant', content: r.answer, at: Date.now(), ...(r.media?.length ? { media: r.media } : {}) }];
    keep(done); draw(done);
    // a long answer opens at its start, under the question, rather than at its end
    const log = $('asLog'), mine = log?.querySelectorAll('.asYou'), q = mine?.[mine.length - 1];
    if (q) log.scrollTo({ top: Math.max(0, q.offsetTop - 8), behavior: 'smooth' });
    if (byVoice || $('asSpeak')?.getAttribute('aria-pressed') === 'true') say(r.answer);
  } catch (e) {
    $('asThinking')?.remove(); failAs(e.message);
  } finally { busy = false; typing(false); const b = $('asSend'); if (b) b.disabled = false; }
}

async function toggleMic() {
  const mic = $('asMic'); if (!mic) return;
  const listening = (on) => { mic.classList.toggle('on', on); $('asListening').hidden = !on; $('asQ').hidden = on; };
  if (rec) { // finished talking: what was said becomes the question
    const r = rec; rec = null; listening(false); clearInterval(toggleMic.meter);
    try {
      const { audio, seconds } = await r.stop();
      if (seconds < 0.6) return failAs(t('That was too short: hold on a moment longer.'));
      mic.disabled = true; typing(true);
      const { text } = await siteCall('assistant/listen', { method: 'POST', body: { audio, lang: lang() } });
      typing(false);
      if (!text) return failAs(t('I didn\'t catch that: try again, or type it.'));
      await ask(text, true);
    } catch (e) { typing(false); failAs(e.message); } finally { mic.disabled = false; swap(); }
    return;
  }
  failAs(''); stopPlaying();
  try {
    rec = await startRecording({ onAutoStop: () => toggleMic() });
    listening(true);
    toggleMic.meter = setInterval(() => { const l = $('asLevel'); if (l && rec) l.style.width = `${Math.round(rec.level() * 100)}%`; }, 100);
  } catch (e) { rec = null; failAs(e.name === 'NotAllowedError' ? t('The microphone isn\'t allowed: allow it in the browser\'s settings, or type the question.') : e.message); }
}

// the chat fills the screen down to the tabs, the messages scrolling inside it and the box to type in staying at the bottom, also
// while the phone's keyboard is up
function fit() {
  const chat = $('asChat'); if (!chat) return;
  const vv = window.visualViewport, h = vv ? vv.height : innerHeight;
  const tabs = document.querySelector('.appTabs:not([hidden])'), below = tabs && getComputedStyle(tabs).position === 'fixed' && !(vv && vv.height < innerHeight - 120) ? tabs.offsetHeight : 0;
  const top = chat.getBoundingClientRect().top + scrollY; // where it starts on the page, under the header
  chat.style.height = `${Math.max(320, Math.round(h - top - below - 10))}px`;
}

export function wire() {
  const form = $('asAsk'); if (!form || form.dataset.wired) return;
  form.dataset.wired = '1';
  const q = $('asQ');
  const grow = () => { q.style.height = 'auto'; q.style.height = `${Math.min(q.scrollHeight, 140)}px`; };
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = q.value; q.value = ''; grow(); swap(); ask(v); });
  // Enter sends; Shift+Enter is a new line
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  q.addEventListener('input', () => { grow(); swap(); });
  q.addEventListener('focus', () => setTimeout(() => { fit(); toBottom(); }, 300));
  $('asMic')?.addEventListener('click', toggleMic);
  $('asSpeak')?.addEventListener('click', (e) => {
    const b = e.currentTarget, on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); store.set(SPEAK, on ? '1' : ''); if (!on) stopPlaying();
  });
  $('asNew').addEventListener('click', () => { keep([]); stopPlaying(); failAs(''); draw([]); });
  $('asLog').addEventListener('click', (e) => { const b = e.target.closest('[data-say]'); if (b) { const m = kept()[Number(b.dataset.say)]; if (m) say(m.content); } });
  wireVisual($('asLog'));
  fit(); toBottom();
  const refit = () => { if ($('asChat')) fit(); };
  window.visualViewport?.addEventListener('resize', refit); window.addEventListener('resize', refit);
  // leaving the page stops the microphone and the voice
  window.addEventListener('hashchange', () => {
    if (rec) { rec.cancel(); rec = null; } stopPlaying();
    window.visualViewport?.removeEventListener('resize', refit); window.removeEventListener('resize', refit);
  }, { once: true });
}

export const views = { assistant: assistantView };

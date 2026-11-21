// The Assistant (#/assistant, 21 November 2026): ask about an obstacle, a rule, a lesson, an event or an athlete the cameras filmed,
// by typing or by talking, and the answer comes back in your language with the rule cited, the lesson quoted and links into the app.
// Asked by voice, it answers by voice too (or always, with "Read answers aloud"). The conversation stays in this tab while you follow
// its links and come back; nothing is kept on the server but what each question cost (api/src/assistant.js).
import { call as siteCall } from '../api-base.js';
import { $, esc, t, store } from './core.js';
import { startRecording, play, stopPlaying } from './voice.js';
import { markdown } from './assistant-md.js';

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

const bubble = (m, i) => m.role === 'user'
  ? `<li class="asMsg asYou"><p>${esc(m.content)}</p></li>`
  : `<li class="asMsg asIt">${markdown(m.content)}${m.voice !== false ? `<button class="asReplay" type="button" data-say="${i}" aria-label="${esc(t('Read it aloud'))}" title="${esc(t('Read it aloud'))}">${SPEAKER}</button>` : ''}</li>`;
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>';
const SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2-6-8-2z"/></svg>';
const IDEAS = ['At the Spear Throw, what is a pass and what is a fail?', 'What is the penalty for missed burpees?', 'Which events am I assigned to?', 'Can an athlete kick the bell?'];

async function assistantView() {
  const s = await assistantStatus(true);
  if (!s.allowed) {
    return `<section class="card"><h1>${esc(t('Assistant'))}</h1><p class="note">${esc(t('The Assistant isn\'t switched on for you yet. An admin can turn it on in Admin Config.'))}</p></section>`;
  }
  const list = kept();
  return `<section class="card asCard"><div class="asHead"><h1>${esc(t('Assistant'))}</h1>
      ${list.length ? `<button class="small" type="button" id="asNew">${esc(t('New conversation'))}</button>` : ''}</div>
    <p class="note">${esc(t('Ask about an obstacle, a rule, a lesson, an event or an athlete the cameras filmed. Answers cite the rules and link to them. On the day, the Head Referee\'s call stands.'))}</p>
    <ol class="asLog" id="asLog" aria-live="polite">${list.map(bubble).join('')}</ol>
    ${list.length ? '' : `<div class="asIdeas" id="asIdeas">${IDEAS.map((q) => `<button class="chipBtn" type="button" data-ask="${esc(t(q))}">${esc(t(q))}</button>`).join('')}</div>`}
    <form class="asAsk" id="asAsk">
      <textarea id="asQ" rows="2" maxlength="2000" placeholder="${esc(t('Ask a question…'))}" aria-label="${esc(t('Your question'))}" enterkeyhint="send"></textarea>
      ${s.voice ? `<button class="asMic" type="button" id="asMic" aria-label="${esc(t('Ask by voice'))}" title="${esc(t('Ask by voice'))}">${MIC}</button>` : ''}
      <button class="primary asSend" type="submit" id="asSend" aria-label="${esc(t('Send'))}" title="${esc(t('Send'))}">${SEND}</button>
    </form>
    <p class="asListening" id="asListening" hidden><span class="asLevel"><span id="asLevel"></span></span><span>${esc(t('Listening… tap the microphone again when you\'ve finished.'))}</span></p>
    ${s.voice ? `<label class="asSpeakToggle"><input type="checkbox" id="asSpeak"${store.get(SPEAK) === '1' ? ' checked' : ''}> ${esc(t('Read answers aloud'))}</label>` : ''}
    <p class="error" id="asError" role="alert" hidden></p></section>`;
}

const failAs = (msg) => { const e = $('asError'); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; };
function draw(list) {
  const log = $('asLog'); if (!log) return;
  log.innerHTML = list.map(bubble).join('');
  log.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
async function say(text) {
  try { const r = await siteCall('assistant/speak', { method: 'POST', body: { text, lang: lang() } }); play(r.audio); } catch (e) { failAs(e.message); }
}

async function ask(question, byVoice = false) {
  question = String(question || '').trim();
  if (!question || busy) return;
  busy = true; failAs(''); stopPlaying();
  const list = [...kept(), { role: 'user', content: question }];
  keep(list); $('asIdeas')?.remove();
  draw(list);
  const log = $('asLog');
  log.insertAdjacentHTML('beforeend', `<li class="asMsg asIt asThinking" id="asThinking"><span class="spin" aria-hidden="true"></span> ${esc(t('Looking it up…'))}</li>`);
  log.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('asSend').disabled = true;
  try {
    const r = await siteCall('assistant/ask', { method: 'POST', body: { lang: lang(), messages: list.map(({ role, content }) => ({ role, content })) } });
    const done = [...list, { role: 'assistant', content: r.answer }];
    keep(done); draw(done);
    if (byVoice || $('asSpeak')?.checked) say(r.answer);
  } catch (e) {
    $('asThinking')?.remove(); failAs(e.message);
  } finally { busy = false; const b = $('asSend'); if (b) b.disabled = false; }
}

async function toggleMic() {
  const mic = $('asMic'); if (!mic) return;
  if (rec) { // finished talking: what was said becomes the question
    const r = rec; rec = null; mic.classList.remove('on'); $('asListening').hidden = true; clearInterval(toggleMic.meter);
    try {
      const { audio, seconds } = await r.stop();
      if (seconds < 0.6) return failAs(t('That was too short: hold on a moment longer.'));
      mic.disabled = true;
      const { text } = await siteCall('assistant/listen', { method: 'POST', body: { audio, lang: lang() } });
      if (!text) return failAs(t('I didn\'t catch that: try again, or type it.'));
      $('asQ').value = text;
      await ask(text, true);
      $('asQ').value = '';
    } catch (e) { failAs(e.message); } finally { mic.disabled = false; }
    return;
  }
  failAs(''); stopPlaying();
  try {
    rec = await startRecording({ onAutoStop: () => toggleMic() });
    mic.classList.add('on'); $('asListening').hidden = false;
    toggleMic.meter = setInterval(() => { const l = $('asLevel'); if (l && rec) l.style.width = `${Math.round(rec.level() * 100)}%`; }, 100);
  } catch (e) { rec = null; failAs(e.name === 'NotAllowedError' ? t('The microphone isn\'t allowed: allow it in the browser\'s settings, or type the question.') : e.message); }
}

export function wire() {
  const form = $('asAsk'); if (!form || form.dataset.wired) return;
  form.dataset.wired = '1';
  form.addEventListener('submit', (e) => { e.preventDefault(); const q = $('asQ').value; $('asQ').value = ''; ask(q); });
  // Enter sends; Shift+Enter is a new line
  $('asQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  $('asMic')?.addEventListener('click', toggleMic);
  $('asSpeak')?.addEventListener('change', (e) => { store.set(SPEAK, e.target.checked ? '1' : ''); if (!e.target.checked) stopPlaying(); });
  $('asNew')?.addEventListener('click', () => { keep([]); stopPlaying(); window.dispatchEvent(new Event('learn:redraw')); });
  $('asIdeas')?.addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (b) ask(b.dataset.ask); });
  $('asLog').addEventListener('click', (e) => { const b = e.target.closest('[data-say]'); if (b) { const m = kept()[Number(b.dataset.say)]; if (m) say(m.content); } });
  // leaving the page stops the microphone and the voice
  window.addEventListener('hashchange', () => { if (rec) { rec.cancel(); rec = null; } stopPlaying(); }, { once: true });
  $('asLog').lastElementChild?.scrollIntoView({ block: 'nearest' });
}

export const views = { assistant: assistantView };

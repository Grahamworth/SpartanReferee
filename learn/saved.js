// Saving a programme on the phone for use with no signal (the installable app): on a programme's page, "Save for offline" fetches
// its lessons in the page's language (with their narration, when it's Azure's), its rules and its handbook. Each answer is kept by
// core.js's call (offline.js) the moment it arrives, so the lesson player, the rules and the handbook then open offline as they are.
// What was saved is listed in localStorage (sr_saved), per person, so it can be shown, brought up to date or removed.
import { $, call, esc, t, toast, hooks, bar, LANG, loadPdf } from './core.js';
import { lessonPath, audioPath } from './lesson.js';
import { owner, keepFile, forget } from '../offline.js';

const ls = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const pageLang = () => (window.SR_I18N && SR_I18N.lang) || '';
const records = () => { try { return JSON.parse(ls.get('sr_saved')) || {}; } catch { return {}; } };
const keyOf = (pid) => `${owner()}|${pid}|${pageLang() || 'en'}`;
const record = (pid) => records()[keyOf(pid)] || null;
function setRecord(pid, r) { const all = records(); if (r) all[keyOf(pid)] = r; else delete all[keyOf(pid)]; ls.set('sr_saved', JSON.stringify(all)); }
const mb = (n) => (n / 1e6).toFixed(n < 1e7 ? 1 : 0);

// a small download icon beside "Your progress" (20 November 2026): tapping it saves; once saved it shows a tick, and opens what was saved
// with Update and Remove
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>';
const ICON_SAVED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h14"/><path d="M7 11l3.5 3.5L17 8"/></svg>';
function box(pid) {
  if (!owner() || typeof caches === 'undefined') return '';
  const r = record(pid);
  const when = r ? new Date(r.at).toLocaleString(pageLang() || undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const progress = '<p class="note" id="offlineProgress" aria-live="polite" hidden></p>';
  if (!r) return `<div class="offlineSave" id="offlineSave" data-programme="${esc(pid)}">
      <button class="iconBtn offlineIcon" type="button" data-save-offline title="${esc(t('Save for offline'))}" aria-label="${esc(t('Save for offline'))}">${ICON}</button>${progress}</div>`;
  return `<details class="offlineSave saved" id="offlineSave" data-programme="${esc(pid)}">
      <summary class="iconBtn offlineIcon" title="${esc(t('Saved on this phone'))}" aria-label="${esc(t('Saved on this phone'))}">${ICON_SAVED}</summary>
      <div class="offlinePanel"><p class="note"><b>${esc(t('Saved on this phone {when} ({size} MB).', { when, size: mb(r.bytes) }))}</b> ${esc(t('{lessons} lessons and {rules} rules, in {language}.', { lessons: r.lessons, rules: r.rules, language: LANG[r.lang] || r.lang }))}${r.noAudio ? ` ${esc(t('Some narration wasn\'t saved: the device reads those slides aloud instead.'))}` : ''}</p>
      <div class="btnRow"><button class="small" type="button" data-save-offline>${esc(t('Update the saved copy'))}</button><button class="small" type="button" data-forget-offline>${esc(t('Remove from this phone'))}</button></div>${progress}</div>
    </details>`;
}
// on a programme's page, beside "Your progress" (or "Take part"): published versions only, as learners see
hooks.programme.push(async (d) => (d.slot === 'head' && d.version.state === 'published' ? box(d.programme.id) : ''));

/** a few at a time, so it's quick without flooding the server */
async function pool(jobs, n, each) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (i < jobs.length) { const j = jobs[i++]; await each(j); } }));
}
const b64blob = (b64, type) => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type }); };

async function save(pid, btn) {
  if (navigator.onLine === false) { toast(t('You\'re offline: saving needs a connection.')); return; }
  btn.disabled = true;
  const out = $('offlineProgress'); out.hidden = false;
  const lang = pageLang(), paths = [], files = [];
  let bytes = 0, done = 0, total = 4, noAudio = false, failed = 0;
  const step = () => { done++; out.innerHTML = `${bar(done, total)} ${esc(t('Saving… {done} of {total}', { done, total }))}`; };
  const get = async (p) => { try { const d = await call(p); paths.push(p); bytes += JSON.stringify(d).length; return d; } catch (e) { if (!e.status) throw e; failed++; return null; } finally { step(); } };
  try {
    navigator.storage?.persist?.().catch(() => {}); // ask the browser not to clear it when space runs low
    const d = await get(`programmes/${encodeURIComponent(pid)}`);
    await get('programmes');
    const lessons = (d?.modules || []).flatMap((m) => m.lessons);
    const rl = await get(`rules?programme=${encodeURIComponent(pid)}`);
    const rules = rl?.rules || [];
    total += lessons.length + rules.length;
    const audio = [];
    await pool(lessons, 4, async (l) => {
      const L = await get(lessonPath(l.id, lang));
      if (L?.content && L.media?.kind === 'audio') L.content.slides.forEach((s, i) => { if (s.narration) audio.push([L.content.id, L.media.voice, i]); });
    });
    total += audio.length;
    await pool(rules, 6, (r) => get(`rules/${encodeURIComponent(r.id)}`));
    await get(`handbook/${encodeURIComponent(pid)}?locale=${encodeURIComponent(lang || 'en')}`);
    loadPdf().catch(() => {}); // the handbook's PDF maker, kept by the app for offline use
    await pool(audio, 4, async ([cid, voice, i]) => {
      try {
        if (noAudio) return; // the daily limit's reached: the rest are read by the device
        const r = await call(`content/${cid}/narration/${i}?file=1`);
        bytes += await keepFile(audioPath(cid, voice, i), b64blob(r.audio, r.type));
        files.push(audioPath(cid, voice, i));
      } catch (e) { if (!e.status) throw e; noAudio = true; } finally { step(); }
    });
    // a newer save replaces an older one: what it doesn't list any more goes
    const old = record(pid);
    if (old) await forget(old.files.filter((f) => !files.includes(f)));
    setRecord(pid, { at: Date.now(), lang: lang || 'en', bytes, lessons: lessons.length, rules: rules.length, noAudio: noAudio || undefined, paths, files });
    toast(failed ? t('Saved, apart from {n} pages the server didn\'t give', { n: failed }) : t('Saved for offline use'));
  } catch {
    toast(t('The connection dropped: what was saved so far is kept. Try again when there\'s signal.'));
  }
  window.dispatchEvent(new Event('learn:redraw'));
}
async function remove(pid, btn) {
  if (!confirm(t('Remove the saved lessons, rules and handbook from this phone? They still open online.'))) return;
  btn.disabled = true;
  const r = record(pid);
  if (r) await forget([...r.files, ...r.paths]);
  setRecord(pid, null);
  toast(t('Removed from this phone'));
  window.dispatchEvent(new Event('learn:redraw'));
}

export const views = {};
export function wire() {
  const el = $('offlineSave'); if (!el) return;
  const pid = el.dataset.programme;
  el.querySelector('[data-save-offline]').onclick = (e) => save(pid, e.currentTarget);
  const f = el.querySelector('[data-forget-offline]'); if (f) f.onclick = (e) => remove(pid, e.currentTarget);
}

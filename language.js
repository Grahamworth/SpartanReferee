// A referee's language, on the home page and the learning platform: asked on their first visit (the browser's own language first,
// marked "Suggested"), then kept with them (/api/home), so it follows them to any device and to their lessons. A change made with
// the menu at the top is saved back on the next visit.
//   language(h, card): h is /api/home's answer; card holds a .langGrid. True when the page is reloading into their language.
import { call, esc } from './api-base.js';

const KEY = 'sr_lang';
const saved = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const keep = (c) => { try { localStorage.setItem(KEY, c); } catch { /* private mode */ } };

export function language(h, card) {
  const I = window.SR_I18N; if (!I || !card) return false;
  const grid = card.querySelector('.langGrid');
  if (!h.language) {
    const guess = I.lang, langs = [...I.LANGS.filter(([c]) => c === guess), ...I.LANGS.filter(([c]) => c !== guess)];
    grid.innerHTML = langs.map(([c, n]) => `<button type="button" lang="${c}" data-lang="${c}"${c === guess ? ' class="suggested"' : ''}>${esc(n)}${c === guess ? `<small>${esc(I.t('Suggested'))}</small>` : ''}</button>`).join('');
    for (const b of grid.querySelectorAll('[data-lang]')) b.onclick = async () => {
      for (const x of grid.querySelectorAll('button')) x.disabled = true;
      try { await call('home', { method: 'POST', body: { language: b.dataset.lang } }); } catch { /* still use it here */ }
      keep(b.dataset.lang); location.reload();
    };
    card.hidden = false;
    return false;
  }
  card.hidden = true;
  // a new device: use theirs
  if (!saved() && h.language !== I.lang) { keep(h.language); location.reload(); return true; }
  // changed with the menu since: remember that instead
  if (saved() && saved() !== h.language) call('home', { method: 'POST', body: { language: saved() } }).catch(() => {});
  return false;
}

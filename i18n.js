// SpartanReferee in the viewer's language. A plain script (as brand.js), loaded first on every page: the website, the judge, the
// server's video review and the Broadcaster app.
//
// Pages are written in English and stay that way in the code: this translates what's on screen as it appears, so nothing that's
// saved or sent (results, no-rep reasons, the judge's reports to the server) ever changes language. The dictionaries are keyed by
// the English text (i18n/<lang>.json), built by scripts/i18n-extract.mjs:
//   - a text node whose whole text is a key is swapped for its translation, and so are title, placeholder, aria-label and alt;
//   - a key with {name} slots ("Camera {n}") matches any text of that shape and keeps what was in the slots; a translation can be
//     { one, few, many, other } (Intl.PluralRules) for the first number in it;
//   - an element marked data-i18n has its inline children numbered: "New to SpartanReferee? <0>Register</0> first." Its translation
//     moves those same children (links, buttons, with their handlers) into the new order, with the translated text inside;
//   - canvas drawing and speech call SR_I18N.t(text, values) themselves.
// The judge running on a server (judge.html?engine=…) never translates: it's a machine, and what it sends must stay English.
(function (root) {
  const LANGS = [
    ['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch'], ['nl', 'Nederlands'], ['es', 'Español'], ['it', 'Italiano'],
    ['el', 'Ελληνικά'], ['hr', 'Hrvatski'], ['cs', 'Čeština'], ['pl', 'Polski'], ['fi', 'Suomi'], ['sv', 'Svenska'], ['da', 'Dansk'],
    ['ar', 'العربية'], ['th', 'ไทย'],
  ];
  const CODES = LANGS.map(([c]) => c), RTL = new Set(['ar']);
  const KEY = 'sr_lang';
  const store = { get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }, set(v) { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } } };

  /** the language to show: ?lang=, then the one picked before, then the browser's own, then English */
  function pick(search, saved, browser) {
    const ok = (c) => { c = String(c || '').toLowerCase().split(/[-_]/)[0]; return CODES.includes(c) ? c : ''; };
    const q = ok(new URLSearchParams(search || '').get('lang'));
    if (q) return q;
    if (ok(saved)) return ok(saved);
    for (const b of browser || []) if (ok(b)) return ok(b);
    return 'en';
  }

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const SLOT = /\{(\w+)\}/g;
  /** a dictionary ready to use: exact keys in a Map, keys with slots as patterns (longest first, so the most specific wins) */
  function compile(dict) {
    const exact = new Map(), patterns = [];
    for (const [k, v] of Object.entries(dict || {})) {
      if (v == null || v === '') continue;
      const key = norm(k);
      exact.set(key, v); // asked for by name, with values (SR_I18N.t("Reps {count}", { count }))
      if (!SLOT.test(key)) continue;
      SLOT.lastIndex = 0;
      const names = [];
      const re = new RegExp('^' + key.split(SLOT).map((part, i) => (i % 2 ? (names.push(part), '(.+?)') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('') + '$');
      patterns.push({ re, names, v, len: key.length });
    }
    patterns.sort((a, b) => b.len - a.len);
    return { exact, patterns };
  }

  function fill(v, values, lang) {
    if (v && typeof v === 'object') {
      const n = Object.values(values || {}).map((x) => parseFloat(String(x).replace(',', '.'))).find((x) => !Number.isNaN(x));
      let cat = 'other';
      try { if (n !== undefined) cat = new Intl.PluralRules(lang).select(n); } catch { /* old browser */ }
      v = v[cat] || v.other || Object.values(v)[0];
    }
    return String(v).replace(SLOT, (m, name) => (values && name in values ? values[name] : m));
  }

  /** text in the current language, or as it was when there's no translation */
  function translate(c, lang, text, values) {
    if (!c) return values ? fill(text, values, lang) : text;
    const key = norm(text);
    if (!key) return text;
    if (c.exact.has(key)) return fill(c.exact.get(key), values, lang);
    if (values) return fill(text, values, lang);
    if (!/\p{L}/u.test(key)) return text; // numbers, times and symbols stay as they are
    for (const p of c.patterns) {
      const m = p.re.exec(key);
      if (!m) continue;
      const got = {};
      // what was in a slot is translated too when it's a text of its own ("No rep. {x}" with x a no-rep reason)
      p.names.forEach((nm, i) => { const s = m[i + 1]; got[nm] = c.exact.has(s) ? fill(c.exact.get(s), null, lang) : s; });
      return fill(p.v, got, lang);
    }
    return text;
  }

  const api = { LANGS, CODES, RTL, pick, compile, translate, norm, lang: 'en', dict: null };
  api.t = (text, values) => translate(api.dict, api.lang, text, values);

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.SR_I18N = api;
  if (typeof document === 'undefined') return;
  const params = new URLSearchParams(location.search);
  if (params.get('engine') || params.get('bg')) return; // a judge on a server, live or analysing an upload: a machine, in English

  // ------------------------------------------------------------------------------------------ the page
  const base = (document.currentScript && document.currentScript.src) ? new URL('i18n/', document.currentScript.src).href : 'i18n/';
  api.lang = pick(location.search, store.get(), navigator.languages || [navigator.language]);
  if (params.get('lang') && api.CODES.includes(api.lang)) store.set(api.lang);
  const html = document.documentElement;
  html.lang = api.lang;
  if (RTL.has(api.lang)) html.dir = 'rtl';
  // until the translation is in, the page is hidden (a second and a half at most), so it never shows in English first
  if (api.lang !== "en") {
    const st = document.createElement("style");
    st.textContent = "html.sr-i18n-wait body { visibility: hidden; }";
    document.head ? document.head.appendChild(st) : html.appendChild(st);
    html.classList.add("sr-i18n-wait");
    setTimeout(() => html.classList.remove("sr-i18n-wait"), 1500);
  }

  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'NOSCRIPT']);
  const done = new WeakMap(); // text node -> the English it was, and what we put there

  function textNode(n) {
    const now = n.nodeValue, was = done.get(n);
    if (was && now === was.out) return; // ours, unchanged
    const out = api.t(now);
    if (out !== now) {
      const lead = now.match(/^\s*/)[0], trail = now.match(/\s*$/)[0];
      const next = lead + out.trim() + trail;
      done.set(n, { out: next });
      n.nodeValue = next;
    }
  }
  function attrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const out = api.t(v); if (out !== v) el.setAttribute(a, out); }
    }
  }
  // <p data-i18n>New to X? <a href=…>Register</a> first.</p>  ->  "New to X? <0>Register</0> first."
  function marked(el) {
    const kids = [...el.childNodes].filter((k) => k.nodeType === 1);
    let key = '', i = 0;
    for (const k of el.childNodes) {
      if (k.nodeType === 3) key += k.nodeValue;
      else if (k.nodeType === 1) { const tx = norm(k.textContent); key += `<${i}>${/\p{L}/u.test(tx) ? tx : '{n}'}</${i}>`; i++; } // a number set by the page stays as it is
    }
    key = norm(key);
    const v = api.dict && api.dict.exact.get(key); // once translated, it no longer matches: its parts are then looked at on their own
    if (!v) return false;
    const parts = String(v).split(/(<\d+>[\s\S]*?<\/\d+>)/);
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      const m = /^<(\d+)>([\s\S]*?)<\/\d+>$/.exec(part);
      if (!m) { if (part) frag.appendChild(document.createTextNode(part)); continue; }
      const k = kids[+m[1]];
      if (!k) continue;
      if (m[2] !== '{n}' && ![...k.childNodes].some((c) => c.nodeType === 1)) k.textContent = m[2];
      frag.appendChild(k);
    }
    el.textContent = '';
    el.appendChild(frag);
    return true;
  }
  function walk(node) {
    if (!api.dict) return;
    if (node.nodeType === 3) { if (!node.parentNode || !SKIP.has(node.parentNode.nodeName)) textNode(node); return; }
    if (node.nodeType !== 1 || SKIP.has(node.nodeName)) return;
    attrs(node);
    if (node.hasAttribute('data-i18n-skip')) return;
    if (node.hasAttribute('data-i18n') && marked(node)) {
      for (const k of node.children) walk(k);
      return;
    }
    for (const k of [...node.childNodes]) walk(k);
  }

  let watching = false;
  function watch() {
    if (watching || !api.dict) return;
    watching = true;
    walk(document.documentElement);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') attrs(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // English needs no dictionary. Others: fetched once, then kept, so a page opened offline (the judge on a phone) still has it.
  const cacheKey = 'sr_i18n_' + api.lang;
  api.ready = api.lang === 'en' ? Promise.resolve() : (async () => {
    let dict = null;
    try {
      const r = await fetch(base + api.lang + '.json', { cache: 'no-cache' });
      if (r.ok) { dict = await r.json(); try { localStorage.setItem(cacheKey, JSON.stringify(dict)); } catch { /* full */ } }
    } catch { /* offline */ }
    if (!dict) { try { dict = JSON.parse(localStorage.getItem(cacheKey)); } catch { /* none */ } }
    if (!dict) { html.classList.remove("sr-i18n-wait"); return; }
    api.dict = compile(dict);
    const go = () => { watch(); html.classList.remove("sr-i18n-wait"); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
  })();

  /** a language menu: <select data-lang-picker> anywhere on a page becomes one */
  function pickers() {
    for (const sel of document.querySelectorAll('select[data-lang-picker]:not([data-ready])')) {
      sel.dataset.ready = '1';
      sel.setAttribute('data-i18n-skip', '');
      sel.innerHTML = LANGS.map(([c, name]) => `<option value="${c}"${c === api.lang ? ' selected' : ''}>${name}</option>`).join('');
      sel.addEventListener('change', () => {
        store.set(sel.value);
        const u = new URL(location.href);
        u.searchParams.delete('lang');
        location.replace(u.href);
      });
    }
  }
  api.pickers = pickers;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pickers); else pickers();
})(typeof globalThis !== 'undefined' ? globalThis : this);

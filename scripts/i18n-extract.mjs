// Collects the English text people see, from the pages and scripts, for translating (see i18n.js).
//   node scripts/i18n-extract.mjs            writes i18n/en.json: every text, with the files it's in
//   node scripts/i18n-extract.mjs --check    says how many texts each language is missing
// Texts are what i18n.js matches on screen: a whole text between tags, an attribute (title, placeholder, aria-label, alt), the inside
// of an element marked data-i18n with its children numbered (<0>…</0>), and in scripts, a string or template that reads as words
// (a ${…} in it becomes a {slot}). Strings that are code (CSS, selectors, addresses, ids) are left out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILES = [
  // event day: the server's video review, the judge, the Broadcaster and the camera phone guide
  'server/review/index.html', 'server/review/review.js', 'server/review/counts.js',
  'judge.html', 'app.js', 'burpee.js', 'exercises.js', 'multi.js', 'cones.js', 'judge-gate.js', 'readers.js',
  'broadcaster.html', 'camera.js', 'phone.html', 'apptabs.js', 'apptabs-core.js',
  // the website
  'index.html', 'info.html', 'home.html', 'home.js', 'language.js', 'event.html', 'event.js', 'console.html', 'console.js', 'booking.js', 'results.html', 'results.js',
  'streaming.html', 'email-return.html', 'offline.html', 'offline.js', 'privacy.html', 'email-signin-web.js', 'email-signin-core.js', 'api-base.js', 'recordings.html', 'recordings.js',
  // the learning platform
  'learn/index.html', 'learn/learn.js', 'learn/core.js', 'learn/people.js', 'learn/programmes.js', 'learn/lesson.js', 'learn/assess.js', 'learn/judgement.js',
  'learn/govern.js', 'learn/reports.js', 'learn/diagnostics.js', 'learn/practice.js', 'learn/saved.js', 'learn/sharp.js', 'learn/home.js', 'learn/events.js', 'learn/invites.js', 'learn/tracking.js', 'join.html', 'join.js',
  // what the server says that people see: its error messages and labels (shown in the page, so translated there like the rest)
  'api/src/core.js', 'api/src/assignments.js', 'api/src/servers.js', 'api/src/events.js', 'api/src/companies.js', 'api/src/recordings.js',
  'api/src/learn/index.js', 'api/src/learn/programmes.js', 'api/src/learn/lessons.js', 'api/src/learn/media.js', 'api/src/learn/assess.js',
  'api/src/learn/govern.js', 'api/src/learn/reports.js', 'api/src/learn/privacy.js', 'api/src/learn/diagnostics.js', 'api/src/learn/permissions.js', 'api/src/learn/checks.js', 'api/src/learn/invites.js', 'api/src/learn/tracking.js', 'api/src/mailer.js',
];

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&times;/g, '×').replace(/&middot;/g, '·');

/** worth translating: has a word (two letters together), isn't a lone slot, and doesn't look like code */
export function wordy(s) {
  const t = norm(s);
  if (!t || t.length > 1500) return false;
  const bare = t.replace(/\{\w+\}/g, '');
  if (!/\p{L}{2}/u.test(bare)) return false;
  if (/^(https?:|\/|\.\/|#|--|data:|mailto:)/.test(t)) return false;
  if (/^[\w.-]+\.(js|css|html|json|png|jpg|svg|onnx|task|wasm|mp4|apk|exe|zip|csv)$/i.test(t)) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(t) && !/^[a-z]{2,}$/.test(t)) return false; // camelCase ids
  if (/^[a-z0-9_-]+$/.test(t) && /[_-]/.test(t)) return false; // kebab/snake ids
  if (/[{;]\s*$|(^|[^\w])\}\s*$|^\s*[.#][\w-]+\s*[{,]|:\s*(var\(|#[0-9a-f]{3}|\d+px)/i.test(t)) return false; // CSS (a text may still end with a {slot})
  if (/^(?:[a-z-]+:[^;]+;\s*)+$/i.test(t)) return false; // inline style
  if (/^[\w.[\]()'"=!&|<>+\-*/%?: ]+$/.test(t) && /[=<>()[\]]/.test(t) && !/ [a-z]{3,} [a-z]{3,}/i.test(t)) return false; // expressions
  if (/^(GET|POST|PUT|DELETE|Content-Type|application\/|text\/|image\/|video\/)/.test(t)) return false;
  if (/^\(?\s*(SELECT|INSERT|UPDATE|DELETE|MERGE|IF|WITH|CREATE|ALTER|DROP|DECLARE|EXEC|BEGIN|WHEN|AND|OR|ORDER BY|GROUP BY|FROM|JOIN|LEFT JOIN|WHERE|VALUES|OUTPUT|SET)\b/.test(t) || /\{S\}\./.test(t)) return false; // SQL
  if (/\}\/|\/\{|\}\.(csv|onnx|txt|mjs|js|json|wasm|task|mp4|png|jpg)\b|\.(csv|onnx|txt|mjs|js|json)$|^[\w-]+\/$/.test(t)) return false; // paths and file names built in code
  if (!/\s/.test(t) && /\w\/\w/.test(t)) return false; // an address or path: servers/mine{x}
  if (/^(UTC|GMT)$/.test(t)) return false;
  if (/\bpx\b.*(Arial|sans-serif|Barlow)|^rgba?\(|^\w+\[|^X-[A-Z]|^(NFKD|SHA-256|localhost)$|@|\.com$/.test(t)) return false; // fonts, colours, selectors, headers
  if (/^[A-Z][a-z]+(?:[A-Z][a-z]*)+$/.test(t) || /^\w+_\w+$/.test(t)) return false; // ArrowLeft, NotFoundError, SpartanReferee, Closed_Fist: names, not words
  if (/^[A-Z_0-9]+$/.test(t) && t.length > 1 && !/^[A-Z]{2,}$/.test(t)) return false; // CONSTANT_NAMES (but NO REP-style words stay)
  if (/^(sans-serif|monospace|serif|bold|italic|normal|none|auto|block|flex|grid|inline|hidden|visible|absolute|relative|fixed|center|left|right|top|bottom|transparent|currentColor|inherit|cover|contain|round|butt|source-over|destination-out|anonymous|use-credentials|same-origin|no-store|no-cache|reload|smooth|instant|nearest|start|end|utf-8|module|text|number|range|checkbox|radio|button|submit|click|change|input|keydown|keyup|load|error|message|resize|scroll|pointerdown|pointerup|pointermove|touchstart|visibilitychange|beforeunload|loadedmetadata|playing|pause|ended|timeupdate|seeked|canplay|webgl|webgl2|webgpu|wasm|cpu|gpu|environment|user|landscape|portrait|video|audio|img|div|span|canvas|option|select|label|li|ul|tr|td|th|table|tbody|thead|section|details|summary|figure|figcaption|a|b|p|i|em|strong|small|code|pre|svg|path|rect|circle|polyline|line|g|use|defs|lighter|darker|multiply|screen|overlay|true|false|null|undefined|object|string|function|boolean|bigint|symbol)$/i.test(t)) return false;
  if (/^(use strict|autoplay; fullscreen|openid profile email)$/.test(t)) return false;
  if (/[&?][a-z]+=|^\w+\.\w+\.|^[a-z-]+ \{\w+\}$|^[a-z]+(\{\w+\})+$/.test(t)) return false; // query strings, setting names, "pill {x}", "new{k}"
  if (!/[A-Z]/.test(t) && /^(btn|link|primary|ghost)\b[a-z -]*$/.test(t)) return false; // class lists: "btn btn-red", "link signOut" is caught above
  if (!/[A-Z]/.test(t) && /[.#]/.test(t) && /^[a-z]*\s*[.#]?[\w-]+(\s+[.#]?[\w-]+)*$/.test(t)) return false; // selectors: "header .tabs button"
  if (/^[a-z]+ [a-z]+=\"/.test(t) || /^[a-z-]+ (start|on)$/.test(t) || /^[a-z]+, [a-z]+$/.test(t)) return false; // attributes, class pairs, "a, button"
  return true;
}

// ------------------------------------------------------------------------------------------------ HTML
/** texts in a piece of HTML: text between tags, the four attributes, and data-i18n elements whole */
export function fromHtml(src) {
  const out = [];
  src = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|svg|code|pre|textarea)\b[\s\S]*?<\/\1>/gi, (m, tag) => (/^<script/i.test(m) ? ' ' : `<${tag}></${tag}>`));
  for (const m of src.matchAll(/<[a-z][^>]*>/gi)) {
    for (const a of m[0].matchAll(/\s(title|placeholder|aria-label|alt)="([^"]*)"/gi)) if (wordy(decode(a[2])) && !a[2].includes('${')) out.push(norm(decode(a[2])));
  }
  // data-i18n elements: their inside, with child elements numbered
  for (const m of src.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n(?=[\s>=])[^>]*>([\s\S]*?)<\/\1>/gi)) {
    let i = 0, key = '';
    const inner = m[2];
    // one level of children: <x …>text</x> becomes <i>text</i>, and a child with no words in it (a number the page sets) <i>{n}</i>
    key = inner.replace(/<([a-z0-9]+)\b[^>]*>([\s\S]*?)<\/\1>/gi, (mm, tag, txt) => { const tx = norm(decode(txt.replace(/<[^>]+>/g, ''))); return `<${i}>${/\p{L}/u.test(tx) ? tx : '{n}'}</${i++}>`; });
    key = norm(decode(key.replace(/<(?!\/?\d+>)[^>]+>/g, '')));
    if (wordy(key.replace(/<\/?\d+>/g, ''))) out.push(key);
  }
  // the rest, apart from what's inside data-i18n elements (translated whole, above)
  const rest = src.replace(/<([a-z0-9]+)\b[^>]*\sdata-i18n(?=[\s>=])[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  for (const m of rest.replace(/<[^>]+>/g, '\u0000').split('\u0000')) {
    const t = norm(decode(m));
    if (wordy(t)) out.push(t);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ scripts
/** the index just after the template literal starting at src[k] (a backtick), its ${…} and the templates inside them included */
function skipTemplate(src, k) {
  const n = src.length;
  let j = k + 1;
  while (j < n && src[j] !== '`') {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === '$' && src[j + 1] === '{') {
      let depth = 1;
      j += 2;
      while (j < n && depth) {
        const ch = src[j];
        if (ch === '`') { j = skipTemplate(src, j); continue; }
        if (ch === '"' || ch === "'") { let q = j + 1; while (q < n && src[q] !== ch) { if (src[q] === '\\') q++; q++; } j = q + 1; continue; }
        if (ch === '{') depth++; else if (ch === '}') depth--;
        j++;
      }
      continue;
    }
    j++;
  }
  return j + 1;
}
/** the string literals in a script: ['text', isTemplate] (templates with ${…} turned into {slots}) */
export function literals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const slotName = (expr, used) => {
    const e = expr.trim();
    let name = (/^[A-Za-z_$][\w$]*$/.test(e) ? e : (/([A-Za-z_$][\w$]*)\s*(?:\)|\.length)?\s*$/.exec(e) || [])[1]) || 'x';
    name = name.replace(/\$/g, '') || 'x';
    let k = name, j = 2;
    while (used.has(k)) k = name + j++;
    used.add(k);
    return k;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && /[=(,:!&|?;{}[\n]\s*$/.test(src.slice(Math.max(0, i - 20), i)) && src[i + 1] !== '/' && src[i + 1] !== '*') {
      // a regex literal: skip it
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      if (src[j] === '/') { i = j + 1; continue; }
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { const e = src[j + 1]; s += e === 'n' ? '\n' : e === 'u' ? String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)) : e; j += e === 'u' ? 6 : 2; continue; } s += src[j++]; }
      out.push([s, false]);
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '';
      const used = new Set();
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1, k = j + 2;
          const start = k;
          // nested templates and strings inside ${…}
          while (k < n && depth) {
            const ch = src[k];
            if (ch === '`') { k = skipTemplate(src, k); continue; } // a whole nested template, its own ${…} included
            if (ch === '"' || ch === "'") { let q = k + 1; while (q < n && src[q] !== ch) { if (src[q] === '\\') q++; q++; } k = q + 1; continue; }
            if (ch === '{') depth++; else if (ch === '}') depth--;
            k++;
          }
          const expr = src.slice(start, k - 1);
          // strings inside the expression are texts too
          for (const lit of literals(expr)) out.push(lit);
          s += `{${slotName(expr, used)}}`;
          j = k; continue;
        }
        s += src[j++];
      }
      out.push([s, true]);
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}

export function fromScript(src) {
  const out = [];
  for (const [s, tpl] of literals(src)) {
    if (/<[a-z][^>]*>/i.test(s)) { // HTML built in a script
      for (const t of fromHtml(s)) out.push(t);
      continue;
    }
    const t = norm(s);
    if (!wordy(t)) continue;
    if (!tpl && !/[\s’']/.test(t) && !/^[A-Z]/.test(t)) continue; // a lone lowercase word in quotes is usually code
    if (/\{\w+\}/.test(t) && t.replace(/\{\w+\}/g, '').replace(/[^\p{L}]/gu, '').length < 3) continue; // nearly all slots
    out.push(t);
  }
  return out;
}

// the learning platform's seeded content that pages show as it is (the lesson slides themselves are translated as their own content
// versions, scripts/learn-translations): programme, module and lesson titles and summaries, and the assessments' questions
const { PROGRAMMES } = await import('./learn-content.mjs');
const { ASSESSMENTS } = await import('./learn-questions.mjs');
const { DISPUTES } = await import('./learn-rules.mjs');
const CHECKS = JSON.parse(fs.readFileSync(new URL('./learn-checks.json', import.meta.url), 'utf8')); // the lessons' quick checks
export function contentTexts() {
  const out = [];
  const add = (s) => { const t = norm(s || ''); if (t && wordy(t)) out.push(t); };
  for (const q of Object.values(CHECKS).flat()) [q.prompt, q.feedback, ...q.options].forEach(add);
  for (const p of PROGRAMMES) {
    [p.title, p.description, p.learnerRole, p.version.qualification, p.version.policyNote].forEach(add);
    for (const m of p.modules) { [m.title, m.summary, m.source].forEach(add); for (const l of m.lessons) [l.title, l.summary].forEach(add); }
  }
  for (const d of DISPUTES) add(d.title); // the open review items' titles (their details quote the sources, in English)
  for (const a of Object.values(ASSESSMENTS)) {
    [a.title, a.description].forEach(add);
    for (const q of a.questions) { [q.prompt, q.feedback, q.review].forEach(add); q.options.forEach((o) => add(o.text)); }
  }
  return out;
}

export function extract(files = FILES) {
  const where = new Map();
  if (files === FILES) for (const t of contentTexts()) { if (!where.has(t)) where.set(t, new Set()); where.get(t).add('learn content'); }
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const texts = f.endsWith('.html') ? [...fromHtml(src), ...fromScript((src.match(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n').replace(/<\/?script[^>]*>/gi, ''))] : fromScript(src);
    for (const t of texts) { if (!where.has(t)) where.set(t, new Set()); where.get(t).add(f); }
  }
  return where;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const where = extract();
  const dir = path.join(ROOT, 'i18n');
  fs.mkdirSync(dir, { recursive: true });
  if (process.argv.includes('--check')) {
    for (const f of fs.readdirSync(dir).filter((x) => /^[a-z]{2}\.json$/.test(x) && x !== 'en.json')) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const missing = [...where.keys()].filter((k) => !d[k]);
      console.log(`${f}: ${where.size - missing.length} of ${where.size} translated`);
    }
  } else {
    const en = Object.fromEntries([...where].map(([k, files]) => [k, [...files].join(' ')]));
    fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(en, null, 1) + '\n');
    const words = [...where.keys()].join(' ').split(/\s+/).length;
    console.log(`${where.size} texts, ${words} words, written to i18n/en.json`);
  }
}

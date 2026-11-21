// Splits Spartan's 2026 Rules of Competition (PDF) and Officiating SOP (Word) into numbered sections, read from material/ on this PC
// (never committed: the text goes only into the learning database and the Assistant's private index). Used by
// scripts/learn-rulebook.mjs and scripts/assistant-index.mjs. Needs pdftotext (Git for Windows has it) and Python with python-docx.
//   node scripts/learn-rulebook-parse.mjs        prints how many sections each document has, and a few of them
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RULES_PDF = path.join(ROOT, 'material', 'Spartan_OCR_Rules_of_Competition_2026.pdf');
export const SOP_DOCX = path.join(ROOT, 'material', 'Spartan_Referee_SOP_2026.docx');

const clean = (s) => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; } return 0; };
const parentOf = (n) => n.split('.').slice(0, -1).join('.');
// a heading's own words: "SPEAR THROW a) Competitor ..." -> "Spear Throw"; "TIME PENALTIES" -> "Time penalties"
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const sentenceCase = (s) => { const l = s.toLowerCase(); return l.charAt(0).toUpperCase() + l.slice(1); };

/** the rulebook: [{ section: '3.17.4', title, text, chapter: '3.17', chapterTitle }] */
export function rulebookSections(pdf = RULES_PDF) {
  let raw = execFileSync('pdftotext', ['-enc', 'UTF-8', pdf, '-'], { encoding: 'utf8', maxBuffer: 64e6 });
  // Windows line ends; the PDF puts zero-width spaces between numbers and headings
  raw = raw.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').replace(/[​‌‍﻿]/g, ' ').normalize('NFKC'); // and ligatures (ﬁ) as letters
  // the contents pages come first: the body starts at the second "1.1 SCOPE"
  const scope = [...raw.matchAll(/^1\.1\s*SCOPE\b/gm)];
  const start = scope.length > 1 ? scope[1].index : 0;
  // running headers and page numbers
  const body = raw.slice(start).split('\n').filter((l) => !/^\s*\d{1,3}\s*$/.test(l) && !/^\s*2026 RULES OF COMPETITION\s*$/i.test(l)).join('\n');
  // every place a section number could start: at a line start, or mid-line after a full stop ("... purposes. 3.21.2 Failure")
  // (after any space: "3.22 TIMING 3.22.1 The winner"; a heading can start with a number: "4.1.1 6', 7', 8', 9' WALLS")
  const cands = [...body.matchAll(/(^|\s)(\d{1,2}(?:\.\d{1,2}){1,3})(?=[\s.]*[A-Z0-9("“'a-z])/g)].map((m) => ({ at: m.index + m[1].length, n: m[2] }));
  // a real section follows the one before it: its first child (3.17 -> 3.17.1), or the next at some level, a gap of up to 3
  // allowed, with any deeper levels starting at 1 (3.4.3 -> 3.5 or 3.5.1). Anything else is a cross-reference in the text.
  const follows = (cur, n) => {
    const a = cur.split('.').map(Number), b = n.split('.').map(Number);
    if (b.length === a.length + 1 && n.startsWith(`${cur}.`) && b[b.length - 1] <= 1) return true;
    for (let k = 1; k <= a.length; k++) {
      if (b.length < k) break;
      if (a.slice(0, k - 1).some((x, i) => x !== b[i])) continue;
      const d = b[k - 1] - a[k - 1];
      if (d >= 1 && d <= 3 && b.slice(k).every((x) => x <= 1)) return true;
    }
    return false;
  };
  const picked = [];
  let cur = '0';
  for (const c of cands) if (follows(cur, c.n)) { picked.push(c); cur = c.n; }
  const out = [];
  const titles = {};
  for (let i = 0; i < picked.length; i++) {
    const { n, at } = picked[i];
    let text = clean(body.slice(at + n.length, i + 1 < picked.length ? picked[i + 1].at : undefined)).replace(/^\.\s*/, ''); // "4.1.2 . 10’ WALL"
    let title = '';
    const head = text.match(/^([A-Z0-9][A-Z0-9 ,&/()'’-]{2,80}?)(?=\s+(?:[a-z]\)|[A-Z][a-z])|\n|$)/);
    if (head && head[1].replace(/[^A-Z]/g, '').length >= 3) { title = titleCase(head[1].trim()); text = text.slice(head[0].length).trim(); }
    if (n.split('.').length <= 2 && title) titles[n] = title;
    out.push({ section: n, title, text });
  }
  for (const s of out) {
    const ch = s.section.split('.').slice(0, 2).join('.');
    s.chapter = ch; s.chapterTitle = titles[ch] || titles[s.section.split('.')[0]] || '';
    if (!s.title) s.title = (s.text.split(/(?<=[.!?])\s/)[0] || '').replace(/\s+/g, ' ').slice(0, 90).replace(/\s+\S*$/, (m) => (m.length > 0 && s.text.length > 90 ? '…' : m)) || s.chapterTitle;
    if (s.title.length > 120) s.title = `${s.title.slice(0, 117)}…`;
  }
  return out.filter((s) => s.text || s.title);
}

/** the SOP: [{ section: '4.2.2' or 'sop-12', title, text }] from its headings */
export function sopSections(docx = SOP_DOCX) {
  const py = `
import docx, json, sys
d = docx.Document(sys.argv[1])
body = d.element.body
out = []
from docx.table import Table
from docx.text.paragraph import Paragraph
for child in body.iterchildren():
    tag = child.tag.split('}')[1]
    if tag == 'p':
        p = Paragraph(child, d)
        t = p.text.strip()
        if t: out.append({'style': p.style.name, 'text': t})
    elif tag == 'tbl':
        tb = Table(child, d)
        rows = [' | '.join(c.text.strip().replace('\\n', ' / ') for c in r.cells) for r in tb.rows]
        out.append({'style': 'Table', 'text': '\\n'.join(rows)})
print(json.dumps(out))`;
  const paras = JSON.parse(execFileSync('python', ['-c', py, docx], { encoding: 'utf8', maxBuffer: 64e6 }));
  const out = [];
  let cur = null, i = 0;
  for (const p of paras) {
    const heading = /^Heading [123]$/.test(p.style) || (p.style === 'Title' && !/INDEX/i.test(p.text));
    // a definition is a Heading 3 with its meaning after a colon: kept as one section each
    if (heading) {
      const m = p.text.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/);
      const [num, rest] = m ? [m[1], m[2]] : [null, p.text];
      const def = rest.match(/^([^:]{2,60}):\s+(.+)$/);
      cur = { section: num || `${out.length ? out[out.length - 1].section.split('/')[0] : 'sop'}/${++i}`, title: def ? def[1] : (rest === rest.toUpperCase() ? sentenceCase(rest) : rest), text: def ? def[2] : '' };
      if (num) i = 0;
      out.push(cur);
    } else if (cur) cur.text += `${cur.text ? '\n' : ''}${p.text}`;
  }
  return out.map((s) => ({ ...s, text: clean(s.text) })).filter((s) => s.text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = rulebookSections(), s = sopSections();
  console.log(`Rules of Competition: ${r.length} sections; SOP: ${s.length} sections`);
  const dump = process.argv[2];
  if (dump) fs.writeFileSync(dump, JSON.stringify({ rules: r, sop: s }, null, 1));
  for (const x of [...r.slice(0, 6), ...r.filter((x) => /^(3\.17\.4|4\.2\.13|3\.21\.2)$/.test(x.section)), ...s.slice(0, 4)]) console.log(`- ${x.section} | ${x.title} | ${x.text.slice(0, 120).replace(/\n/g, ' ')}`);
}

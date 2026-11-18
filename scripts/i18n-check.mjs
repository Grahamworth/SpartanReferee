// Checks one language's dictionary against the list to translate: valid JSON, nothing missing, nothing extra, and every
// translation keeping the English's {slots} and <0>…</0> markers.
//   node scripts/i18n-check.mjs fr
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = process.argv[2];
if (!/^[a-z]{2}$/.test(code || '')) { console.log('Usage: node scripts/i18n-check.mjs <two-letter code>'); process.exit(2); }
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/en.json'), 'utf8'));
let d;
try { d = JSON.parse(fs.readFileSync(path.join(ROOT, `i18n/${code}.json`), 'utf8')); } catch (e) { console.log(`i18n/${code}.json: ${e.message}`); process.exit(1); }
const marks = (s) => [...String(s).matchAll(/\{\w+\}|<\/?\d+>/g)].map((m) => m[0]).sort().join(' ');
const problems = [];
for (const [k, v] of Object.entries(d)) {
  if (!(k in en)) { problems.push(`not in en.json: ${JSON.stringify(k)}`); continue; }
  if (v && typeof v === 'object') {
    if (!v.other) problems.push(`plural forms need "other": ${JSON.stringify(k)}`);
    for (const [form, s] of Object.entries(v)) if (!['zero', 'one', 'two', 'few', 'many', 'other'].includes(form) || typeof s !== 'string') problems.push(`bad plural form ${form}: ${JSON.stringify(k)}`);
    const tags = (s) => [...String(s).matchAll(/<\/?\d+>/g)].map((m) => m[0]).sort().join(' ');
    if (v.other && tags(v.other) !== tags(k)) problems.push(`markers differ: ${JSON.stringify(k)} -> ${JSON.stringify(v.other)}`);
    continue;
  }
  if (typeof v !== 'string' || !v.trim()) { problems.push(`empty: ${JSON.stringify(k)}`); continue; }
  if (marks(v) !== marks(k)) problems.push(`slots or markers differ: ${JSON.stringify(k)} -> ${JSON.stringify(v)}`);
}
const missing = Object.keys(en).filter((k) => !(k in d));
console.log(`i18n/${code}.json: ${Object.keys(d).length} of ${Object.keys(en).length} texts, ${missing.length} not done, ${problems.length} problems`);
for (const p of problems.slice(0, 40)) console.log('  ' + p);
if (missing.length) console.log('  not done (first 20):\n' + missing.slice(0, 20).map((k) => '    ' + JSON.stringify(k.slice(0, 100))).join('\n'));
process.exit(problems.length ? 1 : 0);

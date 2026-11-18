// Marks data-i18n on the pages' sentences that have a link or bold words in them, so i18n.js translates each as a whole
// ("New to X? <0>Register</0> first.") rather than in pieces whose order might not suit another language. Safe to run again.
//   node scripts/i18n-mark.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES } from './i18n-extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOCKS = /<(p|div|ul|ol|li|table|section|select|textarea|h[1-6]|details|summary|form|fieldset|figure|header|footer|nav|main|aside|video|canvas|img|svg|br)\b/i;
let total = 0;
for (const f of FILES.filter((x) => x.endsWith('.html'))) {
  const file = path.join(ROOT, f);
  let src = fs.readFileSync(file, 'utf8'), n = 0;
  src = src.replace(/<(p|li|h[1-6]|label|dd|dt|summary|figcaption|td|th|small)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (m, tag, at = '', inner) => {
    if (/\sdata-i18n\b/.test(at) || BLOCKS.test(inner) || !/<[a-z]/i.test(inner)) return m;
    const kids = [...inner.matchAll(/<([a-z0-9]+)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
    if (kids.some((k) => /<[a-z]/i.test(k[2]))) return m; // children with children of their own: left in pieces
    const outside = inner.replace(/<([a-z0-9]+)\b[^>]*>[\s\S]*?<\/\1>/gi, '\u0000').replace(/<[^>]+>/g, '\u0000');
    const runs = outside.split('\u0000').filter((s) => /\p{L}/u.test(s));
    if (!runs.length || runs.length + kids.filter((k) => k[2].trim()).length < 2) return m;
    n++;
    return `<${tag}${at} data-i18n>${inner}</${tag}>`;
  });
  if (n) fs.writeFileSync(file, src);
  console.log(`${f}: ${n} marked`);
  total += n;
}
console.log(`${total} in all`);

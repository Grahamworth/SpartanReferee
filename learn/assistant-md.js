// The Assistant's answers as HTML (learn/assistant.js): no page code here, so the tests can load it.
// (its own esc, as api-base.js needs a page around it)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// an answer's Markdown, the little it uses: paragraphs, bullet and numbered lists, bold, and links, only into this app or the site's
// event and results pages (anything else stays words)
export const SAFE = /^(#\/[\w%./?=&~-]*|\/(?:event|results)\.html\?[\w%.=&~-]*)$/;
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => { const u = url.replace(/&amp;/g, '&'); return SAFE.test(u) ? `<a href="${esc(u)}">${text}</a>` : text; })
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}
export function markdown(md) {
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line), num = /^\d{1,2}[.)]\s+(.*)$/.exec(line);
    if (bullet || num) { const kind = bullet ? 'ul' : 'ol'; if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; } out.push(`<li>${inline((bullet || num)[1])}</li>`); continue; }
    close();
    if (line) out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join('');
}


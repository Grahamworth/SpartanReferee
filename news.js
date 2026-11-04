// News: the organisers' own news (admins edit it here), then the latest stories from Spartan's blogs.
import { call, esc, getMe } from './api-base.js';
import { editor, field, val } from './hub-edit.js';

const $ = (id) => document.getElementById(id);
const fmtDate = (d) => { const x = new Date(d + 'T12:00:00'); return isNaN(x) ? d : x.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); };
let C = null;

async function loadLocal() {
  try { C = await call('content'); } catch (e) { $('local').innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; return; }
  $('local').innerHTML = C.news.length ? C.news.map((n) => `<article><h3>${esc(n.title)}</h3>${n.date ? `<time>${esc(fmtDate(n.date))}</time>` : ''}${n.text ? `<p>${esc(n.text)}</p>` : ''}</article>`).join('')
    : '<div class="empty">No news from the organisers yet.</div>';
}
async function loadSpartan() {
  let r;
  try { r = await call('news'); } catch (e) { $('articles').innerHTML = `<div class="empty">Couldn't load Spartan’s news: ${esc(e.message)}</div>`; return; }
  $('articles').innerHTML = r.articles.length ? r.articles.map((a) => `<a class="article" href="${esc(a.url)}" target="_blank" rel="noopener">
      ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <div><small>${esc(a.blog)} · ${esc(fmtDate(a.date))}</small><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p></div></a>`).join('')
    : '<div class="empty">No stories right now.</div>';
}
const newsItem = (n = {}) => `<div class="item"><button type="button" class="rm" aria-label="Remove">×</button>${field('Headline', 'title', n.title || '')}${field('Date', 'date', n.date || new Date().toISOString().slice(0, 10), 'date')}${field('Story', 'text', n.text || '', 'area')}</div>`;
$('editNews').onclick = () => editor('From the organisers', C.news.map(newsItem).join(''),
  (b) => call('content/news', { method: 'PUT', body: { value: [...b.querySelectorAll('.item')].map((it) => ({ title: val(it, 'title'), date: val(it, 'date'), text: val(it, 'text') })) } }).then(loadLocal),
  (b) => b.insertAdjacentHTML('afterbegin', newsItem()));
getMe().then((me) => { $('editNews').hidden = !me.admin; });
loadLocal(); loadSpartan();
